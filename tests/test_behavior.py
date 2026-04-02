"""Behavioral tests: auto-refresh, persistence, error resilience, edge cases,
responsiveness, notifications, and sparklines."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from playwright.sync_api import Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_web.webapp import STATUS_CACHE  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server, bust_cache  # noqa: E402


# ---------------------------------------------------------------------------
# Switchable backend for online/offline tests
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
            return {"ok": False, "backend": {"reachable": False, "error": "connection refused"}}
        return {
            "items": self.items,
            "active": self._active(),
            "state": {"running": bool(self.items), "paused": False, "session_id": "s1"},
            "summary": {"queued": sum(1 for i in self.items if i["status"] == "queued"), "done": 0, "error": 0, "total": len(self.items)},
            "bandwidth": {"source": "default", "downlink_mbps": 50, "cap_mbps": 40, "interface_name": "eth0"},
            "backend": {"reachable": True, "version": "1.0", "pid": 9999},
        }

    def _active(self) -> dict | None:
        for item in self.items:
            if item["status"] == "downloading":
                return {"gid": item["gid"], "url": item["url"], "status": "active", "downloadSpeed": self.speed, "totalLength": 1000000, "completedLength": 500000, "percent": 50.0}
        return None


backend = SwitchableBackend()


@pytest.fixture(scope="module")
def web_server():
    global backend
    backend = SwitchableBackend()
    url, server, patches, _ = start_server(
        extra={"ariaflow_web.webapp.get_status_from": "__SKIP__"},
    )
    # Replace status mock with our switchable one
    p = patch("ariaflow_web.webapp.get_status_from", side_effect=backend.status)
    p.start()
    patches.append(p)
    yield url
    stop_server(server, patches)


@pytest.fixture(scope="module")
def browser_context(shared_browser):
    ctx = shared_browser.new_context()
    yield ctx
    ctx.close()


@pytest.fixture()
def page(browser_context, web_server) -> Page:
    p = browser_context.new_page()
    yield p
    p.close()


def refresh(page: Page) -> None:
    bust_cache()
    page.evaluate("refresh()")
    page.wait_for_timeout(500)


class TestAutoRefresh:
    def test_polling_triggers(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        backend.call_count = 0
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "1500")
        before = backend.call_count
        page.wait_for_timeout(4000)
        assert backend.call_count > before

    def test_off_stops_polling(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "0")
        backend.call_count = 0
        page.wait_for_timeout(2000)
        assert backend.call_count <= 1

    def test_data_change_reflected(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        refresh(page)
        assert "no " in page.inner_text("#queue").lower() or "empty" in page.inner_text("#queue").lower()
        backend.items = [{"id": "r1", "url": "http://example.com/new.bin", "status": "queued", "gid": "g1", "created_at": "2026-04-02"}]
        refresh(page)
        assert "new.bin" in page.inner_text("#queue")
        backend.items = []


class TestBackendTransitions:
    def test_offline_shows_unavailable(self, page: Page, web_server: str) -> None:
        backend.online = False
        page.goto(f"{web_server}/")
        refresh(page)
        assert "offline" in page.inner_text("#queue-state").lower()
        backend.online = True

    def test_recovery_from_offline(self, page: Page, web_server: str) -> None:
        backend.online = False
        page.goto(f"{web_server}/")
        refresh(page)
        backend.online = True
        backend.items = [{"id": "r2", "url": "http://example.com/back.zip", "status": "queued", "gid": "g2", "created_at": "2026-04-02"}]
        refresh(page)
        assert "back.zip" in page.inner_text("#queue")
        backend.items = []


class TestThemePersistence:
    def test_theme_survives_reload(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        for _ in range(3):
            page.click("#theme-btn")
            if page.evaluate("localStorage.getItem('ariaflow.theme')") == "dark":
                break
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        assert page.evaluate("document.documentElement.dataset.theme") == "dark"


class TestBackendPersistence:
    def test_added_backend_survives_reload(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        page.fill("#backend-input", "http://10.20.30.40:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(300)
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        assert "10.20.30.40" in page.inner_html("#backend-panel")


class TestConcurrentRefreshGuard:
    def test_double_refresh(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        bust_cache()
        backend.call_count = 0
        page.evaluate("Promise.all([refresh(), refresh()])")
        page.wait_for_timeout(500)
        assert backend.call_count <= 2


class TestRenderingEdgeCases:
    def test_empty_queue(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        page.goto(f"{web_server}/")
        refresh(page)
        assert "no " in page.inner_text("#queue").lower() or "empty" in page.inner_text("#queue").lower()

    def test_many_items(self, page: Page, web_server: str) -> None:
        backend.items = [{"id": f"m{i}", "url": f"http://example.com/file-{i:03d}.bin", "status": "queued", "gid": f"g{i}", "created_at": "2026-04-02"} for i in range(50)]
        page.goto(f"{web_server}/")
        refresh(page)
        assert len(page.query_selector_all("#queue .item")) == 50
        backend.items = []

    def test_item_with_missing_fields(self, page: Page, web_server: str) -> None:
        backend.items = [{"status": "queued"}]
        page.goto(f"{web_server}/")
        refresh(page)
        assert len(page.query_selector_all("#queue .item")) == 1
        backend.items = []

    def test_zero_speed_no_infinity(self, page: Page, web_server: str) -> None:
        backend.speed = 0
        backend.items = [{"id": "z1", "url": "http://example.com/slow.bin", "status": "downloading", "gid": "gz", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        refresh(page)
        text = page.inner_text("#queue")
        assert "Infinity" not in text and "NaN" not in text
        backend.items = []


class TestErrorResilience:
    def test_invalid_json_declaration(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        page.evaluate('document.getElementById("declaration").value = "not json {{"')
        page.click('.declaration button:has-text("Save")')
        page.wait_for_timeout(300)
        assert "invalid json" in page.inner_text("#result").lower() or "error" in page.inner_text("#result").lower()

    def test_backend_timeout_ui_functional(self, page: Page, web_server: str) -> None:
        backend.online = False
        page.goto(f"{web_server}/")
        refresh(page)
        page.click("#theme-btn")
        assert page.evaluate("document.documentElement.dataset.theme") in ("dark", "light")
        backend.online = True


class TestResponsiveness:
    def test_desktop(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(f"{web_server}/")
        assert len(page.query_selector_all(".span-12")) >= 1

    def test_tablet_no_overflow(self, page: Page, web_server: str) -> None:
        page.set_viewport_size({"width": 768, "height": 1024})
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        assert not page.evaluate("document.body.scrollWidth > document.body.clientWidth")

    def test_mobile_no_overflow(self, page: Page, web_server: str) -> None:
        page.set_viewport_size({"width": 375, "height": 667})
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        assert not page.evaluate("document.body.scrollWidth > document.body.clientWidth")


class TestNotificationFlow:
    def test_no_notification_error_on_click(self, page: Page, web_server: str) -> None:
        backend.online = True
        page.goto(f"{web_server}/")
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.click("#theme-btn")
        page.wait_for_timeout(200)
        assert [e for e in errors if "Notification" in e] == []


class TestSpeedHistory:
    def test_sparkline_renders(self, page: Page, web_server: str) -> None:
        backend.speed = 1048576
        backend.items = [{"id": "sp1", "url": "http://example.com/spark.bin", "status": "downloading", "gid": "gsp", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        for _ in range(3):
            refresh(page)
        assert "svg" in page.inner_html("#global-speed-chart").lower()
        backend.items = []

    def test_sparkline_capped(self, page: Page, web_server: str) -> None:
        backend.speed = 500000
        backend.items = [{"id": "sp2", "url": "http://example.com/cap.bin", "status": "downloading", "gid": "gsp2", "created_at": "2026-04-02"}]
        page.goto(f"{web_server}/")
        for _ in range(35):
            bust_cache()
            page.evaluate("refresh()")
            page.wait_for_timeout(50)
        page.wait_for_timeout(300)
        assert page.evaluate("globalSpeedHistory.length") <= 40
        backend.items = []
