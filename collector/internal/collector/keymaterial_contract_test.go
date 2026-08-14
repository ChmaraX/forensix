package collector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestKeyMaterialCanonicalSchemasAreValidJSON(t *testing.T) {
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate key-material schema tests")
	}
	contractRoot := filepath.Join(filepath.Dir(current), "..", "..", "contracts", "key-material")
	for _, name := range []string{
		"key-material-manifest-entry.schema.json",
		"key-material-manifest-header.schema.json",
		"key-material-record.schema.json",
	} {
		content, err := os.ReadFile(filepath.Join(contractRoot, name))
		if err != nil {
			t.Fatal(err)
		}
		var schema map[string]any
		if err := json.Unmarshal(content, &schema); err != nil {
			t.Fatalf("%s is not valid JSON: %v", name, err)
		}
		if schema["$schema"] != "https://json-schema.org/draft/2020-12/schema" || schema["additionalProperties"] != false {
			t.Fatalf("%s does not declare the closed canonical JSON Schema contract", name)
		}
	}
}
