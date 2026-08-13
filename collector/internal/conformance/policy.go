package conformance

import (
	"path"
	"sort"
	"strings"
)

var browserArtifacts = map[string]FileKind{
	"Local State":  KindBrowserState,
	"Last Version": KindBrowserState,
	"First Run":    KindBrowserState,
}

var profileArtifacts = map[string]FileKind{
	"History":                    KindDatabase,
	"Favicons":                   KindDatabase,
	"Top Sites":                  KindDatabase,
	"Cookies":                    KindDatabase,
	"Login Data":                 KindDatabase,
	"Login Data For Account":     KindDatabase,
	"Web Data":                   KindDatabase,
	"Account Web Data":           KindDatabase,
	"Affiliation Database":       KindDatabase,
	"Preferences":                KindBrowserState,
	"Secure Preferences":         KindBrowserState,
	"Bookmarks":                  KindBrowserState,
	"Bookmarks.bak":              KindBrowserState,
	"Google Profile Picture.png": KindBrowserState,
	"Network Persistent State":   KindBrowserState,
}

var tier2Parts = map[string]bool{
	"external_cache": true, "Cache": true, "Code Cache": true, "GPUCache": true,
	"Service Worker": true, "Storage": true, "Extensions": true, "Sessions": true,
}

var tier3Parts = map[string]bool{
	"optimization_guide_model_store": true, "component_crx_cache": true,
	"WasmTtsEngine": true, "DeferredBrowserMetrics": true, "GraphiteDawnCache": true,
	"OnDeviceHeadSuggestModel": true, "DIPS": true, "Shortcuts": true,
	"Network Action Predictor": true,
}

// Classify applies path rules in precedence order. Bulk and ballast ancestors
// win before artifact names, so a file named History under Cache or Extensions
// cannot become Tier 1 accidentally.
func Classify(relative string, node NodeType, includeBulk bool) (Selection, FileKind, bool) {
	clean := path.Clean(strings.ReplaceAll(relative, "\\", "/"))
	parts := strings.Split(clean, "/")
	for _, part := range parts {
		policyPart := stripSidecarSuffix(part)
		if tier2Parts[policyPart] {
			return Tier2, KindBulkArtifact, includeBulk && node == NodeFile
		}
		if tier3Parts[policyPart] || strings.HasPrefix(policyPart, "BrowserMetrics") {
			return Tier3, KindBallast, false
		}
	}

	base := path.Base(clean)
	if isLivenessName(base) {
		return Tier1, KindLivenessEvidence, node == NodeFile
	}
	if len(parts) == 1 {
		if kind, ok := browserArtifacts[base]; ok {
			return Tier1, kind, node == NodeFile
		}
	}
	if isProfileArtifactPath(parts, base) {
		name := stripSidecarSuffix(base)
		kind := profileArtifacts[name]
		if name != base {
			kind = KindSidecar
		}
		return Tier1, kind, node == NodeFile
	}
	return Unclassified, KindUnclassified, false
}

func IsProfileName(name string) bool {
	return name == "Default" || name == "Guest Profile" || name == "System Profile" || strings.HasPrefix(name, "Profile ")
}

func MissingExpectedPaths(entries []ManifestEntry) []string {
	profiles := map[string]bool{"Default": true}
	browserPresent := map[string]bool{}
	profilePresent := map[string]map[string]bool{}
	for _, entry := range entries {
		parts := strings.Split(entry.Path, "/")
		if len(parts) == 1 {
			browserPresent[parts[0]] = true
		}
		if len(parts) > 1 && IsProfileName(parts[0]) {
			profile := parts[0]
			profiles[profile] = true
			if profilePresent[profile] == nil {
				profilePresent[profile] = map[string]bool{}
			}
			if isProfileArtifactPath(parts, path.Base(entry.Path)) {
				profilePresent[profile][stripSidecarSuffix(path.Base(entry.Path))] = true
			}
		}
	}
	var missing []string
	for name := range browserArtifacts {
		if !browserPresent[name] {
			missing = append(missing, name)
		}
	}
	for profile := range profiles {
		for name := range profileArtifacts {
			if !profilePresent[profile][name] {
				missing = append(missing, profile+"/"+name)
			}
		}
	}
	sort.Strings(missing)
	return missing
}

func isProfileArtifactPath(parts []string, base string) bool {
	if len(parts) < 2 || !IsProfileName(parts[0]) {
		return false
	}
	name := stripSidecarSuffix(base)
	if _, ok := profileArtifacts[name]; !ok {
		return false
	}
	if len(parts) == 2 {
		return true
	}
	return len(parts) == 3 && parts[1] == "Network" && name == "Cookies"
}

func isLivenessName(name string) bool {
	return name == "SingletonLock" || name == "SingletonSocket" || name == "RunningChromeVersion"
}

func stripSidecarSuffix(name string) string {
	return strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(name, "-journal"), "-shm"), "-wal")
}
