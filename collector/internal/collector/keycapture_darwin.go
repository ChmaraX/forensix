//go:build darwin

package collector

import (
	"runtime"
	"unsafe"

	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
	"github.com/ebitengine/purego"
)

type darwinKeyCapturer struct{}

func NewHostKeyCapturer(_ string) KeyCapturer { return darwinKeyCapturer{} }

func (darwinKeyCapturer) Capture(found platformscanner.UserDataDir) KeyCaptureResult {
	if !currentAccountCanReadLiveStore(found) {
		return unavailableDarwinKey("live-key-store-account-context-mismatch")
	}
	handle, err := purego.Dlopen("/System/Library/Frameworks/Security.framework/Security", purego.RTLD_LAZY|purego.RTLD_LOCAL)
	if err != nil {
		return unavailableDarwinKey("native-keychain-adapter-unavailable")
	}
	defer purego.Dlclose(handle)
	findAddress, err := purego.Dlsym(handle, "SecKeychainFindGenericPassword")
	if err != nil || findAddress == 0 {
		return unavailableDarwinKey("native-keychain-adapter-unavailable")
	}
	freeAddress, err := purego.Dlsym(handle, "SecKeychainItemFreeContent")
	if err != nil || freeAddress == 0 {
		return unavailableDarwinKey("native-keychain-adapter-unavailable")
	}
	var findGenericPassword func(uintptr, uint32, *byte, uint32, *byte, *uint32, *unsafe.Pointer, uintptr) int32
	var freeContent func(uintptr, unsafe.Pointer) int32
	purego.RegisterFunc(&findGenericPassword, findAddress)
	purego.RegisterFunc(&freeContent, freeAddress)

	service := []byte("Chrome Safe Storage")
	account := []byte("Chrome")
	var length uint32
	var data unsafe.Pointer
	status := findGenericPassword(0, uint32(len(service)), &service[0], uint32(len(account)), &account[0], &length, &data, 0)
	runtime.KeepAlive(service)
	runtime.KeepAlive(account)
	if status != 0 || data == nil || length == 0 {
		if data != nil {
			zeroUnsafeBytes(data, length)
			_ = freeContent(0, data)
		}
		reason := "keychain-read-failed"
		switch status {
		case -25300:
			reason = "provider-item-not-found"
		case -25293:
			reason = "provider-authorization-denied"
		case -128:
			reason = "provider-prompt-cancelled"
		}
		return unavailableDarwinKey(reason)
	}
	view := unsafe.Slice((*byte)(data), int(length))
	secret := append([]byte(nil), view...)
	zeroBytes(view)
	_ = freeContent(0, data)
	record := capturedProviderKey("macos-keychain-v10", "darwin", "macos-keychain", "Chrome Safe Storage/Chrome", "live_account_keychain", "v10", secret, 1003, []KeyContext{
		{Name: "service", Value: "Chrome Safe Storage"},
		{Name: "account", Value: "Chrome"},
		{Name: "derivation", Value: "pbkdf2-hmac-sha1"},
		{Name: "iterations", Value: "1003"},
		{Name: "salt", Value: "saltysalt"},
	})
	zeroBytes(secret)
	return KeyCaptureResult{Records: []CapturedKeyRecord{record}}
}

func unavailableDarwinKey(reason string) KeyCaptureResult {
	return KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey(
		"macos-keychain-unavailable", "darwin", "macos-keychain", "Chrome Safe Storage/Chrome", "live_account_keychain", "v10", reason,
	)}}
}

func zeroUnsafeBytes(data unsafe.Pointer, length uint32) {
	zeroBytes(unsafe.Slice((*byte)(data), int(length)))
}
