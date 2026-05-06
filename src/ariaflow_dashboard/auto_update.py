"""Dashboard-local auto-update poller.

Mirrors the backend's BG-45 design but stores its preference *locally* —
the dashboard must keep itself current even when ariaflow-server is down,
so we can't put the toggle in the server's declaration.

The poller runs in a daemon thread, sleeps `auto_update_check_hours`,
then dispatches `dispatch_update()` which already shells out to the
right package manager (brew / pipx / pip). Source installs are skipped.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import urllib.error
import urllib.request

from .action_log import record_action
from .install_self import check_for_update, detect_installed_via, dispatch_update

DEFAULT_BACKEND = "http://127.0.0.1:8000"

CONFIG_DIR = Path.home() / ".ariaflow-dashboard"
CONFIG_PATH = CONFIG_DIR / "config.json"

DEFAULTS: dict[str, Any] = {
    "auto_update": False,
    "auto_update_check_hours": 24,
    # When the dashboard auto-update fires, also trigger the server's
    # update beforehand (best-effort; failures don't block the dashboard
    # update). Default off — operators who want both kept current opt
    # in.
    "update_server_first": False,
    # Backend URL to use for the server-update orchestration. Falls
    # back to DEFAULT_BACKEND_URL in webapp.py when empty.
    "backend_url": "",
}


def load_config() -> dict[str, Any]:
    """Read local config, merging missing keys with defaults."""
    cfg = dict(DEFAULTS)
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            cfg.update({k: raw[k] for k in raw if k in DEFAULTS})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    cfg["auto_update"] = bool(cfg.get("auto_update", False))
    cfg["update_server_first"] = bool(cfg.get("update_server_first", False))
    cfg["backend_url"] = str(cfg.get("backend_url", "") or "")
    try:
        hours = int(cfg.get("auto_update_check_hours", 24))
    except (TypeError, ValueError):
        hours = 24
    cfg["auto_update_check_hours"] = max(1, min(720, hours))
    return cfg


def save_config(updates: dict[str, Any]) -> dict[str, Any]:
    """Patch local config; only known keys are accepted."""
    current = load_config()
    for key in DEFAULTS:
        if key in updates:
            current[key] = updates[key]
    current["auto_update"] = bool(current["auto_update"])
    current["update_server_first"] = bool(current["update_server_first"])
    current["backend_url"] = str(current.get("backend_url", "") or "")
    try:
        hours = int(current.get("auto_update_check_hours", 24))
    except (TypeError, ValueError):
        hours = 24
    current["auto_update_check_hours"] = max(1, min(720, hours))
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def _trigger_server_update(backend_url: str) -> None:
    """Best-effort: ask the server to upgrade itself before we upgrade
    ourselves. POSTs /api/lifecycle/ariaflow-server/update — fire and
    forget. Any failure (server down, route 404, network) is swallowed
    and logged; the dashboard's own update still proceeds."""
    base = (backend_url or "").rstrip("/") or DEFAULT_BACKEND
    url = f"{base}/api/lifecycle/ariaflow-server/update"
    try:
        req = urllib.request.Request(url, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
            ok = 200 <= resp.status < 300
        record_action(
            action="auto_update_server_kick",
            target="ariaflow-server",
            outcome="changed" if ok else "failed",
            reason="dashboard_orchestration",
            detail={"backend_url": base, "status": resp.status},
        )
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        record_action(
            action="auto_update_server_kick",
            target="ariaflow-server",
            outcome="failed",
            reason="server_unreachable",
            detail={"backend_url": base, "error": str(e)},
        )


def _run_check_once() -> None:
    """One iteration: skip if disabled, probe for an update, only
    dispatch if one is actually available. Avoids re-downloading the
    same bottle every cycle."""
    cfg = load_config()
    if not cfg["auto_update"]:
        return
    via = detect_installed_via()
    if via in (None, "source"):
        record_action(
            action="auto_update_skip",
            target="ariaflow-dashboard",
            outcome="unchanged",
            reason="no_upgrade_channel",
            detail={"installed_via": via},
        )
        return
    probe = check_for_update()
    if probe.get("ok") is False:
        record_action(
            action="auto_update_check",
            target="ariaflow-dashboard",
            outcome="failed",
            reason=probe.get("error", "unknown"),
            detail={"installed_via": via},
        )
        return
    if not probe.get("update_available"):
        record_action(
            action="auto_update_check",
            target="ariaflow-dashboard",
            outcome="unchanged",
            reason="up_to_date",
            detail={
                "installed_via": via,
                "current_version": probe.get("current_version"),
            },
        )
        return
    # Optional orchestration: kick the server's update first so server +
    # dashboard end up at compatible versions when both have updates
    # waiting. Best-effort — server unreachable / no update is not a
    # blocker for the dashboard's own upgrade.
    if cfg.get("update_server_first"):
        _trigger_server_update(cfg.get("backend_url", ""))
    plan = dispatch_update()
    if plan.get("ok"):
        record_action(
            action="auto_update_dispatch",
            target="ariaflow-dashboard",
            outcome="changed",
            reason="periodic",
            detail={
                "installed_via": plan.get("installed_via"),
                "from_version": probe.get("current_version"),
                "to_version": probe.get("latest_version"),
            },
        )
        after = plan.get("after")
        if callable(after):
            after()
    else:
        record_action(
            action="auto_update_dispatch",
            target="ariaflow-dashboard",
            outcome="failed",
            reason=plan.get("error", "unknown"),
            detail={"installed_via": plan.get("installed_via")},
        )


def _poller_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        cfg = load_config()
        try:
            _run_check_once()
        except Exception as exc:  # noqa: BLE001
            record_action(
                action="auto_update_dispatch",
                target="ariaflow-dashboard",
                outcome="failed",
                reason="poller_error",
                detail={"error": str(exc)},
            )
        # Sleep until next check. Wake on stop_event so test teardown
        # is fast and we re-read interval changes promptly.
        seconds = cfg["auto_update_check_hours"] * 3600
        stop_event.wait(seconds)


def start_poller() -> threading.Event:
    """Spawn the background poller. Returns the stop_event for teardown."""
    stop_event = threading.Event()
    t = threading.Thread(
        target=_poller_loop, args=(stop_event,), name="ariaflow-auto-update", daemon=True
    )
    t.start()
    return stop_event
