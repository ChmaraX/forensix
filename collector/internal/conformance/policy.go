package conformance

import (
	"path"
	"strings"
)

var tier1Names = map[string]FileKind{
	"History": KindDatabase, "Favicons": KindDatabase, "Top Sites": KindDatabase,
	"Cookies": KindDatabase, "Login Data": KindDatabase, "Login Data For Account": KindDatabase,
	"Web Data": KindDatabase, "Account Web Data": KindDatabase, "Affiliation Database": KindDatabase,
	"Preferences": KindBrowserState, "Secure Preferences": KindBrowserState,
	"Bookmarks": KindBrowserState, "Bookmarks.bak": KindBrowserState,
	"Google Profile Picture.png": KindBrowserState, "Network Persistent State": KindBrowserState,
	"Local State": KindBrowserState, "Last Version": KindBrowserState, "First Run": KindBrowserState,
}

var tier2Parts = map[string]bool{
	"Cache": true, "Code Cache": true, "GPUCache": true, "Service Worker": true,
	"Storage": true, "Extensions": true, "Sessions": true,
}

var tier3Parts = map[string]bool{
	"optimization_guide_model_store": true, "component_crx_cache": true,
	"WasmTtsEngine": true, "DeferredBrowserMetrics": true, "GraphiteDawnCache": true,
	"OnDeviceHeadSuggestModel": true, "DIPS": true, "Shortcuts": true,
	"Network Action Predictor": true,
}

func Classify(relative string, node NodeType, includeBulk bool) (Selection, FileKind, bool) {
	clean := path.Clean(strings.ReplaceAll(relative, "\\", "/"))
	base := path.Base(clean)
	if base == "SingletonLock" || base == "SingletonSocket" || base == "RunningChromeVersion" {
		return Tier1, KindLivenessEvidence, node == NodeFile
	}
	if kind, ok := tier1Names[base]; ok {
		return Tier1, kind, node == NodeFile
	}
	for name := range tier1Names {
		if base == name+"-wal" || base == name+"-shm" || base == name+"-journal" {
			return Tier1, KindSidecar, node == NodeFile
		}
	}
	for _, part := range strings.Split(clean, "/") {
		policyPart := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(part, "-journal"), "-shm"), "-wal")
		if tier2Parts[policyPart] {
			return Tier2, KindBulkArtifact, includeBulk && node == NodeFile
		}
		if tier3Parts[policyPart] || strings.HasPrefix(policyPart, "BrowserMetrics") {
			return Tier3, KindBallast, false
		}
	}
	return Unclassified, KindUnclassified, false
}

func Tier1Names() []string {
	out := make([]string, 0, len(tier1Names))
	for name := range tier1Names {
		out = append(out, name)
	}
	return out
}
