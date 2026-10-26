package collector

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

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

// bundle_manifest.json obeys
// contracts/acquisition-bundle/bundle-manifest.schema.json for collected,
// skipped, and stripped User Data Dirs.
func TestBundleManifestMatchesSharedSchema(t *testing.T) {
	schema := readSchema(t, filepath.Join(acquisitionBundleFixtureRoot(t), "..", "bundle-manifest.schema.json"))

	collected, running := t.TempDir(), t.TempDir()
	mustWrite(t, filepath.Join(collected, "Local State"), "state")
	mustWrite(t, filepath.Join(running, "RunningChromeVersion"), "151")
	out := filepath.Join(t.TempDir(), "bundle")
	scan := platformscanner.ScanResult{Found: []platformscanner.UserDataDir{{AccountID: "a", Path: collected}, {AccountID: "b", Path: running}}}
	_, recipient := x25519Recipient(t)
	capturer := fixedKeyCapturer{KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey("unavailable", "linux", "basic", "item", "scope", "v10", "reason")}}}
	bundle, err := (Collector{Scanner: fixedScanner{scan}, KeyCapturer: capturer}).Run(Options{
		Output: out, OperatorIdentifier: "examiner", AuthorizationReference: "case/ref",
		CaptureKeyMaterial: true, KeyMaterialRecipient: recipient,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.KeyMaterial) == 0 || len(bundle.UserDataDirs) != 2 || bundle.UserDataDirs[0].Outcome != Collected || bundle.UserDataDirs[1].Outcome != SkippedRunning {
		t.Fatalf("the test bundle does not cover every checked manifest shape: %#v", bundle)
	}
	assertMatchesSchema(t, filepath.Join(out, "bundle_manifest.json"), schema, readJSONValue(t, filepath.Join(out, "bundle_manifest.json")))

	stripped := filepath.Join(t.TempDir(), "stripped")
	if _, err := StripKeys(out, stripped); err != nil {
		t.Fatal(err)
	}
	assertMatchesSchema(t, filepath.Join(stripped, "bundle_manifest.json"), schema, readJSONValue(t, filepath.Join(stripped, "bundle_manifest.json")))
}

func readSchema(t *testing.T, path string) map[string]any {
	t.Helper()
	schema, ok := readJSONValue(t, path).(map[string]any)
	if !ok {
		t.Fatalf("%s is not a JSON Schema object", path)
	}
	return schema
}

func readJSONValue(t *testing.T, path string) any {
	t.Helper()
	var value any
	readStrictJSON(t, path, &value)
	return value
}

func assertMatchesSchema(t *testing.T, name string, schema map[string]any, value any) {
	t.Helper()
	for _, problem := range schemaProblems(schema, schema, value, "$") {
		t.Errorf("%s does not match the shared contract: %s", name, problem)
	}
}

