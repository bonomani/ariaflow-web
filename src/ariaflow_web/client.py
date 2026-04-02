from __future__ import annotations

import http.client
import json
import socket
import threading
from urllib.parse import urlencode, urlparse

# Keep-alive connection pool — one persistent connection per host:port
_pool: dict[str, http.client.HTTPConnection] = {}
_pool_lock = threading.Lock()
_TIMEOUT = 10


def _get_conn(scheme: str, host: str, port: int) -> http.client.HTTPConnection:
    key = f"{scheme}://{host}:{port}"
    with _pool_lock:
        conn = _pool.get(key)
        if conn is not None:
            return conn
        if scheme == "https":
            conn = http.client.HTTPSConnection(host, port, timeout=_TIMEOUT)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=_TIMEOUT)
        _pool[key] = conn
        return conn


def _drop_conn(scheme: str, host: str, port: int) -> None:
    key = f"{scheme}://{host}:{port}"
    with _pool_lock:
        conn = _pool.pop(key, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def _request(path: str, method: str = "GET", payload: dict | None = None, base_url: str = "http://127.0.0.1:8000") -> dict:
    parsed = urlparse(base_url)
    scheme = parsed.scheme or "http"
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if scheme == "https" else 80)
    url = f"{base_url.rstrip('/')}{path}"

    headers: dict[str, str] = {"Connection": "keep-alive"}
    body: bytes | None = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    for attempt in range(2):
        conn = _get_conn(scheme, host, port)
        try:
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8")
            if resp.status >= 400:
                try:
                    result = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    result = {"ok": False, "error": "http_error", "message": raw or str(resp.status)}
                if not isinstance(result, dict):
                    result = {"ok": False, "error": "http_error", "message": str(result)}
                result.setdefault("ok", False)
                result.setdefault("http_status", resp.status)
                result.setdefault("ariaflow", {"reachable": True, "status": resp.status, "url": url})
                return result
            return json.loads(raw)
        except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError):
            # Stale keep-alive connection — drop and retry once
            _drop_conn(scheme, host, port)
            if attempt > 0:
                return {"ok": False, "ariaflow": {"reachable": False, "error": "connection reset", "url": url}}
        except (OSError, socket.timeout, http.client.HTTPException) as exc:
            _drop_conn(scheme, host, port)
            return {"ok": False, "ariaflow": {"reachable": False, "error": str(exc), "url": url}}

    return {"ok": False, "ariaflow": {"reachable": False, "error": "connection failed", "url": url}}


def get_api_discovery_from(base_url: str) -> dict:
    return _request("/api", base_url=base_url)


def get_status_from(base_url: str) -> dict:
    return _request("/api/status", base_url=base_url)


def get_bandwidth_from(base_url: str) -> dict:
    return _request("/api/bandwidth", base_url=base_url)


def bandwidth_probe_from(base_url: str) -> dict:
    return _request("/api/bandwidth/probe", method="POST", base_url=base_url)


def get_log_from(base_url: str, limit: int = 120) -> dict:
    return _request(f"/api/log?{urlencode({'limit': limit})}", base_url=base_url)


def get_declaration_from(base_url: str) -> dict:
    return _request("/api/declaration", base_url=base_url)


def save_declaration_from(base_url: str, declaration: dict) -> dict:
    return _request("/api/declaration", method="POST", payload=declaration, base_url=base_url)


def get_lifecycle_from(base_url: str) -> dict:
    return _request("/api/lifecycle", base_url=base_url)


def add_items_from(base_url: str, items: list[dict[str, object]]) -> dict:
    payload: dict[str, object] = {"items": items}
    return _request("/api/add", method="POST", payload=payload, base_url=base_url)


def preflight_from(base_url: str) -> dict:
    return _request("/api/preflight", method="POST", base_url=base_url)


def run_action_from(base_url: str, action: str, auto_preflight_on_run: bool | None = None) -> dict:
    payload: dict[str, object] = {"action": action}
    if auto_preflight_on_run is not None:
        payload["auto_preflight_on_run"] = auto_preflight_on_run
    return _request("/api/run", method="POST", payload=payload, base_url=base_url)


def run_ucc_from(base_url: str) -> dict:
    return _request("/api/ucc", method="POST", base_url=base_url)


def set_session_from(base_url: str, action: str = "new") -> dict:
    return _request("/api/session", method="POST", payload={"action": action}, base_url=base_url)


def pause_from(base_url: str) -> dict:
    return _request("/api/pause", method="POST", base_url=base_url)


def resume_from(base_url: str) -> dict:
    return _request("/api/resume", method="POST", base_url=base_url)


def item_action_from(base_url: str, item_id: str, action: str) -> dict:
    return _request(f"/api/item/{item_id}/{action}", method="POST", base_url=base_url)


def item_priority_from(base_url: str, item_id: str, priority: int) -> dict:
    return _request(f"/api/item/{item_id}/priority", method="POST", payload={"priority": priority}, base_url=base_url)


def get_item_files_from(base_url: str, item_id: str) -> dict:
    return _request(f"/api/item/{item_id}/files", base_url=base_url)


def set_item_files_from(base_url: str, item_id: str, selected: list[int]) -> dict:
    return _request(f"/api/item/{item_id}/files", method="POST", payload={"select": selected}, base_url=base_url)


def get_archive_from(base_url: str, limit: int = 100) -> dict:
    return _request(f"/api/archive?{urlencode({'limit': limit})}", base_url=base_url)


def cleanup_from(base_url: str) -> dict:
    return _request("/api/cleanup", method="POST", base_url=base_url)


def lifecycle_action_from(base_url: str, target: str, action: str) -> dict:
    return _request("/api/lifecycle/action", method="POST", payload={"target": target, "action": action}, base_url=base_url)
