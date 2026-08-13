//go:build linux || darwin

package platformscanner

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func nativeAccounts() ([]Account, error) {
	file, err := os.Open("/etc/passwd")
	if err != nil {
		return nil, fmt.Errorf("open account database: %w", err)
	}
	defer file.Close()
	var accounts []Account
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) < 7 || fields[0] == "" || fields[5] == "" {
			continue
		}
		home := fields[5]
		if home == "/var/empty" || home == "/nonexistent" {
			continue
		}
		accounts = append(accounts, Account{ID: fields[0], Home: home})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return accounts, nil
}
