package collector

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
)

func StripKeys(input, output string) (BundleManifest, error) {
	if input == "" || output == "" {
		return BundleManifest{}, errors.New("input Acquisition Bundle and output are required")
	}
	inputPath, err := filepath.EvalSymlinks(input)
	if err != nil {
		return BundleManifest{}, fmt.Errorf("open input Acquisition Bundle: %w", err)
	}
	inputPath, err = filepath.Abs(inputPath)
	if err != nil {
		return BundleManifest{}, err
	}
	outputPath, err := prospectiveRealPath(output)
	if err != nil {
		return BundleManifest{}, err
	}
	if inside, err := pathContains(inputPath, outputPath); err != nil {
		return BundleManifest{}, err
	} else if inside {
		return BundleManifest{}, errors.New("stripped Acquisition Bundle output must be outside the input bundle")
	}

	manifest, err := readBundleManifest(filepath.Join(inputPath, "bundle_manifest.json"))
	if err != nil {
		return BundleManifest{}, err
	}
	if err := verifyBundleManifest(inputPath, manifest); err != nil {
		return BundleManifest{}, fmt.Errorf("refuse to strip divergent Acquisition Bundle: %w", err)
	}
	if !manifest.KeyMaterialCaptured || manifest.KeyMaterialStripped {
		return BundleManifest{}, errors.New("Acquisition Bundle has no captured key material to strip")
	}
	hasKeyFile := false
	for _, file := range manifest.Files {
		if strings.HasPrefix(file.Path, "key_material/") {
			hasKeyFile = true
			break
		}
	}
	if !hasKeyFile {
		return BundleManifest{}, errors.New("Acquisition Bundle claims captured key material but has no key-material subtree")
	}

	if err := prepareOutput(output); err != nil {
		return BundleManifest{}, err
	}
	tmp := output + ".partial"
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(tmp)
		}
	}()
	for _, file := range manifest.Files {
		if strings.HasPrefix(file.Path, "key_material/") {
			continue
		}
		if err := copyVerifiedBundleFile(inputPath, tmp, file); err != nil {
			return BundleManifest{}, err
		}
	}

	originalDigest := manifest.BundleDigest
	manifest.SchemaVersion = "forensix-acquisition-bundle-draft/2"
	manifest.KeyMaterialCaptured = false
	manifest.KeyMaterialStripped = true
	manifest.OriginalBundleDigest = originalDigest
	manifest.KeyMaterial = []BundleKeyMaterial{}
	manifest.Files, manifest.BundleDigest, err = bundleFiles(tmp)
	if err != nil {
		return BundleManifest{}, err
	}
	if err := conformance.WriteJSON(filepath.Join(tmp, "bundle_manifest.json"), manifest); err != nil {
		return BundleManifest{}, err
	}
	if err := os.Rename(tmp, output); err != nil {
		return BundleManifest{}, fmt.Errorf("publish stripped Acquisition Bundle: %w", err)
	}
	committed = true
	return manifest, nil
}

func readBundleManifest(filePath string) (BundleManifest, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return BundleManifest{}, fmt.Errorf("open bundle Manifest: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var manifest BundleManifest
	if err := decoder.Decode(&manifest); err != nil {
		return BundleManifest{}, fmt.Errorf("decode bundle Manifest: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return BundleManifest{}, errors.New("bundle Manifest has trailing data")
	}
	return manifest, nil
}

func verifyBundleManifest(root string, manifest BundleManifest) error {
	if manifest.HashAlgorithm != conformance.HashAlgorithm {
		return fmt.Errorf("unsupported bundle hash algorithm %q", manifest.HashAlgorithm)
	}
	expected := make(map[string]BundleFile, len(manifest.Files))
	for index, file := range manifest.Files {
		if !canonicalKeyMaterialPath(file.Path) || file.Path == "bundle_manifest.json" || file.Size < 0 || len(file.SHA256) != 64 {
			return fmt.Errorf("invalid bundle Manifest entry %q", file.Path)
		}
		if index > 0 && manifest.Files[index-1].Path >= file.Path {
			return errors.New("bundle Manifest entries are not uniquely path-sorted")
		}
		if _, duplicate := expected[file.Path]; duplicate {
			return fmt.Errorf("duplicate bundle Manifest path %q", file.Path)
		}
		expected[file.Path] = file
		filePath := filepath.Join(root, filepath.FromSlash(file.Path))
		info, err := os.Lstat(filePath)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("bundle file missing or not regular: %s", file.Path)
		}
		if info.Size() != file.Size {
			return fmt.Errorf("bundle file size mismatch: %s", file.Path)
		}
		digest, err := hashFile(filePath)
		if err != nil {
			return err
		}
		if digest != file.SHA256 {
			return fmt.Errorf("bundle file digest mismatch: %s", file.Path)
		}
	}
	actual := make([]string, 0, len(expected))
	err := filepath.WalkDir(root, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, filePath)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "bundle_manifest.json" {
			if !entry.Type().IsRegular() {
				return errors.New("bundle Manifest is not a regular file")
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported bundle node %q", rel)
		}
		actual = append(actual, rel)
		return nil
	})
	if err != nil {
		return err
	}
	sort.Strings(actual)
	if len(actual) != len(expected) {
		return errors.New("bundle Manifest is not exhaustive over bundle files")
	}
	for _, filePath := range actual {
		if _, ok := expected[filePath]; !ok {
			return fmt.Errorf("bundle file missing from Manifest: %s", filePath)
		}
	}
	digest, err := bundleFileDigest(manifest.Files)
	if err != nil {
		return err
	}
	if digest != manifest.BundleDigest {
		return errors.New("bundle digest mismatch")
	}
	return nil
}

func copyVerifiedBundleFile(sourceRoot, destinationRoot string, expected BundleFile) error {
	sourcePath := filepath.Join(sourceRoot, filepath.FromSlash(expected.Path))
	destinationPath := filepath.Join(destinationRoot, filepath.FromSlash(expected.Path))
	input, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(destinationPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(output, hash), input)
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
	if written != expected.Size || hex.EncodeToString(hash.Sum(nil)) != expected.SHA256 {
		return fmt.Errorf("bundle file changed while stripping: %s", expected.Path)
	}
	return nil
}
