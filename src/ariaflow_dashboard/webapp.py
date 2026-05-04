from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from .action_log import load_action_log, record_action
from .bonjour import discover_http_services, local_identity

_STATIC_DIR = Path(__file__).parent / "static"
_DIST_INDEX = _STATIC_DIR / "dist" / "index.html"

_CONTENT_TYPES: dict[str, str] = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
}


DEFAULT_BACKEND_URL = "http://127.0.0.1:8000"


def _read_index_html(backend_url: str | None = None) -> str:
    from . import __version__
    text = _DIST_INDEX.read_text(encoding="utf-8")
    identity = local_identity()
    globals_js = (
        f"<script>"
        f"window.__ARIAFLOW_DASHBOARD_VERSION__={json.dumps(__version__)};"
        f"window.__ARIAFLOW_DASHBOARD_PID__={json.dumps(os.getpid())};"
        f"window.__ARIAFLOW_DASHBOARD_HOSTNAME__={json.dumps(identity['hostname'])};"
        f"window.__ARIAFLOW_DASHBOARD_LOCAL_MAIN_IP__={json.dumps(identity['main_ip'])};"
        f"window.__ARIAFLOW_DASHBOARD_LOCAL_IPS__={json.dumps(identity['ips'] or ['127.0.0.1'])};"
    )
    url = backend_url or DEFAULT_BACKEND_URL
    if url != "http://127.0.0.1:8000":
        globals_js += f"window.__ARIAFLOW_BACKEND_URL__={json.dumps(url)};"
    globals_js += "</script>"
    text = text.replace("</head>", f"{globals_js}</head>")
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
        parsed = urlparse(self.path)
        path = parsed.path
        if path in {"/", "/index.html", "/bandwidth", "/lifecycle", "/options", "/log", "/dev", "/archive"}:
            body = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            record_action(action="serve", target="page", outcome="ok", reason=path)
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
            result = discover_http_services()
            self._send_json(result)
            items = result.get("items")
            item_list = items if isinstance(items, list) else []
            urls = [str(i.get("url", "")) for i in item_list if isinstance(i, dict)]
            record_action(
                action="discover", target="bonjour", outcome="ok" if result.get("available") else "skipped",
                reason=str(result.get("reason", "")),
                detail={"count": len(item_list), "urls": urls},
            )
            return
        if path == "/api/web/log":
            qs = parse_qs(parsed.query)
            limit = min(int(qs.get("limit", ["200"])[0]), 500)
            self._send_json({"items": load_action_log(limit), "source": "ariaflow-dashboard"})
            return
        self._send_json({"error": "not_found"}, status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


def serve(host: str = "127.0.0.1", port: int = 8000, backend_url: str | None = None) -> ThreadingHTTPServer:
    global INDEX_HTML  # noqa: PLW0603
    if backend_url:
        INDEX_HTML = _read_index_html(backend_url)
    from . import __version__
    record_action(
        action="start", target="server", outcome="ok",
        detail={"host": host, "port": port, "backend_url": backend_url or DEFAULT_BACKEND_URL, "version": __version__},
    )
    return ThreadingHTTPServer((host, port), AriaFlowHandler)
