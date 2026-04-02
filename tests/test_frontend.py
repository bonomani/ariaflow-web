from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_web.webapp import serve  # noqa: E402


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

STATUS_PAYLOAD = {
    "items": [
        {"id": "item-1", "url": "https://example.com/big.iso", "output": "big.iso", "status": "downloading", "gid": "aaa111", "created_at": "2026-04-01T10:00:00"},
        {"id": "item-2", "url": "https://example.com/small.zip", "output": "small.zip", "status": "queued", "gid": "bbb222", "created_at": "2026-04-01T10:01:00"},
        {"id": "item-3", "url": "https://example.com/done.tar", "output": "done.tar", "status": "done", "gid": "ccc333", "created_at": "2026-04-01T09:00:00"},
        {"id": "item-4", "url": "https://example.com/fail.bin", "output": "fail.bin", "status": "error", "gid": "ddd444", "created_at": "2026-04-01T09:30:00", "error_message": "404 Not Found"},
        {"id": "item-5", "url": "https://example.com/paused.dat", "output": "paused.dat", "status": "paused", "gid": "eee555", "created_at": "2026-04-01T09:45:00"},
    ],
    "active": {
        "gid": "aaa111",
        "url": "https://example.com/big.iso",
        "status": "active",
        "downloadSpeed": 1048576,
        "totalLength": 104857600,
        "completedLength": 52428800,
        "percent": 50.0,
    },
    "state": {"running": True, "paused": False, "session_id": "sess-001", "session_started_at": "2026-04-01T10:00:00"},
    "summary": {"queued": 1, "done": 1, "error": 1, "total": 5},
    "bandwidth": {"source": "networkquality", "downlink_mbps": 100, "cap_mbps": 50},
    "backend": {"reachable": True, "version": "0.1.34", "pid": 1234},
}

DECLARATION_PAYLOAD: dict = {"uic": {"preferences": [
    {"name": "auto_preflight_on_run", "value": False, "options": [True, False], "rationale": "default off"},
    {"name": "max_simultaneous_downloads", "value": 1, "options": [1], "rationale": "sequential"},
]}, "ucc": {}, "policy": {}}

MOCK_PATCHES: dict[str, object] = {
    "ariaflow_web.webapp.get_status_from": STATUS_PAYLOAD,
    "ariaflow_web.webapp.get_log_from": {"items": []},
    "ariaflow_web.webapp.get_declaration_from": DECLARATION_PAYLOAD,
    "ariaflow_web.webapp.get_lifecycle_from": {},
    "ariaflow_web.webapp.add_items_from": {"ok": True, "count": 0, "added": []},
    "ariaflow_web.webapp.preflight_from": {"status": "pass"},
    "ariaflow_web.webapp.run_action_from": {"ok": True, "action": "start", "result": {"started": True}},
    "ariaflow_web.webapp.run_ucc_from": {"result": {"outcome": "converged"}},
    "ariaflow_web.webapp.save_declaration_from": {"saved": True},
    "ariaflow_web.webapp.discover_http_services": {"available": False, "items": [], "reason": "none"},
    "ariaflow_web.webapp.set_session_from": {"ok": True, "session": "sess-001"},
    "ariaflow_web.webapp.pause_from": {"paused": True},
    "ariaflow_web.webapp.resume_from": {"resumed": True},
    "ariaflow_web.webapp.lifecycle_action_from": {"ok": True, "lifecycle": {}},
    "ariaflow_web.webapp.item_action_from": {"ok": True, "item": {"id": "item-1", "status": "paused"}},
    "ariaflow_web.webapp._local_pid_for_port": None,
}

PORT = 8780


@pytest.fixture(scope="module")
def web_server():
    """Start a mocked ariaflow-web server for the test module."""
    tmp = tempfile.mkdtemp()
    os.environ["ARIA_QUEUE_DIR"] = tmp
    patches = [patch(k, return_value=v) for k, v in MOCK_PATCHES.items()]
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
    """Shared playwright browser for the test module."""
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context()
    yield ctx
    ctx.close()
    browser.close()
    pw.stop()


@pytest.fixture()
def page(browser_context, web_server) -> Page:  # type: ignore[type-arg]
    """Fresh page per test."""
    p = browser_context.new_page()
    yield p
    p.close()


# ---------------------------------------------------------------------------
# HTML structure tests (BeautifulSoup — no JS)
# ---------------------------------------------------------------------------

class TestHTMLStructure:
    """Validate the served HTML has all expected elements."""

    @pytest.fixture(autouse=True)
    def _fetch_html(self, web_server: str) -> None:
        import urllib.request
        html = urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode()
        self.soup = BeautifulSoup(html, "html.parser")

    def test_nav_has_all_pages(self) -> None:
        nav = self.soup.select(".nav a")
        pages = [a.get("data-page") for a in nav]
        assert "dashboard" in pages
        assert "bandwidth" in pages
        assert "lifecycle" in pages
        assert "options" in pages
        assert "log" in pages
        assert "dev" in pages

    def test_queue_filter_bar_exists(self) -> None:
        filters = self.soup.select("#queue-filters .filter-btn")
        labels = [btn.get("data-filter") for btn in filters]
        assert "all" in labels
        assert "queued" in labels
        assert "downloading" in labels
        assert "paused" in labels
        assert "done" in labels
        assert "error" in labels

    def test_search_input_exists(self) -> None:
        search = self.soup.select_one("#queue-search")
        assert search is not None
        assert search.get("type") == "text"

    def test_global_speed_chart_container(self) -> None:
        chart = self.soup.select_one("#global-speed-chart")
        assert chart is not None

    def test_refresh_control_exists(self) -> None:
        select = self.soup.select_one("#refresh-interval")
        assert select is not None
        options = [o.get("value") for o in select.select("option")]
        assert "0" in options  # off
        assert "10000" in options  # default

    def test_theme_button_exists(self) -> None:
        btn = self.soup.select_one("#theme-btn")
        assert btn is not None

    def test_developer_page_sections(self) -> None:
        dev_panels = self.soup.select(".show-dev")
        assert len(dev_panels) >= 2  # API docs panel + test runner panel

    def test_queue_metrics_exist(self) -> None:
        for eid in ("sum-queued", "sum-done", "sum-error", "queue-speed"):
            assert self.soup.select_one(f"#{eid}") is not None


