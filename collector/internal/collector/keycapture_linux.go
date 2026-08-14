//go:build linux

package collector

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/ChmaraX/forensix/collector/internal/platformscanner"
	"github.com/godbus/dbus/v5"
)

const (
	secretServiceName = "org.freedesktop.secrets"
	secretServicePath = dbus.ObjectPath("/org/freedesktop/secrets")
)

type linuxKeyCapturer struct{ provider string }

type providerSecret struct {
	value   []byte
	item    string
	context []KeyContext
}

type secretServiceValue struct {
	Session     dbus.ObjectPath
	Parameters  []byte
	Value       []byte
	ContentType string
}

type kwalletEndpoint struct {
	mode    string
	service string
	path    dbus.ObjectPath
}

func NewHostKeyCapturer(provider string) KeyCapturer {
	if provider == "" {
		provider = linuxProviderAuto
	}
	return linuxKeyCapturer{provider: provider}
}

func (capturer linuxKeyCapturer) Capture(found platformscanner.UserDataDir) KeyCaptureResult {
	if !currentAccountCanReadLiveStore(found) {
		return KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey(
			"linux-account-context-unavailable", "linux", capturer.provider, "Chrome Safe Storage", "live_account_session", "v11", "live-key-store-account-context-mismatch",
		)}}
	}
	switch capturer.provider {
	case linuxProviderBasic:
		secret := []byte("peanuts")
		record := capturedProviderKey("linux-basic-v10", "linux", "basic", "hard-coded basic password", "browser_default", "v10", secret, 1, []KeyContext{{Name: "derivation", Value: "pbkdf2-hmac-sha1"}, {Name: "iterations", Value: "1"}, {Name: "salt", Value: "saltysalt"}})
		zeroBytes(secret)
		return KeyCaptureResult{Records: []CapturedKeyRecord{record}}
	case linuxProviderLibsecret:
		return captureLibsecret()
	case linuxProviderKWallet, linuxProviderKWallet5, linuxProviderKWallet6:
		return captureKWallet(endpointForMode(capturer.provider))
	default:
		return captureAutomaticLinuxProvider()
	}
}

func captureAutomaticLinuxProvider() KeyCaptureResult {
	desktop := strings.ToLower(os.Getenv("XDG_CURRENT_DESKTOP") + ":" + os.Getenv("DESKTOP_SESSION"))
	if strings.Contains(desktop, "kde") || strings.Contains(desktop, "plasma") {
		var attempts []CapturedKeyRecord
		for _, endpoint := range []kwalletEndpoint{endpointForMode(linuxProviderKWallet6), endpointForMode(linuxProviderKWallet5), endpointForMode(linuxProviderKWallet)} {
			result := captureKWallet(endpoint)
			if len(result.Records) > 0 && result.Records[0].CaptureState == "captured" {
				return result
			}
			attempts = append(attempts, result.Records...)
		}
		return KeyCaptureResult{Records: attempts}
	}
	return captureLibsecret()
}

func captureLibsecret() KeyCaptureResult {
	secrets, err := readSecretService()
	if err != nil {
		return KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey("linux-libsecret-unavailable", "linux", "gnome-libsecret", "Chrome Safe Storage", "live_account_session", "v11", stableProviderReason(err))}}
	}
	records := make([]CapturedKeyRecord, 0, len(secrets))
	for index := range secrets {
		secret := &secrets[index]
		record := capturedProviderKey(fmt.Sprintf("linux-libsecret-v11-%d", index+1), "linux", "gnome-libsecret", secret.item, "live_account_session", "v11", secret.value, 1, append(secret.context,
			KeyContext{Name: "derivation", Value: "pbkdf2-hmac-sha1"}, KeyContext{Name: "iterations", Value: "1"}, KeyContext{Name: "salt", Value: "saltysalt"}))
		zeroBytes(secret.value)
		records = append(records, record)
	}
	return KeyCaptureResult{Records: records}
}

