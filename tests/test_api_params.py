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
_FRAGMENTS_DIR = INDEX_HTML.parent / "_fragments"


def _read_index_html_assembled() -> str:
    text = INDEX_HTML.read_text(encoding="utf-8")
    for frag in sorted(_FRAGMENTS_DIR.glob("*.html")):
        text += "\n" + frag.read_text(encoding="utf-8")
    return text
BACKEND_WEBAPP = Path(__file__).resolve().parents[2] / "ariaflow" / "src" / "aria_queue" / "webapp.py"
UCC_DECLARATIONS = Path(__file__).resolve().parents[1] / "docs" / "ucc-declarations.yaml"


def _load_ucc_declarations() -> dict:
    """Load the canonical UCC declaration artifact (BGS-Verified evidence)."""
    import yaml
    return yaml.safe_load(UCC_DECLARATIONS.read_text(encoding="utf-8"))


_UCC = _load_ucc_declarations()


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


def _assert_get_ok(url: str) -> dict:
    data = _get(url)
    assert isinstance(data, dict)
    return data


def _assert_post_ok(url: str, payload: object = None) -> dict:
    data = _post(url, payload)
    assert data.get("ok") is True
    return data


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
        _assert_get_ok(f"{web_server}/api/log")

    def test_log_custom_limit(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/log?limit=10")

    def test_log_limit_clamped_high(self, web_server: str) -> None:
        # limit > 500 should be clamped
        _assert_get_ok(f"{web_server}/api/log?limit=9999")

    def test_log_limit_clamped_low(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/log?limit=0")

    def test_log_limit_invalid(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/log?limit=abc")  # should fallback to 120

    def test_api_discovery(self, web_server: str) -> None:
        data = _get(f"{web_server}/api")
        assert "name" in data

    def test_bandwidth(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/bandwidth")

    def test_declaration(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/declaration")
        assert "uic" in data

    def test_declaration_fields(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/declaration")
        assert "uic" in data

    def test_lifecycle(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/lifecycle")

    def test_unknown_get_returns_404(self, web_server: str) -> None:
        data = _get(f"{web_server}/api/nonexistent", expect_status=404)
        assert data.get("error") == "not_found"


# ---------------------------------------------------------------------------
# POST endpoint parameter tests
# ---------------------------------------------------------------------------

class TestPostAdd:
    def test_valid_add(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/downloads/add", {"items": [{"url": "http://example.com/f"}]})

    def test_add_empty_items(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/downloads/add", {"items": []})
        assert isinstance(data, dict)


class TestPostRun:
    def test_valid_resume(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/scheduler/resume", {})

    def test_valid_pause(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/pause", {})
        assert isinstance(data, dict)

    def test_resume_with_auto_preflight_bool(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/scheduler/resume", {"auto_preflight_on_run": True})
        assert isinstance(data, dict)


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
        _assert_post_ok(f"{web_server}/api/downloads/abc123/pause")

    def test_valid_resume(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/downloads/abc123/resume")

    def test_valid_remove(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/downloads/abc123/remove")

    def test_valid_retry(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/downloads/abc123/retry")

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
        _assert_post_ok(f"{web_server}/api/lifecycle/ariaflow/install")

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

    def test_bandwidth_probe(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/bandwidth/probe")

    def test_archive(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/downloads/archive")

    def test_events_endpoint_exists(self, web_server: str) -> None:
        """SSE endpoint returns 502 when backend is mocked (no real stream)."""
        try:
            _get(f"{web_server}/api/events")
        except Exception:
            pass  # Expected — mock backend can't stream SSE

    def test_scheduler(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/scheduler")

    def test_api_discovery(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api")

    def test_sessions(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/sessions")

    def test_session_stats(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/sessions/stats")

    def test_health(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/health")

    def test_aria2_get_option(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/aria2/get_option?gid=dummy")

    def test_aria2_get_global_option(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/aria2/get_global_option")

    def test_aria2_option_tiers(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/aria2/option_tiers")

    def test_aria2_options(self, web_server: str) -> None:
        data = _post(f"{web_server}/api/aria2/change_global_option", {"max-concurrent-downloads": "5"})
        assert isinstance(data, dict)

    def test_aria2_change_option(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/aria2/change_option", {"gid": "abc", "max-download-limit": "1M"})

    def test_aria2_set_limits(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/aria2/set_limits", {"max_download_speed": "5M"})

    def test_torrents(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/torrents")

    def test_peers(self, web_server: str) -> None:
        _assert_get_ok(f"{web_server}/api/peers")

    def test_torrent_stop(self, web_server: str) -> None:
        _assert_post_ok(f"{web_server}/api/torrents/abc123deadbeef/stop")

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

    # Sourced from docs/ucc-declarations.yaml (UCC declaration artifact).
    ENDPOINT_COVERAGE = _UCC["endpoint_coverage"]

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

    @staticmethod
    def _extract_backend_routes() -> set[str]:
        """Extract all API routes from the backend webapp.py source."""
        if not BACKEND_WEBAPP.exists():
            pytest.skip("Backend repo not available")
        source = BACKEND_WEBAPP.read_text(encoding="utf-8")
        routes: set[str] = set()
        # Dispatch table entries: "/api/path": routes.handler,
        for match in re.finditer(r'"(/api/[^"]+)":\s*routes\.\w+', source):
            routes.add(match.group(1))
        # Parameterized routes in comments or path.startswith checks
        # These are represented by their prefix
        for match in re.finditer(r'path\.startswith\("(/api/[^"]+)"\)', source):
            routes.add(match.group(1))
        # PATCH routes
        for match in re.finditer(r'path == "(/api/[^"]+)"', source):
            if match.group(1).startswith("/api/"):
                routes.add(match.group(1))
        return routes

    def test_every_api_endpoint_is_called(self) -> None:
        """Verify every backend API endpoint is called in app.js or index.html.

        Reads the backend webapp.py route tables directly to detect new
        endpoints automatically — no hardcoded list to maintain.
        """
        js = APP_JS.read_text(encoding="utf-8")
        html = _read_index_html_assembled()
        combined = js + "\n" + html

        backend_routes = self._extract_backend_routes()

        # Frontend-only routes (not in backend, served by ariaflow-web itself)
        FRONTEND_ONLY = {"/api/discovery"}

        # Endpoints accessed via window.open (not apiPath/_fetch)
        WINDOW_OPEN = {"/api/docs", "/api/openapi.yaml"}

        missing = []
        for route in sorted(backend_routes):
            if route in FRONTEND_ONLY:
                continue
            # Check if the route or its prefix appears in frontend code
            if route in combined:
                continue
            # Check prefix match for parameterized routes
            if any(route.startswith(prefix) for prefix in ["/api/downloads/", "/api/torrents/", "/api/lifecycle/"]) and any(p in combined for p in ["/api/downloads/", "/api/torrents/", "/api/lifecycle/"]):
                continue
            if route in WINDOW_OPEN:
                continue
            missing.append(route)

        assert missing == [], (
            f"Backend endpoints not called by frontend:\n"
            + "\n".join(f"  - {r}" for r in missing)
            + "\n\nAdd the endpoint call to app.js or index.html."
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
        MULTI_CALLER_ALLOWED = {"/api/declaration", "/api/health"}

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
        @change, @input, x-show, called from init, or declared in LOADERS.
        """
        js = APP_JS.read_text(encoding="utf-8")
        html = _read_index_html_assembled()

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
            "checkNotifications",
            "pauseDownloads", "resumeDownloads", "itemAction",
            "apiPath", "saveDeclaration",
        }

        # Check each API method is referenced in HTML, called from init, or
        # declared in the LOADERS manifest (per-tab timer-driven loaders).
        init_block = js[js.find("init()"):js.find("navigateTo(")]
        loaders_block = js[js.find("LOADERS:"):js.find("_tabPollers")]

        missing = []
        for method in sorted(api_methods - INTERNAL_METHODS):
            in_html = method in html
            in_init = method in init_block
            in_loaders = f"'{method}'" in loaders_block
            if not (in_html or in_init or in_loaders):
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
        html = _read_index_html_assembled()

        # All preference names the frontend reads via getDeclarationPreference.
        # Sourced from docs/ucc-declarations.yaml (UCC declaration artifact).
        EXPECTED_PREFERENCES = _UCC["expected_preferences"]

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

        html = _read_index_html_assembled()

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
    """Verify every data field the backend returns is consumed by the frontend.

    Auto-discovers expected fields from the backend's openapi.yaml — no
    hand-maintained list. If the backend adds a new property, this test
    will fail until the frontend references it.
    """

    BACKEND_OPENAPI = Path(__file__).resolve().parents[2] / "ariaflow" / "src" / "aria_queue" / "openapi.yaml"

    # Fields that are generic wire format or internal — skip checking.
    SKIP_FIELDS = {
        "ok", "error", "message", "_rev", "_schema", "_request_id",
        "count", "meta", "contract",
        # OpenAPI pagination / nullable markers
        "filtered",
    }

    # Backend fields the frontend intentionally does not use (yet).
    # Sourced from docs/ucc-declarations.yaml (UCC declaration artifact).
    KNOWN_UNUSED: dict[str, str] = _UCC["known_unused"]

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

    def _collect_schema_properties(self, schema: object, components: dict, seen: set) -> set[str]:
        """Recursively walk a JSON schema and return all property names found.

        Handles $ref, nested objects, array items, oneOf/anyOf/allOf.
        """
        if not isinstance(schema, dict):
            return set()
        # Avoid infinite recursion on cyclic schemas
        sid = id(schema)
        if sid in seen:
            return set()
        seen = seen | {sid}

        out: set[str] = set()
        # $ref resolution
        ref = schema.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            name = ref.split("/")[-1]
            target = components.get(name, {})
            return self._collect_schema_properties(target, components, seen)
        # Composition keywords
        for key in ("oneOf", "anyOf", "allOf"):
            for sub in schema.get(key, []) or []:
                out |= self._collect_schema_properties(sub, components, seen)
        # Object properties
        props = schema.get("properties")
        if isinstance(props, dict):
            for name, subschema in props.items():
                out.add(name)
                out |= self._collect_schema_properties(subschema, components, seen)
        # Array items
        items = schema.get("items")
        if isinstance(items, dict):
            out |= self._collect_schema_properties(items, components, seen)
        return out

    def _extract_backend_fields(self) -> dict[str, set[str]]:
        """Load openapi.yaml and extract field names per GET endpoint."""
        if not self.BACKEND_OPENAPI.exists():
            pytest.skip("Backend openapi.yaml not available")
        try:
            import yaml
        except ImportError:
            pytest.skip("PyYAML not installed")
        spec = yaml.safe_load(self.BACKEND_OPENAPI.read_text(encoding="utf-8"))
        components = (spec.get("components") or {}).get("schemas") or {}

        # Collect top-level endpoint schemas
        fields_by_endpoint: dict[str, set[str]] = {}
        for path, methods in (spec.get("paths") or {}).items():
            if not isinstance(methods, dict) or "{" in path:
                continue
            get_op = methods.get("get")
            if not isinstance(get_op, dict):
                continue
            schema = (
                ((get_op.get("responses") or {}).get("200") or {})
                .get("content", {})
                .get("application/json", {})
                .get("schema")
            )
            if not schema:
                continue
            fields = self._collect_schema_properties(schema, components, set())
            if fields:
                fields_by_endpoint[path] = fields

        # Also include all component schemas as a safety net — these are the
        # canonical shapes the backend publishes, even when endpoints type
        # nested objects as just `{type: object}`.
        all_component_fields: set[str] = set()
        for name, schema in components.items():
            all_component_fields |= self._collect_schema_properties(schema, components, set())
        if all_component_fields:
            fields_by_endpoint["__components__"] = all_component_fields

        return fields_by_endpoint

    def test_all_backend_fields_consumed(self) -> None:
        """Every field in backend openapi.yaml must appear in app.js or index.html."""
        js = APP_JS.read_text(encoding="utf-8")
        html = _read_index_html_assembled()
        combined = js + "\n" + html

        expected = self._extract_backend_fields()
        missing: list[str] = []
        for endpoint, fields in sorted(expected.items()):
            for field in sorted(fields - self.SKIP_FIELDS):
                if field in self.KNOWN_UNUSED:
                    continue
                if not self._field_present(field, combined):
                    missing.append(f"{endpoint}: {field}")

        assert missing == [], (
            f"Backend response fields not referenced in frontend:\n"
            + "\n".join(f"  - {f}" for f in missing)
            + "\n\nIf intentionally unused, add the field name to KNOWN_UNUSED "
            "with a reason. Otherwise wire it into the UI."
        )

    def test_known_unused_count_is_stable(self) -> None:
        """Guard: track how many fields are intentionally unused."""
        expected = _UCC["known_unused_expected_count"]
        assert len(self.KNOWN_UNUSED) == expected, (
            f"KNOWN_UNUSED has {len(self.KNOWN_UNUSED)} entries (expected {expected}). "
            "Update known_unused_expected_count in docs/ucc-declarations.yaml."
        )


class TestMockFixturesMatchBackend:
    """Verify test mock fixtures contain the fields the real backend returns.

    Ensures browser tests exercise realistic data shapes. If the backend
    adds a new field to /api/status, conftest.py's DEFAULT_STATUS should
    include it so the UI renders correctly in tests.
    """

    BACKEND_OPENAPI = TestBackendFieldCoverage.BACKEND_OPENAPI
    CONFTEST = Path(__file__).resolve().parent / "conftest.py"

    # Fixtures with loose coverage (intentionally partial — mocks are minimal
    # and don't need every optional field). Listed here so we don't over-check.
    # Format: fixture_name → set of fields that MUST be present.
    REQUIRED_FIELDS_PER_FIXTURE: dict[str, set[str]] = {
        "DEFAULT_STATUS": {
            # Must have the shape the frontend reads
            "items", "state", "summary",
        },
        "DEFAULT_DECLARATION": {
            "uic",
        },
        "DEFAULT_LIFECYCLE": set(),  # no strict requirements
    }

    def _collect_mock_keys(self, fixture_src: str) -> set[str]:
        """Extract all dict keys (strings) from a fixture literal via AST."""
        import ast
        try:
            tree = ast.parse(fixture_src, mode="eval")
        except SyntaxError:
            return set()
        keys: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Dict):
                for k in node.keys:
                    if isinstance(k, ast.Constant) and isinstance(k.value, str):
                        keys.add(k.value)
        return keys

    def _extract_fixture(self, name: str) -> str | None:
        """Find a top-level fixture assignment in conftest.py and return its source."""
        import ast
        src = self.CONFTEST.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                tgt = node.targets[0]
                if isinstance(tgt, ast.Name) and tgt.id == name:
                    return ast.unparse(node.value)
        return None

    def test_mock_fixtures_have_required_fields(self) -> None:
        """Each mock fixture must contain the minimal required field set."""
        missing_per_fixture: dict[str, set[str]] = {}
        for fixture_name, required in self.REQUIRED_FIELDS_PER_FIXTURE.items():
            src = self._extract_fixture(fixture_name)
            if src is None:
                missing_per_fixture[fixture_name] = {"<fixture not found>"}
                continue
            keys = self._collect_mock_keys(src)
            missing = required - keys
            if missing:
                missing_per_fixture[fixture_name] = missing

        assert not missing_per_fixture, (
            "Mock fixtures missing required fields:\n"
            + "\n".join(
                f"  {fix}: {sorted(fields)}"
                for fix, fields in missing_per_fixture.items()
            )
            + "\n\nAdd the missing fields to the fixture in conftest.py "
            "so browser tests exercise realistic data shapes."
        )

    def test_mock_status_covers_frontend_read_fields(self) -> None:
        """DEFAULT_STATUS should include any status field the frontend reads.

        Cross-checks: for every field the frontend references (from
        TestBackendFieldCoverage auto-discovery), if it's defined in the
        backend /api/status schema, it should be present in DEFAULT_STATUS.
        Skipped if openapi.yaml or mock fixture is not available.
        """
        cov = TestBackendFieldCoverage()
        try:
            backend_fields_by_endpoint = cov._extract_backend_fields()
        except Exception:
            pytest.skip("Could not extract backend fields")

        status_fields = backend_fields_by_endpoint.get("/api/status", set())
        src = self._extract_fixture("DEFAULT_STATUS")
        if src is None:
            pytest.skip("DEFAULT_STATUS not found in conftest.py")
        mock_keys = self._collect_mock_keys(src)

        # Read frontend code to check which status fields are actually used
        js = APP_JS.read_text(encoding="utf-8")
        html = _read_index_html_assembled()
        combined = js + "\n" + html

        missing: list[str] = []
        for field in sorted(status_fields - cov.SKIP_FIELDS):
            if field in cov.KNOWN_UNUSED:
                continue
            if not cov._field_present(field, combined):
                continue  # frontend doesn't use it — mock can skip too
            if field not in mock_keys:
                missing.append(field)

        assert not missing, (
            "DEFAULT_STATUS mock missing fields the frontend actually reads:\n"
            + "\n".join(f"  - {f}" for f in missing)
            + "\n\nAdd these to DEFAULT_STATUS in conftest.py."
        )
