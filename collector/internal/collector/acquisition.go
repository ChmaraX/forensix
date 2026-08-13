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

func planAcquisition(found platformscanner.UserDataDir, includeTier2 bool) (acquisitionPlan, error) {
	plan := acquisitionPlan{}
	if err := plan.walk(found.Path, includeTier2); err != nil {
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

func (plan *acquisitionPlan) walk(root string, includeTier2 bool) error {
	return filepath.WalkDir(root, func(source string, dirEntry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("inventory %q: %w", source, walkErr)
		}
		relative, err := filepath.Rel(root, source)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		manifestPath := filepath.ToSlash(relative)
		if strings.Contains(manifestPath, `\`) {
			return fmt.Errorf("Source path cannot be represented by the Manifest contract: %q", manifestPath)
		}
		info, err := os.Lstat(source)
		if err != nil {
			return fmt.Errorf("lstat %q: %w", source, err)
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
				return hashErr
			}
			entry.SHA256 = &digest
		case conformance.NodeSymlink:
			target, readErr := os.Readlink(source)
			if readErr != nil {
				return readErr
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
		plan.entries = append(plan.entries, plannedEntry{manifest: entry, mode: info.Mode()})
		return nil
	})
}

func (plan *acquisitionPlan) addExpectedAbsent() {
	manifestEntries := plan.manifestEntries()
	for _, missingPath := range conformance.MissingExpectedPaths(manifestEntries) {
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
	if entry.manifest.Size == nil || entry.manifest.SHA256 == nil {
		return fmt.Errorf("planned file %q lacks canonical size or hash", entry.manifest.SourcePath)
	}
	before, err := os.Stat(entry.manifest.SourcePath)
	if err != nil {
		return fmt.Errorf("reopen planned source %q: %w", entry.manifest.SourcePath, err)
	}
	if before.Size() != *entry.manifest.Size || !before.ModTime().UTC().Equal(entry.manifest.MTime) {
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
	if hex.EncodeToString(hash.Sum(nil)) != *entry.manifest.SHA256 {
		return fmt.Errorf("source changed while copying %q", entry.manifest.SourcePath)
	}
	after, err := input.Stat()
	if err != nil {
		return err
	}
	if after.Size() != *entry.manifest.Size || !after.ModTime().UTC().Equal(entry.manifest.MTime) {
		return fmt.Errorf("source changed while copying %q", entry.manifest.SourcePath)
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
