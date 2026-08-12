package platformscanner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinuxScannerRecordsEveryAttemptAndFindsReadableDirs(t *testing.T) {
	root := t.TempDir()
	found := filepath.Join(root, "home", "alice", ".config", "google-chrome")
	if err := os.MkdirAll(found, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "home", "bob"), 0o700); err != nil {
		t.Fatal(err)
	}

	result := (HostScanner{GOOS: "linux", Root: root}).Scan()
	if len(result.Found) != 1 || result.Found[0].AccountID != "alice" || result.Found[0].Path != found {
		t.Fatalf("unexpected found dirs: %#v", result.Found)
	}
	// root + two user accounts, with three attempted Linux locations each.
	if len(result.Attempts) != 9 {
		t.Fatalf("got %d attempts, want 9: %#v", len(result.Attempts), result.Attempts)
	}
	outcomes := map[Outcome]int{}
	for _, attempt := range result.Attempts {
		outcomes[attempt.Outcome]++
	}
	if outcomes[Found] != 1 || outcomes[Absent] != 8 {
		t.Fatalf("unexpected outcomes: %#v", outcomes)
	}
}

func TestPlatformCandidatesAreExplicit(t *testing.T) {
	t.Parallel()
	if got := len(candidates("windows", `C:\\Users\\alice`)); got != 1 {
		t.Fatalf("windows candidates=%d", got)
	}
	if got := len(candidates("darwin", "/Users/alice")); got != 1 {
		t.Fatalf("darwin candidates=%d", got)
	}
	if got := len(candidates("linux", "/home/alice")); got != 3 {
		t.Fatalf("linux candidates=%d", got)
	}
}
