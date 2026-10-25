package collector

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

type plannedEntry struct {
	manifest conformance.ManifestEntry
	mode     fs.FileMode
}

type acquisitionPlan struct {
	entries  []plannedEntry
	liveness []string
	running  bool
}

// testHookAfterInventory runs after the inventory and before the copy. Tests
// use it to change the Source between the two passes.
var testHookAfterInventory func(platformscanner.UserDataDir)

// sourceReadError is a failure to read one Source node. The Collector records
// it as an unavailable Manifest entry and continues with the other nodes.
type sourceReadError struct {
	reason conformance.UnavailableReason
	err    error
}

func (e sourceReadError) Error() string { return e.err.Error() }
func (e sourceReadError) Unwrap() error { return e.err }

func sourceFailure(err error) sourceReadError {
	return sourceReadError{reason: unavailableReason(err), err: err}
}

func sourceChanged(format string, args ...any) sourceReadError {
	return sourceReadError{reason: conformance.ChangedDuringIngest, err: fmt.Errorf(format, args...)}
}

// unavailableReason maps a Source read failure to the Manifest contract reason.
// It uses the same mapping as the analyzer.
func unavailableReason(err error) conformance.UnavailableReason {
	switch {
	case errors.Is(err, fs.ErrPermission):
		return conformance.PermissionDenied
	case errors.Is(err, fs.ErrNotExist):
		return conformance.ChangedDuringIngest
	default:
		return conformance.IOError
	}
}

// resolveSourceRoot resolves the selected User Data Dir root once, so that a
// symlinked or junctioned root is walked. Descendant symlinks are not followed.
func resolveSourceRoot(path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("resolve User Data Dir root %q: %w", path, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inventory User Data Dir root %q: %w", path, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("User Data Dir root is not a directory: %q", path)
	}
	return resolved, nil
}

func planAcquisition(found platformscanner.UserDataDir, includeTier2 bool) (acquisitionPlan, error) {
	plan := acquisitionPlan{}
	root, err := resolveSourceRoot(found.Path)
	if err != nil {
		return plan, err
	}
	if err := plan.walk(root, includeTier2); err != nil {
		return plan, err
	}
	// CachePath can point outside the User Data Dir. The canonical Manifest
	// contract only permits Source-relative descendants, so it cannot be folded
	// into this Manifest until the shared contract defines that source boundary.
	plan.addExpectedAbsent()
	sort.Strings(plan.liveness)
	plan.running = indicatesRunningChrome(plan.liveness)
	return plan, nil
}

func unavailableEntry(manifestPath, source string, node conformance.NodeType, info fs.FileInfo, reason conformance.UnavailableReason, includeTier2 bool) conformance.ManifestEntry {
	tier, kind, _ := conformance.Classify(manifestPath, node, includeTier2)
	entry := conformance.ManifestEntry{
		Path: manifestPath, State: conformance.StateUnavailable, UnavailableReason: &reason,
		NodeType: node, FileKind: kind, SelectionTier: tier,
		Unclassified:  tier == conformance.Unclassified,
		HashAlgorithm: conformance.HashAlgorithm, SourcePath: source,
	}
	if info != nil {
		mtimeNS := strconv.FormatInt(info.ModTime().UnixNano(), 10)
		entry.MTimeNS, entry.MTime = &mtimeNS, info.ModTime().UTC()
	}
	return entry
}

