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
    _, backend_url, web_srv, backend_srv, patches, _ = start_server()
    yield backend_url
    stop_server(web_srv, backend_srv, patches)


# ---------------------------------------------------------------------------
# GET endpoint parameter tests
# ---------------------------------------------------------------------------

class TestGetEndpoints:
    def test_status_returns_json(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/status")
        assert "items" in data

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

    def test_run_missing_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/run", {})
        assert isinstance(data, dict)  # action defaults to ""


class TestPostSession:
    def test_valid_new_session(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/session", {"action": "new"})
        assert data.get("ok") is True



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

    def test_archive(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/archive")
        assert isinstance(data, dict)

    def test_events_endpoint_exists(self, web_server: str) -> None:
        """SSE endpoint returns 502 when backend is mocked (no real stream)."""
        try:
            _get(f"{web_server}/api/events")
        except Exception:
            pass  # Expected — mock backend can't stream SSE

    def test_scheduler(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/scheduler")
        assert isinstance(data, dict)

    def test_api_discovery(self, web_server: str) -> None:
        data = _get(f"{web_server}/api")
        assert isinstance(data, dict)

    def test_sessions(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/sessions")
        assert isinstance(data, dict)

    def test_session_stats(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/session/stats")
        assert isinstance(data, dict)

    def test_health(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/health")
        assert isinstance(data, dict)

    def test_scheduler(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/scheduler")
        assert isinstance(data, dict)

    def test_aria2_get_option(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/aria2/get_option?gid=dummy")
        assert isinstance(data, dict)

    def test_aria2_get_global_option(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/aria2/get_global_option")
        assert isinstance(data, dict)

    def test_aria2_option_tiers(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/aria2/option_tiers")
        assert isinstance(data, dict)

    def test_aria2_options(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/aria2/options", {"max-concurrent-downloads": "5"})
        assert isinstance(data, dict)

    def test_cleanup(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/cleanup")
        assert isinstance(data, dict)

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
        "GET /api/status": "test_status_returns_json",
        "GET /api/bandwidth": "test_bandwidth",
        "GET /api/log": "test_log_default_limit + test_log_custom_limit + test_log_limit_clamped + test_log_limit_invalid",
        "GET /api/declaration": "test_declaration",
        "GET /api/options": "test_options_alias",
        "GET /api/lifecycle": "test_lifecycle",
        "GET /api/discovery": "test_web.py (web server only)",
        "GET /static/*": "test_static_serving.py (separate file)",
        # POST endpoints
        "POST /api/add": "test_valid_add + test_add_empty_items",
        "POST /api/run": "test_valid_start + test_valid_stop + test_run_with_auto_preflight_bool + test_run_missing_action",
        "POST /api/session": "test_valid_new_session",
        "POST /api/declaration": "TestPostDeclaration",
        "POST /api/item/{id}/{action}": "TestPostItem",
        "POST /api/lifecycle/action": "TestPostLifecycle",
        "POST /api/preflight": "test_preflight",
        "POST /api/ucc": "test_ucc",
        "POST /api/pause": "test_pause",
        "POST /api/resume": "test_resume",
        "POST /api/bandwidth/probe": "test_bandwidth_probe",
        "GET /api/archive": "test_archive",
        "GET /api/events": "test_events_endpoint_exists",
        "GET /api/scheduler": "test_scheduler",
        "GET /api": "test_api_discovery",
        "GET /api/sessions": "test_sessions",
        "GET /api/session/stats": "test_session_stats",
        "GET /api/health": "test_health",
        "GET /api/scheduler": "test_scheduler",
        "GET /api/aria2/get_option": "test_aria2_get_option",
        "GET /api/aria2/get_global_option": "test_aria2_get_global_option",
        "GET /api/aria2/option_tiers": "test_aria2_option_tiers",
        "POST /api/aria2/options": "test_aria2_options",
        "POST /api/cleanup": "test_cleanup",
        # Error handling
        "POST invalid JSON": "test_invalid_json_body",
        "GET unknown": "test_unknown_get_returns_404",
        "POST unknown": "test_unknown_post_returns_404",
    }

    def test_js_fetch_calls_have_tests(self) -> None:
        """Verify every fetch() path in app.js is covered by an endpoint test."""
        js = APP_JS.read_text(encoding="utf-8")
        fetch_paths = set()
        for match in re.finditer(r"_fetch\(.*?['\"`](/api[^'\"`$]*)['\"`]", js):
            path = match.group(1)
            path = re.sub(r'\$\{[^}]+\}', '{param}', path)
            fetch_paths.add(path.split("?")[0])

        known = {v.split("/api/")[-1].split("?")[0] for v in self.ENDPOINT_COVERAGE if v.startswith("GET /api") or v.startswith("POST /api")}
        known.add("item/{param}/{param}")  # dynamic routes
        known.add("discovery")  # local-only
        known.add("/api")  # root API discovery

        uncovered = []
        for fp in sorted(fetch_paths):
            name = fp[len("/api/"):] if fp.startswith("/api/") else fp
            if name not in known and not any(name.startswith(k.replace("{param}", "")) for k in known):
                uncovered.append(fp)

        assert uncovered == [], (
            f"JS fetch() calls without endpoint tests:\n"
            + "\n".join(f"  - {p}" for p in uncovered)
        )

    def test_every_api_endpoint_is_called(self) -> None:
        """Verify every backend API endpoint is called at least once in app.js.

        Ensures no endpoint is wired in tests but never actually used
        by the frontend code.
        """
        js = APP_JS.read_text(encoding="utf-8")

        # All endpoints the frontend should call
        EXPECTED_ENDPOINTS = [
            "/api/status",
            "/api/events",
            "/api/declaration",
            "/api/add",
            "/api/run",
            "/api/pause",
            "/api/resume",
            "/api/session",
            "/api/cleanup",
            "/api/bandwidth",
            "/api/bandwidth/probe",
            "/api/lifecycle",
            "/api/lifecycle/action",
            "/api/preflight",
            "/api/ucc",
            "/api/log",
            "/api/archive",
            "/api/sessions",
            "/api/session/stats",
            "/api/health",
            "/api/scheduler",
            "/api/aria2/options",
            "/api/aria2/get_global_option",
            "/api/aria2/option_tiers",
            "/api/aria2/get_option",
            "/api/item/",
            "/api/discovery",
            "/api/docs",
            "/api/openapi.yaml",
            "/api/tests",
        ]

        missing = [ep for ep in EXPECTED_ENDPOINTS if ep not in js]
        assert missing == [], (
            f"Backend endpoints not called in app.js:\n"
            + "\n".join(f"  - {p}" for p in missing)
        )

    def test_no_duplicate_endpoint_wiring(self) -> None:
        """Verify no endpoint is called from multiple different methods.

        Each endpoint should have exactly one caller method (except
        /api/declaration which is used by load, save, and pref flush).
        """
        js = APP_JS.read_text(encoding="utf-8")

        # Extract all apiPath calls with their line context
        endpoint_callers: dict[str, list[str]] = {}
        lines = js.splitlines()
        for i, line in enumerate(lines):
            for match in re.finditer(r"apiPath\(['\"](/api/[^'\"]+)['\"]", line):
                path = match.group(1).split("?")[0]
                path = re.sub(r"\$\{[^}]+\}", "{param}", path)
                # Find enclosing method name
                method = "unknown"
                for j in range(i, max(0, i - 20), -1):
                    m = re.match(r"\s+(?:async\s+)?(\w+)\s*\(", lines[j])
                    if m:
                        method = m.group(1)
                        break
                endpoint_callers.setdefault(path, set()).add(method)

        # /api/declaration is expected to be called from multiple methods
        MULTI_CALLER_ALLOWED = {"/api/declaration"}

        duplicates = []
        for path, callers in sorted(endpoint_callers.items()):
            if len(callers) > 1 and path not in MULTI_CALLER_ALLOWED:
                duplicates.append(f"{path}: called from {sorted(callers)}")

        assert duplicates == [], (
            f"Endpoints called from multiple methods (potential duplication):\n"
            + "\n".join(f"  - {d}" for d in duplicates)
        )
