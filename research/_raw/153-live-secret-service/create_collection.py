import dbus, sys

bus = dbus.SessionBus()
service_obj = bus.get_object("org.freedesktop.secrets", "/org/freedesktop/secrets")
service = dbus.Interface(service_obj, "org.freedesktop.Secret.Service")

session_path, out = service.OpenSession("plain", dbus.String("", variant_level=1))
print("session:", session_path)

props = {
    "org.freedesktop.Secret.Collection.Label": dbus.String("Login", variant_level=1),
}
try:
    collection_path, prompt_path = service.CreateCollection(props, "default")
    print("collection:", collection_path)
    print("prompt:", prompt_path)
except Exception as e:
    print("ERROR:", repr(e))
    sys.exit(1)
