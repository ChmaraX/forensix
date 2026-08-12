// Package conformance is the replaceable boundary shared conceptually with the
// analyzer. The Analyzer lane (#167) owns the final cross-implementation wire
// contract. Keep serialization, selection, and digest rules confined here.
package conformance

import "time"

const (
	SchemaVersion   = "forensix-manifest-draft/1"
	SelectionPolicy = "chrome-userdata/1"
	HashAlgorithm   = "sha-256"
)

type NodeType string

const (
	NodeFile    NodeType = "file"
	NodeSymlink NodeType = "symlink"
	NodeSocket  NodeType = "socket"
	NodeDir     NodeType = "dir"
	NodeAbsent  NodeType = "absent"
)

type Selection string

const (
	Tier1        Selection = "tier_1"
	Tier2        Selection = "tier_2"
	Tier3        Selection = "tier_3"
	Unclassified Selection = "unclassified"
)

type FileKind string

const (
	KindDatabase         FileKind = "database"
	KindSidecar          FileKind = "sidecar"
	KindBrowserState     FileKind = "browser_state"
	KindLivenessEvidence FileKind = "liveness_evidence"
	KindBulkArtifact     FileKind = "bulk_artifact"
	KindBallast          FileKind = "ballast"
	KindUnclassified     FileKind = "unclassified"
	KindExpectedArtifact FileKind = "expected_artifact"
)

// ManifestEntry field order is the canonical JSON key order. Path must remain
// first so byte sorting complete lines is path sorting.
type ManifestEntry struct {
	Path          string    `json:"path"`
	SourcePath    string    `json:"source_path"`
	Size          int64     `json:"size"`
	HashAlgorithm string    `json:"hash_algorithm"`
	SHA256        string    `json:"sha256"`
	MTime         time.Time `json:"mtime"`
	NodeType      NodeType  `json:"node_type"`
	FileKind      FileKind  `json:"file_kind"`
	Copied        bool      `json:"copied"`
	Selection     Selection `json:"selection"`
}

type PolicyDiff struct {
	IncludeBulk bool     `json:"include_bulk"`
	Includes    []string `json:"includes"`
	Excludes    []string `json:"excludes"`
}

type ManifestHeader struct {
	SchemaVersion     string     `json:"schema_version"`
	SelectionPolicy   string     `json:"selection_policy"`
	SelectionDiff     PolicyDiff `json:"selection_diff"`
	SourcePath        string     `json:"source_path"`
	ChromeRunning     bool       `json:"chrome_running"`
	LivenessEvidence  []string   `json:"liveness_evidence"`
	Unclassified      int        `json:"unclassified"`
	EvidenceSetDigest string     `json:"evidence_set_digest"`
	WorkingCopyDigest string     `json:"working_copy_digest"`
	HashAlgorithm     string     `json:"hash_algorithm"`
}
