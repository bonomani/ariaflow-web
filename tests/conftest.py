"""Shared fixtures for all test files."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import pytest
from playwright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_web.webapp import serve  # noqa: E402

# ---------------------------------------------------------------------------
# Default mock data
# ---------------------------------------------------------------------------

DEFAULT_STATUS = {
    "items": [
        {"id": "item-1", "url": "https://example.com/big.iso", "output": "big.iso", "status": "downloading", "gid": "aaa111", "created_at": "2026-04-01T10:00:00"},
        {"id": "item-2", "url": "https://example.com/small.zip", "output": "small.zip", "status": "queued", "gid": "bbb222", "created_at": "2026-04-01T10:01:00"},
        {"id": "item-3", "url": "https://example.com/done.tar", "output": "done.tar", "status": "done", "gid": "ccc333", "created_at": "2026-04-01T09:00:00"},
        {"id": "item-4", "url": "https://example.com/fail.bin", "output": "fail.bin", "status": "error", "gid": "ddd444", "created_at": "2026-04-01T09:30:00", "error_message": "404 Not Found"},
        {"id": "item-5", "url": "https://example.com/paused.dat", "output": "paused.dat", "status": "paused", "gid": "eee555", "created_at": "2026-04-01T09:45:00"},
    ],
    "active": {
        "gid": "aaa111", "url": "https://example.com/big.iso", "status": "active",
        "downloadSpeed": 1048576, "totalLength": 104857600, "completedLength": 52428800, "percent": 50.0,
    },
    "actives": [
        {
            "gid": "aaa111", "url": "https://example.com/big.iso", "status": "active",
            "downloadSpeed": 1048576, "totalLength": 104857600, "completedLength": 52428800, "percent": 50.0,
        },
    ],
    "aria2": {"enabled": True, "reachable": True, "version": "1.36.0"},
    "state": {"running": True, "paused": False, "session_id": "sess-001", "session_started_at": "2026-04-01T10:00:00"},
    "summary": {"queued": 1, "done": 1, "error": 1, "total": 5},
    "bandwidth": {"source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 50, "interface_name": "en0"},
    "ariaflow": {"reachable": True, "version": "0.1.34", "pid": 1234},
}

DEFAULT_DECLARATION = {"uic": {"preferences": [
    {"name": "auto_preflight_on_run", "value": False, "options": [True, False], "rationale": "default off"},
    {"name": "max_simultaneous_downloads", "value": 1, "options": [1], "rationale": "sequential"},
    {"name": "duplicate_active_transfer_action", "value": "remove", "options": ["remove", "pause", "ignore"], "rationale": "default"},
    {"name": "post_action_rule", "value": "pending", "options": ["pending"], "rationale": "default"},
]}, "ucc": {}, "policy": {}}

DEFAULT_LIFECYCLE = {
    "ariaflow": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "message": "installed"}},
    "aria2": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "message": "installed"}},
    "networkquality": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "ready", "message": "available"}},
    "aria2-launchd": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "message": "loaded"}},
    "session_id": "sess-001",
    "session_started_at": "2026-04-01T10:00:00",
    "session_last_seen_at": "2026-04-01T10:05:00",
}

DEFAULT_LOG = {"items": [
    {"action": "add", "outcome": "ok", "timestamp": "2026-04-01T10:00:00", "session_id": "sess-001", "target": "queue"},
]}

DEFAULT_PREFLIGHT = {"status": "pass", "gates": [{"name": "aria2", "satisfied": True, "class": "gate", "blocking": "hard"}], "warnings": [], "hard_failures": []}


# ---------------------------------------------------------------------------
# Mock backend server (simulates ariaflow backend API)
# ---------------------------------------------------------------------------

class MockBackendHandler(BaseHTTPRequestHandler):
    """Handles API requests that the frontend sends directly to the backend."""

    # Class-level state — overridable per test. Can be dict or callable returning dict.
    status_data: dict | object = DEFAULT_STATUS
    declaration_data: dict | object = DEFAULT_DECLARATION
    lifecycle_data: dict = DEFAULT_LIFECYCLE
    log_data: dict = DEFAULT_LOG
    preflight_data: dict = DEFAULT_PREFLIGHT
    # Optional: a FakeBackend object that intercepts all calls
    fake_backend: object | None = None

    def _send(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/api" or path == "/api/":
            self._send({"name": "ariaflow", "version": "0.1.48", "endpoints": {"GET": [], "POST": []}})
        elif path == "/api/status":
            sd = type(self).status_data
            data = sd() if callable(sd) else sd
            self._send(data)
        elif path == "/api/bandwidth":
            self._send({"source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 80, "interface_name": "eth0"})
        elif path == "/api/log":
            self._send(self.log_data)
        elif path == "/api/declaration" or path == "/api/options":
            dd = type(self).declaration_data
            data = dd() if callable(dd) else dd
            self._send(data)
        elif path == "/api/lifecycle":
            self._send(self.lifecycle_data)
        elif path == "/api/downloads/archive":
            self._send({"items": []})
        elif path == "/api/scheduler":
            self._send({"status": "running", "running": True, "paused": False, "session_id": "sess-001"})
        elif path == "/api/sessions":
            self._send({"sessions": []})
        elif path == "/api/sessions/stats":
            self._send({"session_id": "sess-001", "total": 5, "done": 1})
        elif path == "/api/torrents":
            self._send({"torrents": []})
        elif path == "/api/peers":
            self._send({"peers": []})
        elif path.startswith("/api/downloads/") and path.endswith("/files"):
            self._send({"files": []})
        else:
            self._send({"error": "not_found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            self._send({"ok": False, "error": "invalid_json"}, status=400)
            return

        if path == "/api/downloads/add":
            items = payload.get("items", [])
            self._send({"ok": True, "count": len(items), "added": [{"url": item.get("url", "")} for item in items]})
        elif path == "/api/scheduler/resume":
            self._send({"ok": True, "action": "resume", "result": {"started": True}})
        elif path == "/api/scheduler/pause":
            self._send({"paused": True})
        elif path == "/api/scheduler/preflight":
            self._send(self.preflight_data)
        elif path == "/api/scheduler/ucc":
            self._send({"result": {"outcome": "converged", "observation": "ok"}, "meta": {"contract": "UCC", "version": "1.0"}})
        elif path == "/api/declaration":
            self.declaration_data = payload if isinstance(payload, dict) and payload.get("uic") else self.declaration_data
            self._send(self.declaration_data)
        elif path.startswith("/api/lifecycle/"):
            self._send({"ok": True, "lifecycle": self.lifecycle_data})
        elif path == "/api/sessions/new":
            self._send({"ok": True, "session": "sess-002"})
        elif path == "/api/bandwidth/probe":
            self._send({"ok": True, "source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 80})
        elif path == "/api/downloads/cleanup":
            self._send({"ok": True, "archived": 0, "remaining": 0})
        elif path == "/api/aria2/change_global_option":
            self._send({"ok": True})
        elif path == "/api/aria2/change_option":
            self._send({"ok": True})
        elif path == "/api/aria2/set_limits":
            self._send({"ok": True})
        elif path.startswith("/api/torrents/") and path.endswith("/stop"):
            self._send({"ok": True})
        elif path.startswith("/api/downloads/"):
            parts = path.split("/")
            if len(parts) == 5:
                action = parts[4]
                if action == "files":
                    self._send({"ok": True, "selected": payload.get("select", [])})
                elif action in {"pause", "resume", "remove", "retry"}:
                    self._send({"ok": True, "item": {"id": parts[3], "status": "paused"}})
                else:
                    self._send({"error": "not_found"}, status=404)
            else:
                self._send({"error": "not_found"}, status=404)
        else:
            self._send({"error": "not_found"}, status=404)

    def do_PATCH(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            self._send({"ok": False, "error": "invalid_json"}, status=400)
            return

        if path == "/api/declaration/preferences":
            self._send({"ok": True, "applied": payload})
        else:
            self._send({"error": "not_found"}, status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


# ---------------------------------------------------------------------------
# Port allocator (avoids conflicts between test files)
# ---------------------------------------------------------------------------

import socket

_next_port = 8770
_port_lock = threading.Lock()


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _allocate_port() -> int:
    global _next_port
    with _port_lock:
        while not _port_is_free(_next_port):
            _next_port += 1
        port = _next_port
        _next_port += 1
        return port


# ---------------------------------------------------------------------------
# Server factory
# ---------------------------------------------------------------------------

def start_mock_backend(**overrides: object) -> tuple:
    """Start a mock backend API server. Returns (url, server)."""
    port = _allocate_port()
    # Create a subclass to avoid shared state across test modules
    handler_cls = type("IsolatedHandler", (MockBackendHandler,), {})
    for key, value in overrides.items():
        setattr(handler_cls, key, value)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.1)
    return f"http://127.0.0.1:{port}", server, handler_cls


def start_server(port: int | None = None, **mock_kwargs: object) -> tuple:
    """Start ariaflow-web (static files) + mock backend. Returns (web_url, backend_url, web_server, backend_server, patches)."""
    if port is None:
        port = _allocate_port()
    backend_url, backend_server, handler_cls = start_mock_backend(**mock_kwargs)
    from unittest.mock import patch
    p = patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"})
    p.start()
    web_server = serve(host="127.0.0.1", port=port, backend_url=backend_url)
    thread = threading.Thread(target=web_server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)
    return f"http://127.0.0.1:{port}", backend_url, web_server, backend_server, [p], handler_cls


def stop_server(web_server: object, backend_server: object, patches: list | None = None) -> None:
    web_server.shutdown()
    web_server.server_close()
    backend_server.shutdown()
    backend_server.server_close()
    for p in (patches or []):
        p.stop()


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def playwright_instance():
    pw = sync_playwright().start()
    yield pw
    pw.stop()


@pytest.fixture(scope="session")
def shared_browser(playwright_instance):
    browser = playwright_instance.chromium.launch(headless=True)
    yield browser
    browser.close()