func (plan *acquisitionPlan) walk(root string, includeTier2 bool) error {
	entryIndex := map[string]int{}
	// Walk the root with a trailing separator. Since Go 1.23, a Windows
	// junction is neither a symlink to EvalSymlinks nor a directory to Lstat
	// (it reports ModeIrregular), so WalkDir would not descend into a
	// junctioned root. Lstat follows the last path element when the path ends
	// with a separator, on every platform, so the root itself is entered while
	// links below it are still not followed.
	walkRoot := root
	if !strings.HasSuffix(walkRoot, string(filepath.Separator)) {
		walkRoot += string(filepath.Separator)
	}
	return filepath.WalkDir(walkRoot, func(source string, dirEntry fs.DirEntry, walkErr error) error {
		relative, err := filepath.Rel(root, source)
		if err != nil {
			return err
		}
		if relative == "." {
			if walkErr != nil {
				return fmt.Errorf("inventory %q: %w", source, walkErr)
			}
			return nil
		}
		manifestPath := filepath.ToSlash(relative)
		if strings.Contains(manifestPath, `\`) {
			return fmt.Errorf("Source path cannot be represented by the Manifest contract: %q", manifestPath)
		}
		if walkErr != nil {
			// WalkDir reports a failed directory read in a second call for a
			// directory it already reported. Record that directory as
			// unavailable and skip its descendants.
			if index, ok := entryIndex[manifestPath]; ok {
				previous := plan.entries[index]
				node, reason := previous.manifest.NodeType, unavailableReason(walkErr)
				if node != conformance.NodeDir {
					// The node was not a directory when it was inventoried.
					reason = conformance.ChangedDuringIngest
				}
				info, _ := os.Lstat(source)
				plan.entries[index] = plannedEntry{manifest: unavailableEntry(manifestPath, source, node, info, reason, includeTier2), mode: previous.mode}
				return skipIfDirectory(dirEntry)
			}
			plan.entries = append(plan.entries, plannedEntry{manifest: unavailableEntry(manifestPath, source, conformance.NodeFile, nil, unavailableReason(walkErr), includeTier2)})
			return skipIfDirectory(dirEntry)
		}
		info, err := os.Lstat(source)
		if err != nil {
			plan.entries = append(plan.entries, plannedEntry{manifest: unavailableEntry(manifestPath, source, conformance.NodeFile, nil, unavailableReason(err), includeTier2)})
			return skipIfDirectory(dirEntry)
		}
		node, err := nodeType(info.Mode())
		if err != nil {
			return fmt.Errorf("inventory %q: %w", source, err)
		}
		tier, kind, copied := conformance.Classify(manifestPath, node, includeTier2)
		mtimeNS := strconv.FormatInt(info.ModTime().UnixNano(), 10)
		entry := conformance.ManifestEntry{
			Path: manifestPath, State: conformance.StateValue, NodeType: node,
			FileKind: kind, SelectionTier: tier, Copied: copied,
			Unclassified: tier == conformance.Unclassified,
			MTimeNS:      &mtimeNS, HashAlgorithm: conformance.HashAlgorithm,
			SourcePath: source, MTime: info.ModTime().UTC(),
		}
		switch node {
		case conformance.NodeFile:
			size := info.Size()
			entry.Size = &size
			digest, hashErr := hashFile(source)
			if hashErr != nil {
				entry = unavailableEntry(manifestPath, source, node, info, unavailableReason(hashErr), includeTier2)
				break
			}
			entry.SHA256 = &digest
		case conformance.NodeSymlink:
			target, readErr := os.Readlink(source)
			if readErr != nil {
				entry = unavailableEntry(manifestPath, source, node, info, unavailableReason(readErr), includeTier2)
				break
			}
			size, digest := int64(len([]byte(target))), hashString(target)
			entry.Size, entry.SHA256, entry.LinkTarget = &size, &digest, &target
		case conformance.NodeSocket, conformance.NodeDir:
			digest := hashString(string(node))
			entry.SHA256 = &digest
		}
		if kind == conformance.KindLivenessEvidence {
			plan.liveness = append(plan.liveness, manifestPath)
		}
		entryIndex[manifestPath] = len(plan.entries)
		plan.entries = append(plan.entries, plannedEntry{manifest: entry, mode: info.Mode()})
		return nil
	})
}

func skipIfDirectory(dirEntry fs.DirEntry) error {
	if dirEntry != nil && dirEntry.IsDir() {
		return fs.SkipDir
	}
	return nil
}

func (plan *acquisitionPlan) addExpectedAbsent() {
	manifestEntries := plan.manifestEntries()
	unavailableDirectories := map[string]bool{}
	for _, entry := range manifestEntries {
		if entry.State == conformance.StateUnavailable && entry.NodeType == conformance.NodeDir {
			unavailableDirectories[entry.Path] = true
		}
	}
	for _, missingPath := range conformance.MissingExpectedPaths(manifestEntries) {
		if hasUnavailableParent(missingPath, unavailableDirectories) {
			// The Collector could not read the parent directory, so it cannot
			// claim that the expected path is absent.
			reason := conformance.ParentUnavailable
			tier, kind, _ := conformance.Classify(missingPath, conformance.NodeFile, false)
			entry := conformance.ManifestEntry{
				Path: missingPath, State: conformance.StateUnavailable, UnavailableReason: &reason,
				NodeType: conformance.NodeFile, FileKind: kind, SelectionTier: tier,
				Unclassified: tier == conformance.Unclassified, HashAlgorithm: conformance.HashAlgorithm,
			}
			plan.entries = append(plan.entries, plannedEntry{manifest: entry})
			continue
		}
		tier, kind, _ := conformance.Classify(missingPath, conformance.NodeAbsent, false)
		digest := hashString("absent")
		entry := conformance.ManifestEntry{
			Path: missingPath, State: conformance.StateAbsent, NodeType: conformance.NodeAbsent,
			FileKind: kind, SelectionTier: tier, HashAlgorithm: conformance.HashAlgorithm,
			SHA256: &digest,
		}
		plan.entries = append(plan.entries, plannedEntry{manifest: entry})
	}
}

func hasUnavailableParent(manifestPath string, unavailableDirectories map[string]bool) bool {
	parts := strings.Split(manifestPath, "/")
	for length := 1; length < len(parts); length++ {
		if unavailableDirectories[strings.Join(parts[:length], "/")] {
			return true
		}
	}
	return false
}

func (plan acquisitionPlan) manifestEntries() []conformance.ManifestEntry {
	entries := make([]conformance.ManifestEntry, len(plan.entries))
	for index := range plan.entries {
		entries[index] = plan.entries[index].manifest
	}
	return entries
}

func (plan acquisitionPlan) profileCount() int {
	count := 0
	for _, entry := range plan.entries {
		manifest := entry.manifest
		if !strings.Contains(manifest.Path, "/") && conformance.IsProfileName(manifest.Path) && manifest.NodeType == conformance.NodeDir && manifest.State == conformance.StateValue {
			count++
		}
	}
	return count
}

// materialize copies each selected file into the Working Copy. A Source file
// that cannot be read, or that changed after the inventory, becomes an
// unavailable Manifest entry, and the copy continues with the other files. Only
// a failure to write the bundle stops the copy.
func (plan *acquisitionPlan) materialize(destination string) error {
	for index := range plan.entries {
		entry := &plan.entries[index]
		if !entry.manifest.Copied {
			continue
		}
		target := filepath.Join(destination, "working_copy", filepath.FromSlash(entry.manifest.Path))
		err := copyPlannedFile(*entry, target)
		if err == nil {
			continue
		}
		var readErr sourceReadError
		if !errors.As(err, &readErr) {
			return err
		}
		if removeErr := os.Remove(target); removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
			return fmt.Errorf("remove partial Working Copy file %q: %w", target, removeErr)
		}
		reason := readErr.reason
		manifest := entry.manifest
		manifest.State, manifest.UnavailableReason = conformance.StateUnavailable, &reason
		manifest.Copied, manifest.Size, manifest.SHA256 = false, nil, nil
		entry.manifest = manifest
	}
	return nil
}

// sourceReader marks read failures as Source failures, so that a copy can tell
// them apart from Working Copy write failures.
type sourceReader struct{ file *os.File }

func (reader sourceReader) Read(buffer []byte) (int, error) {
	n, err := reader.file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		return n, sourceFailure(err)
	}
	return n, err
}

func copyPlannedFile(entry plannedEntry, destination string) error {
	if entry.manifest.Size == nil || entry.manifest.SHA256 == nil {
		return fmt.Errorf("planned file %q lacks canonical size or hash", entry.manifest.SourcePath)
	}
	before, err := os.Lstat(entry.manifest.SourcePath)
	if err != nil {
		return sourceFailure(fmt.Errorf("reopen planned source %q: %w", entry.manifest.SourcePath, err))
	}
	if !before.Mode().IsRegular() || before.Size() != *entry.manifest.Size || !before.ModTime().UTC().Equal(entry.manifest.MTime) {
		return sourceChanged("source changed after inventory %q", entry.manifest.SourcePath)
	}
	input, err := os.Open(entry.manifest.SourcePath)
	if err != nil {
		return sourceFailure(err)
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, entry.mode.Perm()&0o777)
	if err != nil {
		return err
	}
	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(output, hash), sourceReader{input})
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if hex.EncodeToString(hash.Sum(nil)) != *entry.manifest.SHA256 {
		return sourceChanged("source changed while copying %q", entry.manifest.SourcePath)
	}
	after, err := input.Stat()
	if err != nil {
		return sourceFailure(err)
	}
	if after.Size() != *entry.manifest.Size || !after.ModTime().UTC().Equal(entry.manifest.MTime) {
		return sourceChanged("source changed while copying %q", entry.manifest.SourcePath)
	}
	copyDigest, err := hashFile(destination)
	if err != nil {
		return err
	}
	if copyDigest != *entry.manifest.SHA256 {
		return fmt.Errorf("copied file digest mismatch for %q", entry.manifest.SourcePath)
	}
	return nil
}

func nodeType(mode fs.FileMode) (conformance.NodeType, error) {
	if mode.IsRegular() {
		return conformance.NodeFile, nil
	}
	if mode&os.ModeSymlink != 0 {
		return conformance.NodeSymlink, nil
	}
	if mode&os.ModeSocket != 0 {
		return conformance.NodeSocket, nil
	}
	if mode.IsDir() {
		return conformance.NodeDir, nil
	}
	return "", fmt.Errorf("unsupported Node Type with mode %s", mode)
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

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
