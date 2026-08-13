package collector

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

func bundleFiles(root string) ([]BundleFile, string, error) {
	var files []BundleFile
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		digest, err := hashFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, BundleFile{Path: filepath.ToSlash(rel), Size: info.Size(), SHA256: digest})
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
	return files, conformance.Digest(append(encoded, '\n')), nil
}

func rejectOutputInsideSources(output string, found []platformscanner.UserDataDir) error {
	outputPath, err := prospectiveRealPath(output)
	if err != nil {
		return err
	}
	for _, source := range found {
		for _, root := range []string{source.Path, source.CachePath} {
			if root == "" {
				continue
			}
			realRoot, err := filepath.EvalSymlinks(root)
			if err != nil {
				realRoot, err = filepath.Abs(root)
			}
			if err != nil {
				return err
			}
			inside, err := pathContains(realRoot, outputPath)
			if err != nil {
				return err
			}
			if inside {
				return fmt.Errorf("output %q is inside Source %q", output, root)
			}
		}
	}
	return nil
}

func prospectiveRealPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return absolute, nil
	}
	return filepath.Join(parent, filepath.Base(absolute)), nil
}

func pathContains(root, candidate string) (bool, error) {
	relative, err := filepath.Rel(root, candidate)
	if err != nil {
		return false, err
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))), nil
}
