package collector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The Acquisition Bundle Digest is a single cross-implementation contract: the
// Collector emits `bundle_digest` and the analyzer recomputes it. Both must
// serialize the sorted Bundle file list identically. This test pins the
// Collector's digest of the shared golden file set (issue #188, AC6). The
// analyzer pins the same golden to the same expected value in
// core/test/acquisition-bundle-conformance.test.ts.
func TestBundleDigestMatchesSharedGolden(t *testing.T) {
	directory := filepath.Join(acquisitionBundleFixtureRoot(t), "canonical-v1")

	var files []BundleFile
	readStrictJSON(t, filepath.Join(directory, "bundle-files.json"), &files)

	var expected struct {
		BundleDigest string `json:"bundle_digest"`
	}
	readStrictJSON(t, filepath.Join(directory, "expected-bundle-digest.json"), &expected)

	got, err := bundleFileDigest(files)
	if err != nil {
		t.Fatalf("bundleFileDigest: %v", err)
	}
	if got != expected.BundleDigest {
		t.Fatalf(
			"Collector Bundle Digest diverged from shared golden:\n got  %s\n want %s",
			got, expected.BundleDigest,
		)
	}
}

func acquisitionBundleFixtureRoot(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate bundle conformance test")
	}
	return filepath.Clean(filepath.Join(
		filepath.Dir(current), "..", "..", "..",
		"contracts", "acquisition-bundle", "fixtures",
	))
}

func readStrictJSON(t *testing.T, path string, target any) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(content, target); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}
