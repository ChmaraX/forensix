package main

import (
	"bytes"
	"testing"

	"github.com/ChmaraX/forensix/collector/internal/collector"
)

func TestExitCodeForPartialBundle(t *testing.T) {
	bundle := collector.BundleManifest{UserDataDirs: []collector.BundleUserDataDir{{SourcePath: "/source", Outcome: collector.SkippedRunning, LivenessEvidence: []string{"RunningChromeVersion"}, LivenessExplanation: "running"}}}
	if got := reportResult(bundle, "/bundle", &bytes.Buffer{}); got != 2 {
		t.Fatalf("exit=%d want=2", got)
	}
}

func TestExitCodeForCompleteBundle(t *testing.T) {
	bundle := collector.BundleManifest{BundleDigest: "digest", UserDataDirs: []collector.BundleUserDataDir{{Outcome: collector.Collected}}}
	if got := reportResult(bundle, "/bundle", &bytes.Buffer{}); got != 0 {
		t.Fatalf("exit=%d want=0", got)
	}
}
