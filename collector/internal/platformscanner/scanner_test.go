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

func TestScannerUsesInjectedCustomHome(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "srv", "custom-home")
	found := filepath.Join(home, ".config", "google-chrome")
	if err := os.MkdirAll(found, 0o700); err != nil {
		t.Fatal(err)
	}
	result := (HostScanner{GOOS: "linux", Accounts: []Account{{ID: "custom", Home: home}}}).Scan()
	if len(result.Found) != 1 || result.Found[0].Path != found {
		t.Fatalf("custom home not scanned: %#v", result)
	}
}

func TestWindowsAndDarwinCustomHomesUsePlatformPaths(t *testing.T) {
	for _, test := range []struct{ goos, suffix string }{{"windows", filepath.Join("AppData", "Local", "Google", "Chrome", "User Data")}, {"darwin", filepath.Join("Library", "Application Support", "Google", "Chrome")}} {
		home := filepath.Join(t.TempDir(), "custom")
		found := filepath.Join(home, test.suffix)
		if err := os.MkdirAll(found, 0o700); err != nil {
			t.Fatal(err)
		}
		result := (HostScanner{GOOS: test.goos, Accounts: []Account{{ID: "custom", Home: home}}}).Scan()
		if len(result.Found) != 1 || result.Found[0].Path != found {
			t.Fatalf("%s custom home not scanned: %#v", test.goos, result)
		}
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
