import dbus, subprocess, threading
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
service_obj = bus.get_object("org.freedesktop.secrets", "/org/freedesktop/secrets")
service = dbus.Interface(service_obj, "org.freedesktop.Secret.Service")

session_path, out = service.OpenSession("plain", dbus.String("", variant_level=1))
props = {"org.freedesktop.Secret.Collection.Label": dbus.String("Login", variant_level=1)}
collection_path, prompt_path = service.CreateCollection(props, "default")
print("collection:", collection_path, "prompt:", prompt_path)

loop = GLib.MainLoop()

if str(prompt_path) == "/":
    print("No prompt needed, collection created directly")
else:
    prompt_obj = bus.get_object("org.freedesktop.secrets", prompt_path)
    prompt_iface = dbus.Interface(prompt_obj, "org.freedesktop.Secret.Prompt")

    def on_completed(dismissed, out):
        print("COMPLETED dismissed=", dismissed, "out=", out)
        loop.quit()

    bus.add_signal_receiver(on_completed, signal_name="Completed",
                             dbus_interface="org.freedesktop.Secret.Prompt",
                             path=prompt_path)
    prompt_iface.Prompt("0")

    def screenshot_cb():
        subprocess.run(["scrot", "/home/cua/prompt_mid.png"], env={"DISPLAY": ":1"})
        print("screenshot taken")
        return False
    GLib.timeout_add(2500, screenshot_cb)

    def timeout_cb():
        print("TIMEOUT waiting for Completed")
        loop.quit()
        return False
    GLib.timeout_add(9000, timeout_cb)
    loop.run()
