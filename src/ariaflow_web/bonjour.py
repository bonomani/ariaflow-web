from __future__ import annotations

import os
import platform
import re
import shlex
import shutil
import subprocess
from contextlib import contextmanager
from typing import Iterator


_SERVICE_TYPE = "_ariaflow._tcp"
_DOMAIN = "local"
_REACHABLE_RE = re.compile(r"can be reached at ([^\s]+)\.\s*:(\d+)")
_BROWSE_RE = re.compile(r"\bAdd\b.*\s_ariaflow\._tcp\.\s+\S+\s+(.*\S)\s*$")
_TXT_PATH_RE = re.compile(r'"path=([^"]+)"')
_TXT_ROLE_RE = re.compile(r'"role=([^"]+)"')
_TXT_PRODUCT_RE = re.compile(r'"product=([^"]+)"')


def _dns_sd_path() -> str | None:
    return shutil.which("dns-sd")


def bonjour_available() -> bool:
    return platform.system() == "Darwin" and _dns_sd_path() is not None


def _service_name(role: str, port: int) -> str:
    host = os.uname().nodename.split(".")[0] or "localhost"
    return f"ariaflow {role} {host} {port}"


def _txt_records(*, role: str, path: str, product: str, version: str) -> list[str]:
    return [
        f"role={role}",
        f"path={path}",
        f"product={product}",
        f"version={version}",
        "proto=http",
    ]


@contextmanager
def advertise_http_service(*, role: str, port: int, path: str, product: str, version: str) -> Iterator[None]:
    if not bonjour_available():
        yield
        return
    cmd = [
        _dns_sd_path() or "dns-sd",
        "-R",
        _service_name(role, port),
        _SERVICE_TYPE,
        _DOMAIN,
        str(port),
        *(_txt_records(role=role, path=path, product=product, version=version)),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        yield
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)


def _browse_service_names(timeout: float = 1.5) -> list[str]:
    if not bonjour_available():
        return []
    cmd = [_dns_sd_path() or "dns-sd", "-B", _SERVICE_TYPE, _DOMAIN]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        output = str(exc.stdout or "") + "\n" + str(exc.stderr or "")
    else:
        output = (completed.stdout or "") + "\n" + (completed.stderr or "")
    names: list[str] = []
    for line in output.splitlines():
        match = _BROWSE_RE.search(line.strip())
        if match:
            names.append(match.group(1).strip())
    return list(dict.fromkeys(names))


def _resolve_service(name: str, timeout: float = 1.5) -> dict[str, object] | None:
    cmd = [_dns_sd_path() or "dns-sd", "-L", name, _SERVICE_TYPE, _DOMAIN]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        output = str(exc.stdout or "") + "\n" + str(exc.stderr or "")
    else:
        output = (completed.stdout or "") + "\n" + (completed.stderr or "")
    host = None
    port = None
    for line in output.splitlines():
        match = _REACHABLE_RE.search(line)
        if match:
            host = match.group(1).rstrip(".")
            port = int(match.group(2))
            break
    if not host or not port:
        return None
    path_match = _TXT_PATH_RE.search(output)
    role_match = _TXT_ROLE_RE.search(output)
    product_match = _TXT_PRODUCT_RE.search(output)
    url = f"http://{host}:{port}"
    return {
        "name": name,
        "host": host,
        "port": port,
        "url": url,
        "path": path_match.group(1) if path_match else "/",
        "role": role_match.group(1) if role_match else None,
        "product": product_match.group(1) if product_match else None,
        "service_type": _SERVICE_TYPE,
        "domain": _DOMAIN,
        "command": " ".join(shlex.quote(part) for part in cmd),
    }


def discover_http_services(timeout: float = 1.5) -> dict[str, object]:
    if not bonjour_available():
        return {"available": False, "items": [], "reason": "dns_sd_unavailable"}
    items = [resolved for name in _browse_service_names(timeout=timeout) if (resolved := _resolve_service(name, timeout=timeout))]
    return {"available": True, "items": items, "reason": "ok"}
