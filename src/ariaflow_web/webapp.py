from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import __version__
from .bonjour import discover_http_services
from .client import (
    add_items_from,
    bandwidth_probe_from,
    cleanup_from,
    get_api_discovery_from,
    get_archive_from,
    get_bandwidth_from,
    get_declaration_from,
    get_item_files_from,
    get_lifecycle_from,
    get_log_from,
    get_scheduler_from,
    get_session_stats_from,
    get_sessions_from,
    get_status_from,
    item_action_from,
    item_priority_from,
    lifecycle_action_from,
    pause_from,
    preflight_from,
    resume_from,
    run_action_from,
    run_ucc_from,
    save_declaration_from,
    set_aria2_options_from,
    set_item_files_from,
    set_session_from,
)
STATUS_CACHE: dict[str, object] = {"ts": 0.0, "payload": None}
STATUS_CACHE_TTL = 2.0
DEFAULT_BACKEND_URL = "http://127.0.0.1:8000"

# PID cache — lsof is expensive, PID rarely changes
_PID_CACHE: dict[str, object] = {"ts": 0.0, "pid": None, "port": 0}
_PID_CACHE_TTL = 60.0


def _is_local_backend(hostname: str | None) -> bool:
    host = (hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _local_pid_for_port(port: int) -> int | None:
    now = time.time()
    if (
        _PID_CACHE["port"] == port
        and now - float(_PID_CACHE.get("ts") or 0.0) < _PID_CACHE_TTL  # type: ignore[arg-type]
    ):
        return _PID_CACHE["pid"]  # type: ignore[return-value]
    pid = _local_pid_for_port_uncached(port)
    _PID_CACHE["ts"] = now
    _PID_CACHE["pid"] = pid
    _PID_CACHE["port"] = port
    return pid


def _local_pid_for_port_uncached(port: int) -> int | None:
    lsof = shutil.which("lsof")
    if not lsof:
        return None
    try:
        completed = subprocess.run(
            [lsof, "-tiTCP:%d" % port, "-sTCP:LISTEN", "-n", "-P"],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
    except Exception:
        return None
    for line in (completed.stdout or "").splitlines():
        text = line.strip()
        if not text:
            continue
        try:
            return int(text)
        except ValueError:
            continue
    return None


def _normalize_backend_payload(payload: dict, backend_url: str) -> dict:
    parsed = urlparse(backend_url)
    af = dict(payload.get("ariaflow") or {})
    af.setdefault("reachable", payload.get("ok", True) is not False)
    af.setdefault("url", backend_url)
    if not af.get("pid") and _is_local_backend(parsed.hostname) and parsed.port:
        pid = _local_pid_for_port(parsed.port)
        if pid:
            af["pid"] = pid
    payload["ariaflow"] = af
    return payload


_STATIC_DIR = Path(__file__).parent / "static"

_CONTENT_TYPES: dict[str, str] = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
}


def _read_index_html() -> str:
    text = (_STATIC_DIR / "index.html").read_text(encoding="utf-8")
    text = text.replace("__ARIAFLOW_WEB_VERSION__", f"v{__version__}")
    text = text.replace("__ARIAFLOW_WEB_PID__", str(os.getpid()))
    return text


INDEX_HTML = _read_index_html()


class AriaFlowHandler(BaseHTTPRequestHandler):
    def _backend_url(self, parsed: object | None = None) -> str:
        if parsed is None:
            return DEFAULT_BACKEND_URL
        try:
            query = parse_qs(getattr(parsed, "query", ""), keep_blank_values=True)  # type: ignore[arg-type]
        except Exception:
            query = {}
        backend = str(query.get("backend", [""])[0]).strip()
        return backend or DEFAULT_BACKEND_URL

    def _invalidate_status_cache(self) -> None:
        STATUS_CACHE["ts"] = 0.0
        STATUS_CACHE["payload"] = None

    def _status_payload(self, backend_url: str, force: bool = False) -> dict:
        now = time.time()
        cached = STATUS_CACHE.get("payload")
        if (
            not force
            and cached is not None
            and STATUS_CACHE.get("backend") == backend_url
            and now - float(STATUS_CACHE.get("ts") or 0.0) < STATUS_CACHE_TTL  # type: ignore[arg-type]
        ):
            return cached  # type: ignore[return-value]
        payload = _normalize_backend_payload(get_status_from(backend_url), backend_url)
        STATUS_CACHE["ts"] = now
        STATUS_CACHE["backend"] = backend_url
        STATUS_CACHE["payload"] = payload
        return payload

    def _proxy_sse(self, backend_url: str) -> None:
        """Forward an SSE stream from the backend to the client."""
        import http.client as hc
        parsed = urlparse(backend_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 8000
        try:
            conn = hc.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/api/events")
            resp = conn.getresponse()
            if resp.status != 200:
                self._send_json({"error": "sse_unavailable"}, status=502)
                conn.close()
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            while True:
                line = resp.readline()
                if not line:
                    break
                self.wfile.write(line)
                self.wfile.flush()
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _forward_status(payload: dict[str, object]) -> int:
        raw_status = payload.get("http_status")
        try:
            return int(str(raw_status)) if raw_status is not None else 200
        except (TypeError, ValueError):
            return 200

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        backend_url = self._backend_url(parsed)
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
        if path == "/api":
            payload = get_api_discovery_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/bandwidth":
            payload = get_bandwidth_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/status":
            payload = self._status_payload(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/log":
            limit = 120
            query: dict[str, str] = {}
            for part in parsed.query.split("&"):
                if not part:
                    continue
                if "=" in part:
                    k, v = part.split("=", 1)
                    query[k] = v
                else:
                    query[part] = ""
            try:
                limit = max(1, min(500, int(query.get("limit", "120"))))
            except ValueError:
                limit = 120
            payload = get_log_from(backend_url, limit=limit)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/declaration":
            payload = get_declaration_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/options":
            payload = get_declaration_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/lifecycle":
            payload = get_lifecycle_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/discovery":
            self._send_json(discover_http_services())
            return
        if path == "/api/archive":
            payload = get_archive_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/scheduler":
            payload = get_scheduler_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/sessions":
            payload = get_sessions_from(backend_url)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/session/stats":
            qs = parse_qs(parsed.query, keep_blank_values=True)
            sid = qs.get("session_id", [None])[0]
            payload = get_session_stats_from(backend_url, sid)
            self._send_json(payload, status=self._forward_status(payload))
            return
        if path == "/api/events":
            self._proxy_sse(backend_url)
            return
        if path.startswith("/api/item/"):
            parts = path.split("/")
            if len(parts) == 5 and parts[4] == "files":
                item_id = parts[3]
                payload = get_item_files_from(backend_url, item_id)
                self._send_json(payload, status=self._forward_status(payload))
                return
        self._send_json({"error": "not_found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        backend_url = self._backend_url(parsed)
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            self._send_json(
                {"ok": False, "error": "invalid_json", "message": "request body must be valid JSON"},
                status=400,
            )
            return

        if path == "/api/bandwidth/probe":
            self._invalidate_status_cache()
            response = bandwidth_probe_from(backend_url)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/add":
            if not isinstance(payload, dict):
                self._send_json({"ok": False, "error": "invalid_payload", "message": "expected a JSON object"}, status=400)
                return
            items = payload.get("items")
            if not isinstance(items, list):
                self._send_json({"ok": False, "error": "invalid_items", "message": "items must be provided as a list"}, status=400)
                return
            self._invalidate_status_cache()
            response = add_items_from(backend_url, items)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/preflight":
            self._invalidate_status_cache()
            response = preflight_from(backend_url)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/run":
            if not isinstance(payload, dict):
                self._send_json({"ok": False, "error": "invalid_payload", "message": "expected a JSON object"}, status=400)
                return
            action = str(payload.get("action", "")).strip()
            auto_preflight = payload.get("auto_preflight_on_run")
            if auto_preflight is not None and not isinstance(auto_preflight, bool):
                self._send_json(
                    {
                        "ok": False,
                        "error": "invalid_auto_preflight_on_run",
                        "message": "auto_preflight_on_run must be a boolean when provided",
                    },
                    status=400,
                )
                return
            self._invalidate_status_cache()
            response = run_action_from(backend_url, action, auto_preflight if isinstance(auto_preflight, bool) else None)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/ucc":
            self._invalidate_status_cache()
            response = run_ucc_from(backend_url)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/declaration":
            declaration = payload if isinstance(payload, dict) else {}
            self._invalidate_status_cache()
            response = save_declaration_from(backend_url, declaration)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/lifecycle/action":
            target = str(payload.get("target", "")).strip()
            action = str(payload.get("action", "")).strip()
            self._invalidate_status_cache()
            response = lifecycle_action_from(backend_url, target, action)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/session":
            action = str(payload.get("action", "")).strip()
            if action != "new":
                self._send_json({"error": "unsupported_action", "action": action}, status=400)
                return
            self._invalidate_status_cache()
            response = set_session_from(backend_url, action)
            self._send_json(response, status=self._forward_status(response))
            return

        if path.startswith("/api/item/"):
            parts = path.split("/")
            if len(parts) == 5 and parts[1] == "api" and parts[2] == "item":
                item_id = parts[3]
                action = parts[4]
                if action in {"pause", "resume", "remove", "retry"}:
                    self._invalidate_status_cache()
                    response = item_action_from(backend_url, item_id, action)
                    self._send_json(response, status=self._forward_status(response))
                    return
                if action == "priority":
                    priority = int(payload.get("priority", 0))
                    self._invalidate_status_cache()
                    response = item_priority_from(backend_url, item_id, priority)
                    self._send_json(response, status=self._forward_status(response))
                    return
                if action == "files":
                    selected = payload.get("select", [])
                    self._invalidate_status_cache()
                    response = set_item_files_from(backend_url, item_id, selected)
                    self._send_json(response, status=self._forward_status(response))
                    return
            self._send_json({"error": "not_found"}, status=404)
            return

        if path == "/api/aria2/options":
            options = payload if isinstance(payload, dict) else {}
            response = set_aria2_options_from(backend_url, options)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/cleanup":
            self._invalidate_status_cache()
            response = cleanup_from(backend_url)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/pause":
            self._invalidate_status_cache()
            response = pause_from(backend_url)
            self._send_json(response, status=self._forward_status(response))
            return

        if path == "/api/resume":
            self._invalidate_status_cache()
            response = resume_from(backend_url)
            self._send_json(response, status=self._forward_status(response))
            return

        self._send_json({"error": "not_found"}, status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


def serve(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), AriaFlowHandler)
