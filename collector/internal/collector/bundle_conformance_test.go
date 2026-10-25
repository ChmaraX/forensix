package collector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
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

// The Collector writes the one Acquisition Bundle schema version that
// contracts/acquisition-bundle/bundle-manifest.schema.json defines. The
// analyzer accepts only that version.
func TestBundleManifestMatchesSharedSchema(t *testing.T) {
	var schema struct {
		Required   []string                   `json:"required"`
		Properties map[string]json.RawMessage `json:"properties"`
		Defs       map[string]struct {
			Required   []string                   `json:"required"`
			Properties map[string]json.RawMessage `json:"properties"`
		} `json:"$defs"`
	}
	readStrictJSON(t, filepath.Join(acquisitionBundleFixtureRoot(t), "..", "bundle-manifest.schema.json"), &schema)
	var version struct {
		Const string `json:"const"`
	}
	if err := json.Unmarshal(schema.Properties["schema_version"], &version); err != nil {
		t.Fatal(err)
	}
	if version.Const != BundleSchemaVersion {
		t.Fatalf("Collector writes %q but the shared contract defines %q", BundleSchemaVersion, version.Const)
	}

	source := t.TempDir()
	mustWrite(t, filepath.Join(source, "Local State"), "state")
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: source}}}
	_, recipient := x25519Recipient(t)
	capturer := fixedKeyCapturer{KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey("unavailable", "linux", "basic", "item", "scope", "v10", "reason")}}}
	if _, err := (Collector{Scanner: fixedScanner{scan}, KeyCapturer: capturer}).Run(Options{
		Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref",
		CaptureKeyMaterial: true, KeyMaterialRecipient: recipient,
	}); err != nil {
		t.Fatal(err)
	}
	var written map[string]json.RawMessage
	readStrictJSON(t, filepath.Join(out, "bundle_manifest.json"), &written)
	assertObjectMatchesSchema(t, "bundle manifest", written, schema.Required, schema.Properties)
	for _, list := range []struct{ field, def string }{{"user_data_dirs", "userDataDir"}, {"key_material", "keyMaterial"}, {"files", "file"}} {
		var items []map[string]json.RawMessage
		if err := json.Unmarshal(written[list.field], &items); err != nil {
			t.Fatalf("%s is not an array of objects: %v", list.field, err)
		}
		if len(items) == 0 {
			t.Fatalf("%s is empty; the test cannot check its shape", list.field)
		}
		for _, item := range items {
			assertObjectMatchesSchema(t, list.field, item, schema.Defs[list.def].Required, schema.Defs[list.def].Properties)
		}
	}
}

func assertObjectMatchesSchema(t *testing.T, name string, object map[string]json.RawMessage, required []string, properties map[string]json.RawMessage) {
	t.Helper()
	for _, field := range required {
		value, ok := object[field]
		if !ok || string(value) == "null" {
			t.Errorf("%s lacks required field %q", name, field)
		}
	}
	for field := range object {
		if _, ok := properties[field]; !ok {
			t.Errorf("%s has field %q that the shared contract does not define", name, field)
		}
	}
}
