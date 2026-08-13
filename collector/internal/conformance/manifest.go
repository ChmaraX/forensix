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
	"sort"
)

// CanonicalLines encodes entries first, then byte-sorts complete JSONL lines.
// This exactly matches LC_ALL=C sort, including escaped path characters.
func CanonicalLines(entries []ManifestEntry) ([]byte, error) {
	lines := make([][]byte, 0, len(entries))
	for _, entry := range entries {
		var line bytes.Buffer
		encoder := json.NewEncoder(&line)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(entry); err != nil {
			return nil, fmt.Errorf("encode manifest entry: %w", err)
		}
		lines = append(lines, append([]byte(nil), line.Bytes()...))
	}
	sort.Slice(lines, func(i, j int) bool { return bytes.Compare(lines[i], lines[j]) < 0 })
	return bytes.Join(lines, nil), nil
}

func Digest(lines []byte) string { sum := sha256.Sum256(lines); return hex.EncodeToString(sum[:]) }

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
