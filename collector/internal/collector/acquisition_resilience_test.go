package collector

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

func collectOne(t *testing.T, source string) (BundleManifest, string) {
	t.Helper()
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	bundle, err := (Collector{Scanner: fixedScanner{scan}}).Run(Options{Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref"})
	if err != nil {
		t.Fatalf("one unreadable or changing Source node aborted the collection: %v", err)
	}
	if len(bundle.UserDataDirs) != 1 || bundle.UserDataDirs[0].Outcome != Collected {
		t.Fatalf("User Data Dir was not collected: %#v", bundle.UserDataDirs)
	}
	assertBundleFiles(t, out, bundle)
	return bundle, filepath.Join(out, "accounts", "a", "udd-1")
}

func assertUnavailable(t *testing.T, manifest map[string]conformance.ManifestEntry, path string, node conformance.NodeType, reason conformance.UnavailableReason) {
	t.Helper()
	entry, ok := manifest[path]
	if !ok {
		t.Fatalf("Manifest has no entry for %q", path)
	}
	if entry.State != conformance.StateUnavailable || entry.UnavailableReason == nil || *entry.UnavailableReason != reason || entry.NodeType != node || entry.Copied || entry.SHA256 != nil || entry.Size != nil {
		t.Fatalf("%q is not unavailable(%s) %s: %#v", path, reason, node, entry)
	}
}

func assertCopied(t *testing.T, udd, path, content string) {
	t.Helper()
	got, err := os.ReadFile(filepath.Join(udd, "working_copy", filepath.FromSlash(path)))
	if err != nil || string(got) != content {
		t.Fatalf("Working Copy %q = %q, %v; want %q", path, got, err, content)
	}
}

func assertNotCopied(t *testing.T, udd, path string) {
	t.Helper()
	if _, err := os.Lstat(filepath.Join(udd, "working_copy", filepath.FromSlash(path))); !os.IsNotExist(err) {
		t.Fatalf("Working Copy contains unavailable %q (err=%v)", path, err)
	}
}

func assertHeaderMatchesManifest(t *testing.T, udd string) {
	t.Helper()
	manifestBytes, err := os.ReadFile(filepath.Join(udd, "manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	manifest := readManifest(t, filepath.Join(udd, "manifest.jsonl"))
	entries := make([]conformance.ManifestEntry, 0, len(manifest))
	unavailable := 0
	for _, entry := range manifest {
		entries = append(entries, entry)
		if entry.State == conformance.StateUnavailable {
			unavailable++
		}
	}
	lines, err := conformance.CanonicalLines(entries)
	if err != nil {
		t.Fatalf("Manifest breaks the canonical contract: %v", err)
	}
	var header conformance.ManifestHeader
	readJSON(t, filepath.Join(udd, "manifest_header.json"), &header)
	if string(lines) != string(manifestBytes) || header.EvidenceSetDigest != conformance.Digest(manifestBytes) || header.UnavailableCount != unavailable || header.EntryCount != len(entries) {
		t.Fatalf("Manifest header does not match the written Manifest: %#v", header)
	}
}

func TestUnreadableSourceNodesBecomeUnavailableAndCollectionContinues(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits do not make a file unreadable on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("root can read files without read permission")
	}
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	mustWrite(t, filepath.Join(source, "Default", "Preferences"), "preferences")
	mustWrite(t, filepath.Join(source, "Default", "History"), "locked history")
	mustWrite(t, filepath.Join(source, "Default", "Network", "Cookies"), "cookies")
	locked := filepath.Join(source, "Default", "History")
	lockedDir := filepath.Join(source, "Default", "Network")
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lockedDir, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(locked, 0o600)
		_ = os.Chmod(lockedDir, 0o700)
	})

	_, udd := collectOne(t, source)
	manifest := readManifest(t, filepath.Join(udd, "manifest.jsonl"))
	assertUnavailable(t, manifest, "Default/History", conformance.NodeFile, conformance.PermissionDenied)
	assertUnavailable(t, manifest, "Default/Network", conformance.NodeDir, conformance.PermissionDenied)
	// The Collector could not list Network, so it must not claim that the
	// expected Cookies database is absent.
	assertUnavailable(t, manifest, "Default/Network/Cookies", conformance.NodeFile, conformance.ParentUnavailable)
	if entry := manifest["Default/Network/Cookies-journal"]; entry.State != conformance.StateUnavailable {
		t.Fatalf("expected sidecar under an unreadable directory collapsed to %s", entry.State)
	}
	assertNotCopied(t, udd, "Default/History")
	assertCopied(t, udd, "Default/Preferences", "preferences")
	assertCopied(t, udd, "Local State", "state")
	assertHeaderMatchesManifest(t, udd)
}

func TestSourceFilesThatChangeAfterInventoryBecomeUnavailable(t *testing.T) {
	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	mustWrite(t, filepath.Join(source, "Default", "History"), "history before")
	mustWrite(t, filepath.Join(source, "Default", "Preferences"), "preferences before")
	mustWrite(t, filepath.Join(source, "Default", "Bookmarks"), "bookmarks")
	mustWrite(t, filepath.Join(source, "Default", "Top Sites"), "top sites")
	stamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	preferences := filepath.Join(source, "Default", "Preferences")
	if err := os.Chtimes(preferences, stamp, stamp); err != nil {
		t.Fatal(err)
	}

	testHookAfterInventory = func(platformscanner.UserDataDir) {
		// Chrome appends to History: size and mtime change.
		file, err := os.OpenFile(filepath.Join(source, "Default", "History"), os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = file.WriteString(" and after")
		_ = file.Close()
		// Same size and mtime, new bytes: only the copy hash shows the change,
		// after the Collector has written a partial Working Copy file.
		mustWrite(t, preferences, "PREFERENCES AFTER!")
		if err := os.Chtimes(preferences, stamp, stamp); err != nil {
			t.Fatal(err)
		}
		// Chrome deletes Top Sites.
		if err := os.Remove(filepath.Join(source, "Default", "Top Sites")); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { testHookAfterInventory = nil })

	_, udd := collectOne(t, source)
	manifest := readManifest(t, filepath.Join(udd, "manifest.jsonl"))
	assertUnavailable(t, manifest, "Default/History", conformance.NodeFile, conformance.ChangedDuringIngest)
	assertUnavailable(t, manifest, "Default/Preferences", conformance.NodeFile, conformance.ChangedDuringIngest)
	assertUnavailable(t, manifest, "Default/Top Sites", conformance.NodeFile, conformance.ChangedDuringIngest)
	assertNotCopied(t, udd, "Default/History")
	assertNotCopied(t, udd, "Default/Preferences")
	assertNotCopied(t, udd, "Default/Top Sites")
	assertCopied(t, udd, "Default/Bookmarks", "bookmarks")
	assertCopied(t, udd, "Local State", "state")
	assertHeaderMatchesManifest(t, udd)
}

func TestSymlinkedUserDataDirRootIsWalkedWithoutFollowingDescendantLinks(t *testing.T) {
	parent := t.TempDir()
	real := filepath.Join(parent, "real-user-data")
	outside := filepath.Join(parent, "outside")
	mustWrite(t, filepath.Join(real, "Local State"), "state")
	mustWrite(t, filepath.Join(real, "Default", "History"), "history")
	mustWrite(t, filepath.Join(outside, "History"), "outside history")
	root := filepath.Join(parent, "linked-user-data")
	if err := os.Symlink(real, root); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(real, "Default", "linked")); err != nil {
		t.Fatal(err)
	}

	bundle, udd := collectOne(t, root)
	if bundle.UserDataDirs[0].SourcePath != root {
		t.Fatalf("selected Source path was not preserved: %q", bundle.UserDataDirs[0].SourcePath)
	}
	manifest := readManifest(t, filepath.Join(udd, "manifest.jsonl"))
	history := manifest["Default/History"]
	if history.State != conformance.StateValue || !history.Copied {
		t.Fatalf("symlinked root produced no evidence: %#v", history)
	}
	assertCopied(t, udd, "Default/History", "history")
	assertCopied(t, udd, "Local State", "state")
	if linked := manifest["Default/linked"]; linked.NodeType != conformance.NodeSymlink {
		t.Fatalf("descendant symlink was not recorded as a symlink: %#v", linked)
	}
	if _, followed := manifest["Default/linked/History"]; followed {
		t.Fatal("descendant symlink was followed")
	}
	assertHeaderMatchesManifest(t, udd)
}
