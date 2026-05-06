"""Detection helpers for ariaflow-dashboard self-management.

Mirrors the backend's BG-43 design (`packages/core/src/install/ariaflow_self.ts`):
two orthogonal axes describe how the running dashboard process is supervised
and how it was installed. The lifecycle action handler in `webapp.py` uses
these to dispatch Restart and Update via the appropriate supervisor /
package manager.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Literal, Mapping, Optional

# Common install paths for package managers; checked when the resolved
# launchd / systemd PATH doesn't include the brew prefix. macOS launchd
# in particular ships a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
# which excludes /opt/homebrew/bin.
_PKG_MANAGER_PATHS = (
    "/opt/homebrew/bin",      # macOS Apple Silicon
    "/usr/local/bin",         # macOS Intel + Linuxbrew
    "/home/linuxbrew/.linuxbrew/bin",
    str(Path.home() / ".local/bin"),
)


def _resolve_pkg_manager(name: str) -> str:
    """Find the absolute path to a package manager binary.

    The dashboard process may inherit a stripped PATH from its
    supervisor (launchd, systemd) — `which brew` returns nothing even
    though brew is installed. Search PATH first (cheap), then known
    install locations.
    """
    found = shutil.which(name)
    if found:
        return found
    for d in _PKG_MANAGER_PATHS:
        candidate = Path(d) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    # Fall through with the bare name; subprocess will raise
    # FileNotFoundError, the caller's try/except already handles it.
    return name

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
        # `launchctl kickstart -k <label>` is supposed to kill+restart
        # but silently no-ops in some plist configurations (observed
        # live: process kept running with stale code after click).
        # Reliable hammer: bootout + bootstrap of the plist file.
        # Falls back to kickstart only if the plist isn't where we
        # expect.
        plist_path = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
        target = f"gui/{os.getuid()}/{label}"
        if plist_path.is_file():
            after = lambda: _restart_via_bootstrap(target, str(plist_path), label)  # noqa: E731
        else:
            after = lambda: _detached("launchctl", ["kickstart", "-k", target])  # noqa: E731
        return {
            "ok": True,
            "status": 202,
            "action": "restart",
            "managed_by": "launchd",
            "after": after,
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


def dispatch_update(auto_restart: bool = False) -> dict:
    """Plan + execute an update per detected installer.

    When auto_restart=True and we're under launchd, chain the upgrade
    and a bootout+bootstrap restart into one detached shell so the
    new bottle is running before the operator's next request hits a
    stale-cellar 404.
    """
    installed_via = detect_installed_via()

    def _chain_restart(upgrade_cmd: str) -> str:
        """Build a shell snippet that runs the upgrade, then restarts
        via launchd if applicable. Falls back to upgrade-only when no
        managed supervisor is detected (the operator can restart
        manually)."""
        if not auto_restart:
            return upgrade_cmd
        managed_by = detect_managed_by()
        if managed_by != "launchd":
            return upgrade_cmd
        label = detect_launchd_label()
        if not label:
            return upgrade_cmd
        plist_path = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
        if not plist_path.is_file():
            return upgrade_cmd
        target = f"gui/{os.getuid()}/{label}"
        domain = f"gui/{os.getuid()}"
        # Update means 'fix me to latest running state' — full pipeline:
        # try upgrade (no-op when already current), then ALWAYS restart
        # via bootout+bootstrap. Restart-after-no-op-upgrade picks up
        # the stale-cellar case where running version ≠ installed
        # version but tap has nothing newer. Operator's mental model:
        # Update = 'whatever it takes', Restart = just bounce.
        return (
            f"{upgrade_cmd}; "
            f"launchctl bootout {target} 2>/dev/null; "
            f"launchctl bootstrap {domain} {plist_path}"
        )

    if installed_via == "homebrew":
        brew = _resolve_pkg_manager("brew")
        upgrade = f"{brew} upgrade ariaflow-dashboard"
        return {
            "ok": True,
            "status": 202,
            "action": "update",
            "installed_via": "homebrew",
            "auto_restart": auto_restart,
            "after": lambda: _detached("sh", ["-c", _chain_restart(upgrade)]),
        }
    if installed_via == "pipx":
        pipx = _resolve_pkg_manager("pipx")
        upgrade = f"{pipx} upgrade ariaflow-dashboard"
        return {
            "ok": True,
            "status": 202,
            "action": "update",
            "installed_via": "pipx",
            "auto_restart": auto_restart,
            "after": lambda: _detached("sh", ["-c", _chain_restart(upgrade)]),
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


def check_for_update() -> dict:
    """Probe the package manager to see if an update is available.

    Read-only — does NOT dispatch the upgrade.

    Homebrew: runs `brew update` (refreshes the tap from GitHub) THEN
    `brew outdated`. Without the update step the tap clone is stale
    and `brew outdated` reports the cached "latest", missing recent
    releases. The update step is ~1-3s on a warm cache.
    """
    from . import __version__

    installed_via = detect_installed_via()
    current = __version__
    if installed_via == "homebrew":
        try:
            brew = _resolve_pkg_manager("brew")
            # Force a real tap refresh on every check. brew update
            # normally throttles itself via HOMEBREW_AUTO_UPDATE_SECS
            # (default 300s) — back-to-back manual checks would read
            # stale formula. Setting the var to 0 in the subprocess env
            # forces it to actually pull. macOS launchd may also strip
            # the env, so set HOME explicitly so brew can find its
            # config / cache dirs.
            env = {**os.environ, "HOMEBREW_AUTO_UPDATE_SECS": "0"}
            subprocess.run(  # noqa: S603
                [brew, "update"],
                capture_output=True, text=True, timeout=30, check=False, env=env,
            )
            out = subprocess.run(  # noqa: S603
                [brew, "outdated", "--json", "--formula", "ariaflow-dashboard"],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            import json as _json

            data = _json.loads(out.stdout or "{}")
            outdated = data.get("formulae") or []
            if outdated:
                latest = outdated[0].get("current_version") or "?"
                return {
                    "ok": True,
                    "update_available": True,
                    "installed_via": "homebrew",
                    "current_version": current,
                    "latest_version": latest,
                }
            return {
                "ok": True,
                "update_available": False,
                "installed_via": "homebrew",
                "current_version": current,
            }
        except (subprocess.TimeoutExpired, FileNotFoundError, ValueError) as e:
            return {"ok": False, "error": "probe_failed", "message": str(e)}
    if installed_via == "pipx":
        return {
            "ok": True,
            "update_available": None,
            "installed_via": "pipx",
            "current_version": current,
            "message": "pipx update probe not implemented; run `pipx upgrade ariaflow-dashboard` manually",
        }
    if installed_via == "source":
        return {
            "ok": False,
            "error": "source_install",
            "message": "running from a git checkout — check via git pull",
        }
    return {
        "ok": False,
        "error": "unknown_installer",
        "message": "could not detect an installer for this process",
    }


def _restart_via_bootstrap(target: str, plist_path: str, label: str) -> None:
    """Reliable launchd restart: bootout the running service then
    bootstrap from the plist. Equivalent to the legacy
    `launchctl unload && launchctl load` sequence the operator found
    works when `kickstart -k` doesn't.

    Runs the whole sequence in one detached `sh -c` so we don't have
    to chain Popens through the dashboard process (which is itself
    being killed). Fire-and-forget; launchd handles the rest.
    """
    domain = target.rsplit("/", 1)[0]  # "gui/<uid>"
    cmd = (
        f"launchctl bootout {target} 2>/dev/null; "
        f"launchctl bootstrap {domain} {plist_path}"
    )
    _detached("sh", ["-c", cmd])


def detect_server_installed_via() -> InstalledVia:
    """Detect how (or if) ariaflow-server is installed locally.

    Probes the package manager — does NOT require ariaflow-server to be
    running. This is what enables the dashboard to install the server
    when no backend is reachable (cold-start).
    """
    brew = shutil.which("brew") or _resolve_pkg_manager("brew")
    if brew and brew != "brew":
        try:
            out = subprocess.run(  # noqa: S603
                [brew, "list", "--formula", "--versions", "ariaflow-server"],
                capture_output=True, text=True, timeout=5, check=False,
            )
            if out.returncode == 0 and out.stdout.strip():
                return "homebrew"
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            pass
    pipx = shutil.which("pipx") or _resolve_pkg_manager("pipx")
    if pipx and pipx != "pipx":
        try:
            out = subprocess.run(  # noqa: S603
                [pipx, "list", "--short"],
                capture_output=True, text=True, timeout=5, check=False,
            )
            if "ariaflow-server" in (out.stdout or ""):
                return "pipx"
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            pass
    return None


def dispatch_server_lifecycle(action: str) -> dict:
    """Plan + execute install / uninstall / update for ariaflow-server.

    Mirrors dispatch_update but targets the server formula. Channel is
    coupled to the dashboard's own installer (homebrew dashboard →
    homebrew server) to avoid mixed-channel installs at upgrade time.
    """
    if action not in ("install", "uninstall", "update"):
        return {"ok": False, "status": 400, "error": "unsupported_action"}
    dash_via = detect_installed_via()
    if dash_via == "source":
        return {
            "ok": False,
            "status": 409,
            "error": "source_install",
            "message": "dashboard is a git checkout — manage server manually",
        }
    if dash_via == "homebrew":
        brew = _resolve_pkg_manager("brew")
        if action == "install":
            cmd = f"{brew} install bonomani/ariaflow/ariaflow-server"
        elif action == "uninstall":
            cmd = f"{brew} uninstall ariaflow-server"
        else:
            cmd = f"{brew} upgrade ariaflow-server"
        return {
            "ok": True,
            "status": 202,
            "action": action,
            "target": "ariaflow-server",
            "installed_via": "homebrew",
            "after": lambda: _detached("sh", ["-c", cmd]),
        }
    if dash_via == "pipx":
        pipx = _resolve_pkg_manager("pipx")
        if action == "install":
            cmd = f"{pipx} install ariaflow-server"
        elif action == "uninstall":
            cmd = f"{pipx} uninstall ariaflow-server"
        else:
            cmd = f"{pipx} upgrade ariaflow-server"
        return {
            "ok": True,
            "status": 202,
            "action": action,
            "target": "ariaflow-server",
            "installed_via": "pipx",
            "after": lambda: _detached("sh", ["-c", cmd]),
        }
    return {
        "ok": False,
        "status": 409,
        "error": "unknown_installer",
        "message": "could not detect a supported installer (homebrew/pipx) for the dashboard",
    }


def _server_plist_path() -> Optional[Path]:
    """Locate the launchd plist for ariaflow-server. None if not present."""
    candidates = (
        "homebrew.mxcl.ariaflow-server",
        "com.ariaflow-server",
    )
    agents = Path.home() / "Library" / "LaunchAgents"
    for label in candidates:
        p = agents / f"{label}.plist"
        if p.is_file():
            return p
    return None


def server_lifecycle_probe() -> dict:
    """Snapshot of ariaflow-server's local install state.

    Used by the FE to decide which buttons to render: Install (when
    not installed), Bootstrap (when installed but not loaded into
    launchd), Uninstall + Update (when running).
    """
    via = detect_server_installed_via()
    plist = _server_plist_path()
    return {
        "ok": True,
        "installed": via is not None,
        "installed_via": via,
        "install_supported": detect_installed_via() in ("homebrew", "pipx"),
        "plist_present": plist is not None,
        "plist_path": str(plist) if plist else None,
    }


def dispatch_server_bootstrap() -> dict:
    """Re-load the server into launchd via `brew services restart` —
    the same primitive brew itself uses. Handles: plist symlink
    re-creation, launchctl bootstrap into the right user domain,
    legacy launchctl/bootstrap-API fallbacks across macOS versions.

    Recovery path for the case where the server's been bootout'd but
    never bootstrap'd — process is down, plist is on disk, only a
    proper launchctl bootstrap revives it. Operator needs no terminal
    access.
    """
    plist = _server_plist_path()
    if plist is None:
        return {
            "ok": False,
            "status": 409,
            "error": "plist_missing",
            "message": "no ariaflow-server launchd plist found in ~/Library/LaunchAgents",
        }
    if detect_installed_via() != "homebrew":
        # `brew services` is brew-only; for non-brew installs fall
        # back to the raw launchctl chain.
        domain = f"gui/{os.getuid()}"
        cmd = (
            f"launchctl bootout {domain}/{plist.stem} 2>/dev/null; "
            f"launchctl bootstrap {domain} {plist}"
        )
        return {
            "ok": True, "status": 202, "action": "bootstrap",
            "target": "ariaflow-server", "plist_path": str(plist),
            "after": lambda: _detached("sh", ["-c", cmd]),
        }
    brew = _resolve_pkg_manager("brew")
    return {
        "ok": True,
        "status": 202,
        "action": "bootstrap",
        "target": "ariaflow-server",
        "plist_path": str(plist),
        "after": lambda: _detached(brew, ["services", "restart", "ariaflow-server"]),
    }


def _detached(cmd: str, args: list[str]) -> None:
    subprocess.Popen(  # noqa: S603
        [cmd, *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
