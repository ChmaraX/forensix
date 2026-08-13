//go:build windows

package collector

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func osVersion() EnvironmentValue {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "os_version_registry_unreadable"}
	}
	defer key.Close()
	product, _, productErr := key.GetStringValue("ProductName")
	build, _, buildErr := key.GetStringValue("CurrentBuildNumber")
	if productErr != nil || buildErr != nil {
		return EnvironmentValue{State: "unavailable", Reason: "os_version_not_found"}
	}
	return environmentValue(strings.TrimSpace(fmt.Sprintf("%s build %s", product, build)), "os_version_not_found")
}

func machineIdentifier() EnvironmentValue {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_registry_unreadable"}
	}
	defer key.Close()
	value, _, err := key.GetStringValue("MachineGuid")
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_not_found"}
	}
	return environmentValue(strings.TrimSpace(value), "machine_identifier_empty")
}
