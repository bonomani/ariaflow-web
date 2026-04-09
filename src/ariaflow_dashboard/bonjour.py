"""Bonjour/mDNS discovery for ariaflow backends.

Browse and resolve _ariaflow._tcp services on the local network.
Uses dns-sd (macOS/Windows) or avahi-browse (Linux).
"""
from __future__ import annotations

import platform
import re
import shutil
import socket
import subprocess


_SERVICE_TYPE = "_ariaflow._tcp"
_DOMAIN = "local"

# dns-sd -B output columns: Timestamp A/R Flags if Domain ServiceType InstanceName
# Example: " 1:14:41.123  Add  3  4  local.  _ariaflow._tcp.  bc's Mac16,11 AriaFlow"
_BROWSE_RE = re.compile(r"\bAdd\b.*\s_ariaflow\._tcp\.\s+(.*\S)\s*$")
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
    """Run a long-running command (e.g. dns-sd) and collect its output for `timeout` seconds.

    Uses Popen + line-by-line read in a background thread so we reliably
    capture partial output even when the process never exits.
    """
    import threading
    import time as _time
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # line-buffered
        )
    except (FileNotFoundError, PermissionError):
        return ""

    lines: list[str] = []

    def _reader(stream) -> None:
        try:
            for line in iter(stream.readline, ""):
                lines.append(line)
        except Exception:
            pass

    t_out = threading.Thread(target=_reader, args=(proc.stdout,), daemon=True)
    t_err = threading.Thread(target=_reader, args=(proc.stderr,), daemon=True)
    t_out.start()
    t_err.start()

    _time.sleep(timeout)

    try:
        proc.terminate()
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass

    t_out.join(timeout=0.5)
    t_err.join(timeout=0.5)
    return "".join(lines)


def _parse_txt(output: str) -> dict[str, str]:
    """Extract TXT record key=value pairs from dns-sd or avahi output."""
    return dict(_TXT_RE.findall(output))


def _resolve_to_ip(host: str) -> str | None:
    """Resolve a .local hostname to an IPv4 address. Returns None if resolution fails."""
    try:
        # Prefer IPv4 for URL building; browsers have issues with link-local IPv6
        results = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
        if results:
            addr = results[0][4][0]
            return str(addr) if addr else None
    except (socket.gaierror, OSError):
        pass
    return None


# ---------------------------------------------------------------------------
# Local machine identity (hostname, interfaces, primary IP)
# ---------------------------------------------------------------------------

def local_hostname() -> str:
    """Return the short local hostname (e.g. 'bc-mac-mini')."""
    try:
        return platform.node().split(".")[0] or "localhost"
    except Exception:
        return "localhost"


def main_local_ip() -> str:
    """Return the primary LAN IP via the UDP socket trick.

    Connecting a UDP socket to a public address forces the OS to select the
    default outbound interface without sending any packets.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return str(s.getsockname()[0])
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def all_local_ips() -> list[str]:
    """Return all non-loopback IPv4 addresses on this machine."""
    ips: set[str] = set()
    main = main_local_ip()
    if main and not main.startswith("127."):
        ips.add(main)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = str(info[4][0])
            if ip and not ip.startswith("127."):
                ips.add(ip)
    except (socket.gaierror, OSError):
        pass
    return sorted(ips)


def local_identity() -> dict[str, object]:
    """Bundle hostname + main IP + all non-loopback IPv4s for the local host."""
    main = main_local_ip()
    return {
        "hostname": local_hostname(),
        "main_ip": main,
        "ips": all_local_ips(),
    }


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
            # Resolve .local hostname to IP — works in networking contexts
            # where mDNS hostname resolution is unavailable (WSL, containers).
            ip = _resolve_to_ip(host) if host.endswith(".local") else host
            url_host = ip or host
            return {
                "name": name,
                "host": host,
                "ip": ip,
                "port": port,
                "url": f"{scheme}://{url_host}:{port}",
                "path": path,
                "role": txt.get("role"),
                "product": txt.get("product"),
                "version": txt.get("version"),
                "txt_hostname": txt.get("hostname"),
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
        ip = match.group(3)  # avahi-browse already resolved to IP
        port = int(match.group(4))
        txt_raw = match.group(5)
        txt = _parse_txt(txt_raw)
        key = f"{ip}:{port}"
        if key in seen:
            continue
        seen.add(key)
        path = txt.get("path", "/")
        tls = txt.get("tls", "0")
        scheme = "https" if tls == "1" else "http"
        url_host = ip or host
        items.append({
            "name": name,
            "host": host,
            "ip": ip,
            "port": port,
            "url": f"{scheme}://{url_host}:{port}",
            "path": path,
            "role": txt.get("role"),
            "product": txt.get("product"),
            "version": txt.get("version"),
            "txt_hostname": txt.get("hostname"),
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
