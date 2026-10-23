#!/usr/bin/env python3
"""Serve the vent globe and let any local user ask open screens to reload."""

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

ROOT = "/home/hmt/captain_nemo"
PORT = 8090
SHOT = "/tmp/captain-nemo-hdmi-now.png"

generation = 0
generation_lock = Lock()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/screen":
            with generation_lock:
                current = generation
            self._send_json({"generation": current})
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > 12_000_000:
            self.send_error(413)
            return
        body = self.rfile.read(length) if length else b""
        if path == "/api/screen/shot":
            if not body.startswith(b"\x89PNG\r\n\x1a\n"):
                self.send_error(400)
                return
            with open(SHOT, "wb") as shot:
                shot.write(body)
            os.chmod(SHOT, 0o644)
            self._send_json({"ok": True, "bytes": len(body)})
            return
        if path != "/api/screen/reload":
            self.send_error(404)
            return
        global generation
        with generation_lock:
            generation += 1
            current = generation
        self._send_json({"generation": current})

    def _send_json(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer(
        ("0.0.0.0", PORT),
        partial(Handler, directory=ROOT),
    )
    server.serve_forever()
