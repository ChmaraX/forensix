package collector

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

const (
	keyMaterialRecordSchema     = "forensix/key-material-record/1"
	keyMaterialManifestSchema   = "forensix/key-material-manifest/1"
	keyMaterialSealingAlgorithm = "x25519-hkdf-sha256-aes-256-gcm"
)

var safeRecordID = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

type KeyCapturer interface {
	Capture(platformscanner.UserDataDir) KeyCaptureResult
}

type KeyCaptureResult struct {
	Records  []CapturedKeyRecord
	Evidence []CapturedKeyEvidence
}

type CapturedKeyRecord struct {
	RecordID     string
	CaptureState string
	KeyKind      string
	UsableRowKey bool
	Provider     KeyProviderMetadata
	Context      []KeyContext
	Policy       KeyPolicyEvidence
	Evidence     []KeyEvidenceReference
	DerivedKey   []byte
}

type CapturedKeyEvidence struct {
	Path    string
	Content []byte
}

type KeyProviderMetadata struct {
	Platform string `json:"platform"`
	Name     string `json:"name"`
	Item     string `json:"item"`
	Scope    string `json:"scope"`
}

type KeyContext struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type KeyPolicyEvidence struct {
	RowPrefix string `json:"row_prefix"`
	Support   string `json:"support"`
	Reason    string `json:"reason,omitempty"`
}

type KeyEvidenceReference struct {
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
	Version string `json:"version,omitempty"`
	Policy  string `json:"policy,omitempty"`
}

type sealedKeyMaterial struct {
	Algorithm            string `json:"algorithm"`
	RecipientFingerprint string `json:"recipient_fingerprint"`
	EphemeralPublicKey   string `json:"ephemeral_public_key"`
	Salt                 string `json:"salt"`
	Nonce                string `json:"nonce"`
	Ciphertext           string `json:"ciphertext"`
	AssociatedDataSHA256 string `json:"associated_data_sha256"`
}

type keyMaterialRecord struct {
	SchemaVersion  string                 `json:"schema_version"`
	RecordID       string                 `json:"record_id"`
	CaptureState   string                 `json:"capture_state"`
	KeyKind        string                 `json:"key_kind"`
	UsableRowKey   bool                   `json:"usable_row_key"`
	Provider       KeyProviderMetadata    `json:"provider"`
	Context        []KeyContext           `json:"context"`
	Policy         KeyPolicyEvidence      `json:"policy"`
	Evidence       []KeyEvidenceReference `json:"evidence"`
	SealedMaterial *sealedKeyMaterial     `json:"sealed_material"`
}

type KeyMaterialManifestEntry struct {
	Path          string `json:"path"`
	Size          int64  `json:"size"`
	HashAlgorithm string `json:"hash_algorithm"`
	SHA256        string `json:"sha256"`
}

type KeyMaterialManifestHeader struct {
	ManifestSchema string `json:"manifest_schema"`
	HashAlgorithm  string `json:"hash_algorithm"`
	ManifestDigest string `json:"manifest_digest"`
	EntryCount     int    `json:"entry_count"`
}

func ParseKeyMaterialRecipient(content []byte) ([]byte, error) {
	if block, _ := pem.Decode(content); block != nil {
		public, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, errors.New("parse key-material recipient PEM")
		}
		key, ok := public.(*ecdh.PublicKey)
		if !ok || len(key.Bytes()) != 32 {
			return nil, errors.New("key-material recipient must be an X25519 public key")
		}
		return append([]byte(nil), key.Bytes()...), nil
	}

	text := strings.TrimSpace(string(content))
	const prefix = "forensix-x25519-public-v1:"
	if !strings.HasPrefix(text, prefix) {
		return nil, errors.New("key-material recipient must be X25519 PEM or forensix-x25519-public-v1 base64")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(text, prefix))
	if err != nil || len(decoded) != 32 {
		return nil, errors.New("key-material recipient contains an invalid X25519 public key")
	}
	return decoded, nil
}

