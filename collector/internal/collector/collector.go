package collector

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

var ErrChromeRunning = errors.New("chrome-running liveness evidence detected")

type Options struct {
	Output                 string
	OperatorIdentifier     string
	AuthorizationReference string
	IncludeBulk            bool
	ContinueIfRunning      bool
	CaptureKeyMaterial     bool
	KeyMaterialRecipient   []byte
	LinuxKeyProvider       string
	Version                string
	Commit                 string
	Now                    func() time.Time
}

type Collector struct {
	Scanner     platformscanner.Scanner
	KeyCapturer KeyCapturer
	Random      io.Reader
}

type CollectionOutcome string

const (
	Collected      CollectionOutcome = "collected"
	SkippedRunning CollectionOutcome = "skipped_chrome_running"
	Failed         CollectionOutcome = "failed"
)

type ScanRecord struct {
	Attempts []platformscanner.Attempt `json:"attempts"`
}

type CollectorRecord struct {
	SchemaVersion      string `json:"schema_version"`
	CollectorVersion   string `json:"collector_version"`
	CollectorCommit    string `json:"collector_commit"`
	SelectionPolicy    string `json:"selection_policy"`
	OperatorIdentifier string `json:"operator_identifier"`
	AuthorizationClaim struct {
		Reference            string `json:"reference"`
		WitnessedByCollector bool   `json:"witnessed_by_collector"`
		AuthorityVerified    bool   `json:"authority_verified"`
	} `json:"authorization_claim"`
	StartedAt          time.Time          `json:"started_at"`
	EndedAt            time.Time          `json:"ended_at"`
	HostReportedLocal  HostReportedTime   `json:"host_reported_local_time"`
	Hostname           string             `json:"hostname"`
	OS                 string             `json:"os"`
	OSVersion          EnvironmentValue   `json:"os_version"`
	Architecture       string             `json:"architecture"`
	MachineIdentifier  EnvironmentValue   `json:"machine_identifier"`
	NetworkCalls       string             `json:"network_calls"`
	KeyMaterialCapture KeyMaterialCapture `json:"key_material_capture"`
}

type KeyMaterialCapture struct {
	Requested              bool   `json:"requested"`
	AuthorizationReference string `json:"authorization_reference,omitempty"`
	SealingAlgorithm       string `json:"sealing_algorithm,omitempty"`
	RecipientFingerprint   string `json:"recipient_fingerprint,omitempty"`
}

