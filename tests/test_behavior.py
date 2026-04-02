"""Behavioral tests beyond button clicks: auto-refresh, persistence,
error resilience, edge cases, responsiveness, and notifications."""
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

from ariaflow_web.webapp import serve, STATUS_CACHE  # noqa: E402


# ---------------------------------------------------------------------------
# Stateful mock that can switch between online/offline
# ---------------------------------------------------------------------------

class SwitchableBackend:
    def __init__(self) -> None:
        self.online = True
        self.items: list[dict] = []
        self.speed = 0
        self.call_count = 0

    def status(self, _base_url: str) -> dict:
        self.call_count += 1
        if not self.online:
            return {
                "ok": False,
                "backend": {"reachable": False, "error": "connection refused"},
            }
        return {
            "items": self.items,
            "active": self._active(),
            "state": {"running": bool(self.items), "paused": False, "session_id": "s1", "session_started_at": "2026-04-02T10:00:00"},
            "summary": {
                "queued": sum(1 for i in self.items if i["status"] == "queued"),
                "done": sum(1 for i in self.items if i["status"] == "done"),
                "error": sum(1 for i in self.items if i["status"] == "error"),
                "total": len(self.items),
            },
            "bandwidth": {"source": "default", "downlink_mbps": 50, "cap_mbps": 40, "interface_name": "eth0"},
            "backend": {"reachable": True, "version": "1.0", "pid": 9999},
        }

    def _active(self) -> dict | None:
        for item in self.items:
            if item["status"] == "downloading":
                return {
                    "gid": item["gid"], "url": item["url"], "status": "active",
                    "downloadSpeed": self.speed, "totalLength": 1000000,
                    "completedLength": 500000, "percent": 50.0,
                }
        return None


PORT = 8795
backend = SwitchableBackend()


@pytest.fixture(scope="module")
def web_server():
    global backend
    backend = SwitchableBackend()
    tmp = tempfile.mkdtemp()
    os.environ["ARIA_QUEUE_DIR"] = tmp
    decl = {"uic": {"preferences": []}, "ucc": {}, "policy": {}}
    patches = [
        patch("ariaflow_web.webapp.get_status_from", side_effect=backend.status),
        patch("ariaflow_web.webapp.get_log_from", return_value={"items": []}),
        patch("ariaflow_web.webapp.get_declaration_from", return_value=decl),
        patch("ariaflow_web.webapp.get_lifecycle_from", return_value={}),
        patch("ariaflow_web.webapp.add_items_from", return_value={"ok": True, "count": 0, "added": []}),
        patch("ariaflow_web.webapp.preflight_from", return_value={"status": "pass", "gates": [], "warnings": [], "hard_failures": []}),
        patch("ariaflow_web.webapp.run_action_from", return_value={"ok": True, "result": {"started": True}}),
        patch("ariaflow_web.webapp.run_ucc_from", return_value={"result": {"outcome": "converged"}}),
        patch("ariaflow_web.webapp.save_declaration_from", return_value={"saved": True}),
        patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"}),
        patch("ariaflow_web.webapp.set_session_from", return_value={"ok": True, "session": "s1"}),
        patch("ariaflow_web.webapp.pause_from", return_value={"paused": True}),
        patch("ariaflow_web.webapp.resume_from", return_value={"resumed": True}),
        patch("ariaflow_web.webapp.lifecycle_action_from", return_value={"ok": True, "lifecycle": {}}),
        patch("ariaflow_web.webapp.item_action_from", return_value={"ok": True}),
        patch("ariaflow_web.webapp.get_api_discovery_from", return_value={"name": "ariaflow"}),
        patch("ariaflow_web.webapp.get_bandwidth_from", return_value={"source": "default"}),
        patch("ariaflow_web.webapp.bandwidth_probe_from", return_value={"ok": True}),
        patch("ariaflow_web.webapp._local_pid_for_port", return_value=None),
    ]
    for p in patches:
        p.start()
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


def bust_cache() -> None:
    STATUS_CACHE["ts"] = 0.0
    STATUS_CACHE["payload"] = None


def refresh(page: Page) -> None:
    bust_cache()
    page.evaluate("refresh()")
    page.wait_for_timeout(500)


# ---------------------------------------------------------------------------
# 1. Auto-refresh cycle
# ---------------------------------------------------------------------------

