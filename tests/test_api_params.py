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
INDEX_HTML = Path(__file__).resolve().parents[1] / "src" / "ariaflow_web" / "static" / "index.html"


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
        data = _post(f"{web_server}/api/downloads/add", {"items": [{"url": "http://example.com/f"}]})
        assert data.get("ok") is True

    def test_add_empty_items(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/add", {"items": []})
        assert isinstance(data, dict)


class TestPostRun:
    def test_valid_start(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/start", {})
        assert data.get("ok") is True

    def test_valid_stop(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/stop", {})
        assert isinstance(data, dict)

    def test_run_with_auto_preflight_bool(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/start", {"auto_preflight_on_run": True})
        assert isinstance(data, dict)

    def test_run_missing_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/start", {})
        assert isinstance(data, dict)  # action defaults to ""


class TestPostSession:
    def test_valid_new_session(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/sessions/new", {"action": "new"})
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
        data = _post(f"{web_server}/api/downloads/abc123/pause")
        assert data.get("ok") is True

    def test_valid_resume(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/abc123/resume")
        assert data.get("ok") is True

    def test_valid_remove(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/abc123/remove")
        assert data.get("ok") is True

    def test_valid_retry(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/abc123/retry")
        assert data.get("ok") is True

    def test_invalid_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/abc123/destroy", expect_status=404)
        assert data.get("error") == "not_found"

    def test_missing_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/abc123/", expect_status=404)

    def test_empty_id_forwarded(self, web_server: str) -> None:
        # Empty ID is forwarded to backend (backend decides validity)
        data = _post(f"{web_server}/api/downloads//pause")
        assert isinstance(data, dict)


class TestPostLifecycle:
    def test_valid_lifecycle_action(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/lifecycle/ariaflow/install")
        assert data.get("ok") is True

    def test_lifecycle_missing_fields(self, web_server: str) -> None:
        # Should still work — empty strings
        data = _post(f"{web_server}/api/lifecycle/unknown/check")
        assert isinstance(data, dict)


class TestPostMisc:
    def test_preflight(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/preflight")
        assert isinstance(data, dict)

    def test_ucc(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/ucc")
        assert isinstance(data, dict)

    def test_pause(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/pause")
        assert isinstance(data, dict)

    def test_resume(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/resume")
        assert isinstance(data, dict)

    def test_bandwidth_probe(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/bandwidth/probe")
        assert data.get("ok") is True

    def test_archive(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/downloads/archive")
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
        data = _get(f"{web_server}/api/sessions/stats")
        assert isinstance(data, dict)

    def test_health(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/health")
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
        data = _post(f"{web_server}/api/aria2/change_global_option", {"max-concurrent-downloads": "5"})
        assert isinstance(data, dict)

    def test_aria2_change_option(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/aria2/change_option", {"gid": "abc", "max-download-limit": "1M"})
        assert data.get("ok") is True

    def test_aria2_set_limits(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/aria2/set_limits", {"max_download_speed": "5M"})
        assert data.get("ok") is True

    def test_torrents(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/torrents")
        assert isinstance(data, dict)

    def test_torrent_stop(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/torrents/abc123deadbeef/stop")
        assert data.get("ok") is True

    def test_cleanup(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/cleanup")
        assert isinstance(data, dict)

    def test_unknown_post_returns_404(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/nonexistent", {}, expect_status=404)
        assert data.get("error") == "not_found"

    def test_invalid_json_body(self, web_server: str) -> None:
        req = urllib.request.Request(
            f"{web_server}/api/downloads/add",
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
        "POST /api/downloads/add": "test_valid_add + test_add_empty_items",
        "POST /api/scheduler/start": "test_valid_start + test_run_with_auto_preflight_bool",
        "POST /api/scheduler/stop": "test_valid_stop",
        "POST /api/sessions/new": "test_valid_new_session",
        "POST /api/declaration": "TestPostDeclaration",
        "POST /api/downloads/{id}/{action}": "TestPostItem",
        "POST /api/lifecycle/{target}/{action}": "TestPostLifecycle",
        "POST /api/scheduler/preflight": "test_preflight",
        "POST /api/scheduler/ucc": "test_ucc",
        "POST /api/scheduler/pause": "test_pause",
        "POST /api/scheduler/resume": "test_resume",
        "POST /api/bandwidth/probe": "test_bandwidth_probe",
        "GET /api/downloads/archive": "test_archive",
        "GET /api/events": "test_events_endpoint_exists",
        "GET /api/scheduler": "test_scheduler",
        "GET /api": "test_api_discovery",
        "GET /api/sessions": "test_sessions",
        "GET /api/sessions/stats": "test_session_stats",
        "GET /api/health": "test_health",
        "GET /api/scheduler": "test_scheduler",
        "GET /api/aria2/get_option": "test_aria2_get_option",
        "GET /api/aria2/get_global_option": "test_aria2_get_global_option",
        "GET /api/aria2/option_tiers": "test_aria2_option_tiers",
        "POST /api/aria2/change_global_option": "test_aria2_options",
        "POST /api/aria2/change_option": "test_aria2_change_option",
        "POST /api/aria2/set_limits": "test_aria2_set_limits",
        "GET /api/torrents": "test_torrents",
        "POST /api/torrents/{infohash}/stop": "test_torrent_stop",
        "POST /api/downloads/cleanup": "test_cleanup",
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
            "/api/downloads/add",
            "/api/scheduler/start",
            "/api/scheduler/stop",
            "/api/scheduler/pause",
            "/api/scheduler/resume",
            "/api/scheduler/preflight",
            "/api/scheduler/ucc",
            "/api/downloads/cleanup",
            "/api/bandwidth",
            "/api/bandwidth/probe",
            "/api/lifecycle",
            "/api/lifecycle/",
            "/api/log",
            "/api/downloads/archive",
            "/api/sessions",
            "/api/sessions/stats",
            "/api/health",
            "/api/scheduler",
            "/api/aria2/change_global_option",
            "/api/aria2/get_global_option",
            "/api/aria2/option_tiers",
            "/api/aria2/get_option",
            "/api/downloads/",
            "/api/declaration/preferences",
            "/api/torrents",
            "/api/aria2/change_option",
            "/api/aria2/set_limits",
            "/api/sessions/new",
            "/api/torrents/",
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

    def test_every_api_method_has_ui_trigger(self) -> None:
        """Verify every async method that calls an API has a UI trigger in HTML.

        Each method that posts/fetches should be reachable from a @click,
        @change, @input, x-show, or called from init/_loadPageData.
        """
        js = APP_JS.read_text(encoding="utf-8")
        html = INDEX_HTML.read_text(encoding="utf-8")

        # Find async methods that call _fetch or apiPath
        api_methods = set()
        lines = js.splitlines()
        for i, line in enumerate(lines):
            if "apiPath(" in line or "_fetch(" in line:
                for j in range(i, max(0, i - 20), -1):
                    m = re.match(r"\s+(?:async\s+)?(\w+)\s*\(", lines[j])
                    if m:
                        api_methods.add(m.group(1))
                        break

        # Methods that are internal (called by other methods, not UI)
        INTERNAL_METHODS = {
            "_fetch", "_sendAria2Option", "_flushPrefQueue", "refresh",
            "_statusUrl", "_closeSSE", "_initSSE",
            "schedulerAction", "loadScheduler", "loadAria2Options", "setAria2Limits",
            "loadDeclaration", "loadSessionHistory", "loadArchive",
            "refreshActionLog", "refreshBandwidth", "discoverBackends",
            "annotateQueueItems", "recordGlobalSpeed", "recordSpeed",
            "checkNotifications", "saveDeclaration",
            "pauseDownloads", "resumeDownloads", "itemAction",
            "apiPath", "newSession", "saveDeclaration",
        }

        # Check each API method is referenced in HTML or called from init/_loadPageData
        init_block = js[js.find("init()"):js.find("navigateTo(")]
        load_block = js[js.find("_loadPageData("):js.find("_loadPageData(") + 500]

        missing = []
        for method in sorted(api_methods - INTERNAL_METHODS):
            in_html = method in html
            in_init = method in init_block
            in_load = method in load_block
            called_by_other = any(f"this.{method}(" in js.replace(f"async {method}(", "") for _ in [1])
            if not (in_html or in_init or in_load):
                missing.append(method)

        assert missing == [], (
            f"API methods with no UI trigger or init call:\n"
            + "\n".join(f"  - {m}" for m in missing)
        )

    def test_every_preference_has_ui_control(self) -> None:
        """Verify every backend preference name appears in HTML as a UI control.

        Each preference from contracts.py should have an input, select,
        or checkbox in the frontend that reads/writes it.
        """
        js = APP_JS.read_text(encoding="utf-8")
        html = INDEX_HTML.read_text(encoding="utf-8")

        # All preference names the frontend reads via getDeclarationPreference
        EXPECTED_PREFERENCES = [
            "auto_preflight_on_run",
            "post_action_rule",
            "duplicate_active_transfer_action",
            "max_simultaneous_downloads",
            "bandwidth_down_free_percent",
            "bandwidth_down_free_absolute_mbps",
            "bandwidth_up_free_percent",
            "bandwidth_up_free_absolute_mbps",
            "bandwidth_probe_interval_seconds",
            "aria2_unsafe_options",
            "max_retries",
            "retry_backoff_seconds",
            "aria2_max_tries",
            "aria2_retry_wait",
            "internal_tracker_url",
            "distribute_completed_downloads",
            "distribute_seed_ratio",
            "distribute_max_seed_hours",
            "distribute_max_active_seeds",
        ]

        # Verify each preference is referenced in JS (getter or setter)
        missing_js = [p for p in EXPECTED_PREFERENCES if p not in js]
        assert missing_js == [], (
            f"Preferences not referenced in app.js:\n"
            + "\n".join(f"  - {p}" for p in missing_js)
        )

        # Verify each preference has a corresponding UI control in HTML
        # (either directly via setBandwidthPref('name',...) or via a getter)
        pref_getters = {}
        for p in EXPECTED_PREFERENCES:
            # Find the getter that reads this preference
            for m in re.finditer(r"get\s+(\w+)\(\)\s*\{[^}]*" + re.escape(p), js):
                pref_getters[p] = m.group(1)

        missing_ui = []
        for p in EXPECTED_PREFERENCES:
            # Check if preference name appears in HTML (via setBandwidthPref etc.)
            in_html_direct = p in html
            # Or if its getter appears in HTML
            getter = pref_getters.get(p)
            in_html_getter = getter and getter in html
            if not (in_html_direct or in_html_getter):
                missing_ui.append(f"{p} (getter: {getter})")

        assert missing_ui == [], (
            f"Preferences without UI control in HTML:\n"
            + "\n".join(f"  - {p}" for p in missing_ui)
        )

    def test_item_actions_match_backend(self) -> None:
        """Verify every item action in the UI maps to a real backend endpoint.

        Each action (pause, resume, retry, remove) called via itemAction()
        or itemToggleAction() must correspond to POST /api/downloads/{id}/{action}.
        """
        js = APP_JS.read_text(encoding="utf-8")

        html = INDEX_HTML.read_text(encoding="utf-8")

        # Actions called via itemAction(id, 'action') in JS and HTML
        ui_actions = set(re.findall(r"itemAction\([^,]+,\s*['\"](\w+)['\"]", js))
        ui_actions |= set(re.findall(r"itemAction\([^,]+,\s*['\"](\w+)['\"]", html))

        # Actions in itemToggleAction
        toggle_actions = set(re.findall(r"this\.itemAction\([^,]+,\s*['\"](\w+)['\"]", js))
        ui_actions |= toggle_actions

        # Backend-supported actions (from _post_item_action handler)
        BACKEND_ACTIONS = {"pause", "resume", "remove", "retry"}

        # Every UI action must exist in backend
        unknown = ui_actions - BACKEND_ACTIONS
        assert unknown == set(), (
            f"Item actions in UI not supported by backend:\n"
            + "\n".join(f"  - {a}" for a in sorted(unknown))
        )

        # Every backend action should be reachable from UI
        unreachable = BACKEND_ACTIONS - ui_actions
        assert unreachable == set(), (
            f"Backend item actions not reachable from UI:\n"
            + "\n".join(f"  - {a}" for a in sorted(unreachable))
        )


class TestBackendFieldCoverage:
    """Verify every data field the backend returns is consumed by the frontend."""

    # Expected response fields per endpoint.
    # Notation: "parent.child" for nested, "arr[].field" for array items.
    # Only leaf fields that carry user-visible data are listed.
    EXPECTED_FIELDS: dict[str, set[str]] = {
        "/api/status": {
            # items[]
            "id", "url", "output", "status", "gid", "created_at",
            "error_message", "error_code", "priority", "mode",
            "mirrors", "torrent_data", "metalink_data",
            "live_status", "paused_at", "completed_at",
            "completed_length", "total_length", "allowed_actions",
            "post_action_rule", "session_id",
            "distribute_status", "distribute_infohash",
            # active
            "download_speed", "percent", "files",
            # state
            "running", "paused", "session_started_at", "stop_requested",
            # summary
            "queued", "done", "error", "total",
            "active", "complete", "discovering", "waiting",
            "stopped", "cancelled",
            # bandwidth (inline)
            "downlink_mbps", "uplink_mbps", "cap_mbps",
            # ariaflow
            "reachable", "version", "pid",
        },
        "/api/declaration": {
            "name", "value", "options", "rationale",
            "uic", "preferences",
        },
        "/api/lifecycle": {
            "target", "outcome", "observation", "reason",
            "detail", "completion",
        },
        "/api/bandwidth": {
            "downlink_mbps", "uplink_mbps",
            "down_cap_mbps", "up_cap_mbps", "cap_mbps",
            "current_limit", "interface",
            "responsiveness_rpm",
        },
        "/api/log": {
            "action", "target", "outcome", "timestamp",
            "session_id", "observation", "reason",
        },
        "/api/sessions": {
            "session_id", "started_at", "closed_at", "closed_reason",
            "items_total", "items_done", "items_error",
        },
        "/api/sessions/stats": {
            "session_id", "items_total", "items_done", "items_error",
            "items_queued", "items_active", "bytes_completed",
        },
        "/api/scheduler": {
            "status", "running", "paused", "stop_requested",
            "session_id", "session_started_at",
        },
        "/api/torrents": {
            "infohash", "name", "seed_gid", "started_at", "item_id",
        },
    }

    # Fields that are generic wire format or internal — skip checking.
    SKIP_FIELDS = {
        "ok", "error", "message", "_rev", "_schema", "_request_id",
        "count", "meta", "contract",
    }

    # Backend fields the frontend intentionally does not use (yet).
    # Each entry documents why. Remove from here when wired into the UI.
    KNOWN_UNUSED: dict[str, str] = {
        "/api/status: allowed_actions": "FE-12: could enable/disable action buttons dynamically",
        "/api/status: distribute_status": "FE-12: seeding status per item not shown",
        "/api/status: distribute_infohash": "FE-12: infohash per item not shown",
        "/api/status: error_code": "FE-12: only error_message is displayed",
        "/api/status: live_status": "FE-12: only normalized status shown",
        "/api/status: paused_at": "FE-12: timestamp not displayed",
        "/api/bandwidth: current_limit": "FE-12: raw limit bytes not shown",
        "/api/bandwidth: down_cap_mbps": "FE-12: cap_mbps used instead",
        "/api/bandwidth: up_cap_mbps": "FE-12: not shown separately",
        "/api/bandwidth: responsiveness_rpm": "FE-12: not displayed",
        "/api/lifecycle: observation": "FE-12: only outcome/reason shown",
        "/api/log: observation": "FE-12: only action/outcome shown in log",
        "/api/sessions: items_done": "FE-12: session list shows ID/dates only",
        "/api/sessions: items_error": "FE-12: session list shows ID/dates only",
        "/api/sessions: items_total": "FE-12: session list shows ID/dates only",
        "/api/sessions/stats: bytes_completed": "FE-12: not displayed in stats",
        "/api/sessions/stats: items_active": "FE-12: not displayed in stats",
        "/api/sessions/stats: items_done": "FE-12: not displayed in stats",
        "/api/sessions/stats: items_error": "FE-12: not displayed in stats",
        "/api/sessions/stats: items_queued": "FE-12: not displayed in stats",
        "/api/sessions/stats: items_total": "FE-12: not displayed in stats",
        "/api/torrents: seed_gid": "FE-12: GID not shown in torrent panel",
    }

    @staticmethod
    def _snake_to_camel(name: str) -> str:
        """Convert snake_case to camelCase."""
        parts = name.split("_")
        return parts[0] + "".join(p.capitalize() for p in parts[1:])

    def _field_present(self, field: str, text: str) -> bool:
        """Check if field is referenced in text (snake_case or camelCase)."""
        if field in text:
            return True
        camel = self._snake_to_camel(field)
        if camel != field and camel in text:
            return True
        return False

    def test_all_backend_fields_consumed(self) -> None:
        """Every meaningful backend response field must appear in app.js or index.html."""
        js = APP_JS.read_text(encoding="utf-8")
        html = INDEX_HTML.read_text(encoding="utf-8")
        combined = js + "\n" + html

        missing: list[str] = []
        for endpoint, fields in sorted(self.EXPECTED_FIELDS.items()):
            for field in sorted(fields - self.SKIP_FIELDS):
                key = f"{endpoint}: {field}"
                if key in self.KNOWN_UNUSED:
                    continue
                if not self._field_present(field, combined):
                    missing.append(key)

        assert missing == [], (
            f"Backend response fields not referenced in frontend:\n"
            + "\n".join(f"  - {f}" for f in missing)
            + "\n\nIf intentionally unused, add to KNOWN_UNUSED with a reason."
        )

    def test_known_unused_count_is_stable(self) -> None:
        """Guard: track how many fields are intentionally unused."""
        assert len(self.KNOWN_UNUSED) == 22, (
            f"KNOWN_UNUSED has {len(self.KNOWN_UNUSED)} entries (expected 22). "
            "Update this count when wiring new fields or adding new gaps."
        )