func readSecretService() ([]providerSecret, error) {
	connection, err := dialLocalSessionBus()
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	owner, err := nameHasOwner(connection, secretServiceName)
	if err != nil || !owner {
		return nil, errors.New("provider-service-unavailable")
	}
	service := connection.Object(secretServiceName, secretServicePath)
	var collection dbus.ObjectPath
	if err := service.Call("org.freedesktop.Secret.Service.ReadAlias", 0, "default").Store(&collection); err != nil || collection == "/" {
		return nil, errors.New("default-collection-unavailable")
	}
	collectionObject := connection.Object(secretServiceName, collection)
	locked, err := boolProperty(collectionObject, "org.freedesktop.Secret.Collection.Locked")
	if err != nil || locked {
		return nil, errors.New("provider-store-locked")
	}
	var output dbus.Variant
	var session dbus.ObjectPath
	if err := service.Call("org.freedesktop.Secret.Service.OpenSession", 0, "plain", dbus.MakeVariant("")).Store(&output, &session); err != nil {
		return nil, errors.New("provider-session-unavailable")
	}
	defer connection.Object(secretServiceName, session).Call("org.freedesktop.Secret.Session.Close", 0)

	var items []dbus.ObjectPath
	attributes := map[string]string{"application": "chrome"}
	if err := collectionObject.Call("org.freedesktop.Secret.Collection.SearchItems", 0, attributes).Store(&items); err != nil {
		return nil, errors.New("provider-item-search-failed")
	}
	if len(items) == 0 {
		return nil, errors.New("provider-item-not-found")
	}
	sort.Slice(items, func(i, j int) bool { return string(items[i]) < string(items[j]) })
	results := make([]providerSecret, 0, len(items))
	for _, itemPath := range items {
		item := connection.Object(secretServiceName, itemPath)
		locked, err := boolProperty(item, "org.freedesktop.Secret.Item.Locked")
		if err != nil || locked {
			continue
		}
		var secret secretServiceValue
		if err := item.Call("org.freedesktop.Secret.Item.GetSecret", 0, session).Store(&secret); err != nil || len(secret.Value) == 0 {
			continue
		}
		label := "Chrome Safe Storage"
		if property, err := item.GetProperty("org.freedesktop.Secret.Item.Label"); err == nil {
			if value, ok := property.Value().(string); ok && value != "" {
				label = value
			}
		}
		context := []KeyContext{{Name: "application", Value: "chrome"}, {Name: "dbus_item_path", Value: string(itemPath)}, {Name: "label", Value: label}}
		if secret.ContentType != "" {
			context = append(context, KeyContext{Name: "content_type", Value: secret.ContentType})
		}
		results = append(results, providerSecret{value: secret.Value, item: label, context: context})
	}
	if len(results) == 0 {
		return nil, errors.New("provider-item-locked-or-empty")
	}
	return results, nil
}

func captureKWallet(endpoint kwalletEndpoint) KeyCaptureResult {
	secret, context, err := readKWallet(endpoint)
	if err != nil {
		return KeyCaptureResult{Records: []CapturedKeyRecord{unavailableProviderKey("linux-"+endpoint.mode+"-unavailable", "linux", endpoint.mode, "Chrome Keys/Chrome Safe Storage", "live_account_session", "v11", stableProviderReason(err))}}
	}
	record := capturedProviderKey("linux-"+endpoint.mode+"-v11", "linux", endpoint.mode, "Chrome Keys/Chrome Safe Storage", "live_account_session", "v11", secret, 1, append(context,
		KeyContext{Name: "derivation", Value: "pbkdf2-hmac-sha1"}, KeyContext{Name: "iterations", Value: "1"}, KeyContext{Name: "salt", Value: "saltysalt"}))
	zeroBytes(secret)
	return KeyCaptureResult{Records: []CapturedKeyRecord{record}}
}

