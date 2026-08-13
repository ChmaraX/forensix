package conformance

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestManifestMatchesCanonicalAnalyzerFixture(t *testing.T) {
	directory := filepath.Join(contractRoot(t), "manifest", "fixtures", "canonical-v1")
	var entries []ManifestEntry
	decodeStrictFile(t, filepath.Join(directory, "entries.json"), &entries)

	got, err := CanonicalLines(entries)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(directory, "manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("wire bytes differ from canonical Analyzer fixture\ngot:  %s\nwant: %s", got, want)
	}

	var digests struct {
		HashAlgorithm     string `json:"hash_algorithm"`
		EvidenceSetDigest string `json:"evidence_set_digest"`
		WorkingCopyDigest string `json:"working_copy_digest"`
	}
	decodeStrictFile(t, filepath.Join(directory, "expected-digests.json"), &digests)
	workingCopy, err := WorkingCopyLines(entries)
	if err != nil {
		t.Fatal(err)
	}
	if digests.HashAlgorithm != HashAlgorithm || Digest(got) != digests.EvidenceSetDigest || Digest(workingCopy) != digests.WorkingCopyDigest {
		t.Fatalf("digest mismatch: evidence=%s working-copy=%s expected=%#v", Digest(got), Digest(workingCopy), digests)
	}

	var header ManifestHeader
	decodeStrictFile(t, filepath.Join(directory, "manifest_header.json"), &header)
	if header.ManifestSchema != ManifestSchema || header.SourceKind != SourceKind || header.SelectionPolicy != SelectionPolicy || header.EntryCount != len(entries) || header.EvidenceSetDigest != digests.EvidenceSetDigest || header.WorkingCopyDigest != digests.WorkingCopyDigest {
		t.Fatalf("canonical header is unsupported: %#v", header)
	}
}

func TestSelectionPolicyMatchesCanonicalContractAndFixture(t *testing.T) {
	policyBytes, err := os.ReadFile(filepath.Join(contractRoot(t), "selection-policy.chrome-userdata-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	policy, err := DecodeSelectionPolicy(policyBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(policy, canonicalPolicy) {
		t.Fatalf("Collector Selection Policy drifted from canonical contract\ngot:  %#v\nwant: %#v", canonicalPolicy, policy)
	}

	var fixture struct {
		SelectionPolicy string `json:"selection_policy"`
		Cases           []struct {
			Path          string        `json:"path"`
			NodeType      NodeType      `json:"node_type"`
			SelectionTier SelectionTier `json:"selection_tier"`
			FileKind      FileKind      `json:"file_kind"`
			Unclassified  bool          `json:"unclassified"`
			CopyDefault   bool          `json:"copy_default"`
			CopyWithTier2 bool          `json:"copy_with_tier_2"`
		} `json:"cases"`
	}
	decodeStrictFile(t, filepath.Join(contractRoot(t), "manifest", "fixtures", "selection-policy-v1.json"), &fixture)
	if fixture.SelectionPolicy != SelectionPolicy {
		t.Fatalf("unsupported fixture policy %q", fixture.SelectionPolicy)
	}
	for _, testCase := range fixture.Cases {
		tier, kind, copied := Classify(testCase.Path, testCase.NodeType, false)
		if tier != testCase.SelectionTier || kind != testCase.FileKind || copied != testCase.CopyDefault || (tier == Unclassified) != testCase.Unclassified {
			t.Errorf("default %s: got (%s,%s,%v,%v), want (%s,%s,%v,%v)", testCase.Path, tier, kind, copied, tier == Unclassified, testCase.SelectionTier, testCase.FileKind, testCase.CopyDefault, testCase.Unclassified)
		}
		_, _, copiedWithTier2 := Classify(testCase.Path, testCase.NodeType, true)
		if copiedWithTier2 != testCase.CopyWithTier2 {
			t.Errorf("Tier 2 %s: copied=%v, want %v", testCase.Path, copiedWithTier2, testCase.CopyWithTier2)
		}
	}
}

func TestSelectionPolicyRejectsUnknownContractFields(t *testing.T) {
	content, err := os.ReadFile(filepath.Join(contractRoot(t), "selection-policy.chrome-userdata-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	content = bytes.Replace(content, []byte("{\n"), []byte("{\n  \"unsupported\": true,\n"), 1)
	if _, err := DecodeSelectionPolicy(content); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown contract field was not rejected: %v", err)
	}
}

func TestDigestReproducesWithStandardSortAndSHA256Tools(t *testing.T) {
	sortPath, err := exec.LookPath("sort")
	if err != nil {
		t.Skip("standard sort tool unavailable")
	}
	hashPath, hashArgs := "", []string{}
	if candidate, lookErr := exec.LookPath("sha256sum"); lookErr == nil {
		hashPath = candidate
	} else if candidate, lookErr := exec.LookPath("shasum"); lookErr == nil {
		hashPath, hashArgs = candidate, []string{"-a", "256"}
	} else {
		t.Skip("standard SHA-256 tool unavailable")
	}
	manifestPath := filepath.Join(contractRoot(t), "manifest", "fixtures", "canonical-v1", "manifest.jsonl")
	command := exec.Command(sortPath, manifestPath)
	command.Env = append(os.Environ(), "LC_ALL=C")
	content, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	args := append(hashArgs, manifestPath)
	output, err := exec.Command(hashPath, args...).Output()
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 || fields[0] != Digest(content) {
		t.Fatalf("standard-tool digest=%q Go digest=%s", fields, Digest(content))
	}
}

func TestExpectedPathsFollowCanonicalPolicy(t *testing.T) {
	mtime, directoryDigest := "1", Digest([]byte("dir"))
	entries := []ManifestEntry{{
		Path: "Default", State: StateValue, NodeType: NodeDir, FileKind: KindDirectory,
		SelectionTier: Tier1, MTimeNS: &mtime, HashAlgorithm: HashAlgorithm, SHA256: &directoryDigest,
	}}
	missing := MissingExpectedPaths(entries)
	for _, missingPath := range missing {
		if missingPath == "Default/Cookies" || missingPath == "Default/Network Persistent State" {
			t.Fatalf("optional legacy path was emitted as expected: %s", missingPath)
		}
	}
	for _, wanted := range []string{"Default/Network/Cookies", "Default/Network/Cookies-wal", "Default/Network/Network Persistent State"} {
		if !contains(missing, wanted) {
			t.Errorf("canonical expected path missing: %s", wanted)
		}
	}
}

func TestProfileNamesRequireCanonicalPositiveDecimalSuffix(t *testing.T) {
	for _, name := range []string{"Default", "Guest Profile", "System Profile", "Profile 1", "Profile 20"} {
		if !IsProfileName(name) {
			t.Errorf("valid Profile name rejected: %q", name)
		}
	}
	for _, name := range []string{"Profile 0", "Profile 01", "Profile ", "Profile x", "Profiles"} {
		if IsProfileName(name) {
			t.Errorf("invalid Profile name accepted: %q", name)
		}
	}
}

func contractRoot(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate conformance test")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", "contracts"))
}

func decodeStrictFile(t *testing.T, path string, target any) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
