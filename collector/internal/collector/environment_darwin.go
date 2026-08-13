//go:build darwin

package collector

import (
	"strings"

	"golang.org/x/sys/unix"
)

func osVersion() EnvironmentValue {
	value, err := unix.Sysctl("kern.osproductversion")
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "os_version_sysctl_failed"}
	}
	return environmentValue(strings.TrimSpace(value), "os_version_not_found")
}

func machineIdentifier() EnvironmentValue {
	value, err := unix.Sysctl("hw.uuid")
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_sysctl_failed"}
	}
	return environmentValue(strings.TrimSpace(value), "machine_identifier_empty")
}