func readKWallet(endpoint kwalletEndpoint) ([]byte, []KeyContext, error) {
	connection, err := dialLocalSessionBus()
	if err != nil {
		return nil, nil, err
	}
	defer connection.Close()
	owner, err := nameHasOwner(connection, endpoint.service)
	if err != nil || !owner {
		return nil, nil, errors.New("provider-service-unavailable")
	}
	wallet := connection.Object(endpoint.service, endpoint.path)
	var enabled bool
	if err := wallet.Call("org.kde.KWallet.isEnabled", 0).Store(&enabled); err != nil || !enabled {
		return nil, nil, errors.New("provider-disabled")
	}
	var walletName string
	if err := wallet.Call("org.kde.KWallet.networkWallet", 0).Store(&walletName); err != nil || walletName == "" {
		return nil, nil, errors.New("provider-wallet-unavailable")
	}
	var open bool
	if err := wallet.Call("org.kde.KWallet.isOpen", 0, walletName).Store(&open); err != nil || !open {
		return nil, nil, errors.New("provider-store-locked")
	}
	var handle int32
	if err := wallet.Call("org.kde.KWallet.open", 0, walletName, int64(0), "forensix-collect").Store(&handle); err != nil || handle < 0 {
		return nil, nil, errors.New("provider-open-failed")
	}
	var present bool
	if err := wallet.Call("org.kde.KWallet.hasEntry", 0, handle, "Chrome Keys", "Chrome Safe Storage", "forensix-collect").Store(&present); err != nil || !present {
		return nil, nil, errors.New("provider-item-not-found")
	}
	var secret string
	if err := wallet.Call("org.kde.KWallet.readPassword", 0, handle, "Chrome Keys", "Chrome Safe Storage", "forensix-collect").Store(&secret); err != nil || secret == "" {
		return nil, nil, errors.New("provider-read-failed")
	}
	return []byte(secret), []KeyContext{{Name: "dbus_service", Value: endpoint.service}, {Name: "wallet", Value: walletName}, {Name: "folder", Value: "Chrome Keys"}, {Name: "entry", Value: "Chrome Safe Storage"}}, nil
}

func endpointForMode(mode string) kwalletEndpoint {
	switch mode {
	case linuxProviderKWallet6:
		return kwalletEndpoint{mode: mode, service: "org.kde.kwalletd6", path: "/modules/kwalletd6"}
	case linuxProviderKWallet5:
		return kwalletEndpoint{mode: mode, service: "org.kde.kwalletd5", path: "/modules/kwalletd5"}
	default:
		return kwalletEndpoint{mode: linuxProviderKWallet, service: "org.kde.kwalletd", path: "/modules/kwalletd"}
	}
}

func dialLocalSessionBus() (*dbus.Conn, error) {
	address := os.Getenv("DBUS_SESSION_BUS_ADDRESS")
	if address == "" {
		return nil, errors.New("local-session-bus-unavailable")
	}
	for _, candidate := range strings.Split(address, ";") {
		if candidate == "" || !strings.HasPrefix(candidate, "unix:") {
			return nil, errors.New("non-local-session-bus-prohibited")
		}
	}
	connection, err := dbus.Dial(address)
	if err != nil {
		return nil, errors.New("local-session-bus-unavailable")
	}
	if err := connection.Auth(nil); err != nil {
		connection.Close()
		return nil, errors.New("local-session-bus-authentication-failed")
	}
	if err := connection.Hello(); err != nil {
		connection.Close()
		return nil, errors.New("local-session-bus-handshake-failed")
	}
	return connection, nil
}

func nameHasOwner(connection *dbus.Conn, name string) (bool, error) {
	var owner bool
	err := connection.BusObject().Call("org.freedesktop.DBus.NameHasOwner", 0, name).Store(&owner)
	return owner, err
}

func boolProperty(object dbus.BusObject, name string) (bool, error) {
	property, err := object.GetProperty(name)
	if err != nil {
		return false, err
	}
	value, ok := property.Value().(bool)
	if !ok {
		return false, errors.New("provider-property-invalid")
	}
	return value, nil
}

func stableProviderReason(err error) string {
	if err == nil || err.Error() == "" {
		return "provider-unavailable"
	}
	return err.Error()
}
