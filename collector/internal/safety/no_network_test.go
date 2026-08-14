package safety_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestProductionCodeHasNoNetworkProcessControlOrLoggingImports(t *testing.T) {
	_, current, _, _ := runtime.Caller(0)
	moduleRoot := filepath.Clean(filepath.Join(filepath.Dir(current), "..", ".."))
	// The Windows DPAPI adapter needs unsafe only to copy and immediately zero
	// the OS-owned DATA_BLOB. Network, process-control, and logging packages remain banned.
	forbidden := []string{"net", "net/", "os/exec", "syscall", "log", "log/"}
	err := filepath.WalkDir(moduleRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imported := range file.Imports {
			name, err := strconv.Unquote(imported.Path.Value)
			if err != nil {
				return err
			}
			for _, prefix := range forbidden {
				if name == prefix || strings.HasPrefix(name, prefix) {
					t.Errorf("%s imports forbidden package %q", path, name)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