// schemaProblems checks value against the JSON Schema keywords that the shared
// contracts use. An unknown keyword is a problem, so the check never passes by
// ignoring a rule.
func schemaProblems(root, schema map[string]any, value any, at string) []string {
	var problems []string
	fail := func(format string, args ...any) { problems = append(problems, at+": "+fmt.Sprintf(format, args...)) }
	matches := func(sub any) bool { return len(schemaProblems(root, sub.(map[string]any), value, at)) == 0 }
	for keyword := range schema {
		switch keyword {
		case "$schema", "$id", "$defs", "title", "type", "const", "enum", "$ref", "pattern", "minLength", "minimum",
			"contentEncoding", "properties", "required", "additionalProperties", "items", "allOf", "oneOf", "not", "if", "then", "else":
		default:
			fail("unsupported schema keyword %q", keyword)
		}
	}
	if ref, ok := schema["$ref"].(string); ok {
		target := root
		for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
			target = target[part].(map[string]any)
		}
		problems = append(problems, schemaProblems(root, target, value, at)...)
	}
	if want, ok := schema["type"].(string); ok {
		if got := jsonType(value); got != want && !(want == "number" && got == "integer") {
			fail("type %s, want %s", got, want)
			return problems
		}
	}
	if want, ok := schema["const"]; ok && !reflect.DeepEqual(value, want) {
		fail("%v is not %v", value, want)
	}
	if enum, ok := schema["enum"].([]any); ok && !slices.ContainsFunc(enum, func(item any) bool { return reflect.DeepEqual(item, value) }) {
		fail("%v is not one of %v", value, enum)
	}
	if text, ok := value.(string); ok {
		if pattern, ok := schema["pattern"].(string); ok && !regexp.MustCompile(pattern).MatchString(text) {
			fail("%q does not match %s", text, pattern)
		}
		if minimum, ok := schema["minLength"].(float64); ok && float64(utf8.RuneCountInString(text)) < minimum {
			fail("%q is shorter than %v", text, minimum)
		}
		if schema["contentEncoding"] == "base64" {
			if _, err := base64.StdEncoding.DecodeString(text); err != nil {
				fail("%q is not base64", text)
			}
		}
	}
	if number, ok := value.(float64); ok {
		if minimum, ok := schema["minimum"].(float64); ok && number < minimum {
			fail("%v is less than %v", number, minimum)
		}
	}
	if object, ok := value.(map[string]any); ok {
		properties, _ := schema["properties"].(map[string]any)
		required, _ := schema["required"].([]any)
		for _, field := range required {
			if _, ok := object[field.(string)]; !ok {
				fail("lacks required field %q", field)
			}
		}
		for field, item := range object {
			if property, ok := properties[field]; ok {
				problems = append(problems, schemaProblems(root, property.(map[string]any), item, at+"."+field)...)
			} else if schema["additionalProperties"] == false {
				fail("has field %q that the contract does not define", field)
			}
		}
	}
	if items, ok := value.([]any); ok {
		if itemSchema, ok := schema["items"].(map[string]any); ok {
			for index, item := range items {
				problems = append(problems, schemaProblems(root, itemSchema, item, fmt.Sprintf("%s[%d]", at, index))...)
			}
		}
	}
	if all, ok := schema["allOf"].([]any); ok {
		for _, sub := range all {
			problems = append(problems, schemaProblems(root, sub.(map[string]any), value, at)...)
		}
	}
	if one, ok := schema["oneOf"].([]any); ok {
		if count := len(slices.DeleteFunc(slices.Clone(one), func(sub any) bool { return !matches(sub) })); count != 1 {
			fail("matches %d oneOf branches, want 1", count)
		}
	}
	if not, ok := schema["not"]; ok && matches(not) {
		fail("matches a forbidden shape %v", not)
	}
	if condition, ok := schema["if"]; ok {
		branch := schema["else"]
		if matches(condition) {
			branch = schema["then"]
		}
		if branch != nil {
			problems = append(problems, schemaProblems(root, branch.(map[string]any), value, at)...)
		}
	}
	return problems
}

func jsonType(value any) string {
	switch value := value.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case string:
		return "string"
	case float64:
		if value == math.Trunc(value) {
			return "integer"
		}
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	}
	return "unknown"
}

func TestSchemaCheckRejectsWrongTypesEnumsAndOutcomeFields(t *testing.T) {
	schema := readSchema(t, filepath.Join(acquisitionBundleFixtureRoot(t), "..", "bundle-manifest.schema.json"))
	udd := func(change func(map[string]any)) any {
		value := map[string]any{
			"account_id": "a", "bundle_path": "accounts/a/udd-1", "source_path": "/src", "outcome": "failed",
			"chrome_running": false, "liveness_evidence": []any{}, "liveness_explanation": "x", "error": "disk full",
		}
		change(value)
		return value
	}
	definition := map[string]any{"$ref": "#/$defs/userDataDir"}
	if problems := schemaProblems(schema, definition, udd(func(map[string]any) {}), "$"); len(problems) != 0 {
		t.Fatalf("a valid failed User Data Dir was rejected: %v", problems)
	}
	for name, change := range map[string]func(map[string]any){
		"failed without error":       func(value map[string]any) { delete(value, "error") },
		"skipped without error":      func(value map[string]any) { value["outcome"] = "skipped_chrome_running"; delete(value, "error") },
		"collected without digests":  func(value map[string]any) { value["outcome"] = "collected" },
		"unknown outcome":            func(value map[string]any) { value["outcome"] = "partial" },
		"string where boolean":       func(value map[string]any) { value["chrome_running"] = "false" },
		"traversing bundle path":     func(value map[string]any) { value["bundle_path"] = "../outside" },
		"field outside the contract": func(value map[string]any) { value["extra"] = true },
	} {
		if problems := schemaProblems(schema, definition, udd(change), "$"); len(problems) == 0 {
			t.Errorf("%s was accepted", name)
		}
	}
}