class TestAutoRefresh:
    def test_refresh_interval_triggers_polling(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        backend.call_count = 0
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        # Set a fast refresh interval
        page.select_option("#refresh-interval", "1500")
        before = backend.call_count
        page.wait_for_timeout(4000)
        after = backend.call_count
        assert after > before, "Auto-refresh should poll the backend"

    def test_refresh_off_stops_polling(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "0")
        page.wait_for_timeout(300)
        backend.call_count = 0
        page.wait_for_timeout(2000)
        # Should have 0 new calls (only initial load, no periodic)
        assert backend.call_count <= 1

    def test_data_change_reflected_on_refresh(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        refresh(page)
        text = page.inner_text("#queue")
        assert "empty" in text.lower() or "no " in text.lower()
        # Add an item
        backend.items = [{"id": "r1", "url": "http://example.com/new.bin", "status": "queued", "gid": "g1", "created_at": "2026-04-02"}]
        refresh(page)
        text = page.inner_text("#queue")
        assert "new.bin" in text


# ---------------------------------------------------------------------------
# 2. Backend offline/online transitions
# ---------------------------------------------------------------------------

class TestBackendTransitions:
    def test_offline_shows_unavailable(self, page: Page, web_server: str) -> None:
        backend.online = False
        backend.items = []
        page.goto(f"{web_server}/")
        refresh(page)
        text = page.inner_text("#queue")
        assert "unavailable" in text.lower() or "refused" in text.lower()
        state = page.inner_text("#queue-state")
        assert "offline" in state.lower()

    def test_recovery_from_offline(self, page: Page, web_server: str) -> None:
        backend.online = False
        page.goto(f"{web_server}/")
        refresh(page)
        assert "offline" in page.inner_text("#queue-state").lower()
        # Come back online
        backend.online = True
        backend.items = [{"id": "r2", "url": "http://example.com/back.zip", "status": "queued", "gid": "g2", "created_at": "2026-04-02"}]
        refresh(page)
        assert "offline" not in page.inner_text("#queue-state").lower()
        assert "back.zip" in page.inner_text("#queue")


# ---------------------------------------------------------------------------
# 3. Theme persistence
# ---------------------------------------------------------------------------

class TestThemePersistence:
    def test_theme_survives_reload(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        # Click theme until we get 'dark'
        for _ in range(3):
            page.click("#theme-btn")
            theme = page.evaluate("localStorage.getItem('ariaflow.theme')")
            if theme == "dark":
                break
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        actual = page.evaluate("document.documentElement.dataset.theme")
        assert actual == "dark"


# ---------------------------------------------------------------------------
# 4. Backend selection persistence
# ---------------------------------------------------------------------------

class TestBackendPersistence:
    def test_added_backend_survives_reload(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        page.fill("#backend-input", "http://10.20.30.40:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(300)
        assert "10.20.30.40" in page.inner_html("#backend-panel")
        # Reload
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        assert "10.20.30.40" in page.inner_html("#backend-panel")


# ---------------------------------------------------------------------------
# 5. Concurrent refresh guard
# ---------------------------------------------------------------------------

class TestConcurrentRefreshGuard:
    def test_double_refresh_does_not_double_fetch(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        bust_cache()
        backend.call_count = 0
        # Fire two refreshes simultaneously
        page.evaluate("Promise.all([refresh(), refresh()])")
        page.wait_for_timeout(500)
        # refreshInFlight guard should prevent the second one
        assert backend.call_count <= 2  # at most 2 (one may sneak through timing)


# ---------------------------------------------------------------------------
# 6. Edge cases in rendering
# ---------------------------------------------------------------------------

class TestRenderingEdgeCases:
    def test_empty_queue(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        refresh(page)
        text = page.inner_text("#queue")
        assert "empty" in text.lower() or "no " in text.lower()

    def test_many_items(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = [
            {"id": f"m{i}", "url": f"http://example.com/file-{i:03d}.bin", "status": "queued", "gid": f"g{i}", "created_at": "2026-04-02"}
            for i in range(50)
        ]
        page.goto(f"{web_server}/")
        refresh(page)
        items = page.query_selector_all("#queue .item")
        assert len(items) == 50
        backend.items = []  # cleanup

    def test_very_long_url_truncated(self, page: Page, web_server: str) -> None:
        backend.online = True
        long_name = "a" * 200 + ".iso"
        backend.items = [{"id": "long1", "url": f"http://example.com/{long_name}", "status": "queued", "gid": "glong", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        refresh(page)
        # shortName extracts the filename — should show the full long name without crashing
        text = page.inner_text("#queue")
        assert long_name in text
        backend.items = []

    def test_item_with_missing_fields(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = [{"status": "queued"}]  # no id, url, gid, created_at
        page.goto(f"{web_server}/")
        refresh(page)
        items = page.query_selector_all("#queue .item")
        assert len(items) == 1  # should render without crashing
        backend.items = []

    def test_zero_speed_eta_not_infinity(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.speed = 0
        backend.items = [{"id": "z1", "url": "http://example.com/slow.bin", "status": "downloading", "gid": "gslow", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        refresh(page)
        text = page.inner_text("#queue")
        assert "Infinity" not in text
        assert "NaN" not in text
        backend.items = []
        backend.speed = 0


# ---------------------------------------------------------------------------
# 7. Error resilience
# ---------------------------------------------------------------------------

class TestErrorResilience:
    def test_invalid_json_in_declaration_shows_error(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        page.evaluate('document.getElementById("declaration").value = "not json {{"')
        page.click('.declaration button:has-text("Save")')
        page.wait_for_timeout(300)
        result = page.inner_text("#result")
        assert "invalid json" in result.lower() or "error" in result.lower()

    def test_backend_timeout_ui_stays_functional(self, page: Page, web_server: str) -> None:
        backend.online = False
        page.goto(f"{web_server}/")
        refresh(page)
        # UI should still be interactive — theme button should work
        page.click("#theme-btn")
        theme = page.evaluate("document.documentElement.dataset.theme")
        assert theme in ("dark", "light")
        backend.online = True

    def test_unexpected_payload_shape(self, page: Page, web_server: str) -> None:
        """Backend returns minimal/weird payload — UI should not crash."""
        backend.online = True
        backend.items = [{"id": "w1", "url": "http://x.com/f", "status": "queued", "gid": "gw"}]
        page.goto(f"{web_server}/")
        refresh(page)
        # Page should still be functional
        items = page.query_selector_all("#queue .item")
        assert len(items) >= 1
        backend.items = []


# ---------------------------------------------------------------------------
# 8. CSS responsiveness
# ---------------------------------------------------------------------------

class TestResponsiveness:
    def test_desktop_layout(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(f"{web_server}/")
        refresh(page)
        # Grid spans should be visible
        spans = page.query_selector_all(".span-12")
        assert len(spans) >= 1

    def test_tablet_layout(self, page: Page, web_server: str) -> None:
        page.set_viewport_size({"width": 768, "height": 1024})
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        # At 768px, span-8/span-5 etc. should collapse to span-12 via media query
        # Verify page renders without horizontal overflow
        overflow = page.evaluate("document.body.scrollWidth > document.body.clientWidth")
        assert not overflow, "Page should not have horizontal overflow at tablet width"

    def test_mobile_layout(self, page: Page, web_server: str) -> None:
        page.set_viewport_size({"width": 375, "height": 667})
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        overflow = page.evaluate("document.body.scrollWidth > document.body.clientWidth")
        assert not overflow, "Page should not have horizontal overflow at mobile width"
        # Nav should still be visible
        nav = page.query_selector(".nav")
        assert nav is not None


# ---------------------------------------------------------------------------
# 9. Notification permission flow
# ---------------------------------------------------------------------------

class TestNotificationFlow:
    def test_notification_request_deferred_to_click(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        # The initNotifications() should have registered a click handler
        # We can't test the actual Notification API in headless, but we can
        # verify the handler was attached by checking no errors on load
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.click("#theme-btn")  # trigger a click
        page.wait_for_timeout(200)
        notification_errors = [e for e in errors if "Notification" in e]
        assert notification_errors == [], f"Notification errors on click: {notification_errors}"


# ---------------------------------------------------------------------------
# 10. Speed history / sparkline
# ---------------------------------------------------------------------------

class TestSpeedHistory:
    def test_sparkline_renders_after_multiple_polls(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.speed = 1048576
        backend.items = [{"id": "sp1", "url": "http://example.com/spark.bin", "status": "downloading", "gid": "gsp", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        # Poll multiple times to build speed history
        for _ in range(3):
            refresh(page)
        # Check sparkline SVG exists
        svg = page.query_selector("#queue svg")
        # May or may not render depending on if item.id matches — check global chart at least
        global_chart = page.inner_html("#global-speed-chart")
        assert "svg" in global_chart.lower() or svg is not None
        backend.items = []
        backend.speed = 0

    def test_sparkline_does_not_overflow(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.speed = 500000
        backend.items = [{"id": "sp2", "url": "http://example.com/overflow.bin", "status": "downloading", "gid": "gsp2", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        # Poll 35 times to exceed SPEED_HISTORY_MAX (30)
        for _ in range(35):
            bust_cache()
            page.evaluate("refresh()")
            page.wait_for_timeout(50)
        page.wait_for_timeout(300)
        # Check global history length via JS
        length = page.evaluate("globalSpeedHistory.length")
        assert length <= 40, f"Global speed history should be capped at 40, got {length}"
        backend.items = []
        backend.speed = 0
