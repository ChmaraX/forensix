package collector

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
)

type localStateOSCrypt struct {
	OSCrypt struct {
		EncryptedKey         string `json:"encrypted_key"`
		AppBoundEncryptedKey string `json:"app_bound_encrypted_key"`
	} `json:"os_crypt"`
}

func captureWindowsLocalState(userDataDir string, unprotect func([]byte) ([]byte, error)) KeyCaptureResult {
	content, err := os.ReadFile(filepath.Join(userDataDir, "Local State"))
	if err != nil {
		return KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey("windows-local-state-unavailable", "windows", "windows-dpapi", "Local State/os_crypt", "current_user", "v10", "local-state-unavailable")}}
	}
	var state localStateOSCrypt
	if err := json.Unmarshal(content, &state); err != nil {
		return KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey("windows-local-state-unavailable", "windows", "windows-dpapi", "Local State/os_crypt", "current_user", "v10", "local-state-invalid-json")}}
	}
	result := KeyCaptureResult{}
	if state.OSCrypt.EncryptedKey != "" {
		wrapper, decodeErr := base64.StdEncoding.DecodeString(state.OSCrypt.EncryptedKey)
		if decodeErr != nil {
			result.Records = append(result.Records, unavailableProviderKey("windows-dpapi-v10", "windows", "windows-dpapi", "Local State/os_crypt.encrypted_key", "current_user", "v10", "legacy-wrapper-invalid-base64"))
		} else {
			const evidencePath = "evidence/windows-local-state-encrypted-key.bin"
			result.Evidence = append(result.Evidence, CapturedKeyEvidence{Path: evidencePath, Content: wrapper})
			record := CapturedKeyRecord{
				RecordID: "windows-dpapi-v10", CaptureState: "unavailable", KeyKind: "oscrypt_row_key",
				Provider: KeyProviderMetadata{Platform: "windows", Name: "windows-dpapi", Item: "Local State/os_crypt.encrypted_key", Scope: "current_user"},
				Context:  []KeyContext{{Name: "wrapper_encoding", Value: "base64-in-local-state"}, {Name: "wrapper_sha256", Value: conformance.Digest(wrapper)}},
				Policy:   KeyPolicyEvidence{RowPrefix: "v10", Support: "unavailable", Reason: "legacy-wrapper-format-unsupported"},
				Evidence: []KeyEvidenceReference{{Path: evidencePath, Version: "DPAPI", Policy: "legacy-windows-supported"}},
			}
			if bytes.HasPrefix(wrapper, []byte("DPAPI")) && len(wrapper) > len("DPAPI") {
				record.Context = append(record.Context, KeyContext{Name: "wrapper_prefix", Value: "DPAPI"})
				key, unwrapErr := unprotect(wrapper[len("DPAPI"):])
				if unwrapErr == nil && len(key) == 32 {
					record.CaptureState, record.UsableRowKey, record.DerivedKey = "captured", true, key
					record.Policy.Support, record.Policy.Reason = "supported", ""
				} else {
					zeroBytes(key)
					if errors.Is(unwrapErr, errDPAPIAccountContext) {
						record.Policy.Reason = errDPAPIAccountContext.Error()
					} else {
						record.Policy.Reason = "dpapi-unprotect-failed"
					}
				}
			}
			result.Records = append(result.Records, record)
		}
	}
	if state.OSCrypt.AppBoundEncryptedKey != "" {
		wrapper, decodeErr := base64.StdEncoding.DecodeString(state.OSCrypt.AppBoundEncryptedKey)
		if decodeErr != nil {
			result.Records = append(result.Records, CapturedKeyRecord{
				RecordID: "windows-app-bound-v20", CaptureState: "unsupported", KeyKind: "oscrypt_row_key",
				Provider: KeyProviderMetadata{Platform: "windows", Name: "windows-app-bound-encryption", Item: "Local State/os_crypt.app_bound_encrypted_key", Scope: "system_and_current_user"},
				Context:  []KeyContext{{Name: "wrapper_encoding", Value: "invalid-base64-in-local-state"}},
				Policy:   KeyPolicyEvidence{RowPrefix: "v20", Support: "unsupported", Reason: "unsupported-google-app-bound-key-variant"},
			})
		} else {
			const evidencePath = "evidence/windows-local-state-app-bound-encrypted-key.bin"
			result.Evidence = append(result.Evidence, CapturedKeyEvidence{Path: evidencePath, Content: wrapper})
			prefix := "unidentified"
			if len(wrapper) >= 4 {
				prefix = string(wrapper[:4])
			}
			result.Records = append(result.Records, CapturedKeyRecord{
				RecordID: "windows-app-bound-v20", CaptureState: "unsupported", KeyKind: "oscrypt_row_key", UsableRowKey: false,
				Provider: KeyProviderMetadata{Platform: "windows", Name: "windows-app-bound-encryption", Item: "Local State/os_crypt.app_bound_encrypted_key", Scope: "system_and_current_user"},
				Context:  []KeyContext{{Name: "wrapper_encoding", Value: "base64-in-local-state"}, {Name: "wrapper_prefix", Value: prefix}, {Name: "wrapper_sha256", Value: conformance.Digest(wrapper)}, {Name: "usable_row_key", Value: "false"}},
				Policy:   KeyPolicyEvidence{RowPrefix: "v20", Support: "unsupported", Reason: "unsupported-google-app-bound-key-variant"},
				Evidence: []KeyEvidenceReference{{Path: evidencePath, Version: "v20", Policy: "unsupported-google-app-bound-key-variant"}},
			})
		}
	}
	if len(result.Records) == 0 {
		result.Records = []CapturedKeyRecord{unavailableProviderKey("windows-wrapper-unavailable", "windows", "windows-dpapi", "Local State/os_crypt", "current_user", "v10", "oscrypt-wrapper-absent")}
	}
	return result
}

var (
	errDPAPIUnprotect      = errors.New("dpapi-unprotect-failed")
	errDPAPIAccountContext = errors.New("live-key-store-account-context-mismatch")
)
