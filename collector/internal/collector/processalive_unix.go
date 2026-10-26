//go:build !windows

package collector

import "golang.org/x/sys/unix"

// processAlive probes with signal 0: the kernel checks that the process exists
// and sends no signal.
func processAlive(pid int) bool {
	err := unix.Kill(pid, 0)
	return err == nil || err == unix.EPERM
}
