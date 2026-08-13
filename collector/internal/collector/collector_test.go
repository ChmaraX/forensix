package collector

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

type fixedScanner struct{ result platformscanner.ScanResult }

func (scanner fixedScanner) Scan() platformscanner.ScanResult { return scanner.result }

type sourceState struct {
	Mode   os.FileMode
	Size   int64
	MTime  time.Time
	SHA256 string
	Link   string
}

func TestCollectorCreatesVerifiableBundleWithoutMutatingSource(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "local-state")
	mustWrite(t, filepath.Join(source, "Default", "History"), "history")
	mustWrite(t, filepath.Join(source, "Default", "History-wal"), "wal")
	mustWrite(t, filepath.Join(source, "Default", "Cache", "data_0"), "bulk")
	mustWrite(t, filepath.Join(source, "Default", "unknown.db"), "unknown")
	_ = os.Symlink("host-1234", filepath.Join(source, "Default", "SingletonLock"))
	mustWrite(t, filepath.Join(source, "RunningChromeVersion"), "151")
	before := snapshot(t, source)
	out := filepath.Join(t.TempDir(), "bundle")
	now := time.Date(2026, 8, 12, 20, 0, 0, 0, time.UTC)
	runner := Collector{Scanner: fixedScanner{platformscanner.ScanResult{Attempts: []platformscanner.Attempt{{AccountID: "alice", Path: source, Outcome: platformscanner.Found}}, Found: []platformscanner.UserDataDir{{AccountID: "alice", Path: source}}}}}
	bundle, err := runner.Run(Options{Output: out, OperatorIdentifier: "examiner-7", AuthorizationReference: "CASE-186, authorized by lab lead", ContinueIfRunning: true, Version: "0.1.0", Commit: "abc123", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	after := snapshot(t, source)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("Source changed\nbefore=%#v\nafter=%#v", before, after)
	}
	if len(bundle.UserDataDirs) != 1 || bundle.UserDataDirs[0].Outcome != Collected {
		t.Fatalf("unexpected bundle result: %#v", bundle)
	}

	udd := filepath.Join(out, "accounts", "alice", "udd-1")
	manifestBytes, err := os.ReadFile(filepath.Join(udd, "manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var header conformance.ManifestHeader
	readJSON(t, filepath.Join(udd, "manifest_header.json"), &header)
	if header.EvidenceSetDigest != conformance.Digest(manifestBytes) {
		t.Fatalf("evidence digest is not SHA-256(manifest): %s", header.EvidenceSetDigest)
	}
	if header.ManifestSchema != conformance.ManifestSchema || header.SourceKind != conformance.SourceKind || header.SelectionPolicy != conformance.SelectionPolicy || header.UnclassifiedCount == 0 || header.ProfileCount != 1 || header.EntryCount == 0 {
		t.Fatalf("bad canonical header: %#v", header)
	}
	if len(header.SelectionPolicyDiff) != 0 || header.Tier2Included {
		t.Fatalf("unexpected Selection Policy diff: %#v", header)
	}
	if !bundle.UserDataDirs[0].ChromeRunning {
		t.Fatalf("Chrome liveness state missing from Acquisition Bundle: %#v", bundle.UserDataDirs[0])
	}
	if _, err := os.Stat(filepath.Join(udd, "working_copy", "Default", "History")); err != nil {
		t.Fatal("Tier 1 was not copied:", err)
	}
	if _, err := os.Stat(filepath.Join(udd, "working_copy", "Default", "Cache", "data_0")); !os.IsNotExist(err) {
		t.Fatal("Tier 2 was copied without opt-in")
	}
	if _, err := os.Lstat(filepath.Join(udd, "working_copy", "Default", "SingletonLock")); !os.IsNotExist(err) {
		t.Fatal("liveness symlink was recreated")
	}

	var record CollectorRecord
	readJSON(t, filepath.Join(out, "collector_record.json"), &record)
	if record.AuthorizationClaim.Reference == "" || record.AuthorizationClaim.AuthorityVerified || !record.AuthorizationClaim.WitnessedByCollector {
		t.Fatalf("authorization semantics lost: %#v", record.AuthorizationClaim)
	}
	if record.OS == "" || record.Architecture == "" || record.HostReportedLocal.Verification != "unverified" || record.OSVersion.State == "" || record.MachineIdentifier.State == "" {
		t.Fatalf("collection environment incomplete: %#v", record)
	}
	assertBundleFiles(t, out, bundle)
}

func TestStaleSingletonLockIsRecordedWithoutClaimingChromeIsRunning(t *testing.T) {
	source := t.TempDir()
	if err := os.Symlink("host-1234", filepath.Join(source, "SingletonLock")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	out := filepath.Join(t.TempDir(), "bundle")
	runner := Collector{Scanner: fixedScanner{platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}}}
	_, err := runner.Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref"})
	if err != nil {
		t.Fatal(err)
	}
	var bundle BundleManifest
	readJSON(t, filepath.Join(out, "bundle_manifest.json"), &bundle)
	if bundle.UserDataDirs[0].ChromeRunning {
		t.Fatal("SingletonLock can survive a crash and must not prove Chrome is running")
	}
	if len(bundle.UserDataDirs[0].LivenessEvidence) != 1 || bundle.UserDataDirs[0].LivenessEvidence[0] != "SingletonLock" {
		t.Fatalf("liveness evidence lost: %#v", bundle.UserDataDirs[0].LivenessEvidence)
	}
}

func TestChromeLivenessRequiresExplicitOperatorDecisionBeforeCopy(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "RunningChromeVersion"), "151")
	out := filepath.Join(t.TempDir(), "bundle")
	runner := Collector{Scanner: fixedScanner{platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}}}
	bundle, err := runner.Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref", Version: "dev"})
	if err != nil {
		t.Fatal(err)
	}
	if bundle.UserDataDirs[0].Outcome != SkippedRunning {
		t.Fatalf("outcome=%s", bundle.UserDataDirs[0].Outcome)
	}
	if _, err := os.Stat(filepath.Join(out, "accounts")); !os.IsNotExist(err) {
		t.Fatal("content copied before operator opted to continue")
	}
}

