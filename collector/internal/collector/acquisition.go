package collector

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

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

func planAcquisition(found platformscanner.UserDataDir, includeBulk bool) (acquisitionPlan, error) {
	plan := acquisitionPlan{}
	if err := plan.walk(found.Path, "", includeBulk); err != nil {
		return plan, err
	}
	if found.CachePath != "" {
		info, err := os.Stat(found.CachePath)
		if err == nil && info.IsDir() {
			if err := plan.walk(found.CachePath, "external_cache", includeBulk); err != nil {
				return plan, err
			}
		} else if err != nil && !os.IsNotExist(err) {
			return plan, fmt.Errorf("inventory external cache %q: %w", found.CachePath, err)
		}
	}
	plan.addExpectedAbsent()
	sort.Strings(plan.liveness)
	plan.running = indicatesRunningChrome(plan.liveness)
	return plan, nil
}

func (plan *acquisitionPlan) walk(root, prefix string, includeBulk bool) error {
	return filepath.WalkDir(root, func(source string, dirEntry fs.DirEntry, walkErr error) error {
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
			entry.SHA256, err = hashFile(source)
		case conformance.NodeSymlink:
			var target string
			target, err = os.Readlink(source)
			if err == nil {
				entry.Size, entry.SHA256 = int64(len([]byte(target))), hashString(target)
			}
		default:
			entry.SHA256 = hashString(string(node))
		}
		if err != nil {
			return err
		}
		if kind == conformance.KindLivenessEvidence {
			plan.liveness = append(plan.liveness, manifestPath)
		}
		plan.entries = append(plan.entries, plannedEntry{manifest: entry, mode: info.Mode()})
		return nil
	})
}

func (plan *acquisitionPlan) addExpectedAbsent() {
	manifestEntries := make([]conformance.ManifestEntry, 0, len(plan.entries))
	for _, entry := range plan.entries {
		manifestEntries = append(manifestEntries, entry.manifest)
	}
	for _, path := range conformance.MissingExpectedPaths(manifestEntries) {
		selection, kind, _ := conformance.Classify(path, conformance.NodeAbsent, false)
		entry := conformance.ManifestEntry{Path: path, HashAlgorithm: conformance.HashAlgorithm, SHA256: hashString("absent"), NodeType: conformance.NodeAbsent, FileKind: kind, Selection: selection}
		plan.entries = append(plan.entries, plannedEntry{manifest: entry})
	}
}

func (plan acquisitionPlan) manifestEntries() []conformance.ManifestEntry {
	entries := make([]conformance.ManifestEntry, len(plan.entries))
	for index := range plan.entries {
		entries[index] = plan.entries[index].manifest
	}
	return entries
}

func (plan acquisitionPlan) materialize(destination string) error {
	for _, entry := range plan.entries {
		if !entry.manifest.Copied {
			continue
		}
		target := filepath.Join(destination, "working_copy", filepath.FromSlash(entry.manifest.Path))
		if err := copyPlannedFile(entry, target); err != nil {
			return err
		}
	}
	return nil
}

func copyPlannedFile(entry plannedEntry, destination string) error {
	before, err := os.Stat(entry.manifest.SourcePath)
	if err != nil {
		return fmt.Errorf("reopen planned source %q: %w", entry.manifest.SourcePath, err)
	}
	if before.Size() != entry.manifest.Size || !before.ModTime().UTC().Equal(entry.manifest.MTime) {
		return fmt.Errorf("source changed after inventory %q", entry.manifest.SourcePath)
	}
	input, err := os.Open(entry.manifest.SourcePath)
	if err != nil {
		return err
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
	_, copyErr := io.Copy(io.MultiWriter(output, hash), input)
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
	if hex.EncodeToString(hash.Sum(nil)) != entry.manifest.SHA256 {
		return fmt.Errorf("source changed while copying %q", entry.manifest.SourcePath)
	}
	after, err := input.Stat()
	if err != nil {
		return err
	}
	if after.Size() != entry.manifest.Size || !after.ModTime().UTC().Equal(entry.manifest.MTime) {
		return fmt.Errorf("source changed while copying %q", entry.manifest.SourcePath)
	}
	copyDigest, err := hashFile(destination)
	if err != nil {
		return err
	}
	if copyDigest != entry.manifest.SHA256 {
		return fmt.Errorf("copied file digest mismatch for %q", entry.manifest.SourcePath)
	}
	return nil
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
