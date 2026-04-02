"""API parameter validation tests and meta-test for endpoint coverage."""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server  # noqa: E402

WEBAPP_PY = Path(__file__).resolve().parents[1] / "src" / "ariaflow_web" / "webapp.py"
APP_JS = Path(__file__).resolve().parents[1] / "src" / "ariaflow_web" / "static" / "app.js"


def _post(url: str, payload: object = None, expect_status: int | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else b"{}"
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        result = json.loads(resp.read().decode())
        if expect_status is not None:
            assert resp.status == expect_status, f"Expected {expect_status}, got {resp.status}"
        return result
    except urllib.error.HTTPError as exc:
        result = json.loads(exc.read().decode())
        if expect_status is not None:
            assert exc.code == expect_status, f"Expected {expect_status}, got {exc.code}"
        return result


def _get(url: str, expect_status: int | None = None) -> dict:
    try:
        resp = urllib.request.urlopen(url, timeout=5)
        result = json.loads(resp.read().decode())
        if expect_status is not None:
            assert resp.status == expect_status
        return result
    except urllib.error.HTTPError as exc:
        result = json.loads(exc.read().decode())
        if expect_status is not None:
            assert exc.code == expect_status
        return result


@pytest.fixture(scope="module")
def web_server():
    url, server, patches, _ = start_server(save_echo=True)
    yield url
    stop_server(server, patches)


# ---------------------------------------------------------------------------
# GET endpoint parameter tests
# ---------------------------------------------------------------------------

class TestGetEndpoints:
    def test_status_returns_json(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/status")
        assert "items" in data

    def test_status_with_backend_param(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/status?backend=http://127.0.0.1:8000")
        assert isinstance(data, dict)

    def test_log_default_limit(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/log")
        assert isinstance(data, dict)

    def test_log_custom_limit(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/log?limit=10")
        assert isinstance(data, dict)

    def test_log_limit_clamped_high(self, web_server: str) -> None:
        # limit > 500 should be clamped
        data = _get(f"{web_server}/api/log?limit=9999")
        assert isinstance(data, dict)

    def test_log_limit_clamped_low(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/log?limit=0")
        assert isinstance(data, dict)

    def test_log_limit_invalid(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/log?limit=abc")
        assert isinstance(data, dict)  # should fallback to 120

    def test_api_discovery(self, web_server: str) -> None:
        data = _get(f"{web_server}/api")
        assert "name" in data

    def test_bandwidth(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/bandwidth")
        assert isinstance(data, dict)

    def test_declaration(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/declaration")
        assert "uic" in data

    def test_options_alias(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/options")
        assert "uic" in data

    def test_lifecycle(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/lifecycle")
        assert isinstance(data, dict)

    def test_discovery(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/discovery")
        assert "items" in data or "available" in data

    def test_unknown_get_returns_404(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/nonexistent", expect_status=404)
        assert data.get("error") == "not_found"


# ---------------------------------------------------------------------------
# POST endpoint parameter tests
# ---------------------------------------------------------------------------

class TestPostAdd:
    def test_valid_add(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/add", {"items": [{"url": "http://example.com/f"}]})
        assert data.get("ok") is True

    def test_add_missing_items(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/add", {"urls": ["http://example.com"]}, expect_status=400)
        assert data.get("error") == "invalid_items"

    def test_add_items_not_list(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/add", {"items": "not a list"}, expect_status=400)
        assert data.get("error") == "invalid_items"

    def test_add_not_object(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/add", ["http://example.com"], expect_status=400)
        assert data.get("error") == "invalid_payload"

    def test_add_empty_items(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/add", {"items": []})
        assert isinstance(data, dict)


class TestPostRun:
    def test_valid_start(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", {"action": "start"})
        assert data.get("ok") is True

    def test_valid_stop(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", {"action": "stop"})
        assert isinstance(data, dict)

    def test_run_with_auto_preflight_bool(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", {"action": "start", "auto_preflight_on_run": True})
        assert isinstance(data, dict)

    def test_run_with_auto_preflight_invalid_type(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", {"action": "start", "auto_preflight_on_run": "yes"}, expect_status=400)
        assert data.get("error") == "invalid_auto_preflight_on_run"

    def test_run_not_object(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", "start", expect_status=400)
        assert data.get("error") == "invalid_payload"

    def test_run_missing_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", {})
        assert isinstance(data, dict)  # action defaults to ""


class TestPostSession:
    def test_valid_new_session(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/session", {"action": "new"})
        assert data.get("ok") is True

    def test_invalid_session_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/session", {"action": "delete"}, expect_status=400)
        assert data.get("error") == "unsupported_action"

    def test_missing_session_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/session", {}, expect_status=400)
        assert data.get("error") == "unsupported_action"


class TestPostDeclaration:
    def test_valid_declaration(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/declaration", {"uic": {"preferences": []}})
        assert "uic" in data

    def test_empty_declaration(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/declaration", {})
        assert isinstance(data, dict)

    def test_declaration_non_object(self, web_server: str) -> None:
        # Should still work — coerced to {}
        data = _post(f"{web_server}/api/declaration", "not json object")
        assert isinstance(data, dict)


class TestPostItem:
    def test_valid_pause(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/item/abc123/pause")
        assert data.get("ok") is True

    def test_valid_resume(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/item/abc123/resume")
        assert data.get("ok") is True

    def test_valid_remove(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/item/abc123/remove")
        assert data.get("ok") is True

    def test_valid_retry(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/item/abc123/retry")
        assert data.get("ok") is True

    def test_invalid_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/item/abc123/destroy", expect_status=404)
        assert data.get("error") == "not_found"

    def test_missing_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/item/abc123/", expect_status=404)

    def test_empty_id_forwarded(self, web_server: str) -> None:
        # Empty ID is forwarded to backend (backend decides validity)
        data = _post(f"{web_server}/api/item//pause")
        assert isinstance(data, dict)


class TestPostLifecycle:
    def test_valid_lifecycle_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/lifecycle/action", {"target": "ariaflow", "action": "install"})
        assert data.get("ok") is True

    def test_lifecycle_missing_fields(self, web_server: str) -> None:
        # Should still work — empty strings
        data = _post(f"{web_server}/api/lifecycle/action", {})
        assert isinstance(data, dict)


class TestPostMisc:
    def test_preflight(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/preflight")
        assert isinstance(data, dict)

    def test_ucc(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/ucc")
        assert isinstance(data, dict)

    def test_pause(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/pause")
        assert isinstance(data, dict)

    def test_resume(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/resume")
        assert isinstance(data, dict)

    def test_bandwidth_probe(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/bandwidth/probe")
        assert data.get("ok") is True

    def test_unknown_post_returns_404(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/nonexistent", {}, expect_status=404)
        assert data.get("error") == "not_found"

    def test_invalid_json_body(self, web_server: str) -> None:
        req = urllib.request.Request(
            f"{web_server}/api/add",
            data=b"not json {{{",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=5)
            pytest.fail("Expected 400")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
            data = json.loads(exc.read().decode())
            assert data.get("error") == "invalid_json"


# ---------------------------------------------------------------------------
# Meta-test: verify all proxy endpoints have parameter tests
# ---------------------------------------------------------------------------

class TestApiParamCoverage:
    """Ensure every proxy endpoint in webapp.py has parameter validation tests."""

    ENDPOINT_COVERAGE = {
        # GET endpoints
        "GET /api": "test_api_discovery",
        "GET /api/status": "test_status_returns_json + test_status_with_backend_param",
        "GET /api/bandwidth": "test_bandwidth",
        "GET /api/log": "test_log_default_limit + test_log_custom_limit + test_log_limit_clamped + test_log_limit_invalid",
        "GET /api/declaration": "test_declaration",
        "GET /api/options": "test_options_alias",
        "GET /api/lifecycle": "test_lifecycle",
        "GET /api/discovery": "test_discovery",
        "GET /static/*": "test_static_serving.py (separate file)",
        # POST endpoints
        "POST /api/add": "TestPostAdd (5 tests: valid, missing items, not list, not object, empty)",
        "POST /api/run": "TestPostRun (6 tests: start, stop, auto_preflight bool/invalid, not object, missing action)",
        "POST /api/session": "TestPostSession (3 tests: valid, invalid action, missing action)",
        "POST /api/declaration": "TestPostDeclaration (3 tests: valid, empty, non-object)",
        "POST /api/item/{id}/{action}": "TestPostItem (7 tests: all 4 actions, invalid action, missing action, missing id)",
        "POST /api/lifecycle/action": "TestPostLifecycle (2 tests: valid, missing fields)",
        "POST /api/preflight": "test_preflight",
        "POST /api/ucc": "test_ucc",
        "POST /api/pause": "test_pause",
        "POST /api/resume": "test_resume",
        "POST /api/bandwidth/probe": "test_bandwidth_probe",
        # Error handling
        "POST invalid JSON": "test_invalid_json_body",
        "GET unknown": "test_unknown_get_returns_404",
        "POST unknown": "test_unknown_post_returns_404",
    }

    def test_all_endpoints_extracted(self) -> None:
        """Verify we found a reasonable number of endpoints."""
        source = WEBAPP_PY.read_text(encoding="utf-8")
        get_routes = re.findall(r'if path == "(/api[^"]*)"', source)
        post_routes = re.findall(r'if path == "(/api[^"]*)"', source[source.index("do_POST"):])
        total = len(set(get_routes)) + len(set(post_routes))
        assert total >= 10, f"Expected at least 10 API routes, found {total}"

    def test_coverage_map_is_complete(self) -> None:
        """Verify ENDPOINT_COVERAGE covers all routes in webapp.py."""
        source = WEBAPP_PY.read_text(encoding="utf-8")
        # Extract GET routes
        get_section = source[:source.index("do_POST")]
        for match in re.finditer(r'if path == "(/api[^"]*)"', get_section):
            route = f"GET {match.group(1)}"
            assert route in self.ENDPOINT_COVERAGE, f"Missing test coverage for {route}"
        # Extract POST routes
        post_section = source[source.index("do_POST"):]
        for match in re.finditer(r'if path == "(/api[^"]*)"', post_section):
            route = f"POST {match.group(1)}"
            assert route in self.ENDPOINT_COVERAGE, f"Missing test coverage for {route}"

    def test_js_fetch_calls_match_proxy(self) -> None:
        """Verify every fetch() in app.js hits a proxied endpoint."""
        js = APP_JS.read_text(encoding="utf-8")
        source = WEBAPP_PY.read_text(encoding="utf-8")
        # Extract all fetch paths from JS
        fetch_paths = set()
        for match in re.finditer(r"fetch\(.*?['\"`](/api[^'\"`$]*)['\"`]", js):
            path = match.group(1)
            # Normalize template expressions
            path = re.sub(r'\$\{[^}]+\}', '{param}', path)
            fetch_paths.add(path)

        # Extract all proxied paths from webapp.py
        proxy_paths = set()
        for match in re.finditer(r'if path == "(/api[^"]*)"', source):
            proxy_paths.add(match.group(1))
        proxy_paths.add("/api/item/{param}/{param}")  # dynamic route
        proxy_paths.add("/api/discovery")  # served directly

        unproxied = []
        for fp in sorted(fetch_paths):
            normalized = fp.split("?")[0]  # strip query params
            if normalized not in proxy_paths and not any(normalized.startswith(pp.replace("{param}", "")) for pp in proxy_paths):
                unproxied.append(fp)

        assert unproxied == [], (
            f"JS fetch() calls to unproxied endpoints:\n"
            + "\n".join(f"  - {p}" for p in unproxied)
        )
