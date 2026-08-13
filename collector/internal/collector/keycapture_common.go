package collector

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

const (
	linuxProviderAuto      = "auto"
	linuxProviderBasic     = "basic"
	linuxProviderLibsecret = "gnome-libsecret"
	linuxProviderKWallet   = "kwallet"
	linuxProviderKWallet5  = "kwallet5"
	linuxProviderKWallet6  = "kwallet6"
)

func currentAccountCanReadLiveStore(found platformscanner.UserDataDir) bool {
	accountID, err := currentAccountID()
	if err != nil || found.AccountID == "" || !accountIDsEqual(accountID, found.AccountID) {
		return false
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return false
	}
	home, err = realPath(home)
	if err != nil {
		return false
	}
	source, err := realPath(found.Path)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		home, source = strings.ToLower(home), strings.ToLower(source)
	}
	relative, err := filepath.Rel(home, source)
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func realPath(value string) (string, error) {
	resolved, err := filepath.EvalSymlinks(value)
	if err == nil {
		return filepath.Abs(resolved)
	}
	return filepath.Abs(value)
}

func validLinuxKeyProvider(provider string) bool {
	switch provider {
	case linuxProviderAuto, linuxProviderBasic, linuxProviderLibsecret, linuxProviderKWallet, linuxProviderKWallet5, linuxProviderKWallet6:
		return true
	default:
		return false
	}
}

func deriveChromeLegacyKey(secret []byte, iterations int) []byte {
	const keySize = 16
	salt := []byte("saltysalt")
	block := make([]byte, 4)
	binary.BigEndian.PutUint32(block, 1)
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(salt)
	_, _ = mac.Write(block)
	u := mac.Sum(nil)
	result := append([]byte(nil), u...)
	for i := 1; i < iterations; i++ {
		mac.Reset()
		_, _ = mac.Write(u)
		next := mac.Sum(nil)
		for j := range result {
			result[j] ^= next[j]
		}
		zeroBytes(u)
		u = next
	}
	zeroBytes(u)
	zeroBytes(block)
	return result[:keySize]
}

func capturedProviderKey(recordID, platform, provider, item, scope, rowPrefix string, secret []byte, iterations int, context []KeyContext) CapturedKeyRecord {
	derived := deriveChromeLegacyKey(secret, iterations)
	return CapturedKeyRecord{
		RecordID: recordID, CaptureState: "captured", KeyKind: "oscrypt_row_key", UsableRowKey: true,
		Provider:   KeyProviderMetadata{Platform: platform, Name: provider, Item: item, Scope: scope},
		Context:    context,
		Policy:     KeyPolicyEvidence{RowPrefix: rowPrefix, Support: "supported"},
		DerivedKey: derived,
	}
}

func unavailableProviderKey(recordID, platform, provider, item, scope, rowPrefix, reason string) CapturedKeyRecord {
	return CapturedKeyRecord{
		RecordID: recordID, CaptureState: "unavailable", KeyKind: "oscrypt_row_key", UsableRowKey: false,
		Provider: KeyProviderMetadata{Platform: platform, Name: provider, Item: item, Scope: scope},
		Context:  []KeyContext{},
		Policy:   KeyPolicyEvidence{RowPrefix: rowPrefix, Support: "unavailable", Reason: reason},
	}
}
