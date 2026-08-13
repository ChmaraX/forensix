package conformance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCanonicalManifestIsPathSortedAndExternallyDigestible(t *testing.T) {
	t.Parallel()
	entries := []ManifestEntry{
		{Path: "z/file", Size: 1, HashAlgorithm: HashAlgorithm, SHA256: strings.Repeat("a", 64), MTime: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), NodeType: NodeFile, FileKind: KindUnclassified, Selection: Unclassified},
		{Path: "a/file", Size: 2, HashAlgorithm: HashAlgorithm, SHA256: strings.Repeat("b", 64), MTime: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), NodeType: NodeFile, FileKind: KindDatabase, Copied: true, Selection: Tier1},
	}
	lines, err := CanonicalLines(entries)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(lines, []byte(`{"path":"a/file"`)) {
		t.Fatalf("manifest is not path sorted or path-first: %s", lines)
	}
	if bytes.Contains(lines, []byte("\r")) || !bytes.HasSuffix(lines, []byte("\n")) {
		t.Fatal("manifest must use UTF-8 LF-delimited JSONL")
	}
	got, err := VerifySortedDigest(bytes.NewReader(lines))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(lines)
	want := hex.EncodeToString(sum[:])
	if got != want || Digest(lines) != want {
		t.Fatalf("digest mismatch: got %s verify %s want %s", Digest(lines), got, want)
	}
}

func TestManifestConformanceFixture(t *testing.T) {
	t.Parallel()
	when := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	entries := []ManifestEntry{
		{Path: "Default/new-artifact", SourcePath: "/evidence/Chrome/Default/new-artifact", Size: 1, HashAlgorithm: HashAlgorithm, SHA256: strings.Repeat("a", 64), MTime: when, NodeType: NodeFile, FileKind: KindUnclassified, Selection: Unclassified},
		{Path: "Default/History", SourcePath: "/evidence/Chrome/Default/History", Size: 2, HashAlgorithm: HashAlgorithm, SHA256: strings.Repeat("b", 64), MTime: when, NodeType: NodeFile, FileKind: KindDatabase, Copied: true, Selection: Tier1},
	}
	got, err := CanonicalLines(entries)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "manifest.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("wire bytes changed\ngot:  %s\nwant: %s", got, want)
	}
	wantDigestBytes, err := os.ReadFile(filepath.Join("testdata", "manifest.sha256"))
	if err != nil {
		t.Fatal(err)
	}
	if Digest(got) != strings.TrimSpace(string(wantDigestBytes)) {
		t.Fatalf("digest=%s want=%s", Digest(got), wantDigestBytes)
	}
}

func TestDigestReproducesWithStandardSortAndSHA256Tools(t *testing.T) {
	sortPath, err := exec.LookPath("sort")
	if err != nil {
		t.Skip("standard sort tool unavailable")
	}
	hashPath, hashArgs := "", []string{}
	if path, lookErr := exec.LookPath("sha256sum"); lookErr == nil {
		hashPath = path
	} else if path, lookErr := exec.LookPath("shasum"); lookErr == nil {
		hashPath, hashArgs = path, []string{"-a", "256"}
	} else {
		t.Skip("standard SHA-256 tool unavailable")
	}
	temp := t.TempDir()
	sorted := filepath.Join(temp, "manifest.jsonl")
	command := exec.Command(sortPath, filepath.Join("testdata", "manifest.jsonl"))
	command.Env = append(os.Environ(), "LC_ALL=C")
	content, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sorted, content, 0o600); err != nil {
		t.Fatal(err)
	}
	args := append(hashArgs, sorted)
	output, err := exec.Command(hashPath, args...).Output()
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 {
		t.Fatalf("empty hash output")
	}
	if fields[0] != Digest(content) {
		t.Fatalf("standard-tool digest=%s Go digest=%s", fields[0], Digest(content))
	}
}

func TestCanonicalOrderingMatchesEncodedByteSort(t *testing.T) {
	t.Parallel()
	entries := []ManifestEntry{
		{Path: "a\\file", HashAlgorithm: HashAlgorithm, NodeType: NodeFile, FileKind: KindUnclassified, Selection: Unclassified},
		{Path: "a\nfile", HashAlgorithm: HashAlgorithm, NodeType: NodeFile, FileKind: KindUnclassified, Selection: Unclassified},
	}
	lines, err := CanonicalLines(entries)
	if err != nil {
		t.Fatal(err)
	}
	standardDigest, err := VerifySortedDigest(bytes.NewReader(lines))
	if err != nil {
		t.Fatal(err)
	}
	if standardDigest != Digest(lines) {
		t.Fatalf("encoded byte order differs from standard sort: %q", lines)
	}
}

func TestSelectionPolicyChromeUserdataOne(t *testing.T) {
	t.Parallel()
	tests := []struct {
		path      string
		bulk      bool
		selection Selection
		copied    bool
	}{
		{"Default/History", false, Tier1, true},
		{"Default/History-wal", false, Tier1, true},
		{"Default/Network/Cookies", false, Tier1, true},
		{"Default/Network/Cookies-wal", false, Tier1, true},
		{"Default/Cache/data_0", false, Tier2, false},
		{"Default/Cache/data_0", true, Tier2, true},
		{"optimization_guide_model_store/model", true, Tier3, false},
		{"Default/new-chrome-artifact", true, Unclassified, false},
		{"Default/Cache/History", false, Tier2, false},
		{"Default/Extensions/x/History", false, Tier2, false},
		{"unrelated/History", false, Unclassified, false},
	}
	for _, test := range tests {
		selection, _, copied := Classify(test.path, NodeFile, test.bulk)
		if selection != test.selection || copied != test.copied {
			t.Errorf("%s: got (%s,%v), want (%s,%v)", test.path, selection, copied, test.selection, test.copied)
		}
	}
}

func TestNetworkCookiesSatisfyExpectedCookiesWithoutSuppressingOtherAbsence(t *testing.T) {
	t.Parallel()
	missing := MissingExpectedPaths([]ManifestEntry{{Path: "Default/Network/Cookies", NodeType: NodeFile}})
	for _, path := range missing {
		if path == "Default/Cookies" {
			t.Fatal("Network/Cookies must satisfy the Cookies expected artifact")
		}
	}
	foundHistory := false
	for _, path := range missing {
		if path == "Default/History" {
			foundHistory = true
		}
	}
	if !foundHistory {
		t.Fatal("unrelated expected artifact was suppressed")
	}
}

func TestSymlinkIsNeverCopyable(t *testing.T) {
	t.Parallel()
	selection, kind, copied := Classify("Default/SingletonLock", NodeSymlink, true)
	if selection != Tier1 || kind != KindLivenessEvidence || copied {
		t.Fatalf("got %s %s copied=%v", selection, kind, copied)
	}
}
