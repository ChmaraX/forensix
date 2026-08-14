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
	"encoding/pem"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

type fixedKeyCapturer struct{ result KeyCaptureResult }

func (capturer fixedKeyCapturer) Capture(platformscanner.UserDataDir) KeyCaptureResult {
	return capturer.result
}

type panicKeyCapturer struct{}

func (panicKeyCapturer) Capture(platformscanner.UserDataDir) KeyCaptureResult {
	panic("key capturer called without opt-in")
}

func TestKeyMaterialCaptureIsDisabledByDefault(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	bundle, err := (Collector{Scanner: fixedScanner{scan}, KeyCapturer: panicKeyCapturer{}}).Run(Options{
		Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "CASE-187/lab-lead",
	})
	if err != nil {
		t.Fatal(err)
	}
	if bundle.KeyMaterialCaptureRequested || bundle.KeyMaterialCaptured || bundle.KeyMaterialStripped || len(bundle.KeyMaterial) != 0 {
		t.Fatalf("key capture was not disabled: %#v", bundle)
	}
	if _, err := os.Stat(filepath.Join(out, "key_material")); !os.IsNotExist(err) {
		t.Fatal("key-material subtree exists without opt-in")
	}
	var record CollectorRecord
	readJSON(t, filepath.Join(out, "collector_record.json"), &record)
	if record.KeyMaterialCapture.Requested || record.KeyMaterialCapture.RecipientFingerprint != "" {
		t.Fatalf("collector record claims key capture: %#v", record.KeyMaterialCapture)
	}
}

func TestLiveKeyStoreAccessIsBoundToCurrentAccountIdentityAndHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	accountID, err := currentAccountID()
	if err != nil {
		t.Fatal(err)
	}
	inside := platformscanner.UserDataDir{AccountID: accountID, Path: filepath.Join(home, ".config", "google-chrome")}
	wrongIdentity := platformscanner.UserDataDir{AccountID: accountID + "-different", Path: inside.Path}
	outside := platformscanner.UserDataDir{AccountID: accountID, Path: filepath.Join(filepath.Dir(home), "different-account", ".config", "google-chrome")}
	if !currentAccountCanReadLiveStore(inside) {
		t.Fatal("current account User Data Dir was not recognized")
	}
	if currentAccountCanReadLiveStore(wrongIdentity) {
		t.Fatal("different account identity was allowed to use the current process live key store")
	}
	if currentAccountCanReadLiveStore(outside) {
		t.Fatal("path outside the current account home was allowed to use its live key store")
	}
}

func TestKeyMaterialCaptureRequiresOptInAuthorizationAndRecipient(t *testing.T) {
	scanner := fixedScanner{}
	private, recipient := x25519Recipient(t)
	_ = private
	cases := []struct {
		name string
		opts Options
		want string
	}{
		{name: "authorization", opts: Options{Output: filepath.Join(t.TempDir(), "a"), OperatorIdentifier: "examiner", CaptureKeyMaterial: true, KeyMaterialRecipient: recipient}, want: "authorization"},
		{name: "whitespace authorization", opts: Options{Output: filepath.Join(t.TempDir(), "whitespace"), OperatorIdentifier: "examiner", AuthorizationReference: " \t\n", CaptureKeyMaterial: true, KeyMaterialRecipient: recipient}, want: "authorization"},
		{name: "recipient", opts: Options{Output: filepath.Join(t.TempDir(), "b"), OperatorIdentifier: "examiner", AuthorizationReference: "CASE-187", CaptureKeyMaterial: true}, want: "recipient"},
		{name: "opt-in", opts: Options{Output: filepath.Join(t.TempDir(), "c"), OperatorIdentifier: "examiner", AuthorizationReference: "CASE-187", KeyMaterialRecipient: recipient}, want: "opt-in"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := (Collector{Scanner: scanner}).Run(test.opts)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v want substring %q", err, test.want)
			}
		})
	}
}

