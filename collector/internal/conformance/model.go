// Package conformance implements the language-neutral Manifest and Selection
// Policy contracts shared with the analyzer.
package conformance

import "time"

const (
	ManifestSchema  = "forensix/manifest/1"
	SourceKind      = "USER_DATA_DIR"
	SelectionPolicy = "chrome-userdata/1"
	HashAlgorithm   = "sha-256"
)

type ManifestState string

const (
	StateValue       ManifestState = "value"
	StateAbsent      ManifestState = "absent"
	StateUnavailable ManifestState = "unavailable"
)

type UnavailableReason string

const (
	PermissionDenied    UnavailableReason = "permission_denied"
	IOError             UnavailableReason = "io_error"
	ChangedDuringIngest UnavailableReason = "changed_during_ingest"
	ParentUnavailable   UnavailableReason = "parent_unavailable"
)

type NodeType string

const (
	NodeFile    NodeType = "file"
	NodeSymlink NodeType = "symlink"
	NodeSocket  NodeType = "socket"
	NodeDir     NodeType = "dir"
	NodeAbsent  NodeType = "absent"
)

type SelectionTier string

const (
	Tier1        SelectionTier = "tier_1"
	Tier2        SelectionTier = "tier_2"
	Tier3        SelectionTier = "tier_3"
	Unclassified SelectionTier = "unclassified"
)

type FileKind string

const (
	KindDatabase         FileKind = "database"
	KindSidecar          FileKind = "sidecar"
	KindJSON             FileKind = "json"
	KindImage            FileKind = "image"
	KindMetadata         FileKind = "metadata"
	KindLivenessEvidence FileKind = "liveness_evidence"
	KindBulkData         FileKind = "bulk_data"
	KindBallast          FileKind = "ballast"
	KindDirectory        FileKind = "directory"
	KindUnclassified     FileKind = "unclassified"
)

// ManifestEntry field order is the canonical JSON key order. SourcePath and
// MTime are acquisition-only values and never enter the wire representation.
type ManifestEntry struct {
	Path              string             `json:"path"`
	State             ManifestState      `json:"state"`
	UnavailableReason *UnavailableReason `json:"unavailable_reason"`
	NodeType          NodeType           `json:"node_type"`
	FileKind          FileKind           `json:"file_kind"`
	SelectionTier     SelectionTier      `json:"selection_tier"`
	Copied            bool               `json:"copied"`
	Unclassified      bool               `json:"unclassified"`
	Size              *int64             `json:"size"`
	MTimeNS           *string            `json:"mtime_ns"`
	HashAlgorithm     string             `json:"hash_algorithm"`
	SHA256            *string            `json:"sha256"`
	LinkTarget        *string            `json:"link_target"`

	SourcePath string    `json:"-"`
	MTime      time.Time `json:"-"`
}

// ManifestHeader field order follows the canonical Analyzer contract.
type ManifestHeader struct {
	ManifestSchema      string   `json:"manifest_schema"`
	SourceKind          string   `json:"source_kind"`
	SelectionPolicy     string   `json:"selection_policy"`
	SelectionPolicyDiff []string `json:"selection_policy_diff"`
	Tier2Included       bool     `json:"tier_2_included"`
	HashAlgorithm       string   `json:"hash_algorithm"`
	EvidenceSetDigest   string   `json:"evidence_set_digest"`
	WorkingCopyDigest   string   `json:"working_copy_digest"`
	EntryCount          int      `json:"entry_count"`
	CopiedEntryCount    int      `json:"copied_entry_count"`
	ProfileCount        int      `json:"profile_count"`
	UnavailableCount    int      `json:"unavailable_count"`
	UnclassifiedCount   int      `json:"unclassified_count"`
}
