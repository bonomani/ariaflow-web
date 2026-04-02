from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__
from .bonjour import discover_http_services

_STATIC_DIR = Path(__file__).parent / "static"

_CONTENT_TYPES: dict[str, str] = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
}


DEFAULT_BACKEND_URL = "http://127.0.0.1:8000"


def _read_index_html(backend_url: str | None = None) -> str:
    text = (_STATIC_DIR / "index.html").read_text(encoding="utf-8")
    text = text.replace("__ARIAFLOW_WEB_VERSION__", f"v{__version__}")
    text = text.replace("__ARIAFLOW_WEB_PID__", str(os.getpid()))
    url = backend_url or DEFAULT_BACKEND_URL
    if url != "http://127.0.0.1:8000":
        text = text.replace("</head>", f'<script>window.__ARIAFLOW_BACKEND_URL__="{url}";</script></head>')
    return text


INDEX_HTML = _read_index_html()


class AriaFlowHandler(BaseHTTPRequestHandler):

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path in {"/", "/index.html", "/bandwidth", "/lifecycle", "/options", "/log", "/dev", "/archive"}:
            body = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            file_path = _STATIC_DIR / rel
            try:
                file_path = file_path.resolve()
                if not str(file_path).startswith(str(_STATIC_DIR.resolve())):
                    raise FileNotFoundError
                data = file_path.read_bytes()
            except (FileNotFoundError, OSError):
                self._send_json({"error": "not_found"}, status=404)
                return
            suffix = file_path.suffix.lower()
            ct = _CONTENT_TYPES.get(suffix, mimetypes.guess_type(str(file_path))[0] or "application/octet-stream")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == "/api/discovery":
            self._send_json(discover_http_services())
            return
        self._send_json({"error": "not_found"}, status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


def serve(host: str = "127.0.0.1", port: int = 8000, backend_url: str | None = None) -> ThreadingHTTPServer:
    global INDEX_HTML  # noqa: PLW0603
    if backend_url:
        INDEX_HTML = _read_index_html(backend_url)
    return ThreadingHTTPServer((host, port), AriaFlowHandler)
