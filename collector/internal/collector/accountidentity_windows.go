//go:build windows

package collector

import (
	"strings"

	"golang.org/x/sys/windows"
)

func currentAccountID() (string, error) {
	account, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", err
	}
	return account.User.Sid.String(), nil
}

func accountIDsEqual(current, scanned string) bool { return strings.EqualFold(current, scanned) }
