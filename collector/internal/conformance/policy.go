package conformance

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"strings"
)

type policyArtifact struct {
	Path     string   `json:"path"`
	FileKind FileKind `json:"file_kind"`
	Expected bool     `json:"expected"`
}

type profileDirectories struct {
	Exact           []string `json:"exact"`
	NumberedPrefix  string   `json:"numbered_prefix"`
	NumberedMinimum int      `json:"numbered_minimum"`
}

type selectionPolicyContract struct {
	Schema                string             `json:"schema"`
	Name                  string             `json:"name"`
	ProfileDirectories    profileDirectories `json:"profile_directories"`
	SQLiteSidecarSuffixes []string           `json:"sqlite_sidecar_suffixes"`
	BrowserTier1          []policyArtifact   `json:"browser_tier_1"`
	ProfileTier1          []policyArtifact   `json:"profile_tier_1"`
	ProfileTier2Roots     []string           `json:"profile_tier_2_roots"`
	BrowserTier3Roots     []string           `json:"browser_tier_3_roots"`
	BrowserTier3Globs     []string           `json:"browser_tier_3_globs"`
	ProfileTier3Roots     []string           `json:"profile_tier_3_roots"`
}

var canonicalPolicy = selectionPolicyContract{
	Schema: "forensix/selection-policy/1",
	Name:   SelectionPolicy,
	ProfileDirectories: profileDirectories{
		Exact:           []string{"Default", "Guest Profile", "System Profile"},
		NumberedPrefix:  "Profile ",
		NumberedMinimum: 1,
	},
	SQLiteSidecarSuffixes: []string{"-wal", "-shm", "-journal"},
	BrowserTier1: []policyArtifact{
		{Path: "Local State", FileKind: KindJSON, Expected: true},
		{Path: "Last Version", FileKind: KindMetadata, Expected: true},
		{Path: "First Run", FileKind: KindMetadata, Expected: true},
		{Path: "SingletonLock", FileKind: KindLivenessEvidence},
		{Path: "SingletonSocket", FileKind: KindLivenessEvidence},
		{Path: "RunningChromeVersion", FileKind: KindLivenessEvidence},
	},
	ProfileTier1: []policyArtifact{
		{Path: "History", FileKind: KindDatabase, Expected: true},
		{Path: "Favicons", FileKind: KindDatabase, Expected: true},
		{Path: "Top Sites", FileKind: KindDatabase, Expected: true},
		{Path: "Network/Cookies", FileKind: KindDatabase, Expected: true},
		{Path: "Cookies", FileKind: KindDatabase},
		{Path: "Login Data", FileKind: KindDatabase, Expected: true},
		{Path: "Login Data For Account", FileKind: KindDatabase, Expected: true},
		{Path: "Web Data", FileKind: KindDatabase, Expected: true},
		{Path: "Account Web Data", FileKind: KindDatabase, Expected: true},
		{Path: "Affiliation Database", FileKind: KindDatabase, Expected: true},
		{Path: "Preferences", FileKind: KindJSON, Expected: true},
		{Path: "Secure Preferences", FileKind: KindJSON, Expected: true},
		{Path: "Bookmarks", FileKind: KindJSON, Expected: true},
		{Path: "Bookmarks.bak", FileKind: KindJSON, Expected: true},
		{Path: "Google Profile Picture.png", FileKind: KindImage, Expected: true},
		{Path: "Network/Network Persistent State", FileKind: KindJSON, Expected: true},
		{Path: "Network Persistent State", FileKind: KindJSON},
	},
	ProfileTier2Roots: []string{"Cache", "Code Cache", "GPUCache", "Service Worker", "Storage", "Extensions", "Sessions"},
	BrowserTier3Roots: []string{"optimization_guide_model_store", "component_crx_cache", "WasmTtsEngine", "DeferredBrowserMetrics", "GraphiteDawnCache", "OnDeviceHeadSuggestModel"},
	BrowserTier3Globs: []string{"BrowserMetrics*.pma"},
	ProfileTier3Roots: []string{"DIPS", "Shortcuts", "Network Action Predictor"},
}

// DecodeSelectionPolicy rejects unknown fields so contract growth cannot be
// accepted silently by the Collector.
func DecodeSelectionPolicy(content []byte) (selectionPolicyContract, error) {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	var policy selectionPolicyContract
	if err := decoder.Decode(&policy); err != nil {
		return selectionPolicyContract{}, fmt.Errorf("decode Selection Policy: %w", err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return selectionPolicyContract{}, err
	}
	if policy.Schema != "forensix/selection-policy/1" || policy.Name != SelectionPolicy {
		return selectionPolicyContract{}, fmt.Errorf("unsupported Selection Policy %q (%q)", policy.Name, policy.Schema)
	}
	if policy.ProfileDirectories.NumberedMinimum < 1 || policy.ProfileDirectories.NumberedPrefix == "" {
		return selectionPolicyContract{}, fmt.Errorf("invalid numbered Profile rule")
	}
	validKinds := map[FileKind]bool{KindDatabase: true, KindJSON: true, KindImage: true, KindMetadata: true, KindLivenessEvidence: true}
	for _, group := range [][]policyArtifact{policy.BrowserTier1, policy.ProfileTier1} {
		for _, artifact := range group {
			if artifact.Path == "" || !validKinds[artifact.FileKind] {
				return selectionPolicyContract{}, fmt.Errorf("unsupported Selection Policy artifact %q (%q)", artifact.Path, artifact.FileKind)
			}
		}
	}
	return policy, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected JSON value after contract")
		}
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return nil
}

