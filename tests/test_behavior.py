"""Behavioral tests: auto-refresh, persistence, error resilience, edge cases,
responsiveness, notifications, and sparklines."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from playwright.sync_api import Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server, DEFAULT_STATUS  # noqa: E402

pytestmark = pytest.mark.slow
_ALPINE_EVAL = "document.querySelector('[x-data]')._x_dataStack[0]"


def _goto(page: Page, url: str) -> None:
    page.goto(url)
    page.wait_for_timeout(400)


# ---------------------------------------------------------------------------
# Switchable backend for online/offline tests
# ---------------------------------------------------------------------------

class SwitchableBackend:
    def __init__(self) -> None:
        self.online = True
        self.items: list[dict] = []
        self.speed = 0
        self.call_count = 0

    def status(self) -> dict:
        self.call_count += 1
        if not self.online:
            return {"ok": False, "ariaflow": {"reachable": False, "error": "connection refused"}}
        return {
            "items": self.items,
            "active": self._active(),
            "state": {"running": bool(self.items), "paused": False, "session_id": "s1"},
            "summary": {"queued": sum(1 for i in self.items if i["status"] == "queued"), "done": 0, "error": 0, "total": len(self.items)},
            "bandwidth": {"source": "default", "downlink_mbps": 50, "cap_mbps": 40, "interface_name": "eth0"},
            "ariaflow": {"reachable": True, "version": "1.0", "pid": 9999},
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
    url, _, web_srv, backend_srv, patches, handler_cls = start_server()
    handler_cls.status_data = lambda: backend.status()
    yield url
    stop_server(web_srv, backend_srv, patches)


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
    page.evaluate(f"{_ALPINE_EVAL}._consecutiveFailures = 0; {_ALPINE_EVAL}.lastRev = null")
    page.evaluate(f"(async () => await {_ALPINE_EVAL}.refresh())()")
    page.wait_for_timeout(800)


def queue_text(page: Page) -> str:
    return page.inner_text("body")


class TestAutoRefresh:
    def test_polling_triggers(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        backend.call_count = 0
        _goto(page, f"{web_server}/")
        page.select_option("#refresh-interval", "1500")
        before = backend.call_count
        page.wait_for_timeout(4000)
        assert backend.call_count > before

    def test_off_stops_polling(self, page: Page, web_server: str) -> None:
        backend.online = True
        _goto(page, f"{web_server}/")
        page.select_option("#refresh-interval", "0")
        backend.call_count = 0
        page.wait_for_timeout(2000)
        assert backend.call_count <= 1

    def test_data_change_reflected(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        _goto(page, f"{web_server}/")
        refresh(page)
        text = queue_text(page)
        assert "no " in text.lower() or "empty" in text.lower()
        backend.items = [{"id": "r1", "url": "http://example.com/new.bin", "status": "queued", "gid": "g1", "created_at": "2026-04-02"}]
        refresh(page)
        assert "new.bin" in queue_text(page)
        backend.items = []


class TestBackendTransitions:
    def test_offline_shows_unavailable(self, page: Page, web_server: str) -> None:
        backend.online = False
        _goto(page, f"{web_server}/")
        # Need 3 consecutive failures to trigger offline display (flicker prevention)
        for _ in range(3):
            refresh(page)
        text = queue_text(page)
        assert "offline" in text.lower() or "unavailable" in text.lower() or "unreachable" in text.lower()
        backend.online = True

    def test_recovery_from_offline(self, page: Page, web_server: str) -> None:
        backend.online = False
        _goto(page, f"{web_server}/")
        refresh(page)
        backend.online = True
        backend.items = [{"id": "r2", "url": "http://example.com/back.zip", "status": "queued", "gid": "g2", "created_at": "2026-04-02"}]
        refresh(page)
        assert "back.zip" in queue_text(page)
        backend.items = []


class TestThemePersistence:
    def test_theme_survives_reload(self, page: Page, web_server: str) -> None:
        backend.online = True
        _goto(page, f"{web_server}/")
        for _ in range(3):
            page.click('button:has-text("Theme")')
            page.wait_for_timeout(100)
            if page.evaluate("localStorage.getItem('ariaflow.theme')") == "dark":
                break
        _goto(page, f"{web_server}/")
        assert page.evaluate("document.documentElement.dataset.theme") == "dark"


class TestBackendPersistence:
    def test_added_backend_survives_reload(self, page: Page, web_server: str) -> None:
        backend.online = True
        _goto(page, f"{web_server}/")
        page.fill('input[x-model="backendInput"]', "http://10.20.30.40:8000")
        page.click('button:has-text("Add")')
        page.wait_for_timeout(500)
        _goto(page, f"{web_server}/")
        backends = page.evaluate("JSON.parse(localStorage.getItem('ariaflow.backends') || '[]')")
        assert any("10.20.30.40" in b for b in backends)


class TestConcurrentRefreshGuard:
    def test_double_refresh(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        _goto(page, f"{web_server}/")
        pass  # no server-side cache to bust
        backend.call_count = 0
        page.evaluate(f"Promise.all([{_ALPINE_EVAL}.refresh(), {_ALPINE_EVAL}.refresh()])")
        page.wait_for_timeout(500)
        assert backend.call_count <= 2


class TestRenderingEdgeCases:
    def test_empty_queue(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = []
        _goto(page, f"{web_server}/")
        refresh(page)
        text = queue_text(page)
        assert "no " in text.lower() or "empty" in text.lower()

    @pytest.mark.xfail(reason="flaky: shared mock backend state across fixtures")
    def test_many_items(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = [{"id": f"m{i}", "url": f"http://example.com/file-{i:03d}.bin", "status": "queued", "gid": f"g{i}", "created_at": "2026-04-02"} for i in range(50)]
        _goto(page, f"{web_server}/")
        refresh(page)
        page.wait_for_timeout(1500)
        count = len(page.query_selector_all(".item.compact:not(.add-card)"))
        if count == 0:  # retry once on slow startup
            refresh(page)
            page.wait_for_timeout(1500)
            count = len(page.query_selector_all(".item.compact:not(.add-card)"))
        assert count == 50
        backend.items = []

    @pytest.mark.xfail(reason="flaky: shared mock backend state across fixtures")
    def test_item_with_missing_fields(self, page: Page, web_server: str) -> None:
        backend.online = True
        backend.items = [{"status": "queued"}]
        _goto(page, f"{web_server}/")
        refresh(page)
        assert len(page.query_selector_all(".item.compact:not(.add-card)")) == 1
        backend.items = []

    @pytest.mark.xfail(reason="flaky: shared mock backend state across fixtures")
    def test_zero_speed_no_infinity(self, page: Page, web_server: str) -> None:
        backend.speed = 0
        backend.items = [{"id": "z1", "url": "http://example.com/slow.bin", "status": "downloading", "gid": "gz", "created_at": "2026-04-02"}]
        _goto(page, f"{web_server}/")
        refresh(page)
        text = queue_text(page)
        assert "Infinity" not in text and "NaN" not in text
        backend.items = []


class TestErrorResilience:
    def test_invalid_json_declaration(self, page: Page, web_server: str) -> None:
        backend.online = True
        _goto(page, f"{web_server}/log")
        page.wait_for_selector("body.page-log", timeout=8000)
        page.wait_for_timeout(500)
        page.evaluate(f'{_ALPINE_EVAL}.declarationText = "not json {{"')
        page.click('.declaration button:has-text("Save")')
        page.wait_for_timeout(300)
        text = page.inner_text("body")
        assert "invalid" in text.lower() or "error" in text.lower() or "json" in text.lower()

    def test_backend_timeout_ui_functional(self, page: Page, web_server: str) -> None:
        backend.online = False
        _goto(page, f"{web_server}/")
        refresh(page)
        page.click('button:has-text("Theme")')
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
        _goto(page, f"{web_server}/")
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.click('button:has-text("Theme")')
        page.wait_for_timeout(200)
        assert [e for e in errors if "Notification" in e] == []


class TestSpeedHistory:
    @pytest.mark.xfail(reason="flaky: shared mock backend state")
    def test_sparkline_renders(self, page: Page, web_server: str) -> None:
        backend.speed = 1048576
        backend.items = [{"id": "sp1", "url": "http://example.com/spark.bin", "status": "downloading", "gid": "gsp", "created_at": "2026-04-02"}]
        _goto(page, f"{web_server}/")
        for _ in range(3):
            refresh(page)
        svg = page.evaluate(f"{_ALPINE_EVAL}.globalSparklineSvg")
        assert "svg" in str(svg).lower()
        backend.items = []

    def test_sparkline_capped(self, page: Page, web_server: str) -> None:
        backend.speed = 500000
        backend.items = [{"id": "sp2", "url": "http://example.com/cap.bin", "status": "downloading", "gid": "gsp2", "created_at": "2026-04-02"}]
        _goto(page, f"{web_server}/")
        for _ in range(35):
            pass  # no server-side cache to bust
            page.evaluate(f"{_ALPINE_EVAL}.refresh()")
            page.wait_for_timeout(50)
        page.wait_for_timeout(300)
        length = page.evaluate(f"{_ALPINE_EVAL}.globalSpeedHistory.length")
        assert length <= 40
        backend.items = []
