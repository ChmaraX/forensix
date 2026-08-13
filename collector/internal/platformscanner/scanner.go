package platformscanner

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

type Outcome string

const (
	Found                 Outcome = "found"
	Absent                Outcome = "absent"
	Unreadable            Outcome = "unavailable"
	InsufficientPrivilege Outcome = "insufficient_privilege"
)

type Attempt struct {
	AccountID string  `json:"account_id"`
	Path      string  `json:"path"`
	Outcome   Outcome `json:"outcome"`
	Reason    string  `json:"reason,omitempty"`
}

type UserDataDir struct {
	AccountID string
	Path      string
	CachePath string
}

type ScanResult struct {
	Attempts []Attempt
	Found    []UserDataDir
}

// Scanner is the platform-aware seam. Tests and future privileged adapters can
// replace it without changing collection or forensic serialization.
type Scanner interface {
	Scan() ScanResult
}

type HostScanner struct {
	GOOS     string
	Root     string
	Accounts []Account
}

type Account struct{ ID, Home string }

func NewHostScanner() HostScanner { return HostScanner{GOOS: runtime.GOOS} }

func (s HostScanner) Scan() ScanResult {
	accounts, accountAttempts := s.accounts()
	result := ScanResult{Attempts: accountAttempts}
	for _, account := range accounts {
		for _, candidate := range candidates(s.GOOS, account.Home) {
			attempt := Attempt{AccountID: account.ID, Path: candidate}
			info, err := os.Stat(candidate)
			switch {
			case err == nil && info.IsDir():
				f, openErr := os.Open(candidate)
				if openErr != nil {
					attempt.Outcome, attempt.Reason = classifyOpenError(openErr)
				} else {
					_, readErr := f.Readdirnames(1)
					_ = f.Close()
					if readErr != nil && !errors.Is(readErr, io.EOF) {
						attempt.Outcome, attempt.Reason = classifyOpenError(readErr)
					} else {
						attempt.Outcome = Found
						result.Found = append(result.Found, UserDataDir{AccountID: account.ID, Path: candidate, CachePath: externalCachePath(s.GOOS, account.Home, candidate)})
					}
				}
			case err == nil:
				attempt.Outcome, attempt.Reason = Unreadable, "not_a_directory"
			case os.IsNotExist(err):
				attempt.Outcome = Absent
			default:
				attempt.Outcome, attempt.Reason = classifyOpenError(err)
			}
			result.Attempts = append(result.Attempts, attempt)
		}
	}
	sort.Slice(result.Attempts, func(i, j int) bool {
		if result.Attempts[i].AccountID == result.Attempts[j].AccountID {
			return result.Attempts[i].Path < result.Attempts[j].Path
		}
		return result.Attempts[i].AccountID < result.Attempts[j].AccountID
	})
	return result
}

func (s HostScanner) accounts() ([]Account, []Attempt) {
	if len(s.Accounts) > 0 {
		return append([]Account(nil), s.Accounts...), nil
	}
	if s.Root != "" {
		return directoryAccounts(s.GOOS, s.Root)
	}
	accounts, err := nativeAccounts()
	if err != nil {
		outcome, reason := classifyOpenError(err)
		return nil, []Attempt{{AccountID: "<account-enumeration>", Path: "<os-account-database>", Outcome: outcome, Reason: reason}}
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].ID < accounts[j].ID })
	return accounts, nil
}

func directoryAccounts(goos, root string) ([]Account, []Attempt) {
	base := filepath.Join(root, "home")
	if goos == "windows" || goos == "darwin" {
		base = filepath.Join(root, "Users")
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		outcome, reason := classifyOpenError(err)
		if os.IsNotExist(err) {
			outcome, reason = Absent, "accounts_root_absent"
		}
		return nil, []Attempt{{AccountID: "<account-enumeration>", Path: base, Outcome: outcome, Reason: reason}}
	}
	var accounts []Account
	if goos == "linux" {
		accounts = append(accounts, Account{ID: "root", Home: filepath.Join(root, "root")})
	}
	for _, entry := range entries {
		if entry.IsDir() {
			accounts = append(accounts, Account{ID: entry.Name(), Home: filepath.Join(base, entry.Name())})
		}
	}
	return accounts, nil
}

func candidates(goos, home string) []string {
	switch goos {
	case "windows":
		return []string{filepath.Join(home, "AppData", "Local", "Google", "Chrome", "User Data")}
	case "darwin":
		return []string{filepath.Join(home, "Library", "Application Support", "Google", "Chrome")}
	case "linux":
		return []string{
			filepath.Join(home, ".config", "google-chrome"),
			filepath.Join(home, "snap", "chromium", "common", "chromium"),
			filepath.Join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome"),
		}
	default:
		return nil
	}
}

func externalCachePath(goos, home, userDataDir string) string {
	switch goos {
	case "darwin":
		return filepath.Join(home, "Library", "Caches", "Google", "Chrome")
	case "linux":
		if userDataDir == filepath.Join(home, ".config", "google-chrome") {
			return filepath.Join(home, ".cache", "google-chrome")
		}
	}
	return ""
}

func classifyOpenError(err error) (Outcome, string) {
	if os.IsPermission(err) {
		return InsufficientPrivilege, "insufficient_privilege"
	}
	return Unreadable, fmt.Sprintf("open_failed: %v", err)
}