# ---------------------------------------------------------------------------
# Route tests (all pages return 200)
# ---------------------------------------------------------------------------

class TestRoutes:
    @pytest.mark.parametrize("path", ["/", "/bandwidth", "/lifecycle", "/options", "/log", "/dev"])
    def test_page_returns_200(self, web_server: str, path: str) -> None:
        import urllib.request
        resp = urllib.request.urlopen(f"{web_server}{path}", timeout=5)
        assert resp.status == 200
        assert "text/html" in resp.headers.get("Content-Type", "")

    @pytest.mark.parametrize("path", ["/api/status", "/api/log", "/api/declaration", "/api/options", "/api/lifecycle", "/api/discovery"])
    def test_api_returns_json(self, web_server: str, path: str) -> None:
        import urllib.request
        resp = urllib.request.urlopen(f"{web_server}{path}", timeout=5)
        assert resp.status == 200
        data = json.loads(resp.read().decode())
        assert isinstance(data, dict)

    def test_item_action_proxy(self, web_server: str) -> None:
        import urllib.request
        req = urllib.request.Request(
            f"{web_server}/api/item/item-1/pause",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        assert resp.status == 200
        data = json.loads(resp.read().decode())
        assert data["ok"] is True


# ---------------------------------------------------------------------------
# Playwright interactive tests
# ---------------------------------------------------------------------------

class TestDashboardInteractive:
    """Test JS-driven features with a real headless browser."""

    def test_dashboard_renders_queue_items(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        items = page.query_selector_all("#queue .item")
        assert len(items) >= 1

    def test_filter_chips_show_counts(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        all_btn = page.query_selector('#queue-filters .filter-btn[data-filter="all"]')
        assert all_btn is not None
        text = all_btn.inner_text()
        assert "5" in text  # All (5)

    def test_filter_by_status(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click('#queue-filters .filter-btn[data-filter="done"]')
        page.wait_for_timeout(300)
        items = page.query_selector_all("#queue .item")
        # Should show only the 1 done item
        assert len(items) == 1
        assert "done.tar" in items[0].inner_text() or "done" in items[0].inner_text().lower()

    def test_filter_by_error(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click('#queue-filters .filter-btn[data-filter="error"]')
        page.wait_for_timeout(300)
        items = page.query_selector_all("#queue .item")
        assert len(items) == 1

    def test_search_filters_queue(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.fill("#queue-search", "big.iso")
        page.wait_for_timeout(300)
        items = page.query_selector_all("#queue .item")
        assert len(items) == 1
        assert "big.iso" in items[0].inner_text()

    def test_search_no_results(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.fill("#queue-search", "nonexistent_xyz")
        page.wait_for_timeout(300)
        queue_html = page.inner_html("#queue")
        assert "No " in queue_html or "no " in queue_html.lower()

    def test_active_item_shows_progress(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        active = page.query_selector("#queue .active-item")
        assert active is not None
        text = active.inner_text()
        assert "50%" in text or "50 %" in text

    def test_active_item_shows_eta(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .active-item", timeout=5000)
        text = page.query_selector("#queue .active-item").inner_text()
        assert "ETA" in text

    def test_per_item_action_buttons(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        html = page.inner_html("#queue")
        # Downloading item should have pause button
        assert "itemAction(" in html
        # Error item should have retry button
        assert "retry" in html.lower()
        # All items should have remove button
        assert html.count("remove") >= 5  # one per item (title attr)

    def test_queue_speed_metric_element_exists(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue-speed", timeout=5000)
        el = page.query_selector("#queue-speed")
        assert el is not None

    def test_backend_chips_populated(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        version = page.inner_text("#backend-version")
        assert version == "0.1.34"
        pid = page.inner_text("#backend-pid")
        assert pid == "1234"

    def test_theme_toggle(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.click("#theme-btn")
        theme = page.evaluate("document.documentElement.dataset.theme")
        assert theme in ("dark", "light")


class TestDevPage:
    def test_dev_page_renders(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        text = page.inner_text("body")
        assert "API Documentation" in text
        assert "Test Runner" in text
        assert "Swagger UI" in text
        assert "OpenAPI" in text

    def test_dev_nav_active(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        active = page.query_selector('.nav a.active')
        assert active is not None
        assert active.get_attribute("data-page") == "dev"


class TestBandwidthPage:
    def test_bandwidth_page_renders(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        text = page.inner_text("body")
        assert "Bandwidth" in text
        assert "Probe result" in text


class TestOptionsPage:
    def test_options_page_renders(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/options")
        page.wait_for_selector(".show-options", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        text = page.inner_text("body")
        assert "Options" in text
