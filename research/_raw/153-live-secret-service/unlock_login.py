import dbus
bus = dbus.SessionBus()
service_obj = bus.get_object("org.freedesktop.secrets", "/org/freedesktop/secrets")
service = dbus.Interface(service_obj, "org.freedesktop.Secret.Service")
unlocked, prompt = service.Unlock([dbus.ObjectPath("/org/freedesktop/secrets/collection/login")])
print("unlocked:", unlocked)
print("prompt:", prompt)