func recipientFingerprint(recipient []byte) string {
	if len(recipient) == 0 {
		return ""
	}
	sum := sha256.Sum256(recipient)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func writeKeyMaterialSubtree(destination, bundlePath, accountID string, capture KeyCaptureResult, recipient []byte, random io.Reader) (BundleKeyMaterial, error) {
	defer func() {
		for i := range capture.Records {
			zeroBytes(capture.Records[i].DerivedKey)
		}
	}()
	summary := BundleKeyMaterial{AccountID: accountID, BundlePath: bundlePath, CaptureState: "unavailable"}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return summary, err
	}
	if len(capture.Records) == 0 {
		capture.Records = []CapturedKeyRecord{{
			RecordID: "provider-unavailable", CaptureState: "unavailable", KeyKind: "oscrypt_row_key",
			Provider: KeyProviderMetadata{Platform: "unknown", Name: "unavailable", Item: "Chrome Safe Storage", Scope: "live_account"},
			Policy:   KeyPolicyEvidence{Support: "unavailable", Reason: "provider-returned-no-record"},
		}}
	}

	evidenceDigests := make(map[string]string, len(capture.Evidence))
	sort.Slice(capture.Evidence, func(i, j int) bool { return capture.Evidence[i].Path < capture.Evidence[j].Path })
	for _, evidence := range capture.Evidence {
		if !canonicalKeyMaterialPath(evidence.Path) || !strings.HasPrefix(evidence.Path, "evidence/") {
			return summary, fmt.Errorf("key-material evidence path is not canonical: %q", evidence.Path)
		}
		if _, exists := evidenceDigests[evidence.Path]; exists {
			return summary, fmt.Errorf("duplicate key-material evidence path %q", evidence.Path)
		}
		evidenceDigests[evidence.Path] = conformance.Digest(evidence.Content)
		evidencePath := filepath.Join(destination, filepath.FromSlash(evidence.Path))
		if err := os.MkdirAll(filepath.Dir(evidencePath), 0o700); err != nil {
			return summary, err
		}
		if err := conformance.WriteFile(evidencePath, evidence.Content); err != nil {
			return summary, err
		}
	}

	sort.Slice(capture.Records, func(i, j int) bool { return capture.Records[i].RecordID < capture.Records[j].RecordID })
	seenRecords := make(map[string]bool, len(capture.Records))
	unsupported := false
	for i := range capture.Records {
		record := &capture.Records[i]
		if !safeRecordID.MatchString(record.RecordID) || seenRecords[record.RecordID] {
			zeroBytes(record.DerivedKey)
			return summary, fmt.Errorf("invalid or duplicate key-material record id %q", record.RecordID)
		}
		seenRecords[record.RecordID] = true
		if record.CaptureState == "unsupported" {
			unsupported = true
		}
		if record.UsableRowKey != (record.CaptureState == "captured") || (record.UsableRowKey && len(record.DerivedKey) == 0) || (!record.UsableRowKey && len(record.DerivedKey) != 0) {
			zeroBytes(record.DerivedKey)
			return summary, fmt.Errorf("key-material record %q has inconsistent capture state", record.RecordID)
		}
		sort.Slice(record.Context, func(i, j int) bool {
			if record.Context[i].Name == record.Context[j].Name {
				return record.Context[i].Value < record.Context[j].Value
			}
			return record.Context[i].Name < record.Context[j].Name
		})
		sort.Slice(record.Evidence, func(i, j int) bool { return record.Evidence[i].Path < record.Evidence[j].Path })
		for j := range record.Evidence {
			digest, ok := evidenceDigests[record.Evidence[j].Path]
			if !ok {
				zeroBytes(record.DerivedKey)
				return summary, fmt.Errorf("key-material record %q references missing evidence %q", record.RecordID, record.Evidence[j].Path)
			}
			record.Evidence[j].SHA256 = digest
		}
		wire := keyMaterialRecord{
			SchemaVersion: keyMaterialRecordSchema, RecordID: record.RecordID, CaptureState: record.CaptureState,
			KeyKind: record.KeyKind, UsableRowKey: record.UsableRowKey, Provider: record.Provider,
			Context: record.Context, Policy: record.Policy, Evidence: record.Evidence,
		}
		if wire.Context == nil {
			wire.Context = []KeyContext{}
		}
		if wire.Evidence == nil {
			wire.Evidence = []KeyEvidenceReference{}
		}
		if record.UsableRowKey {
			aad, err := keyMaterialAssociatedData(wire)
			if err != nil {
				zeroBytes(record.DerivedKey)
				return summary, err
			}
			wire.SealedMaterial, err = sealDerivedKey(recipient, record.DerivedKey, aad, random)
			zeroBytes(record.DerivedKey)
			if err != nil {
				return summary, fmt.Errorf("seal key-material record %q: %w", record.RecordID, err)
			}
			summary.UsableRowKeyCount++
		}
		recordPath := filepath.Join(destination, "records", record.RecordID+".json")
		if err := os.MkdirAll(filepath.Dir(recordPath), 0o700); err != nil {
			return summary, err
		}
		if err := conformance.WriteJSON(recordPath, wire); err != nil {
			return summary, err
		}
	}

	entries, lines, err := keyMaterialManifest(destination)
	if err != nil {
		return summary, err
	}
	digest := conformance.Digest(lines)
	if err := conformance.WriteFile(filepath.Join(destination, "key_material_manifest.jsonl"), lines); err != nil {
		return summary, err
	}
	header := KeyMaterialManifestHeader{ManifestSchema: keyMaterialManifestSchema, HashAlgorithm: conformance.HashAlgorithm, ManifestDigest: digest, EntryCount: len(entries)}
	if err := conformance.WriteJSON(filepath.Join(destination, "key_material_manifest_header.json"), header); err != nil {
		return summary, err
	}
	summary.ManifestDigest, summary.EntryCount = digest, len(entries)
	if summary.UsableRowKeyCount > 0 {
		summary.CaptureState = "captured"
	} else if unsupported {
		summary.CaptureState = "evidence_only"
	}
	return summary, nil
}

