package collector

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The key-material subtree that the Collector writes obeys the three canonical
// schemas in contracts/key-material.
func TestKeyMaterialSubtreeMatchesCanonicalSchemas(t *testing.T) {
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate key-material schema tests")
	}
	contractRoot := filepath.Join(filepath.Dir(current), "..", "..", "contracts", "key-material")
	_, recipient := x25519Recipient(t)
	subtree := writeGoldenKeyMaterialSubtree(t, recipient)

	header := filepath.Join(subtree, "key_material_manifest_header.json")
	assertMatchesSchema(t, header, readSchema(t, filepath.Join(contractRoot, "key-material-manifest-header.schema.json")), readJSONValue(t, header))

	entrySchema := readSchema(t, filepath.Join(contractRoot, "key-material-manifest-entry.schema.json"))
	content, err := os.ReadFile(filepath.Join(subtree, "key_material_manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	lines := bufio.NewScanner(bytes.NewReader(content))
	entries := 0
	for lines.Scan() {
		var entry any
		if err := json.Unmarshal(lines.Bytes(), &entry); err != nil {
			t.Fatalf("manifest line %d: %v", entries+1, err)
		}
		assertMatchesSchema(t, "key_material_manifest.jsonl", entrySchema, entry)
		entries++
	}

	recordSchema := readSchema(t, filepath.Join(contractRoot, "key-material-record.schema.json"))
	records, err := filepath.Glob(filepath.Join(subtree, "records", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		assertMatchesSchema(t, record, recordSchema, readJSONValue(t, record))
	}
	if entries != 3 || len(records) != 2 {
		t.Fatalf("checked %d manifest entries and %d records, want 3 and 2", entries, len(records))
	}
}
