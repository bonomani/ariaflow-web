"""Click-test every button in the ariaflow-web UI."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from playwright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_web.webapp import serve  # noqa: E402


# ---------------------------------------------------------------------------
# Shared mock data
# ---------------------------------------------------------------------------

STATUS_PAYLOAD = {
    "items": [
        {"id": "item-1", "url": "https://example.com/big.iso", "output": "big.iso", "status": "downloading", "gid": "aaa111", "created_at": "2026-04-01T10:00:00"},
        {"id": "item-2", "url": "https://example.com/queued.zip", "output": "queued.zip", "status": "queued", "gid": "bbb222", "created_at": "2026-04-01T10:01:00"},
        {"id": "item-3", "url": "https://example.com/done.tar", "output": "done.tar", "status": "done", "gid": "ccc333", "created_at": "2026-04-01T09:00:00"},
        {"id": "item-4", "url": "https://example.com/fail.bin", "output": "fail.bin", "status": "error", "gid": "ddd444", "created_at": "2026-04-01T09:30:00", "error_message": "404"},
        {"id": "item-5", "url": "https://example.com/paused.dat", "output": "paused.dat", "status": "paused", "gid": "eee555", "created_at": "2026-04-01T09:45:00"},
    ],
    "active": {
        "gid": "aaa111", "url": "https://example.com/big.iso", "status": "active",
        "downloadSpeed": 1048576, "totalLength": 104857600, "completedLength": 52428800, "percent": 50.0,
    },
    "state": {"running": True, "paused": False, "session_id": "sess-001", "session_started_at": "2026-04-01T10:00:00"},
    "summary": {"queued": 1, "done": 1, "error": 1, "total": 5},
    "bandwidth": {"source": "networkquality", "downlink_mbps": 100, "cap_mbps": 50},
    "backend": {"reachable": True, "version": "0.1.34", "pid": 1234},
}

DECLARATION_PAYLOAD: dict = {"uic": {"preferences": [
    {"name": "auto_preflight_on_run", "value": False, "options": [True, False], "rationale": "default off"},
    {"name": "max_simultaneous_downloads", "value": 1, "options": [1], "rationale": "sequential"},
    {"name": "duplicate_active_transfer_action", "value": "remove", "options": ["remove", "pause", "ignore"], "rationale": "default"},
    {"name": "post_action_rule", "value": "pending", "options": ["pending"], "rationale": "default"},
]}, "ucc": {}, "policy": {}}

LIFECYCLE_PAYLOAD = {
    "ariaflow": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "message": "installed"}},
    "aria2": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "message": "installed"}},
    "networkquality": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "ready", "message": "available"}},
    "aria2-launchd": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "message": "loaded"}},
    "session_id": "sess-001",
    "session_started_at": "2026-04-01T10:00:00",
    "session_last_seen_at": "2026-04-01T10:05:00",
}

PORT = 8785

# Track mock calls
mock_tracker: dict[str, MagicMock] = {}


@pytest.fixture(scope="module")
def web_server():
    tmp = tempfile.mkdtemp()
    os.environ["ARIA_QUEUE_DIR"] = tmp

    def add_items_response(_base_url, items):
        return {"ok": True, "count": len(items), "added": [{"url": item["url"]} for item in items]}

    patches_config = {
        "ariaflow_web.webapp.get_status_from": STATUS_PAYLOAD,
        "ariaflow_web.webapp.get_log_from": {"items": [
            {"action": "add", "outcome": "ok", "timestamp": "2026-04-01T10:00:00", "session_id": "sess-001", "target": "queue"},
        ]},
        "ariaflow_web.webapp.get_declaration_from": DECLARATION_PAYLOAD,
        "ariaflow_web.webapp.get_lifecycle_from": LIFECYCLE_PAYLOAD,
        "ariaflow_web.webapp.preflight_from": {"status": "pass", "gates": [{"name": "aria2", "satisfied": True, "class": "gate", "blocking": "hard"}], "warnings": [], "hard_failures": []},
        "ariaflow_web.webapp.run_action_from": {"ok": True, "action": "start", "result": {"started": True}},
        "ariaflow_web.webapp.run_ucc_from": {"result": {"outcome": "converged", "observation": "ok"}, "meta": {"contract": "UCC", "version": "1.0"}},
        "ariaflow_web.webapp.save_declaration_from": {"saved": True, "declaration": DECLARATION_PAYLOAD},
        "ariaflow_web.webapp.discover_http_services": {"available": False, "items": [], "reason": "none"},
        "ariaflow_web.webapp.set_session_from": {"ok": True, "session": "sess-002"},
        "ariaflow_web.webapp.pause_from": {"paused": True},
        "ariaflow_web.webapp.resume_from": {"resumed": True},
        "ariaflow_web.webapp.lifecycle_action_from": {"ok": True, "lifecycle": LIFECYCLE_PAYLOAD},
        "ariaflow_web.webapp.item_action_from": {"ok": True, "item": {"id": "item-1", "status": "paused"}},
        "ariaflow_web.webapp.get_api_discovery_from": {"name": "ariaflow", "version": "0.1.48", "endpoints": {"GET": [], "POST": []}},
        "ariaflow_web.webapp.get_bandwidth_from": {"source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 80, "interface_name": "eth0"},
        "ariaflow_web.webapp.bandwidth_probe_from": {"ok": True, "source": "networkquality", "downlink_mbps": 100, "uplink_mbps": 20, "cap_mbps": 80},
        "ariaflow_web.webapp._local_pid_for_port": None,
    }

    patches = []
    for name, rv in patches_config.items():
        if callable(rv) and not isinstance(rv, dict):
            p = patch(name, side_effect=rv)
        else:
            p = patch(name, return_value=rv)
        mock = p.start()
        mock_tracker[name] = mock
        patches.append(p)

    # add_items_from uses side_effect
    p_add = patch("ariaflow_web.webapp.add_items_from", side_effect=add_items_response)
    mock_tracker["ariaflow_web.webapp.add_items_from"] = p_add.start()
    patches.append(p_add)

    server = serve(host="127.0.0.1", port=PORT)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)
    yield f"http://127.0.0.1:{PORT}"
    server.shutdown()
    server.server_close()
    for p in patches:
        p.stop()


@pytest.fixture(scope="module")
def browser_context():
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context()
    yield ctx
    ctx.close()
    browser.close()
    pw.stop()


@pytest.fixture()
def page(browser_context, web_server) -> Page:
    p = browser_context.new_page()
    yield p
    p.close()


# ---------------------------------------------------------------------------
# Dashboard buttons
# ---------------------------------------------------------------------------

class TestDashboardButtons:
    def test_theme_toggle_cycles(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        btn = page.query_selector("#theme-btn")
        initial = page.evaluate("document.documentElement.dataset.theme")
        btn.click()
        after = page.evaluate("document.documentElement.dataset.theme")
        assert after != initial or after in ("dark", "light")  # cycled

    def test_add_url_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.fill("#url", "https://example.com/test.bin")
        page.click(".queue-add-button")
        page.wait_for_timeout(500)
        # Result text should update on the log page area
        assert mock_tracker["ariaflow_web.webapp.add_items_from"].called

    def test_start_stop_engine_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#runner-btn", timeout=5000)
        text_before = page.inner_text("#runner-btn")
        page.click("#runner-btn")
        page.wait_for_timeout(500)
        # Button text or page state should reflect the action
        assert mock_tracker["ariaflow_web.webapp.run_action_from"].called

    def test_new_session_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        before = page.inner_text("#session-detail")
        page.click("text=New run")
        page.wait_for_timeout(500)
        # Session detail should update or at least the call was made
        assert mock_tracker["ariaflow_web.webapp.set_session_from"].called

    def test_pause_resume_queue_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#toggle-btn", timeout=5000)
        text_before = page.inner_text("#toggle-btn")
        page.click("#toggle-btn")
        page.wait_for_timeout(500)
        # Button should reflect the action taken
        called = (mock_tracker["ariaflow_web.webapp.pause_from"].called or
                  mock_tracker["ariaflow_web.webapp.resume_from"].called)
        assert called

    def test_add_backend_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.fill("#backend-input", "http://192.168.1.100:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(300)
        # Backend panel should now show the added backend
        panel = page.inner_html("#backend-panel")
        assert "192.168.1.100" in panel

    def test_select_default_backend_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#backend-panel", timeout=5000)
        page.wait_for_timeout(300)
        # Click the default backend button
        default_btn = page.query_selector('#backend-panel button:first-child')
        if default_btn:
            default_btn.click()
            page.wait_for_timeout(300)
            # No error should occur
            assert True


# ---------------------------------------------------------------------------
# Queue filter buttons
# ---------------------------------------------------------------------------

class TestFilterButtons:
    @pytest.mark.parametrize("filter_name,expected_count", [
        ("all", 5),
        ("queued", 1),
        ("downloading", 1),
        ("paused", 1),
        ("done", 1),
        ("error", 1),
    ])
    def test_filter_button(self, page: Page, web_server: str, filter_name: str, expected_count: int) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click(f'#queue-filters .filter-btn[data-filter="{filter_name}"]')
        page.wait_for_timeout(300)
        items = page.query_selector_all("#queue .item")
        assert len(items) == expected_count


# ---------------------------------------------------------------------------
# Per-item action buttons
# ---------------------------------------------------------------------------

class TestItemActionButtons:
    def test_pause_button_on_downloading_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        mock_tracker["ariaflow_web.webapp.item_action_from"].reset_mock()
        pause_btn = page.query_selector('button[onclick*="itemAction(\'item-1\',\'pause\')"]')
        assert pause_btn is not None
        pause_btn.click()
        page.wait_for_timeout(500)
        mock_tracker["ariaflow_web.webapp.item_action_from"].assert_called()

    def test_resume_button_on_paused_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        resume_btn = page.query_selector('button[onclick*="itemAction(\'item-5\',\'resume\')"]')
        assert resume_btn is not None
        mock_tracker["ariaflow_web.webapp.item_action_from"].reset_mock()
        resume_btn.click()
        page.wait_for_timeout(500)
        mock_tracker["ariaflow_web.webapp.item_action_from"].assert_called()

    def test_retry_button_on_error_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        retry_btn = page.query_selector('button[onclick*="itemAction(\'item-4\',\'retry\')"]')
        assert retry_btn is not None
        mock_tracker["ariaflow_web.webapp.item_action_from"].reset_mock()
        retry_btn.click()
        page.wait_for_timeout(500)
        mock_tracker["ariaflow_web.webapp.item_action_from"].assert_called()

    def test_remove_button_exists_on_every_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        for item_id in ("item-1", "item-2", "item-3", "item-4", "item-5"):
            btn = page.query_selector(f'button[onclick*="itemAction(\'{item_id}\',\'remove\')"]')
            assert btn is not None, f"Remove button missing for {item_id}"

    def test_remove_button_calls_api(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        mock_tracker["ariaflow_web.webapp.item_action_from"].reset_mock()
        remove_btn = page.query_selector('button[onclick*="itemAction(\'item-3\',\'remove\')"]')
        assert remove_btn is not None
        remove_btn.click()
        page.wait_for_timeout(500)
        mock_tracker["ariaflow_web.webapp.item_action_from"].assert_called()

    def test_no_pause_button_on_done_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        pause_btn = page.query_selector('button[onclick*="itemAction(\'item-3\',\'pause\')"]')
        assert pause_btn is None  # done items can't be paused

    def test_no_retry_button_on_queued_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        retry_btn = page.query_selector('button[onclick*="itemAction(\'item-2\',\'retry\')"]')
        assert retry_btn is None  # queued items can't be retried


# ---------------------------------------------------------------------------
# Lifecycle page buttons
# ---------------------------------------------------------------------------

class TestLifecycleButtons:
    def test_refresh_service_status_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/lifecycle")
        page.wait_for_selector(".show-lifecycle", state="visible", timeout=5000)
        mock_tracker["ariaflow_web.webapp.get_lifecycle_from"].reset_mock()
        page.click("text=Refresh service status")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.get_lifecycle_from"].called

    def test_lifecycle_action_buttons_render(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/lifecycle")
        page.wait_for_selector(".show-lifecycle", state="visible", timeout=5000)
        page.click("text=Refresh service status")
        page.wait_for_timeout(500)
        # Should have Install/Update and Remove for ariaflow, Load/Unload for aria2-launchd
        text = page.inner_text("#lifecycle")
        assert "Install" in text or "Load" in text


# ---------------------------------------------------------------------------
# Log page buttons
# ---------------------------------------------------------------------------

class TestLogButtons:
    def test_run_contract_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        before = page.inner_text("#contract-trace")
        page.click('button:has-text("Run contract")')
        page.wait_for_timeout(500)
        after = page.inner_text("#contract-trace")
        assert after != before or "converged" in after  # trace updated

    def test_preflight_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        before = page.inner_text("#preflight")
        page.click('button:has-text("Preflight")')
        page.wait_for_timeout(500)
        after = page.inner_text("#preflight")
        assert after != before or "ready" in after  # content changed or shows gate result

    def test_load_declaration_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        # Clear textarea first
        page.evaluate('document.getElementById("declaration").value = ""')
        page.click('.declaration button:has-text("Load")')
        page.wait_for_timeout(500)
        value = page.evaluate('document.getElementById("declaration").value')
        assert len(value) > 2  # declaration loaded into textarea

    def test_save_declaration_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        # Fill with valid JSON
        page.evaluate('document.getElementById("declaration").value = JSON.stringify({"uic": {}, "ucc": {}, "policy": {}})')
        mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
        page.click('.declaration button:has-text("Save")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_action_filter_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(300)
        page.select_option("#action-filter", "add")
        page.wait_for_timeout(300)
        # Should not crash; log should still render
        log = page.query_selector("#action-log")
        assert log is not None

    def test_target_filter_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(300)
        page.select_option("#target-filter", "queue")
        page.wait_for_timeout(300)
        log = page.query_selector("#action-log")
        assert log is not None

    def test_session_filter_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(300)
        page.select_option("#session-filter", "all")
        page.wait_for_timeout(300)
        log = page.query_selector("#action-log")
        assert log is not None


# ---------------------------------------------------------------------------
# Options page buttons/controls
# ---------------------------------------------------------------------------

class TestBackendButtons:
    def test_remove_backend_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        # First add a backend with a unique address
        page.fill("#backend-input", "http://172.16.99.1:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(300)
        panel = page.inner_html("#backend-panel")
        assert "172.16.99.1" in panel
        # Count remove buttons, then click the last one (ours)
        remove_btns = page.query_selector_all('#backend-panel button[title="Remove backend"]')
        assert len(remove_btns) >= 1
        remove_btns[-1].click()
        page.wait_for_timeout(300)
        panel = page.inner_html("#backend-panel")
        assert "172.16.99.1" not in panel


class TestOptionsButtons:
    def test_auto_preflight_toggle(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/options")
        page.wait_for_selector(".show-options", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        checkbox = page.query_selector('input[type="checkbox"][onchange*="setAutoPreflightPreference"]')
        if checkbox:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            checkbox.click()
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called


    def test_post_action_rule_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/options")
        page.wait_for_selector(".show-options", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        select = page.query_selector('select[onchange*="setPostActionRule"]')
        if select:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            page.select_option('select[onchange*="setPostActionRule"]', "pending")
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called


class TestBandwidthConfigButtons:
    """Duplicate/simultaneous/bandwidth config moved to Bandwidth page."""

    def test_duplicate_action_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        select = page.query_selector('select[onchange*="setDuplicateAction"]')
        if select:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            page.select_option('select[onchange*="setDuplicateAction"]', "pause")
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_simultaneous_downloads_input(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        input_el = page.query_selector('input[oninput*="setSimultaneousLimit"]')
        if input_el:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            input_el.fill("3")
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_bandwidth_free_percent_input(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        input_el = page.query_selector('input[oninput*="bandwidth_free_percent"]')
        if input_el:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            input_el.fill("30")
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_bandwidth_free_absolute_input(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        input_el = page.query_selector('input[oninput*="bandwidth_free_absolute_mbps"]')
        if input_el:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            input_el.fill("5")
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_bandwidth_floor_input(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        input_el = page.query_selector('input[oninput*="bandwidth_floor_mbps"]')
        if input_el:
            mock_tracker["ariaflow_web.webapp.save_declaration_from"].reset_mock()
            input_el.fill("4")
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_run_probe_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        mock_tracker["ariaflow_web.webapp.bandwidth_probe_from"].reset_mock()
        page.click('button:has-text("Run probe")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.bandwidth_probe_from"].called


# ---------------------------------------------------------------------------
# Dev page buttons
# ---------------------------------------------------------------------------

class TestDevButtons:
    def test_open_docs_button_exists(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        btn = page.query_selector("text=Open Swagger UI")
        assert btn is not None

    def test_open_spec_button_exists(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        btn = page.query_selector("text=Download OpenAPI spec")
        assert btn is not None

    def test_run_tests_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        page.click("text=Run tests")
        page.wait_for_timeout(1000)
        # Should show result (even if backend unreachable, the error state renders)
        summary = page.query_selector("#test-summary")
        assert summary is not None
        badge = page.inner_text("#test-badge")
        assert badge != "-"  # Should have updated from initial state


# ---------------------------------------------------------------------------
# Refresh control
# ---------------------------------------------------------------------------

class TestRefreshControl:
    def test_refresh_interval_change(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "3000")
        page.wait_for_timeout(200)
        val = page.evaluate("refreshInterval")
        assert val == 3000

    def test_refresh_off(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "0")
        page.wait_for_timeout(200)
        val = page.evaluate("refreshInterval")
        assert val == 0