func Classify(relative string, node NodeType, includeTier2 bool) (SelectionTier, FileKind, bool) {
	if artifact, ok := exactArtifact(relative, canonicalPolicy.BrowserTier1); ok {
		return selected(Tier1, artifact.FileKind, node, includeTier2)
	}
	if withinAny(relative, canonicalPolicy.BrowserTier3Roots) || matchesAnyGlob(relative, canonicalPolicy.BrowserTier3Globs) {
		return selected(Tier3, KindBallast, node, includeTier2)
	}

	parts := strings.Split(relative, "/")
	if len(parts) == 0 || !IsProfileName(parts[0]) {
		return unclassified(node)
	}
	if len(parts) == 1 {
		return selected(Tier1, KindDirectory, node, includeTier2)
	}

	profilePath := strings.Join(parts[1:], "/")
	if artifact, ok := exactArtifact(profilePath, canonicalPolicy.ProfileTier1); ok {
		return selected(Tier1, artifact.FileKind, node, includeTier2)
	}
	if _, ok := sidecarArtifact(profilePath); ok {
		return selected(Tier1, KindSidecar, node, includeTier2)
	}
	for _, artifact := range canonicalPolicy.ProfileTier1 {
		if strings.HasPrefix(artifact.Path, profilePath+"/") {
			return selected(Tier1, KindDirectory, node, includeTier2)
		}
	}
	if withinAny(profilePath, canonicalPolicy.ProfileTier2Roots) {
		return selected(Tier2, KindBulkData, node, includeTier2)
	}
	if withinAny(profilePath, canonicalPolicy.ProfileTier3Roots) {
		return selected(Tier3, KindBallast, node, includeTier2)
	}
	return unclassified(node)
}

func IsProfileName(name string) bool {
	for _, exact := range canonicalPolicy.ProfileDirectories.Exact {
		if name == exact {
			return true
		}
	}
	if !strings.HasPrefix(name, canonicalPolicy.ProfileDirectories.NumberedPrefix) {
		return false
	}
	suffix := strings.TrimPrefix(name, canonicalPolicy.ProfileDirectories.NumberedPrefix)
	if suffix == "" || (len(suffix) > 1 && suffix[0] == '0') {
		return false
	}
	number, ok := new(big.Int).SetString(suffix, 10)
	minimum := big.NewInt(int64(canonicalPolicy.ProfileDirectories.NumberedMinimum))
	return ok && number.Cmp(minimum) >= 0
}

func MissingExpectedPaths(entries []ManifestEntry) []string {
	present := make(map[string]bool, len(entries))
	var profiles []string
	for _, entry := range entries {
		present[entry.Path] = true
		if !strings.Contains(entry.Path, "/") && IsProfileName(entry.Path) && entry.NodeType == NodeDir && entry.State == StateValue {
			profiles = append(profiles, entry.Path)
		}
	}

	var expected []string
	for _, artifact := range canonicalPolicy.BrowserTier1 {
		if artifact.Expected {
			expected = append(expected, artifact.Path)
		}
	}
	for _, profile := range profiles {
		for _, artifact := range canonicalPolicy.ProfileTier1 {
			if !artifact.Expected {
				continue
			}
			base := profile + "/" + artifact.Path
			expected = append(expected, base)
			if artifact.FileKind == KindDatabase {
				for _, suffix := range canonicalPolicy.SQLiteSidecarSuffixes {
					expected = append(expected, base+suffix)
				}
			}
		}
	}

	missing := make([]string, 0, len(expected))
	for _, candidate := range expected {
		if !present[candidate] {
			missing = append(missing, candidate)
		}
	}
	return missing
}

func selected(tier SelectionTier, kind FileKind, node NodeType, includeTier2 bool) (SelectionTier, FileKind, bool) {
	if node == NodeDir {
		kind = KindDirectory
	}
	copied := node == NodeFile && (tier == Tier1 || (tier == Tier2 && includeTier2))
	return tier, kind, copied
}

func unclassified(node NodeType) (SelectionTier, FileKind, bool) {
	if node == NodeDir {
		return Unclassified, KindDirectory, false
	}
	return Unclassified, KindUnclassified, false
}

func exactArtifact(relative string, artifacts []policyArtifact) (policyArtifact, bool) {
	for _, artifact := range artifacts {
		if relative == artifact.Path {
			return artifact, true
		}
	}
	return policyArtifact{}, false
}

func sidecarArtifact(relative string) (policyArtifact, bool) {
	for _, suffix := range canonicalPolicy.SQLiteSidecarSuffixes {
		if !strings.HasSuffix(relative, suffix) {
			continue
		}
		if artifact, ok := exactArtifact(strings.TrimSuffix(relative, suffix), canonicalPolicy.ProfileTier1); ok && artifact.FileKind == KindDatabase {
			return artifact, true
		}
	}
	return policyArtifact{}, false
}

func withinAny(relative string, roots []string) bool {
	for _, root := range roots {
		if relative == root || strings.HasPrefix(relative, root+"/") {
			return true
		}
	}
	return false
}

func matchesAnyGlob(relative string, globs []string) bool {
	for _, glob := range globs {
		wildcard := strings.IndexByte(glob, '*')
		if wildcard < 0 {
			if relative == glob {
				return true
			}
			continue
		}
		if strings.HasPrefix(relative, glob[:wildcard]) && strings.HasSuffix(relative, glob[wildcard+1:]) {
			return true
		}
	}
	return false
}
