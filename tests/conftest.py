"""Shared fixtures for all test files."""
from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from playwright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_web.webapp import serve, STATUS_CACHE  # noqa: E402

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

def make_mock_patches(
    status: dict | None = None,
    declaration: dict | None = None,
    lifecycle: dict | None = None,
    log: dict | None = None,
    preflight: dict | None = None,
    save_echo: bool = False,
    extra: dict | None = None,
) -> list:
    """Create mock patches for the webapp. Returns list of started patches."""

    def echo_save(_base_url: str, decl: dict) -> dict:
        return decl

    def add_items_response(_base_url: str, items: list) -> dict:
        return {"ok": True, "count": len(items), "added": [{"url": item.get("url", "")} for item in items]}

    config: dict[str, object] = {
        "ariaflow_web.webapp.get_status_from": status or DEFAULT_STATUS,
        "ariaflow_web.webapp.get_log_from": log or DEFAULT_LOG,
        "ariaflow_web.webapp.get_declaration_from": declaration or DEFAULT_DECLARATION,
        "ariaflow_web.webapp.get_lifecycle_from": lifecycle or DEFAULT_LIFECYCLE,
        "ariaflow_web.webapp.preflight_from": preflight or DEFAULT_PREFLIGHT,
        "ariaflow_web.webapp.run_action_from": {"ok": True, "action": "start", "result": {"started": True}},
        "ariaflow_web.webapp.run_ucc_from": {"result": {"outcome": "converged", "observation": "ok"}, "meta": {"contract": "UCC", "version": "1.0"}},
        "ariaflow_web.webapp.discover_http_services": {"available": False, "items": [], "reason": "none"},
        "ariaflow_web.webapp.set_session_from": {"ok": True, "session": "sess-002"},
        "ariaflow_web.webapp.pause_from": {"paused": True},
        "ariaflow_web.webapp.resume_from": {"resumed": True},
        "ariaflow_web.webapp.lifecycle_action_from": {"ok": True, "lifecycle": lifecycle or DEFAULT_LIFECYCLE},
        "ariaflow_web.webapp.item_action_from": {"ok": True, "item": {"id": "item-1", "status": "paused"}},
        "ariaflow_web.webapp.get_api_discovery_from": {"name": "ariaflow", "version": "0.1.48", "endpoints": {"GET": [], "POST": []}},
        "ariaflow_web.webapp.get_bandwidth_from": {"source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 80, "interface_name": "eth0"},
        "ariaflow_web.webapp.bandwidth_probe_from": {"ok": True, "source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 80},
        "ariaflow_web.webapp.get_scheduler_from": {"status": "running", "running": True, "paused": False, "session_id": "sess-001"},
        "ariaflow_web.webapp.get_sessions_from": {"sessions": []},
        "ariaflow_web.webapp.get_session_stats_from": {"session_id": "sess-001", "total": 5, "done": 1},
        "ariaflow_web.webapp.set_aria2_options_from": {"ok": True},
        "ariaflow_web.webapp.item_priority_from": {"ok": True, "item": {"id": "item-1", "priority": 0}},
        "ariaflow_web.webapp.get_item_files_from": {"files": []},
        "ariaflow_web.webapp.set_item_files_from": {"ok": True, "selected": []},
        "ariaflow_web.webapp.get_archive_from": {"items": []},
        "ariaflow_web.webapp.cleanup_from": {"ok": True, "archived": 0, "remaining": 0},
        "ariaflow_web.webapp._local_pid_for_port": None,
    }
    if extra:
        config.update(extra)

    patches = []
    mocks: dict[str, object] = {}

    for name, rv in config.items():
        p = patch(name, return_value=rv)
        m = p.start()
        mocks[name] = m
        patches.append(p)

    # add_items_from always echoes
    p_add = patch("ariaflow_web.webapp.add_items_from", side_effect=add_items_response)
    mocks["ariaflow_web.webapp.add_items_from"] = p_add.start()
    patches.append(p_add)

    # save_declaration echoes or returns static
    if save_echo:
        p_save = patch("ariaflow_web.webapp.save_declaration_from", side_effect=echo_save)
    else:
        p_save = patch("ariaflow_web.webapp.save_declaration_from", return_value=declaration or DEFAULT_DECLARATION)
    mocks["ariaflow_web.webapp.save_declaration_from"] = p_save.start()
    patches.append(p_save)

    return patches, mocks


def start_server(port: int | None = None, **mock_kwargs: object) -> tuple:
    """Start a mocked web server. Returns (url, server, patches, mocks)."""
    if port is None:
        port = _allocate_port()
    tmp = tempfile.mkdtemp()
    os.environ["ARIA_QUEUE_DIR"] = tmp
    patches, mocks = make_mock_patches(**mock_kwargs)
    server = serve(host="127.0.0.1", port=port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)
    return f"http://127.0.0.1:{port}", server, patches, mocks


def stop_server(server: object, patches: list) -> None:
    server.shutdown()
    server.server_close()
    for p in patches:
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


def bust_cache() -> None:
    STATUS_CACHE["ts"] = 0.0
    STATUS_CACHE["payload"] = None