func keyMaterialAssociatedData(record keyMaterialRecord) ([]byte, error) {
	record.SealedMaterial = nil
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	return append(encoded, '\n'), nil
}

func sealDerivedKey(recipient, plaintext, aad []byte, random io.Reader) (*sealedKeyMaterial, error) {
	curve := ecdh.X25519()
	recipientKey, err := curve.NewPublicKey(recipient)
	if err != nil {
		return nil, errors.New("invalid X25519 recipient public key")
	}
	ephemeral, err := curve.GenerateKey(random)
	if err != nil {
		return nil, err
	}
	shared, err := ephemeral.ECDH(recipientKey)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(shared)
	salt := make([]byte, 32)
	if _, err := io.ReadFull(random, salt); err != nil {
		return nil, err
	}
	wrappingKey, err := hkdf.Key(sha256.New, shared, salt, "forensix/key-material-seal/1", 32)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(wrappingKey)
	block, err := aes.NewCipher(wrappingKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(random, nonce); err != nil {
		return nil, err
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, aad)
	return &sealedKeyMaterial{
		Algorithm: keyMaterialSealingAlgorithm, RecipientFingerprint: recipientFingerprint(recipient),
		EphemeralPublicKey: base64.StdEncoding.EncodeToString(ephemeral.PublicKey().Bytes()),
		Salt:               base64.StdEncoding.EncodeToString(salt), Nonce: base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext), AssociatedDataSHA256: conformance.Digest(aad),
	}, nil
}

func keyMaterialManifest(root string) ([]KeyMaterialManifestEntry, []byte, error) {
	var entries []KeyMaterialManifestEntry
	err := filepath.WalkDir(root, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported key-material node %q", filePath)
		}
		rel, err := filepath.Rel(root, filePath)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "key_material_manifest.jsonl" || rel == "key_material_manifest_header.json" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		digest, err := hashFile(filePath)
		if err != nil {
			return err
		}
		entries = append(entries, KeyMaterialManifestEntry{Path: rel, Size: info.Size(), HashAlgorithm: conformance.HashAlgorithm, SHA256: digest})
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	var lines bytes.Buffer
	for _, entry := range entries {
		if !canonicalKeyMaterialPath(entry.Path) {
			return nil, nil, fmt.Errorf("key-material Manifest path is not canonical: %q", entry.Path)
		}
		encoded, err := json.Marshal(entry)
		if err != nil {
			return nil, nil, err
		}
		lines.Write(encoded)
		lines.WriteByte('\n')
	}
	return entries, lines.Bytes(), nil
}

func canonicalKeyMaterialPath(value string) bool {
	return value != "" && !strings.HasPrefix(value, "/") && !strings.ContainsAny(value, `\:`) && path.Clean(value) == value && value != "." && value != ".." && !strings.HasPrefix(value, "../")
}

func zeroBytes(value []byte) {
	for i := range value {
		value[i] = 0
	}
}
