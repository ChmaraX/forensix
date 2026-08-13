//go:build windows

package collector

import (
	"runtime"
	"unsafe"

	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
	"golang.org/x/sys/windows"
)

type windowsKeyCapturer struct{}

func NewHostKeyCapturer(_ string) KeyCapturer { return windowsKeyCapturer{} }

func (windowsKeyCapturer) Capture(found platformscanner.UserDataDir) KeyCaptureResult {
	if !currentAccountCanReadLiveStore(found) {
		return captureWindowsLocalState(found.Path, func([]byte) ([]byte, error) { return nil, errDPAPIAccountContext })
	}
	return captureWindowsLocalState(found.Path, unprotectCurrentUserDPAPI)
}

func unprotectCurrentUserDPAPI(protected []byte) ([]byte, error) {
	if len(protected) == 0 {
		return nil, errDPAPIUnprotect
	}
	input := windows.DataBlob{Size: uint32(len(protected)), Data: &protected[0]}
	var output windows.DataBlob
	if err := windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, errDPAPIUnprotect
	}
	runtime.KeepAlive(protected)
	if output.Data == nil || output.Size == 0 {
		return nil, errDPAPIUnprotect
	}
	decryptedView := unsafe.Slice(output.Data, int(output.Size))
	decrypted := append([]byte(nil), decryptedView...)
	zeroBytes(decryptedView)
	_, _ = windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(output.Data))))
	return decrypted, nil
}
