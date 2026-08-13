//go:build linux

package collector

import (
	"os"
	"strings"
)

func osVersion() EnvironmentValue {
	content, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "os_release_unreadable"}
	}
	for _, line := range strings.Split(string(content), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return environmentValue(strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`), "os_version_not_found")
		}
	}
	return EnvironmentValue{State: "unavailable", Reason: "os_version_not_found"}
}

func machineIdentifier() EnvironmentValue {
	content, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		return EnvironmentValue{State: "unavailable", Reason: "machine_identifier_unreadable"}
	}
	return environmentValue(strings.TrimSpace(string(content)), "machine_identifier_empty")
}
