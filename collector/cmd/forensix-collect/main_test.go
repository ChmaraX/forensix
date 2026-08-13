package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ChmaraX/forensix/collector/internal/collector"
	"github.com/ChmaraX/forensix/collector/internal/conformance"
)

func TestExitCodeForPartialBundle(t *testing.T) {
	bundle := collector.BundleManifest{UserDataDirs: []collector.BundleUserDataDir{{SourcePath: "/source", Outcome: collector.SkippedRunning, LivenessEvidence: []string{"RunningChromeVersion"}, LivenessExplanation: "running"}}}
	if got := reportResult(bundle, "/bundle", &bytes.Buffer{}); got != 2 {
		t.Fatalf("exit=%d want=2", got)
	}
}

func TestExitCodeForCompleteBundle(t *testing.T) {
	bundle := collector.BundleManifest{BundleDigest: "digest", UserDataDirs: []collector.BundleUserDataDir{{Outcome: collector.Collected}}}
	if got := reportResult(bundle, "/bundle", &bytes.Buffer{}); got != 0 {
		t.Fatalf("exit=%d want=0", got)
	}
}

func TestStripKeysSubcommandWritesNewBundle(t *testing.T) {
	input := filepath.Join(t.TempDir(), "input")
	if err := os.MkdirAll(filepath.Join(input, "key_material", "a", "udd-1"), 0o700); err != nil {
		t.Fatal(err)
	}
	write := func(relative, content string) collector.BundleFile {
		t.Helper()
		path := filepath.Join(input, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256([]byte(content))
		return collector.BundleFile{Path: relative, Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:])}
	}
	files := []collector.BundleFile{
		write("collector_record.json", "record"),
		write("key_material/a/udd-1/key_material_manifest.jsonl", "key manifest"),
		write("scan_record.json", "scan"),
	}
	encoded, err := json.Marshal(files)
	if err != nil {
		t.Fatal(err)
	}
	manifest := collector.BundleManifest{
		SchemaVersion: "forensix-acquisition-bundle-draft/2", HashAlgorithm: conformance.HashAlgorithm,
		KeyMaterialCaptureRequested: true, KeyMaterialCaptured: true,
		UserDataDirs: []collector.BundleUserDataDir{}, KeyMaterial: []collector.BundleKeyMaterial{{AccountID: "a", BundlePath: "key_material/a/udd-1"}},
		Files: files, BundleDigest: conformance.Digest(append(encoded, '\n')),
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(input, "bundle_manifest.json"), append(manifestBytes, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "output")
	if exit := run([]string{"strip-keys", "--out", output, input}); exit != 0 {
		t.Fatalf("exit=%d", exit)
	}
	content, err := os.ReadFile(filepath.Join(output, "bundle_manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stripped collector.BundleManifest
	if err := json.Unmarshal(content, &stripped); err != nil {
		t.Fatal(err)
	}
	if stripped.KeyMaterialCaptured || !stripped.KeyMaterialStripped || stripped.OriginalBundleDigest != manifest.BundleDigest {
		t.Fatalf("strip-keys output=%#v", stripped)
	}
	if _, err := os.Stat(filepath.Join(output, "key_material")); !os.IsNotExist(err) {
		t.Fatal("key-material subtree remains after strip-keys")
	}
}
