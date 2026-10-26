package safety_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
)

const modulePrefix = "github.com/ChmaraX/forensix/collector/"

// allowedDependencies lists every non-standard package that the release
// binary can link. A new module dependency fails the test until it is reviewed.
var allowedDependencies = map[string]string{
	"github.com/godbus/dbus/v5":                      "D-Bus over the local unix socket for the Linux key capture only",
	"golang.org/x/sys/unix":                          "sysctl for the macOS version and kill(pid, 0) to test if a staging owner is alive",
	"golang.org/x/sys/windows":                       "DPAPI, the account SID, and the process query for a staging owner on Windows",
	"golang.org/x/sys/windows/registry":              "reads the Windows ProfileList and OS version registry keys",
	"github.com/ebitengine/purego":                   "calls the macOS Security framework for the Keychain key capture without cgo",
	"github.com/ebitengine/purego/internal/fakecgo":  "part of purego: runtime setup for library calls without cgo",
	"github.com/ebitengine/purego/internal/strings":  "part of purego: C string conversion",
	"github.com/ebitengine/purego/internal/xreflect": "part of purego: reflection helpers",
}

// capabilities are the standard packages that open sockets, start processes,
// load code, or make raw system calls.
var capabilities = map[string]bool{"net": true, "os/exec": true, "plugin": true, "syscall": true}

// allowedCapabilityImports lists every import of a capability package by a
// non-standard package, and every import of net, os/exec, or plugin by a
// standard package. The Collector's own packages have no entry.
var allowedCapabilityImports = map[string]string{
	"github.com/godbus/dbus/v5 -> net":                         "D-Bus transports; dialLocalSessionBus refuses every address that is not unix:",
	"github.com/godbus/dbus/v5 -> os/exec":                     "the autolaunch: transport, which dialLocalSessionBus refuses",
	"github.com/godbus/dbus/v5 -> syscall":                     "unix socket credentials for D-Bus authentication",
	"golang.org/x/sys/unix -> syscall":                         "raw system calls; the Collector calls only sysctl and kill(pid, 0)",
	"golang.org/x/sys/windows -> net":                          "Winsock type declarations; the Collector calls no socket API",
	"golang.org/x/sys/windows -> syscall":                      "raw Windows API calls for DPAPI, the token, and the process query",
	"golang.org/x/sys/windows/registry -> syscall":             "registry API calls",
	"github.com/ebitengine/purego/internal/fakecgo -> syscall": "runtime setup for library calls without cgo",
	"crypto/x509 -> net":                                       "IP address types in certificate fields; recipient key parsing opens no socket",
}

// The release binary links only reviewed dependencies on each release target.
// A new module dependency, or a new path to a socket, process, or raw system
// call API, fails this test.
func TestReleaseBinaryLinksOnlyReviewedCapabilities(t *testing.T) {
	_, current, _, _ := runtime.Caller(0)
	moduleRoot := filepath.Clean(filepath.Join(filepath.Dir(current), "..", ".."))
	usedDependencies, usedImports := map[string]bool{}, map[string]bool{}
	for _, target := range []string{"linux/amd64", "linux/arm64", "darwin/amd64", "darwin/arm64", "windows/amd64", "windows/arm64"} {
		goos, goarch, _ := strings.Cut(target, "/")
		list := exec.Command("go", "list", "-deps", "-f", `{{.ImportPath}}{{"\t"}}{{.Standard}}{{"\t"}}{{join .Imports " "}}`, "./cmd/forensix-collect")
		list.Dir = moduleRoot
		list.Env = append(os.Environ(), "GOOS="+goos, "GOARCH="+goarch, "CGO_ENABLED=0")
		output, err := list.Output()
		if err != nil {
			t.Fatalf("go list for %s: %v", target, err)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
			fields := strings.Split(line, "\t")
			if len(fields) != 3 {
				t.Fatalf("unexpected go list line %q", line)
			}
			pkg, standard := fields[0], fields[1] == "true"
			if !standard && !strings.HasPrefix(pkg, modulePrefix) {
				if _, ok := allowedDependencies[pkg]; !ok {
					t.Errorf("%s: unreviewed dependency %s", target, pkg)
				}
				usedDependencies[pkg] = true
			}
			for _, imported := range strings.Fields(fields[2]) {
				if !capabilities[imported] || (standard && imported == "syscall") {
					continue
				}
				edge := pkg + " -> " + imported
				if _, ok := allowedCapabilityImports[edge]; !ok {
					t.Errorf("%s: unreviewed capability import %s", target, edge)
				}
				usedImports[edge] = true
			}
		}
	}
	for _, unused := range append(unusedKeys(allowedDependencies, usedDependencies), unusedKeys(allowedCapabilityImports, usedImports)...) {
		t.Errorf("allowlist entry %q matches no release target; remove it", unused)
	}
}

func unusedKeys(allowed map[string]string, used map[string]bool) []string {
	var unused []string
	for key := range allowed {
		if !used[key] {
			unused = append(unused, key)
		}
	}
	sort.Strings(unused)
	return unused
}
