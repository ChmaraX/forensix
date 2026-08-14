//go:build linux || darwin

package collector

import "os/user"

func currentAccountID() (string, error) {
	account, err := user.Current()
	if err != nil {
		return "", err
	}
	return account.Username, nil
}

func accountIDsEqual(current, scanned string) bool { return current == scanned }