type EnvironmentValue struct {
	State  string `json:"state"`
	Value  string `json:"value,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type HostReportedTime struct {
	StartedAt    time.Time `json:"started_at"`
	EndedAt      time.Time `json:"ended_at"`
	Verification string    `json:"verification"`
}

type BundleUserDataDir struct {
	AccountID           string            `json:"account_id"`
	BundlePath          string            `json:"bundle_path"`
	SourcePath          string            `json:"source_path"`
	Outcome             CollectionOutcome `json:"outcome"`
	ChromeRunning       bool              `json:"chrome_running"`
	LivenessEvidence    []string          `json:"liveness_evidence"`
	LivenessExplanation string            `json:"liveness_explanation"`
	EvidenceSetDigest   string            `json:"evidence_set_digest,omitempty"`
	WorkingCopyDigest   string            `json:"working_copy_digest,omitempty"`
	Error               string            `json:"error,omitempty"`
}

type BundleFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type BundleKeyMaterial struct {
	AccountID         string `json:"account_id"`
	BundlePath        string `json:"bundle_path"`
	CaptureState      string `json:"capture_state"`
	ManifestDigest    string `json:"manifest_digest"`
	EntryCount        int    `json:"entry_count"`
	UsableRowKeyCount int    `json:"usable_row_key_count"`
}

type BundleManifest struct {
	SchemaVersion               string              `json:"schema_version"`
	HashAlgorithm               string              `json:"hash_algorithm"`
	KeyMaterialCaptureRequested bool                `json:"key_material_capture_requested"`
	KeyMaterialCaptured         bool                `json:"key_material_captured"`
	KeyMaterialStripped         bool                `json:"key_material_stripped"`
	OriginalBundleDigest        string              `json:"original_bundle_digest,omitempty"`
	UserDataDirs                []BundleUserDataDir `json:"user_data_dirs"`
	KeyMaterial                 []BundleKeyMaterial `json:"key_material"`
	Files                       []BundleFile        `json:"files"`
	BundleDigest                string              `json:"bundle_digest"`
}

func (c Collector) Run(opts Options) (BundleManifest, error) {
	if err := validateOptions(c.Scanner, opts); err != nil {
		return BundleManifest{}, err
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if c.Random == nil {
		c.Random = rand.Reader
	}
	if opts.CaptureKeyMaterial && c.KeyCapturer == nil {
		c.KeyCapturer = NewHostKeyCapturer(opts.LinuxKeyProvider)
	}
	startedHost := opts.Now()
	scan := c.Scanner.Scan()
	if err := rejectOutputInsideSources(opts.Output, scan.Found); err != nil {
		return BundleManifest{}, err
	}
	if err := prepareOutput(opts.Output); err != nil {
		return BundleManifest{}, err
	}

	tmp := opts.Output + ".partial"
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(tmp)
		}
	}()
	manifest := BundleManifest{
		SchemaVersion: "forensix-acquisition-bundle-draft/2", HashAlgorithm: conformance.HashAlgorithm,
		KeyMaterialCaptureRequested: opts.CaptureKeyMaterial, KeyMaterial: []BundleKeyMaterial{},
	}
	if err := conformance.WriteJSON(filepath.Join(tmp, "scan_record.json"), ScanRecord{Attempts: scan.Attempts}); err != nil {
		return manifest, err
	}

	for index, found := range scan.Found {
		bundleRel := filepath.ToSlash(filepath.Join("accounts", safeComponent(found.AccountID), fmt.Sprintf("udd-%d", indexForAccount(scan.Found, index))))
		destination := filepath.Join(tmp, filepath.FromSlash(bundleRel))
		staging := destination + ".partial"
		outcome, collectErr := collectUserDataDir(found, staging, opts)
		outcome.BundlePath = bundleRel
		if collectErr == nil {
			if err := os.Rename(staging, destination); err != nil {
				outcome.Outcome, outcome.Error, collectErr = Failed, err.Error(), err
			}
		}
		if collectErr != nil {
			_ = os.RemoveAll(staging)
		}
		manifest.UserDataDirs = append(manifest.UserDataDirs, outcome)
		if opts.CaptureKeyMaterial && outcome.Outcome == Collected {
			keyRel := filepath.ToSlash(filepath.Join("key_material", safeComponent(found.AccountID), fmt.Sprintf("udd-%d", indexForAccount(scan.Found, index))))
			capture := c.KeyCapturer.Capture(found)
			summary, err := writeKeyMaterialSubtree(filepath.Join(tmp, filepath.FromSlash(keyRel)), keyRel, found.AccountID, capture, opts.KeyMaterialRecipient, c.Random)
			if err != nil {
				return manifest, err
			}
			manifest.KeyMaterial = append(manifest.KeyMaterial, summary)
		}
	}
	manifest.KeyMaterialCaptured = len(manifest.KeyMaterial) > 0

	endedHost := opts.Now()
	record := collectorRecord(opts, startedHost, endedHost)
	if err := conformance.WriteJSON(filepath.Join(tmp, "collector_record.json"), record); err != nil {
		return manifest, err
	}
	files, digest, err := bundleFiles(tmp)
	if err != nil {
		return manifest, err
	}
	manifest.Files, manifest.BundleDigest = files, digest
	if err := conformance.WriteJSON(filepath.Join(tmp, "bundle_manifest.json"), manifest); err != nil {
		return manifest, err
	}
	if err := os.Rename(tmp, opts.Output); err != nil {
		return manifest, fmt.Errorf("publish bundle: %w", err)
	}
	committed = true
	return manifest, nil
}

func collectUserDataDir(found platformscanner.UserDataDir, destination string, opts Options) (BundleUserDataDir, error) {
	result := BundleUserDataDir{AccountID: found.AccountID, SourcePath: found.Path, Outcome: Failed}
	plan, err := planAcquisition(found, opts.IncludeBulk)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	result.ChromeRunning = plan.running
	result.LivenessEvidence = plan.liveness
	result.LivenessExplanation = livenessExplanation(plan.running, plan.liveness)
	if plan.running && !opts.ContinueIfRunning {
		result.Outcome, result.Error = SkippedRunning, ErrChromeRunning.Error()
		return result, ErrChromeRunning
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return result, err
	}
	if err := plan.materialize(destination); err != nil {
		result.Error = err.Error()
		return result, err
	}
	entries := plan.manifestEntries()
	lines, err := conformance.CanonicalLines(entries)
	if err != nil {
		return result, err
	}
	workingLines, err := conformance.WorkingCopyLines(entries)
	if err != nil {
		return result, err
	}
	result.EvidenceSetDigest, result.WorkingCopyDigest = conformance.Digest(lines), conformance.Digest(workingLines)
	header := conformance.ManifestHeader{
		ManifestSchema: conformance.ManifestSchema, SourceKind: conformance.SourceKind,
		SelectionPolicy: conformance.SelectionPolicy, SelectionPolicyDiff: []string{},
		Tier2Included: opts.IncludeBulk, HashAlgorithm: conformance.HashAlgorithm,
		EvidenceSetDigest: result.EvidenceSetDigest, WorkingCopyDigest: result.WorkingCopyDigest,
		EntryCount: len(entries), ProfileCount: plan.profileCount(),
	}
	for _, entry := range entries {
		if entry.Copied {
			header.CopiedEntryCount++
		}
		if entry.State == conformance.StateUnavailable {
			header.UnavailableCount++
		}
		if entry.State == conformance.StateValue && entry.Unclassified && entry.NodeType != conformance.NodeDir {
			header.UnclassifiedCount++
		}
	}
	if err := conformance.WriteFile(filepath.Join(destination, "manifest.jsonl"), lines); err != nil {
		return result, err
	}
	if err := conformance.WriteJSON(filepath.Join(destination, "manifest_header.json"), header); err != nil {
		return result, err
	}
	result.Outcome = Collected
	return result, nil
}

func indicatesRunningChrome(liveness []string) bool {
	for _, path := range liveness {
		name := filepath.Base(path)
		if name == "RunningChromeVersion" || name == "SingletonSocket" {
			return true
		}
	}
	return false
}

func livenessExplanation(running bool, evidence []string) string {
	if running {
		return "Chrome liveness evidence was present. Chrome can hold evidence only in memory; the Collector did not signal or modify the process."
	}
	if len(evidence) > 0 {
		return "Only non-conclusive Liveness Evidence was present. SingletonLock can survive a crash and does not prove Chrome was running."
	}
	return "No supported Chrome Liveness Evidence was found; absence does not prove Chrome was not running."
}

func validateOptions(scanner platformscanner.Scanner, opts Options) error {
	if scanner == nil {
		return errors.New("scanner is required")
	}
	if opts.Output == "" {
		return errors.New("output is required")
	}
	if opts.OperatorIdentifier == "" {
		return errors.New("operator identifier is required")
	}
	if strings.TrimSpace(opts.AuthorizationReference) == "" {
		return errors.New("authorization reference is required as a witnessed operator claim")
	}
	if opts.CaptureKeyMaterial && len(opts.KeyMaterialRecipient) != 32 {
		return errors.New("key-material capture requires a 32-byte X25519 recipient public key")
	}
	if !opts.CaptureKeyMaterial && len(opts.KeyMaterialRecipient) != 0 {
		return errors.New("key-material recipient requires explicit key-material capture opt-in")
	}
	if opts.LinuxKeyProvider != "" && !validLinuxKeyProvider(opts.LinuxKeyProvider) {
		return fmt.Errorf("unsupported Linux key provider %q", opts.LinuxKeyProvider)
	}
	return nil
}

func prepareOutput(output string) error {
	if _, err := os.Lstat(output); err == nil {
		return fmt.Errorf("output already exists: %s", output)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o700); err != nil {
		return fmt.Errorf("create output parent: %w", err)
	}
	if err := os.Mkdir(output+".partial", 0o700); err != nil {
		return fmt.Errorf("create bundle staging directory: %w", err)
	}
	return nil
}

func safeComponent(value string) string {
	value = strings.NewReplacer("/", "_", `\`, "_", ":", "_").Replace(value)
	if value == "" || value == "." || value == ".." {
		return "unknown"
	}
	return value
}

func indexForAccount(found []platformscanner.UserDataDir, index int) int {
	n := 0
	for i := 0; i <= index; i++ {
		if found[i].AccountID == found[index].AccountID {
			n++
		}
	}
	return n
}
