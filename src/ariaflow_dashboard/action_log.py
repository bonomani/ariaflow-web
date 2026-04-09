"""Action log for ariaflow-dashboard HTTP server.

Same format as the backend (actions.jsonl) — append-only JSONL with
record_action(action, target, outcome, ...) interface.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

_MAX_LINES = 2000
_KEEP_LINES = 1000
_lock = threading.Lock()


def _log_path() -> Path:
    """Action log file path — next to the process working directory."""
    return Path(os.environ.get("ARIAFLOW_DASHBOARD_LOG", "ariaflow-dashboard-actions.jsonl"))


def _rotate() -> None:
    path = _log_path()
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return
    if size < 256 * 1024:
        return
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) <= _MAX_LINES:
        return
    path.write_text("\n".join(lines[-_KEEP_LINES:]) + "\n", encoding="utf-8")


def record_action(
    *,
    action: str,
    target: str,
    outcome: str,
    observation: str = "ok",
    reason: str = "",
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append an action entry to the log. Same schema as backend."""
    entry: dict[str, Any] = {
        "action": action,
        "target": target,
        "outcome": outcome,
        "observation": observation,
        "reason": reason,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": "ariaflow-dashboard",
    }
    if detail is not None:
        entry["detail"] = detail
    with _lock:
        with _log_path().open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")
        _rotate()
    return entry


def load_action_log(limit: int = 200) -> list[dict[str, Any]]:
    """Read the last N log entries."""
    with _lock:
        path = _log_path()
        if not path.exists():
            return []
        lines = path.read_text(encoding="utf-8").splitlines()
        entries: list[dict[str, Any]] = []
        for line in lines[-limit:]:
            if not line.strip():
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return entries
