package main

import (
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/ChmaraX/forensix/collector/internal/collector"
	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
)

var (
	version = "0.0.0-dev"
	commit  = "unknown"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	if len(args) > 0 && args[0] == "strip-keys" {
		return runStripKeys(args[1:])
	}
	return runCollect(args)
}

func runCollect(args []string) int {
	flags := flag.NewFlagSet("forensix-collect", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	out := flags.String("out", "", "new Acquisition Bundle directory")
	operator := flags.String("operator", "", "operator-supplied identifier")
	authorization := flags.String("authorization-reference", "", "operator-supplied case and authorizing person/role claim")
	includeBulk := flags.Bool("include-bulk", false, "copy Selection Policy Tier 2 bulk content")
	continueRunning := flags.Bool("continue-if-chrome-running", false, "record liveness warning and collect without signaling Chrome")
	captureKeys := flags.Bool("capture-key-material", false, "capture authorized derived key material sealed to an X25519 recipient")
	keyRecipientFile := flags.String("key-material-recipient-file", "", "X25519 public key PEM or forensix recipient file")
	linuxKeyProvider := flags.String("linux-key-provider", "auto", "Linux provider: auto, basic, gnome-libsecret, kwallet, kwallet5, or kwallet6")
	showVersion := flags.Bool("version", false, "print collector version")
	if err := flags.Parse(args); err != nil {
		return 1
	}
	if *showVersion {
		fmt.Printf("forensix-collect %s+%s\n", version, commit)
		return 0
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "unexpected positional arguments")
		return 1
	}

	var recipient []byte
	if *keyRecipientFile != "" {
		content, err := os.ReadFile(*keyRecipientFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "collection failed: read key-material recipient: %v\n", err)
			return 1
		}
		recipient, err = collector.ParseKeyMaterialRecipient(content)
		if err != nil {
			fmt.Fprintf(os.Stderr, "collection failed: %v\n", err)
			return 1
		}
	}
	runner := collector.Collector{Scanner: platformscanner.NewHostScanner()}
	bundle, err := runner.Run(collector.Options{
		Output: *out, OperatorIdentifier: *operator, AuthorizationReference: *authorization,
		IncludeBulk: *includeBulk, ContinueIfRunning: *continueRunning,
		CaptureKeyMaterial: *captureKeys, KeyMaterialRecipient: recipient, LinuxKeyProvider: *linuxKeyProvider,
		Version: version, Commit: commit,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "collection failed: %v\n", err)
		return 1
	}
	return reportResult(bundle, *out, os.Stderr)
}

func runStripKeys(args []string) int {
	flags := flag.NewFlagSet("forensix-collect strip-keys", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	out := flags.String("out", "", "new Acquisition Bundle directory without key material")
	if err := flags.Parse(args); err != nil {
		return 1
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "strip-keys requires one input Acquisition Bundle")
		return 1
	}
	bundle, err := collector.StripKeys(flags.Arg(0), *out)
	if err != nil {
		fmt.Fprintf(os.Stderr, "strip-keys failed: %v\n", err)
		return 1
	}
	fmt.Printf("Acquisition Bundle: %s\nBundle Digest: %s\nOriginal Bundle Digest: %s\n", *out, bundle.BundleDigest, bundle.OriginalBundleDigest)
	return 0
}

func reportResult(bundle collector.BundleManifest, output string, stderr io.Writer) int {
	partial := false
	for _, udd := range bundle.UserDataDirs {
		if len(udd.LivenessEvidence) > 0 {
			fmt.Fprintf(stderr, "%s: %s\n", udd.SourcePath, udd.LivenessExplanation)
		}
		if udd.Outcome == collector.SkippedRunning {
			partial = true
			fmt.Fprintln(stderr, "No content was copied for this User Data Dir. Wait for Chrome to close or rerun with --continue-if-chrome-running if collection must proceed.")
		} else if udd.Outcome == collector.Failed {
			partial = true
			fmt.Fprintf(stderr, "%s: collection unavailable: %s\n", udd.SourcePath, udd.Error)
		}
	}
	fmt.Printf("Acquisition Bundle: %s\nBundle Digest: %s\n", output, bundle.BundleDigest)
	if partial {
		return 2
	}
	return 0
}
