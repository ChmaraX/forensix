package collector

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

var ErrChromeRunning = errors.New("chrome-running liveness evidence detected")

type Options struct {
	Output                 string
	OperatorIdentifier     string
	AuthorizationReference string
	IncludeBulk            bool
	ContinueIfRunning      bool
	Version                string
	Commit                 string
	Now                    func() time.Time
}

type Collector struct{ Scanner platformscanner.Scanner }

type CollectionOutcome string

const (
	Collected      CollectionOutcome = "collected"
	SkippedRunning CollectionOutcome = "skipped_chrome_running"
	Failed         CollectionOutcome = "failed"
)

type ScanRecord struct {
	Attempts []platformscanner.Attempt `json:"attempts"`
}

type CollectorRecord struct {
	SchemaVersion      string `json:"schema_version"`
	CollectorVersion   string `json:"collector_version"`
	CollectorCommit    string `json:"collector_commit"`
	SelectionPolicy    string `json:"selection_policy"`
	OperatorIdentifier string `json:"operator_identifier"`
	AuthorizationClaim struct {
		Reference            string `json:"reference"`
		WitnessedByCollector bool   `json:"witnessed_by_collector"`
		AuthorityVerified    bool   `json:"authority_verified"`
	} `json:"authorization_claim"`
	StartedAt         time.Time        `json:"started_at"`
	EndedAt           time.Time        `json:"ended_at"`
	HostReportedLocal HostReportedTime `json:"host_reported_local_time"`
	Hostname          string           `json:"hostname"`
	OS                string           `json:"os"`
	OSVersion         EnvironmentValue `json:"os_version"`
	Architecture      string           `json:"architecture"`
	MachineIdentifier EnvironmentValue `json:"machine_identifier"`
	NetworkCalls      string           `json:"network_calls"`
}

