package collector

import (
	"bytes"
	"crypto/ecdh"
	"crypto/x509"
	"encoding/pem"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

// The analyzer reads a Collector key-material subtree with
// `forensix analyse --decrypt --key-material <subtree>`. The shared fixture is
// the exact Collector output for a fixed capture. The analyzer end-to-end test
// e2e/decrypt-cli.test.ts decrypts with it. Set FORENSIX_UPDATE_GOLDEN=1 to
// write the fixture again after an intentional contract change.
func TestKeyMaterialSubtreeMatchesSharedGolden(t *testing.T) {
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate key-material golden test")
	}
	fixture := filepath.Join(filepath.Dir(current), "..", "..", "contracts", "key-material", "fixtures", "captured-v1")
	// Test-only recipient key. It protects no real key material.
	private, err := ecdh.X25519().NewPrivateKey(bytes.Repeat([]byte{0x11}, 32))
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})

	capture := KeyCaptureResult{Records: []CapturedKeyRecord{
		capturedProviderKey("linux-libsecret-v11-1", "linux", "gnome-libsecret", "Chrome Safe Storage", "live_account_session", "v11", []byte("keyring-secret"), 1,
			[]KeyContext{{Name: "application", Value: "chrome"}, {Name: "derivation", Value: "pbkdf2-hmac-sha1"}, {Name: "iterations", Value: "1"}, {Name: "salt", Value: "saltysalt"}}),
		unavailableProviderKey("linux-kwallet-unavailable", "linux", "kwallet6", "Chrome Safe Storage", "live_account_session", "v11", "provider-store-locked"),
	}}
	generated := filepath.Join(t.TempDir(), "subtree")
	random := bytes.NewReader(bytes.Repeat([]byte{0x5a}, 4096))
	if _, err := writeKeyMaterialSubtree(generated, "key_material/alice/udd-1", "alice", capture, private.PublicKey().Bytes(), random); err != nil {
		t.Fatal(err)
	}

	if os.Getenv("FORENSIX_UPDATE_GOLDEN") == "1" {
		if err := os.RemoveAll(fixture); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(fixture, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(fixture, "recipient-private.pem"), privatePEM, 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.CopyFS(filepath.Join(fixture, "subtree"), os.DirFS(generated)); err != nil {
			t.Fatal(err)
		}
	}

	committedPEM, err := os.ReadFile(filepath.Join(fixture, "recipient-private.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(committedPEM, privatePEM) {
		t.Fatal("fixture recipient key does not match the fixed test key")
	}
	want, got := treeBytes(t, filepath.Join(fixture, "subtree")), treeBytes(t, generated)
	if !reflect.DeepEqual(want, got) {
		for path := range got {
			if !bytes.Equal(want[path], got[path]) {
				t.Errorf("%s differs from the shared fixture:\n%s", path, got[path])
			}
		}
		for path := range want {
			if _, ok := got[path]; !ok {
				t.Errorf("Collector no longer writes %s", path)
			}
		}
		t.Fatal("Collector key-material output diverged from the shared fixture; analyzer interoperability is at risk")
	}
}

func treeBytes(t *testing.T, root string) map[string][]byte {
	t.Helper()
	files := map[string][]byte{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = content
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}
