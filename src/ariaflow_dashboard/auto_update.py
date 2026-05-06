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

from .action_log import record_action
from .install_self import detect_installed_via, dispatch_update

CONFIG_DIR = Path.home() / ".ariaflow-dashboard"
CONFIG_PATH = CONFIG_DIR / "config.json"

DEFAULTS: dict[str, Any] = {
    "auto_update": False,
    "auto_update_check_hours": 24,
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
    # Type coercion + bounds
    cfg["auto_update"] = bool(cfg.get("auto_update", False))
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
    # Re-coerce after merge.
    current["auto_update"] = bool(current["auto_update"])
    try:
        hours = int(current.get("auto_update_check_hours", 24))
    except (TypeError, ValueError):
        hours = 24
    current["auto_update_check_hours"] = max(1, min(720, hours))
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def _run_check_once() -> None:
    """One iteration: skip if disabled, otherwise dispatch update."""
    cfg = load_config()
    if not cfg["auto_update"]:
        return
    via = detect_installed_via()
    if via in (None, "source"):
        # Skip — no upgrade channel for source / unknown installs.
        record_action(
            action="auto_update_skip",
            target="ariaflow-dashboard",
            outcome="unchanged",
            reason="no_upgrade_channel",
            detail={"installed_via": via},
        )
        return
    plan = dispatch_update()
    if plan.get("ok"):
        record_action(
            action="auto_update_dispatch",
            target="ariaflow-dashboard",
            outcome="changed",
            reason="periodic",
            detail={"installed_via": plan.get("installed_via")},
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