func TestAuthorizedKeyCaptureSealsDerivedKeyAndPreservesSourceBytes(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), `{"os_crypt":"opaque"}`)
	mustWrite(t, filepath.Join(source, "Default", "Login Data"), "encrypted Source row: v10-not-decrypted")
	before := snapshot(t, source)
	private, recipient := x25519Recipient(t)
	secret := []byte("0123456789abcdef0123456789abcdef")
	capturer := fixedKeyCapturer{KeyCaptureResult{
		Evidence: []CapturedKeyEvidence{{Path: "evidence/provider-context.bin", Content: []byte("opaque provider context")}},
		Records: []CapturedKeyRecord{{
			RecordID: "test-provider-v10", CaptureState: "captured", KeyKind: "oscrypt_row_key", UsableRowKey: true,
			Provider:   KeyProviderMetadata{Platform: "linux", Name: "gnome-libsecret", Item: "Chrome Safe Storage", Scope: "live_account_session"},
			Context:    []KeyContext{{Name: "application", Value: "chrome"}},
			Policy:     KeyPolicyEvidence{RowPrefix: "v10", Support: "supported"},
			Evidence:   []KeyEvidenceReference{{Path: "evidence/provider-context.bin", Version: "fixture", Policy: "authorized-copy"}},
			DerivedKey: append([]byte(nil), secret...),
		}},
	}}
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "alice", Path: source}}}
	bundle, err := (Collector{Scanner: fixedScanner{scan}, KeyCapturer: capturer, Random: bytes.NewReader(bytes.Repeat([]byte{0x5a}, 4096))}).Run(Options{
		Output: out, OperatorIdentifier: "examiner-7", AuthorizationReference: "CASE-187; authorized by lab lead",
		CaptureKeyMaterial: true, KeyMaterialRecipient: recipient,
	})
	if err != nil {
		t.Fatal(err)
	}
	if after := snapshot(t, source); !reflect.DeepEqual(before, after) {
		t.Fatalf("Source changed during key capture\nbefore=%#v\nafter=%#v", before, after)
	}
	if !bundle.KeyMaterialCaptureRequested || !bundle.KeyMaterialCaptured || len(bundle.KeyMaterial) != 1 || bundle.KeyMaterial[0].UsableRowKeyCount != 1 {
		t.Fatalf("key-material summary incomplete: %#v", bundle)
	}
	keyRoot := filepath.Join(out, "key_material", "alice", "udd-1")
	manifestBytes, err := os.ReadFile(filepath.Join(keyRoot, "key_material_manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var header KeyMaterialManifestHeader
	readJSON(t, filepath.Join(keyRoot, "key_material_manifest_header.json"), &header)
	if header.ManifestSchema != keyMaterialManifestSchema || header.ManifestDigest != conformance.Digest(manifestBytes) || header.ManifestDigest != bundle.KeyMaterial[0].ManifestDigest || header.EntryCount != 2 {
		t.Fatalf("independent key-material Manifest is invalid: %#v", header)
	}
	lines := strings.Split(strings.TrimSpace(string(manifestBytes)), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"path":"evidence/provider-context.bin"`) || !strings.Contains(lines[1], `"path":"records/test-provider-v10.json"`) {
		t.Fatalf("key-material Manifest is incomplete or not path-sorted: %s", manifestBytes)
	}

	var record keyMaterialRecord
	readJSON(t, filepath.Join(keyRoot, "records", "test-provider-v10.json"), &record)
	if record.Provider.Name != "gnome-libsecret" || record.Policy.RowPrefix != "v10" || record.SealedMaterial == nil || !record.UsableRowKey {
		t.Fatalf("provider/context metadata incomplete: %#v", record)
	}
	if got := unsealTestRecord(t, private, record); !bytes.Equal(got, secret) {
		t.Fatalf("sealed key mismatch: %x", got)
	}
	assertTreeDoesNotContain(t, out, secret)

	var collectorRecord CollectorRecord
	readJSON(t, filepath.Join(out, "collector_record.json"), &collectorRecord)
	if !collectorRecord.KeyMaterialCapture.Requested || collectorRecord.KeyMaterialCapture.AuthorizationReference == "" || collectorRecord.KeyMaterialCapture.SealingAlgorithm != keyMaterialSealingAlgorithm || collectorRecord.KeyMaterialCapture.RecipientFingerprint != recipientFingerprint(recipient) {
		t.Fatalf("authorization or sealing claim missing: %#v", collectorRecord.KeyMaterialCapture)
	}
	assertBundleFiles(t, out, bundle)
}

func TestLegacyWindowsCaptureReturnsOnlyTheDPAPIDerivedRowKey(t *testing.T) {
	source := t.TempDir()
	protected := []byte("opaque-dpapi-wrapper")
	wrapper := append([]byte("DPAPI"), protected...)
	state := `{"os_crypt":{"encrypted_key":"` + base64.StdEncoding.EncodeToString(wrapper) + `"}}`
	mustWrite(t, filepath.Join(source, "Local State"), state)
	rowKey := bytes.Repeat([]byte{0x8a}, 32)
	capture := captureWindowsLocalState(source, func(got []byte) ([]byte, error) {
		if !bytes.Equal(got, protected) {
			t.Fatalf("DPAPI input=%x want=%x", got, protected)
		}
		return append([]byte(nil), rowKey...), nil
	})
	if len(capture.Records) != 1 || !capture.Records[0].UsableRowKey || capture.Records[0].CaptureState != "captured" || !bytes.Equal(capture.Records[0].DerivedKey, rowKey) {
		t.Fatalf("legacy Windows row key was not captured: %#v", capture.Records)
	}
	if len(capture.Evidence) != 1 || !bytes.Equal(capture.Evidence[0].Content, wrapper) || capture.Records[0].Evidence[0].Version != "DPAPI" {
		t.Fatal("exact legacy Local State wrapper or DPAPI context was not preserved")
	}
}

func TestWindowsV20CapturePreservesWrapperVersionAndPolicyWithoutUsableKey(t *testing.T) {
	source := t.TempDir()
	wrapper := append([]byte("APPB"), []byte{0x01, 0x02, 0x03, 0x04}...)
	state := `{"os_crypt":{"app_bound_encrypted_key":"` + base64.StdEncoding.EncodeToString(wrapper) + `"}}`
	mustWrite(t, filepath.Join(source, "Local State"), state)
	capture := captureWindowsLocalState(source, func([]byte) ([]byte, error) {
		t.Fatal("v20 wrapper must not be unwrapped as a usable row key")
		return nil, nil
	})
	if len(capture.Records) != 1 || capture.Records[0].CaptureState != "unsupported" || capture.Records[0].UsableRowKey || len(capture.Records[0].DerivedKey) != 0 {
		t.Fatalf("v20 support was overstated: %#v", capture.Records)
	}
	record := capture.Records[0]
	if record.Policy.RowPrefix != "v20" || record.Policy.Reason != "unsupported-google-app-bound-key-variant" || len(record.Evidence) != 1 || record.Evidence[0].Version != "v20" {
		t.Fatalf("v20 wrapper/version/policy evidence incomplete: %#v", record)
	}
	if len(capture.Evidence) != 1 || !bytes.Equal(capture.Evidence[0].Content, wrapper) {
		t.Fatal("exact App-Bound wrapper was not preserved")
	}
}

func TestStripKeysProducesIndependentSelfConsistentBundle(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	mustWrite(t, filepath.Join(source, "Default", "History"), "history")
	private, recipient := x25519Recipient(t)
	_ = private
	secret := []byte("abcdef0123456789")
	capture := KeyCaptureResult{Records: []CapturedKeyRecord{{
		RecordID: "linux-basic-v10", CaptureState: "captured", KeyKind: "oscrypt_row_key", UsableRowKey: true,
		Provider: KeyProviderMetadata{Platform: "linux", Name: "basic", Item: "hard-coded basic password", Scope: "browser_default"},
		Policy:   KeyPolicyEvidence{RowPrefix: "v10", Support: "supported"}, DerivedKey: append([]byte(nil), secret...),
	}}}
	original := filepath.Join(t.TempDir(), "with-keys")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	originalManifest, err := (Collector{Scanner: fixedScanner{scan}, KeyCapturer: fixedKeyCapturer{capture}, Random: bytes.NewReader(bytes.Repeat([]byte{0x33}, 4096))}).Run(Options{
		Output: original, OperatorIdentifier: "examiner", AuthorizationReference: "CASE-187", CaptureKeyMaterial: true, KeyMaterialRecipient: recipient,
	})
	if err != nil {
		t.Fatal(err)
	}
	originalSourceManifest, err := os.ReadFile(filepath.Join(original, "accounts", "a", "udd-1", "manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	stripped := filepath.Join(t.TempDir(), "without-keys")
	strippedManifest, err := StripKeys(original, stripped)
	if err != nil {
		t.Fatal(err)
	}
	if strippedManifest.KeyMaterialCaptured || !strippedManifest.KeyMaterialStripped || strippedManifest.OriginalBundleDigest != originalManifest.BundleDigest || strippedManifest.BundleDigest == originalManifest.BundleDigest || len(strippedManifest.KeyMaterial) != 0 {
		t.Fatalf("strip provenance or digest invalid: %#v", strippedManifest)
	}
	if _, err := os.Stat(filepath.Join(stripped, "key_material")); !os.IsNotExist(err) {
		t.Fatal("stripped bundle still contains key-material subtree")
	}
	if _, err := os.Stat(filepath.Join(original, "key_material")); err != nil {
		t.Fatal("strip operation modified original Acquisition Bundle")
	}
	strippedSourceManifest, err := os.ReadFile(filepath.Join(stripped, "accounts", "a", "udd-1", "manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalSourceManifest, strippedSourceManifest) {
		t.Fatal("strip operation changed the Source Manifest")
	}
	if err := verifyBundleManifest(stripped, strippedManifest); err != nil {
		t.Fatalf("stripped Acquisition Bundle is not self-consistent: %v", err)
	}
	for _, file := range strippedManifest.Files {
		if strings.HasPrefix(file.Path, "key_material/") {
			t.Fatalf("stripped bundle Manifest retains key-material path %q", file.Path)
		}
	}
}

func TestCanonicalBundlePathsRejectTraversalAndWindowsVolumes(t *testing.T) {
	for _, value := range []string{"../outside", "nested/../outside", `/absolute`, `C:/outside`, `nested\\outside`} {
		if canonicalKeyMaterialPath(value) {
			t.Errorf("unsafe bundle path accepted: %q", value)
		}
	}
	for _, value := range []string{"accounts/a/udd-1/manifest.jsonl", "key_material/a/udd-1/records/key.json"} {
		if !canonicalKeyMaterialPath(value) {
			t.Errorf("safe bundle path refused: %q", value)
		}
	}
}

func TestStripKeysRefusesToRemanifestDivergentBundle(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	_, recipient := x25519Recipient(t)
	capture := KeyCaptureResult{Records: []CapturedKeyRecord{{
		RecordID: "test", CaptureState: "captured", KeyKind: "oscrypt_row_key", UsableRowKey: true,
		Provider: KeyProviderMetadata{Platform: "linux", Name: "basic", Item: "item", Scope: "browser_default"},
		Policy:   KeyPolicyEvidence{RowPrefix: "v10", Support: "supported"}, DerivedKey: []byte("0123456789abcdef"),
	}}}
	original := filepath.Join(t.TempDir(), "with-keys")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	_, err := (Collector{Scanner: fixedScanner{scan}, KeyCapturer: fixedKeyCapturer{capture}, Random: bytes.NewReader(bytes.Repeat([]byte{0x44}, 4096))}).Run(Options{
		Output: original, OperatorIdentifier: "examiner", AuthorizationReference: "CASE-187", CaptureKeyMaterial: true, KeyMaterialRecipient: recipient,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(original, "not-manifested.txt"), "divergence")
	output := filepath.Join(t.TempDir(), "stripped")
	if _, err := StripKeys(original, output); err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("error=%v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("strip published output from a divergent bundle")
	}
}

func TestRecipientParserAcceptsPEMAndForensixFormat(t *testing.T) {
	private, public := x25519Recipient(t)
	_ = private
	der, err := x509MarshalPublic(public)
	if err != nil {
		t.Fatal(err)
	}
	pemContent := pemEncodePublic(der)
	parsedPEM, err := ParseKeyMaterialRecipient(pemContent)
	if err != nil || !bytes.Equal(parsedPEM, public) {
		t.Fatalf("PEM parse failed: %v", err)
	}
	text := []byte("forensix-x25519-public-v1:" + base64.StdEncoding.EncodeToString(public) + "\n")
	parsedText, err := ParseKeyMaterialRecipient(text)
	if err != nil || !bytes.Equal(parsedText, public) {
		t.Fatalf("text parse failed: %v", err)
	}
}

func x25519Recipient(t *testing.T) (*ecdh.PrivateKey, []byte) {
	t.Helper()
	private, err := ecdh.X25519().GenerateKey(bytes.NewReader(bytes.Repeat([]byte{0x71}, 64)))
	if err != nil {
		t.Fatal(err)
	}
	return private, private.PublicKey().Bytes()
}

func unsealTestRecord(t *testing.T, private *ecdh.PrivateKey, record keyMaterialRecord) []byte {
	t.Helper()
	aad, err := keyMaterialAssociatedData(record)
	if err != nil {
		t.Fatal(err)
	}
	ephemeralBytes, _ := base64.StdEncoding.DecodeString(record.SealedMaterial.EphemeralPublicKey)
	ephemeral, err := ecdh.X25519().NewPublicKey(ephemeralBytes)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := private.ECDH(ephemeral)
	if err != nil {
		t.Fatal(err)
	}
	salt, _ := base64.StdEncoding.DecodeString(record.SealedMaterial.Salt)
	wrappingKey, err := hkdf.Key(sha256.New, shared, salt, "forensix/key-material-seal/1", 32)
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(wrappingKey)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce, _ := base64.StdEncoding.DecodeString(record.SealedMaterial.Nonce)
	ciphertext, _ := base64.StdEncoding.DecodeString(record.SealedMaterial.Ciphertext)
	plaintext, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		t.Fatal(err)
	}
	return plaintext
}

func assertTreeDoesNotContain(t *testing.T, root string, secret []byte) {
	t.Helper()
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if bytes.Contains(content, secret) {
			t.Errorf("plaintext derived key leaked to bundle file %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Kept in helpers so the production parser stays limited to public-key input.
func x509MarshalPublic(public []byte) ([]byte, error) {
	key, err := ecdh.X25519().NewPublicKey(public)
	if err != nil {
		return nil, err
	}
	return x509.MarshalPKIXPublicKey(key)
}

func pemEncodePublic(der []byte) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
}
