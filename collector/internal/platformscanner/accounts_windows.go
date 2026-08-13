//go:build windows

package platformscanner

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func nativeAccounts() ([]Account, error) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList`, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return nil, fmt.Errorf("open ProfileList: %w", err)
	}
	defer key.Close()
	sids, err := key.ReadSubKeyNames(-1)
	if err != nil {
		return nil, err
	}
	accounts := make([]Account, 0, len(sids))
	for _, sid := range sids {
		profile, err := registry.OpenKey(key, sid, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		home, _, valueErr := profile.GetStringValue("ProfileImagePath")
		_ = profile.Close()
		if valueErr != nil || home == "" {
			continue
		}
		accounts = append(accounts, Account{ID: sid, Home: expandProfilePath(home)})
	}
	return accounts, nil
}

func expandProfilePath(path string) string {
	upper := strings.ToUpper(path)
	if strings.HasPrefix(upper, `%SYSTEMDRIVE%`) {
		return `C:` + path[len(`%SystemDrive%`):]
	}
	if strings.HasPrefix(upper, `%SYSTEMROOT%`) {
		return `C:\Windows` + path[len(`%SystemRoot%`):]
	}
	return path
}
