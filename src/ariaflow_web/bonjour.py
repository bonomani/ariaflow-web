"""Bonjour/mDNS discovery for ariaflow backends.

Browse and resolve _ariaflow._tcp services on the local network.
Uses dns-sd (macOS/Windows) or avahi-browse (Linux).
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess


_SERVICE_TYPE = "_ariaflow._tcp"
_DOMAIN = "local"

# dns-sd -B output: "Add ... _ariaflow._tcp. local. <instance name>"
_BROWSE_RE = re.compile(r"\bAdd\b.*\s_ariaflow\._tcp\.\s+\S+\s+(.*\S)\s*$")
# dns-sd -L output: "can be reached at <host>:<port>"
_RESOLVE_HOST_RE = re.compile(r"can be reached at ([^\s]+)\.\s*:(\d+)")
# TXT record fields
_TXT_RE = re.compile(r'"(\w+)=([^"]*)"')


def _dns_sd_path() -> str | None:
    return shutil.which("dns-sd") or shutil.which("dns-sd.exe")


def _avahi_browse_path() -> str | None:
    return shutil.which("avahi-browse")


def _backend() -> str | None:
    system = platform.system()
    if system in ("Darwin", "Windows") and _dns_sd_path():
        return "dns-sd"
    if system == "Linux" and _avahi_browse_path():
        return "avahi"
    return None


def _run_timeout(cmd: list[str], timeout: float) -> str:
    """Run a command that never terminates on its own (dns-sd style)."""
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return (completed.stdout or "") + "\n" + (completed.stderr or "")
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        return stdout + "\n" + stderr


def _parse_txt(output: str) -> dict[str, str]:
    """Extract TXT record key=value pairs from dns-sd or avahi output."""
    return dict(_TXT_RE.findall(output))


# ---------------------------------------------------------------------------
# dns-sd (macOS / Windows)
# ---------------------------------------------------------------------------

def _dnssd_browse(timeout: float) -> list[str]:
    binary = _dns_sd_path()
    if not binary:
        return []
    output = _run_timeout([binary, "-B", _SERVICE_TYPE, _DOMAIN], timeout)
    names: list[str] = []
    for line in output.splitlines():
        match = _BROWSE_RE.search(line.strip())
        if match:
            names.append(match.group(1).strip())
    return list(dict.fromkeys(names))


def _dnssd_resolve(name: str, timeout: float) -> dict[str, object] | None:
    binary = _dns_sd_path()
    if not binary:
        return None
    output = _run_timeout([binary, "-L", name, _SERVICE_TYPE, _DOMAIN], timeout)
    for line in output.splitlines():
        match = _RESOLVE_HOST_RE.search(line)
        if match:
            host = match.group(1).rstrip(".")
            port = int(match.group(2))
            txt = _parse_txt(output)
            path = txt.get("path", "/")
            tls = txt.get("tls", "0")
            scheme = "https" if tls == "1" else "http"
            return {
                "name": name,
                "host": host,
                "port": port,
                "url": f"{scheme}://{host}:{port}",
                "path": path,
                "role": txt.get("role"),
                "product": txt.get("product"),
                "version": txt.get("version"),
            }
    return None


def _dnssd_discover(timeout: float) -> list[dict[str, object]]:
    items = []
    for name in _dnssd_browse(timeout):
        resolved = _dnssd_resolve(name, timeout)
        if resolved:
            items.append(resolved)
    return items


# ---------------------------------------------------------------------------
# avahi (Linux)
# ---------------------------------------------------------------------------

# avahi-browse -rpt output:
# =;eth0;IPv4;instance name;_ariaflow._tcp;local;hostname.local;192.168.1.x;8080;"path=/api" "tls=0"
_AVAHI_RESOLVE_RE = re.compile(
    r'^=;[^;]*;[^;]*;([^;]*);_ariaflow\._tcp;[^;]*;([^;]*);([^;]*);(\d+);(.*)$'
)


def _avahi_discover(timeout: float) -> list[dict[str, object]]:
    binary = _avahi_browse_path()
    if not binary:
        return []
    try:
        completed = subprocess.run(
            [binary, "-rpt", _SERVICE_TYPE],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        output = completed.stdout or ""
    except subprocess.TimeoutExpired as exc:
        output = str(exc.stdout or "")
    items: list[dict[str, object]] = []
    seen: set[str] = set()
    for line in output.splitlines():
        match = _AVAHI_RESOLVE_RE.match(line.strip())
        if not match:
            continue
        name = match.group(1)
        host = match.group(2).rstrip(".")
        port = int(match.group(4))
        txt_raw = match.group(5)
        txt = _parse_txt(txt_raw)
        key = f"{host}:{port}"
        if key in seen:
            continue
        seen.add(key)
        path = txt.get("path", "/")
        tls = txt.get("tls", "0")
        scheme = "https" if tls == "1" else "http"
        items.append({
            "name": name,
            "host": host,
            "port": port,
            "url": f"{scheme}://{host}:{port}",
            "path": path,
            "role": txt.get("role"),
            "product": txt.get("product"),
            "version": txt.get("version"),
        })
    return items


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def discover_http_services(timeout: float = 3.0) -> dict[str, object]:
    """Discover ariaflow backends on the local network via mDNS."""
    be = _backend()
    if be is None:
        return {"available": False, "items": [], "reason": "no_mdns_tool"}
    if be == "avahi":
        items = _avahi_discover(timeout)
    else:
        items = _dnssd_discover(timeout)
    return {"available": True, "items": items, "reason": "ok"}
