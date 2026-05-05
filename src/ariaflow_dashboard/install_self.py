"""Detection helpers for ariaflow-dashboard self-management.

Mirrors the backend's BG-43 design (`packages/core/src/install/ariaflow_self.ts`):
two orthogonal axes describe how the running dashboard process is supervised
and how it was installed. The lifecycle action handler in `webapp.py` uses
these to dispatch Restart and Update via the appropriate supervisor /
package manager.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Literal, Mapping, Optional

# Use typing.Optional rather than `T | None` so the module imports under
# Python 3.9 too (the Homebrew bottle picks up the system python on
# macOS, which is 3.9 — pyproject says >=3.10 but the installed runner
# isn't always honored).
ManagedBy = Optional[Literal["launchd", "systemd", "docker", "external"]]
InstalledVia = Optional[Literal["homebrew", "pipx", "pip", "source"]]

# Brew formula name + the spec's generic plist label.
_LAUNCHD_LABELS = ("homebrew.mxcl.ariaflow-dashboard", "com.ariaflow-dashboard")


def detect_managed_by(env: Mapping[str, str] | None = None) -> ManagedBy:
    """Detect who supervises this process.

    Mirror of backend's `detectAriaflowManagedBy()`. PPID==1 on macOS means
    launchd is our parent; on Linux it could be init or systemd. We
    disambiguate via filesystem signals.
    """
    env = env if env is not None else os.environ  # type: ignore[assignment]
    if Path("/.dockerenv").exists():
        return "docker"
    ppid = os.getppid()
    if sys.platform == "darwin":
        agents = Path.home() / "Library/LaunchAgents"
        plist_found = any(
            (agents / f"{label}.plist").exists() for label in _LAUNCHD_LABELS
        )
        if plist_found and ppid == 1:
            return "launchd"
    if sys.platform.startswith("linux") and env.get("INVOCATION_ID") and ppid == 1:
        return "systemd"
    if ppid >= 1:
        return "external"
    return None


def detect_installed_via(
    argv_script: str | None = None,
    env: Mapping[str, str] | None = None,
) -> InstalledVia:
    """Detect how this process was installed.

    Resolved from `sys.argv[0]` (the entry script). The backend resolves
    from `process.argv[1]` because Node has the interpreter at [0]; Python
    has the script at [0].
    """
    env = env if env is not None else os.environ  # type: ignore[assignment]
    assert env is not None
    script = argv_script if argv_script is not None else (sys.argv[0] or "")
    if not script:
        return None
    brew_prefix = env.get("HOMEBREW_PREFIX") or (
        "/opt/homebrew" if sys.platform == "darwin" else "/home/linuxbrew/.linuxbrew"
    )
    if script.startswith(f"{brew_prefix}/") or "/Cellar/ariaflow-dashboard/" in script:
        return "homebrew"
    if "/.local/pipx/venvs/" in script:
        return "pipx"
    # pip in a system or user site-packages — heuristic, narrower than pipx.
    if "/site-packages/" in script:
        return "pip"
    if _is_inside_git_tree(script):
        return "source"
    return None


def _is_inside_git_tree(file_path: str) -> bool:
    p = Path(file_path).parent
    for _ in range(8):
        if (p / ".git").exists():
            return True
        if p.parent == p:
            return False
        p = p.parent
    return False


def detect_launchd_label() -> str | None:
    """Return the actually-installed plist label, used to construct the
    `gui/$UID/<label>` argument to `launchctl kickstart`. Returns None when
    no plist exists.
    """
    agents = Path.home() / "Library/LaunchAgents"
    for label in _LAUNCHD_LABELS:
        if (agents / f"{label}.plist").exists():
            return label
    return None


def dispatch_restart() -> dict:
    """Plan + execute a restart per detected supervisor.

    Returns a dict shaped like the backend's response (`{ok, action,
    managed_by, ...}`). Side effects run after the response is sent —
    callers should send the body, then invoke the returned `after`
    callable.
    """
    managed_by = detect_managed_by()
    if managed_by == "launchd":
        label = detect_launchd_label()
        if label is None:
            return {"ok": False, "status": 409, "error": "launchd_label_missing"}
        return {
            "ok": True,
            "status": 202,
            "action": "restart",
            "managed_by": "launchd",
            "after": lambda: _detached(
                "launchctl", ["kickstart", "-k", f"gui/{os.getuid()}/{label}"]
            ),
        }
    if managed_by == "systemd":
        return {
            "ok": True,
            "status": 202,
            "action": "restart",
            "managed_by": "systemd",
            "after": lambda: _detached(
                "systemctl", ["--user", "restart", "ariaflow-dashboard"]
            ),
        }
    if managed_by == "docker":
        # In docker the orchestrator owns relaunch — exit and let it
        # restart us (assumes restart policy: always/unless-stopped).
        return {
            "ok": True,
            "status": 202,
            "action": "restart",
            "managed_by": "docker",
            "after": lambda: os._exit(0),
        }
    # No supervisor we recognize — re-exec ourselves. Python can do this
    # in-process; backend's Node equivalent has to rely on a supervisor
    # because forking a Node process is expensive and lossy.
    return {
        "ok": True,
        "status": 202,
        "action": "restart",
        "managed_by": managed_by,
        "after": lambda: os.execv(sys.executable, [sys.executable, *sys.argv]),
    }


def dispatch_update() -> dict:
    """Plan + execute an update per detected installer."""
    installed_via = detect_installed_via()
    if installed_via == "homebrew":
        return {
            "ok": True,
            "status": 202,
            "action": "update",
            "installed_via": "homebrew",
            "after": lambda: _detached("brew", ["upgrade", "ariaflow-dashboard"]),
        }
    if installed_via == "pipx":
        return {
            "ok": True,
            "status": 202,
            "action": "update",
            "installed_via": "pipx",
            "after": lambda: _detached("pipx", ["upgrade", "ariaflow-dashboard"]),
        }
    if installed_via == "pip":
        return {
            "ok": True,
            "status": 202,
            "action": "update",
            "installed_via": "pip",
            "after": lambda: _detached(
                sys.executable, ["-m", "pip", "install", "-U", "ariaflow-dashboard"]
            ),
        }
    if installed_via == "source":
        return {
            "ok": False,
            "status": 409,
            "error": "source_install",
            "installed_via": "source",
            "message": "running from a git checkout — operator runs git pull",
        }
    return {
        "ok": False,
        "status": 409,
        "error": "unknown_installer",
        "installed_via": None,
        "message": "could not detect an installer for this process",
    }


def _detached(cmd: str, args: list[str]) -> None:
    subprocess.Popen(  # noqa: S603
        [cmd, *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
