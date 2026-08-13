//go:build linux

package collector

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestLinuxKeyStoreAdapterRejectsNetworkDBusTransportBeforeDial(t *testing.T) {
	old, present := os.LookupEnv("DBUS_SESSION_BUS_ADDRESS")
	t.Cleanup(func() {
		if present {
			_ = os.Setenv("DBUS_SESSION_BUS_ADDRESS", old)
		} else {
			_ = os.Unsetenv("DBUS_SESSION_BUS_ADDRESS")
		}
	})
	if err := os.Setenv("DBUS_SESSION_BUS_ADDRESS", "tcp:host=127.0.0.1,port=1"); err != nil {
		t.Fatal(err)
	}
	_, err := dialLocalSessionBus()
	if err == nil || !strings.Contains(err.Error(), "non-local") {
		t.Fatalf("network D-Bus transport was not refused: %v", err)
	}
}

func TestLinuxBasicProviderUsesDemonstratedChromeDerivation(t *testing.T) {
	got := deriveChromeLegacyKey([]byte("peanuts"), 1)
	if hex := fmt.Sprintf("%x", got); hex != "fd621fe5a2b402539dfa147ca9272778" {
		t.Fatalf("derived key=%s", hex)
	}
}
