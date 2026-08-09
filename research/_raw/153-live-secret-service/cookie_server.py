import http.server, socketserver

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Set-Cookie", "forensix153=live_secret_service_local; Path=/; Max-Age=3600")
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<html><body>forensix153 cookie set</body></html>")
    def log_message(self, fmt, *args):
        pass

with socketserver.TCPServer(("127.0.0.1", 8899), Handler) as httpd:
    httpd.serve_forever()
