package conformance

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
)

var (
	decimalPattern = regexp.MustCompile(`^-?[0-9]+$`)
	digestPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// CanonicalLines encodes entries, validates unique paths, and byte-sorts the
// complete JSONL lines. This matches the Analyzer contract and LC_ALL=C sort.
func CanonicalLines(entries []ManifestEntry) ([]byte, error) {
	lines := make([][]byte, 0, len(entries))
	paths := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if paths[entry.Path] {
			return nil, fmt.Errorf("duplicate Manifest path %q", entry.Path)
		}
		paths[entry.Path] = true
		if err := ValidateEntry(entry); err != nil {
			return nil, fmt.Errorf("Manifest entry %q: %w", entry.Path, err)
		}
		var line bytes.Buffer
		encoder := json.NewEncoder(&line)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(entry); err != nil {
			return nil, fmt.Errorf("encode Manifest entry: %w", err)
		}
		// encoding/json always escapes these two valid Unicode characters;
		// JSON.stringify does not, and the contract permits only required JSON
		// escapes. Replace them to keep both implementations byte-identical.
		encoded := bytes.ReplaceAll(line.Bytes(), []byte(`\u2028`), []byte("\u2028"))
		encoded = bytes.ReplaceAll(encoded, []byte(`\u2029`), []byte("\u2029"))
		lines = append(lines, append([]byte(nil), encoded...))
	}
	sort.Slice(lines, func(i, j int) bool { return bytes.Compare(lines[i], lines[j]) < 0 })
	return bytes.Join(lines, nil), nil
}

func ValidateEntry(entry ManifestEntry) error {
	if entry.Path == "" || strings.HasPrefix(entry.Path, "/") || strings.Contains(entry.Path, `\`) || path.Clean(entry.Path) != entry.Path {
		return fmt.Errorf("path is not canonical")
	}
	for _, part := range strings.Split(entry.Path, "/") {
		if part == "" || part == "." || part == ".." {
			return fmt.Errorf("path is not canonical")
		}
	}
	if entry.HashAlgorithm != HashAlgorithm {
		return fmt.Errorf("unsupported hash algorithm %q", entry.HashAlgorithm)
	}
	if entry.Size != nil && *entry.Size < 0 {
		return fmt.Errorf("size is negative")
	}
	if entry.MTimeNS != nil && !decimalPattern.MatchString(*entry.MTimeNS) {
		return fmt.Errorf("mtime_ns is not a decimal nanosecond string")
	}
	if entry.SHA256 != nil && !digestPattern.MatchString(*entry.SHA256) {
		return fmt.Errorf("sha256 is not lowercase SHA-256")
	}
	if !validState(entry.State) || !validNodeType(entry.NodeType) || !validFileKind(entry.FileKind) || !validTier(entry.SelectionTier) {
		return fmt.Errorf("unsupported contract value")
	}

	if entry.State == StateUnavailable {
		if entry.UnavailableReason == nil || !validUnavailableReason(*entry.UnavailableReason) || entry.SHA256 != nil || entry.Copied {
			return fmt.Errorf("unavailable entry has an invalid reason, hash, or copy state")
		}
	} else if entry.UnavailableReason != nil || entry.SHA256 == nil {
		return fmt.Errorf("available or absent entry needs a hash and no unavailable reason")
	}
	if (entry.State == StateAbsent) != (entry.NodeType == NodeAbsent) {
		return fmt.Errorf("only an absent entry can have absent Node Type")
	}
	if entry.State == StateAbsent {
		if entry.Size != nil || entry.MTimeNS != nil || stringValue(entry.SHA256) != representationDigest(NodeAbsent, nil) {
			return fmt.Errorf("absent entry has an invalid representation")
		}
	} else if entry.State == StateValue && entry.MTimeNS == nil {
		return fmt.Errorf("available node needs an mtime")
	}
	if entry.State == StateValue && entry.NodeType == NodeFile && entry.Size == nil {
		return fmt.Errorf("available file needs a size")
	}
	if entry.State == StateValue && (entry.NodeType == NodeDir || entry.NodeType == NodeSocket) {
		if entry.Size != nil || stringValue(entry.SHA256) != representationDigest(entry.NodeType, nil) {
			return fmt.Errorf("directory or socket has an invalid representation")
		}
	}
	if entry.State == StateValue && entry.NodeType == NodeSymlink {
		if entry.LinkTarget == nil || entry.Size == nil || *entry.Size != int64(len([]byte(*entry.LinkTarget))) || stringValue(entry.SHA256) != representationDigest(NodeSymlink, entry.LinkTarget) {
			return fmt.Errorf("symlink has an invalid representation")
		}
	} else if entry.LinkTarget != nil {
		return fmt.Errorf("only a symlink can contain target text")
	}
	if entry.Copied && (entry.State != StateValue || entry.NodeType != NodeFile || (entry.SelectionTier != Tier1 && entry.SelectionTier != Tier2)) {
		return fmt.Errorf("only an available Tier 1 or Tier 2 file can be copied")
	}
	wantUnclassified := entry.SelectionTier == Unclassified && (entry.FileKind == KindUnclassified || entry.FileKind == KindDirectory)
	if entry.Unclassified != wantUnclassified {
		return fmt.Errorf("unclassified fields disagree")
	}
	return nil
}

func Digest(lines []byte) string {
	sum := sha256.Sum256(lines)
	return hex.EncodeToString(sum[:])
}

func WorkingCopyLines(entries []ManifestEntry) ([]byte, error) {
	copied := make([]ManifestEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Copied {
			copied = append(copied, entry)
		}
	}
	return CanonicalLines(copied)
}

func WriteJSON(path string, value any) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func WriteFile(path string, content []byte) error { return os.WriteFile(path, content, 0o600) }

func VerifySortedDigest(reader io.Reader) (string, error) {
	scanner := bufio.NewScanner(reader)
	var lines [][]byte
	for scanner.Scan() {
		lines = append(lines, append([]byte(nil), scanner.Bytes()...))
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	sort.Slice(lines, func(i, j int) bool { return bytes.Compare(lines[i], lines[j]) < 0 })
	var canonical bytes.Buffer
	for _, line := range lines {
		canonical.Write(line)
		canonical.WriteByte('\n')
	}
	return Digest(canonical.Bytes()), nil
}

func representationDigest(node NodeType, linkTarget *string) string {
	value := string(node)
	if node == NodeSymlink && linkTarget != nil {
		value = *linkTarget
	}
	return Digest([]byte(value))
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func validState(value ManifestState) bool {
	return value == StateValue || value == StateAbsent || value == StateUnavailable
}

func validUnavailableReason(value UnavailableReason) bool {
	return value == PermissionDenied || value == IOError || value == ChangedDuringIngest || value == ParentUnavailable
}

func validNodeType(value NodeType) bool {
	return value == NodeFile || value == NodeSymlink || value == NodeSocket || value == NodeDir || value == NodeAbsent
}

func validFileKind(value FileKind) bool {
	switch value {
	case KindDatabase, KindSidecar, KindJSON, KindImage, KindMetadata, KindLivenessEvidence, KindBulkData, KindBallast, KindDirectory, KindUnclassified:
		return true
	default:
		return false
	}
}

func validTier(value SelectionTier) bool {
	return value == Tier1 || value == Tier2 || value == Tier3 || value == Unclassified
}
