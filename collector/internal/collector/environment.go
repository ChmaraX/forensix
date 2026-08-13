package collector

import (
	"os"
	"runtime"
	"time"

	"github.com/ChmaraX/forensix/collector/internal/conformance"
)

func collectorRecord(opts Options, startedHost, endedHost time.Time) CollectorRecord {
	hostname, _ := os.Hostname()
	record := CollectorRecord{
		SchemaVersion: "forensix-collector-record-draft/1", CollectorVersion: opts.Version,
		CollectorCommit: opts.Commit, SelectionPolicy: conformance.SelectionPolicy,
		OperatorIdentifier: opts.OperatorIdentifier, StartedAt: startedHost.UTC(), EndedAt: endedHost.UTC(),
		Hostname: hostname, OS: runtime.GOOS, OSVersion: osVersion(), Architecture: runtime.GOARCH,
		MachineIdentifier: machineIdentifier(), NetworkCalls: "prohibited_by_design",
	}
	record.HostReportedLocal = HostReportedTime{StartedAt: startedHost.In(time.Local), EndedAt: endedHost.In(time.Local), Verification: "unverified"}
	record.AuthorizationClaim.Reference = opts.AuthorizationReference
	record.AuthorizationClaim.WitnessedByCollector = true
	record.AuthorizationClaim.AuthorityVerified = false
	return record
}

func environmentValue(value, unavailableReason string) EnvironmentValue {
	if value == "" {
		return EnvironmentValue{State: "unavailable", Reason: unavailableReason}
	}
	return EnvironmentValue{State: "value", Value: value}
}