type EnvironmentValue struct {
	State  string `json:"state"`
	Value  string `json:"value,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type HostReportedTime struct {
	StartedAt    time.Time `json:"started_at"`
	EndedAt      time.Time `json:"ended_at"`
	Verification string    `json:"verification"`
}

type BundleUserDataDir struct {
	AccountID           string            `json:"account_id"`
	BundlePath          string            `json:"bundle_path"`
	SourcePath          string            `json:"source_path"`
	Outcome             CollectionOutcome `json:"outcome"`
	ChromeRunning       bool              `json:"chrome_running"`
	LivenessEvidence    []string          `json:"liveness_evidence"`
	LivenessExplanation string            `json:"liveness_explanation"`
	EvidenceSetDigest   string            `json:"evidence_set_digest,omitempty"`
	WorkingCopyDigest   string            `json:"working_copy_digest,omitempty"`
	Error               string            `json:"error,omitempty"`
}

type BundleFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type BundleManifest struct {
	SchemaVersion       string              `json:"schema_version"`
	HashAlgorithm       string              `json:"hash_algorithm"`
	KeyMaterialCaptured bool                `json:"key_material_captured"`
	UserDataDirs        []BundleUserDataDir `json:"user_data_dirs"`
	Files               []BundleFile        `json:"files"`
	BundleDigest        string              `json:"bundle_digest"`
}

func (c Collector) Run(opts Options) (BundleManifest, error) {
	if c.Scanner == nil {
		return BundleManifest{}, errors.New("scanner is required")
	}
	if opts.Output == "" {
		return BundleManifest{}, errors.New("output is required")
	}
	if opts.OperatorIdentifier == "" {
		return BundleManifest{}, errors.New("operator identifier is required")
	}
	if opts.AuthorizationReference == "" {
		return BundleManifest{}, errors.New("authorization reference is required as a witnessed operator claim")
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	startedHost := opts.Now()
	started := startedHost.UTC()
	scan := c.Scanner.Scan()

	if _, err := os.Lstat(opts.Output); err == nil {
		return BundleManifest{}, fmt.Errorf("output already exists: %s", opts.Output)
	} else if !os.IsNotExist(err) {
		return BundleManifest{}, err
	}
	if err := os.MkdirAll(filepath.Dir(opts.Output), 0o700); err != nil {
		return BundleManifest{}, fmt.Errorf("create output parent: %w", err)
	}
	tmp := opts.Output + ".partial"
	if err := os.Mkdir(tmp, 0o700); err != nil {
		return BundleManifest{}, fmt.Errorf("create bundle staging directory: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(tmp)
		}
	}()

	manifest := BundleManifest{SchemaVersion: "forensix-acquisition-bundle-draft/1", HashAlgorithm: conformance.HashAlgorithm, KeyMaterialCaptured: false}
	if err := conformance.WriteJSON(filepath.Join(tmp, "scan_record.json"), ScanRecord{Attempts: scan.Attempts}); err != nil {
		return manifest, err
	}

	for index, found := range scan.Found {
		bundleRel := filepath.ToSlash(filepath.Join("accounts", safeComponent(found.AccountID), fmt.Sprintf("udd-%d", indexForAccount(scan.Found, index))))
		destination := filepath.Join(tmp, filepath.FromSlash(bundleRel))
		staging := destination + ".partial"
		outcome, collectErr := collectUserDataDir(found, staging, opts)
		outcome.BundlePath = bundleRel
		if collectErr == nil {
			if renameErr := os.Rename(staging, destination); renameErr != nil {
				outcome.Outcome, outcome.Error, collectErr = Failed, renameErr.Error(), renameErr
			}
		}
		if collectErr != nil {
			_ = os.RemoveAll(staging)
		}
		manifest.UserDataDirs = append(manifest.UserDataDirs, outcome)
	}

	hostname, _ := os.Hostname()
	endedHost := opts.Now()
	record := CollectorRecord{SchemaVersion: "forensix-collector-record-draft/1", CollectorVersion: opts.Version, CollectorCommit: opts.Commit, SelectionPolicy: conformance.SelectionPolicy, OperatorIdentifier: opts.OperatorIdentifier, StartedAt: started, EndedAt: endedHost.UTC(), Hostname: hostname, OS: runtime.GOOS, OSVersion: osVersion(), Architecture: runtime.GOARCH, MachineIdentifier: machineIdentifier(), NetworkCalls: "prohibited_by_design"}
	record.HostReportedLocal = HostReportedTime{StartedAt: startedHost.In(time.Local), EndedAt: endedHost.In(time.Local), Verification: "unverified"}
	record.AuthorizationClaim.Reference = opts.AuthorizationReference
	record.AuthorizationClaim.WitnessedByCollector = true
	record.AuthorizationClaim.AuthorityVerified = false
	if err := conformance.WriteJSON(filepath.Join(tmp, "collector_record.json"), record); err != nil {
		return manifest, err
	}

	files, digest, err := bundleFiles(tmp)
	if err != nil {
		return manifest, err
	}
	manifest.Files, manifest.BundleDigest = files, digest
	if err := conformance.WriteJSON(filepath.Join(tmp, "bundle_manifest.json"), manifest); err != nil {
		return manifest, err
	}
	if err := os.Rename(tmp, opts.Output); err != nil {
		return manifest, fmt.Errorf("publish bundle: %w", err)
	}
	committed = true
	return manifest, nil
}

func collectUserDataDir(found platformscanner.UserDataDir, destination string, opts Options) (BundleUserDataDir, error) {
	result := BundleUserDataDir{AccountID: found.AccountID, SourcePath: found.Path, Outcome: Failed}
	liveness, err := detectLiveness(found.Path)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	chromeRunning := indicatesRunningChrome(liveness)
	result.ChromeRunning = chromeRunning
	result.LivenessEvidence = liveness
	result.LivenessExplanation = livenessExplanation(chromeRunning, liveness)
	if chromeRunning && !opts.ContinueIfRunning {
		result.Outcome, result.Error = SkippedRunning, ErrChromeRunning.Error()
		return result, ErrChromeRunning
	}
	entries, liveness, err := inventory(found.Path, destination, opts.IncludeBulk, "")
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	if opts.IncludeBulk && found.CachePath != "" {
		if info, statErr := os.Stat(found.CachePath); statErr == nil && info.IsDir() {
			external, _, inventoryErr := inventory(found.CachePath, destination, true, "external_cache")
			if inventoryErr != nil {
				result.Error = inventoryErr.Error()
				return result, inventoryErr
			}
			entries = append(entries, external...)
		}
	}
	if err := addExpectedAbsent(&entries); err != nil {
		result.Error = err.Error()
		return result, err
	}
	lines, err := conformance.CanonicalLines(entries)
	if err != nil {
		return result, err
	}
	workingLines, err := conformance.WorkingCopyLines(entries)
	if err != nil {
		return result, err
	}
	result.EvidenceSetDigest, result.WorkingCopyDigest = conformance.Digest(lines), conformance.Digest(workingLines)
	header := conformance.ManifestHeader{SchemaVersion: conformance.SchemaVersion, SelectionPolicy: conformance.SelectionPolicy, SelectionDiff: conformance.PolicyDiff{IncludeBulk: opts.IncludeBulk, Includes: []string{}, Excludes: []string{}}, SourcePath: found.Path, ChromeRunning: chromeRunning, LivenessEvidence: liveness, EvidenceSetDigest: result.EvidenceSetDigest, WorkingCopyDigest: result.WorkingCopyDigest, HashAlgorithm: conformance.HashAlgorithm}
	for _, entry := range entries {
		if entry.Selection == conformance.Unclassified && entry.NodeType == conformance.NodeFile {
			header.Unclassified++
		}
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return result, err
	}
	if err := conformance.WriteFile(filepath.Join(destination, "manifest.jsonl"), lines); err != nil {
		return result, err
	}
	if err := conformance.WriteJSON(filepath.Join(destination, "manifest_header.json"), header); err != nil {
		return result, err
	}
	result.Outcome = Collected
	return result, nil
}

func detectLiveness(root string) ([]string, error) {
	var found []string
	err := filepath.WalkDir(root, func(source string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Name() != "SingletonLock" && entry.Name() != "SingletonSocket" && entry.Name() != "RunningChromeVersion" {
			return nil
		}
		rel, err := filepath.Rel(root, source)
		if err != nil {
			return err
		}
		found = append(found, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(found)
	return found, err
}

func indicatesRunningChrome(liveness []string) bool {
	for _, path := range liveness {
		name := filepath.Base(path)
		if name == "RunningChromeVersion" || name == "SingletonSocket" {
			return true
		}
	}
	return false
}

func livenessExplanation(running bool, evidence []string) string {
	if running {
		return "Chrome liveness evidence was present. Chrome can hold evidence only in memory; the Collector did not signal or modify the process."
	}
	if len(evidence) > 0 {
		return "Only non-conclusive Liveness Evidence was present. SingletonLock can survive a crash and does not prove Chrome was running."
	}
	return "No supported Chrome Liveness Evidence was found; absence does not prove Chrome was not running."
}

func inventory(root, destination string, includeBulk bool, prefix string) ([]conformance.ManifestEntry, []string, error) {
	var entries []conformance.ManifestEntry
	var liveness []string
	err := filepath.WalkDir(root, func(source string, dirEntry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("inventory %q: %w", source, walkErr)
		}
		rel, err := filepath.Rel(root, source)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		manifestPath := rel
		if prefix != "" {
			manifestPath = filepath.ToSlash(filepath.Join(prefix, filepath.FromSlash(rel)))
		}
		info, err := os.Lstat(source)
		if err != nil {
			return fmt.Errorf("lstat %q: %w", source, err)
		}
		node := nodeType(info.Mode())
		selection, kind, copied := conformance.Classify(manifestPath, node, includeBulk)
		entry := conformance.ManifestEntry{Path: manifestPath, SourcePath: source, Size: info.Size(), HashAlgorithm: conformance.HashAlgorithm, MTime: info.ModTime().UTC(), NodeType: node, FileKind: kind, Copied: copied, Selection: selection}
		switch node {
		case conformance.NodeFile:
			entry.SHA256, err = hashAndMaybeCopy(source, filepath.Join(destination, "working_copy", filepath.FromSlash(manifestPath)), copied, info)
		case conformance.NodeSymlink:
			var target string
			target, err = os.Readlink(source)
			if err == nil {
				entry.Size = int64(len([]byte(target)))
				entry.SHA256 = hashString(target)
			}
		default:
			entry.SHA256 = hashString(nodeRepresentation(node))
		}
		if err != nil {
			return err
		}
		if kind == conformance.KindLivenessEvidence {
			liveness = append(liveness, rel)
		}
		entries = append(entries, entry)
		return nil
	})
	sort.Strings(liveness)
	return entries, liveness, err
}

func hashAndMaybeCopy(source, destination string, copied bool, before fs.FileInfo) (string, error) {
	input, err := os.Open(source)
	if err != nil {
		return "", fmt.Errorf("open source %q: %w", source, err)
	}
	defer input.Close()
	hash := sha256.New()
	var writer io.Writer = hash
	var output *os.File
	if copied {
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return "", err
		}
		output, err = os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, before.Mode().Perm()&0o777)
		if err != nil {
			return "", err
		}
		defer output.Close()
		writer = io.MultiWriter(hash, output)
	}
	if _, err := io.Copy(writer, input); err != nil {
		return "", fmt.Errorf("read source %q: %w", source, err)
	}
	if output != nil {
		if err := output.Sync(); err != nil {
			return "", err
		}
		if err := output.Close(); err != nil {
			return "", err
		}
		output = nil
	}
	after, err := input.Stat()
	if err != nil {
		return "", err
	}
	if before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return "", fmt.Errorf("source changed while reading %q", source)
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if copied {
		copyDigest, verifyErr := hashFile(destination)
		if verifyErr != nil {
			return "", fmt.Errorf("verify copied file %q: %w", destination, verifyErr)
		}
		if copyDigest != digest {
			return "", fmt.Errorf("copied file digest mismatch for %q", source)
		}
	}
	return digest, nil
}

func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func addExpectedAbsent(entries *[]conformance.ManifestEntry) error {
	present := map[string]bool{}
	profileArtifacts := map[string]map[string]bool{}
	profiles := map[string]bool{"Default": true}
	for _, entry := range *entries {
		present[entry.Path] = true
		parts := strings.Split(entry.Path, "/")
		if len(parts) > 1 && (parts[0] == "Default" || parts[0] == "Guest Profile" || parts[0] == "System Profile" || strings.HasPrefix(parts[0], "Profile ")) {
			profile := parts[0]
			profiles[profile] = true
			if profileArtifacts[profile] == nil {
				profileArtifacts[profile] = map[string]bool{}
			}
			profileArtifacts[profile][parts[len(parts)-1]] = true
		}
	}
	browser := []string{"Local State", "Last Version", "First Run"}
	for _, name := range browser {
		if !present[name] {
			*entries = append(*entries, absent(name))
		}
	}
	profileNames := []string{"History", "Favicons", "Top Sites", "Cookies", "Login Data", "Login Data For Account", "Web Data", "Account Web Data", "Affiliation Database", "Preferences", "Secure Preferences", "Bookmarks", "Bookmarks.bak", "Google Profile Picture.png", "Network Persistent State"}
	for profile := range profiles {
		for _, name := range profileNames {
			if !profileArtifacts[profile][name] {
				*entries = append(*entries, absent(profile+"/"+name))
			}
		}
	}
	return nil
}

func absent(path string) conformance.ManifestEntry {
	selection, kind, _ := conformance.Classify(path, conformance.NodeAbsent, false)
	return conformance.ManifestEntry{Path: path, SourcePath: "", HashAlgorithm: conformance.HashAlgorithm, SHA256: hashString("absent"), NodeType: conformance.NodeAbsent, FileKind: kind, Selection: selection}
}
func nodeType(mode fs.FileMode) conformance.NodeType {
	if mode.IsRegular() {
		return conformance.NodeFile
	}
	if mode&os.ModeSymlink != 0 {
		return conformance.NodeSymlink
	}
	if mode&os.ModeSocket != 0 {
		return conformance.NodeSocket
	}
	if mode.IsDir() {
		return conformance.NodeDir
	}
	return conformance.NodeSocket
}
func nodeRepresentation(node conformance.NodeType) string { return string(node) }
func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func safeComponent(value string) string {
	value = strings.ReplaceAll(value, string(filepath.Separator), "_")
	if value == "" || value == "." || value == ".." {
		return "unknown"
	}
	return value
}
func indexForAccount(found []platformscanner.UserDataDir, index int) int {
	n := 0
	for i := 0; i <= index; i++ {
		if found[i].AccountID == found[index].AccountID {
			n++
		}
	}
	return n
}

func osVersion() EnvironmentValue {
	switch runtime.GOOS {
	case "linux":
		content, err := os.ReadFile("/etc/os-release")
		if err != nil {
			return EnvironmentValue{State: "unavailable", Reason: "os_release_unreadable"}
		}
		for _, line := range strings.Split(string(content), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				return EnvironmentValue{State: "value", Value: strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)}
			}
		}
		return EnvironmentValue{State: "unavailable", Reason: "os_version_not_found"}
	case "darwin":
		content, err := os.ReadFile("/System/Library/CoreServices/SystemVersion.plist")
		if err != nil {
			return EnvironmentValue{State: "unavailable", Reason: "system_version_unreadable"}
		}
		marker := "<key>ProductVersion</key>"
		remaining := string(content)
		if index := strings.Index(remaining, marker); index >= 0 {
			remaining = remaining[index+len(marker):]
			if start := strings.Index(remaining, "<string>"); start >= 0 {
				remaining = remaining[start+len("<string>"):]
				if end := strings.Index(remaining, "</string>"); end >= 0 {
					return EnvironmentValue{State: "value", Value: remaining[:end]}
				}
			}
		}
		return EnvironmentValue{State: "unavailable", Reason: "os_version_not_found"}
	default:
		return EnvironmentValue{State: "unavailable", Reason: "os_version_api_not_available"}
	}
}

func machineIdentifier() EnvironmentValue {
	if runtime.GOOS != "linux" {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_api_not_available"}
	}
	content, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_unreadable"}
	}
	value := strings.TrimSpace(string(content))
	if value == "" {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_empty"}
	}
	return EnvironmentValue{State: "value", Value: value}
}

func bundleFiles(root string) ([]BundleFile, string, error) {
	var files []BundleFile
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		files = append(files, BundleFile{Path: filepath.ToSlash(rel), Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:])})
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	encoded, err := json.Marshal(files)
	if err != nil {
		return nil, "", err
	}
	encoded = append(encoded, '\n')
	return files, conformance.Digest(encoded), nil
}