func TestExternalPlatformCacheIsNotMergedIntoCanonicalSourceManifest(t *testing.T) {
	source := t.TempDir()
	cache := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	mustWrite(t, filepath.Join(cache, "Default", "Cache", "data_0"), "external cache")
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source, CachePath: cache}}}
	_, err := (Collector{Scanner: fixedScanner{scan}}).Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref", IncludeBulk: true})
	if err != nil {
		t.Fatal(err)
	}
	manifest := readManifest(t, filepath.Join(out, "accounts", "a", "udd-1", "manifest.jsonl"))
	for path := range manifest {
		if strings.HasPrefix(path, "external_cache/") {
			t.Fatalf("path outside the User Data Dir entered the canonical Manifest: %s", path)
		}
	}
}

func TestBulkOptInCopiesCanonicalTierTwoPath(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Default", "Cache", "data_0"), "cache")
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	_, err := (Collector{Scanner: fixedScanner{scan}}).Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref", IncludeBulk: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(out, "accounts", "a", "udd-1", "working_copy", "Default", "Cache", "data_0")); err != nil {
		t.Fatal(err)
	}
	var header conformance.ManifestHeader
	readJSON(t, filepath.Join(out, "accounts", "a", "udd-1", "manifest_header.json"), &header)
	if !header.Tier2Included {
		t.Fatal("canonical Manifest header did not record Tier 2 opt-in")
	}
}

func TestOutputInsideSourceIsRejectedBeforeWrite(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	out := filepath.Join(source, "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	_, err := (Collector{Scanner: fixedScanner{scan}}).Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref"})
	if err == nil || !strings.Contains(err.Error(), "inside Source") {
		t.Fatalf("error=%v", err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatal("output was created inside Source")
	}
}

func TestNestedHistoryUnderCacheIsNotTierOneOrCopied(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Default", "Cache", "History"), "not a profile database")
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	_, err := (Collector{Scanner: fixedScanner{scan}}).Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref"})
	if err != nil {
		t.Fatal(err)
	}
	manifest := readManifest(t, filepath.Join(out, "accounts", "a", "udd-1", "manifest.jsonl"))
	if manifest["Default/Cache/History"].SelectionTier != conformance.Tier2 || manifest["Default/Cache/History"].Copied {
		t.Fatalf("nested History misclassified: %#v", manifest["Default/Cache/History"])
	}
	if manifest["Default/History"].NodeType != conformance.NodeAbsent {
		t.Fatalf("expected artifact absence suppressed: %#v", manifest["Default/History"])
	}
}

func TestUnreadableAccountDoesNotBlockReadableAccount(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "ok")
	scan := platformscanner.ScanResult{Attempts: []platformscanner.Attempt{{AccountID: "blocked", Path: "/blocked", Outcome: platformscanner.InsufficientPrivilege, Reason: "insufficient_privilege"}, {AccountID: "ok", Path: source, Outcome: platformscanner.Found}}, Found: []platformscanner.UserDataDir{{AccountID: "ok", Path: source}}}
	bundle, err := (Collector{Scanner: fixedScanner{scan}}).Run(Options{Output: filepath.Join(t.TempDir(), "bundle"), OperatorIdentifier: "examiner", AuthorizationReference: "case/ref"})
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.UserDataDirs) != 1 || bundle.UserDataDirs[0].Outcome != Collected {
		t.Fatalf("unexpected outcomes: %#v", bundle.UserDataDirs)
	}
}

func TestAuthorizationClaimIsRequired(t *testing.T) {
	_, err := (Collector{Scanner: fixedScanner{}}).Run(Options{Output: filepath.Join(t.TempDir(), "bundle"), OperatorIdentifier: "examiner"})
	if err == nil || !strings.Contains(err.Error(), "authorization") {
		t.Fatalf("error=%v", err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
func readManifest(t *testing.T, path string) map[string]conformance.ManifestEntry {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]conformance.ManifestEntry{}
	for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
		var entry conformance.ManifestEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatal(err)
		}
		entries[entry.Path] = entry
	}
	return entries
}

func readJSON(t *testing.T, path string, target any) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(content, target); err != nil {
		t.Fatal(err)
	}
}
func snapshot(t *testing.T, root string) map[string]sourceState {
	t.Helper()
	result := map[string]sourceState{}
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		state := sourceState{Mode: info.Mode(), Size: info.Size(), MTime: info.ModTime()}
		if info.Mode().IsRegular() {
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(content)
			state.SHA256 = hex.EncodeToString(sum[:])
		}
		if info.Mode()&os.ModeSymlink != 0 {
			state.Link, _ = os.Readlink(path)
		}
		result[rel] = state
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func assertBundleFiles(t *testing.T, root string, bundle BundleManifest) {
	t.Helper()
	for _, file := range bundle.Files {
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(file.Path)))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(content)
		if file.Size != int64(len(content)) || file.SHA256 != hex.EncodeToString(sum[:]) {
			t.Fatalf("bundle file mismatch: %#v", file)
		}
	}
	encoded, _ := json.Marshal(bundle.Files)
	encoded = append(encoded, '\n')
	if bundle.BundleDigest != conformance.Digest(encoded) {
		t.Fatalf("bundle digest mismatch")
	}
}
