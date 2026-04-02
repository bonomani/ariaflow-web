"""Frontend structure, route, and interactive tests."""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import pytest
from bs4 import BeautifulSoup
from playwright.sync_api import Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server  # noqa: E402


@pytest.fixture(scope="module")
def web_server():
    url, server, patches, mocks = start_server()
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


# ---------------------------------------------------------------------------
# HTML structure (BeautifulSoup — no JS)
# ---------------------------------------------------------------------------

class TestHTMLStructure:
    @pytest.fixture(autouse=True)
    def _fetch_html(self, web_server: str) -> None:
        html = urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode()
        self.soup = BeautifulSoup(html, "html.parser")

    def test_nav_has_all_pages(self) -> None:
        pages = [a.get("data-page") for a in self.soup.select(".nav a")]
        for p in ("dashboard", "bandwidth", "lifecycle", "options", "log", "dev"):
            assert p in pages

    def test_queue_filter_bar_exists(self) -> None:
        labels = [btn.get("data-filter") for btn in self.soup.select("#queue-filters .filter-btn")]
        for f in ("all", "queued", "downloading", "paused", "done", "error"):
            assert f in labels

    def test_search_input_exists(self) -> None:
        assert self.soup.select_one("#queue-search") is not None

    def test_global_speed_chart_container(self) -> None:
        assert self.soup.select_one("#global-speed-chart") is not None

    def test_refresh_control_exists(self) -> None:
        assert self.soup.select_one("#refresh-interval") is not None

    def test_theme_button_exists(self) -> None:
        assert self.soup.select_one("#theme-btn") is not None

    def test_developer_page_sections(self) -> None:
        assert len(self.soup.select(".show-dev")) >= 2

    def test_queue_metrics_exist(self) -> None:
        for eid in ("sum-queued", "sum-done", "sum-error", "queue-speed"):
            assert self.soup.select_one(f"#{eid}") is not None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class TestRoutes:
    @pytest.mark.parametrize("path", ["/", "/bandwidth", "/lifecycle", "/options", "/log", "/dev"])
    def test_page_returns_200(self, web_server: str, path: str) -> None:
        resp = urllib.request.urlopen(f"{web_server}{path}", timeout=5)
        assert resp.status == 200
        assert "text/html" in resp.headers.get("Content-Type", "")

    @pytest.mark.parametrize("path", ["/api", "/api/status", "/api/bandwidth", "/api/log", "/api/declaration", "/api/options", "/api/lifecycle", "/api/discovery"])
    def test_api_returns_json(self, web_server: str, path: str) -> None:
        resp = urllib.request.urlopen(f"{web_server}{path}", timeout=5)
        assert resp.status == 200
        assert isinstance(json.loads(resp.read().decode()), dict)

    def test_api_discovery_has_name(self, web_server: str) -> None:
        data = json.loads(urllib.request.urlopen(f"{web_server}/api", timeout=5).read().decode())
        assert "name" in data

    def test_bandwidth_probe_endpoint(self, web_server: str) -> None:
        req = urllib.request.Request(f"{web_server}/api/bandwidth/probe", data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        data = json.loads(urllib.request.urlopen(req, timeout=5).read().decode())
        assert data.get("ok") is True

    def test_item_action_proxy(self, web_server: str) -> None:
        req = urllib.request.Request(f"{web_server}/api/item/item-1/pause", data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        data = json.loads(urllib.request.urlopen(req, timeout=5).read().decode())
        assert data["ok"] is True


# ---------------------------------------------------------------------------
# Playwright interactive tests
# ---------------------------------------------------------------------------

class TestDashboardInteractive:
    def test_dashboard_renders_queue_items(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert len(page.query_selector_all("#queue .item")) >= 1

    def test_filter_chips_show_counts(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert "5" in page.query_selector('#queue-filters .filter-btn[data-filter="all"]').inner_text()

    def test_filter_by_status(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click('#queue-filters .filter-btn[data-filter="done"]')
        page.wait_for_timeout(300)
        assert len(page.query_selector_all("#queue .item")) == 1

    def test_filter_by_error(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click('#queue-filters .filter-btn[data-filter="error"]')
        page.wait_for_timeout(300)
        assert len(page.query_selector_all("#queue .item")) == 1

    def test_search_filters_queue(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.fill("#queue-search", "big.iso")
        page.wait_for_timeout(300)
        items = page.query_selector_all("#queue .item")
        assert len(items) == 1 and "big.iso" in items[0].inner_text()

    def test_search_no_results(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.fill("#queue-search", "nonexistent_xyz")
        page.wait_for_timeout(300)
        assert "no " in page.inner_html("#queue").lower()

    def test_active_item_shows_progress(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .active-item", timeout=5000)
        assert "50%" in page.query_selector("#queue .active-item").inner_text()

    def test_active_item_shows_eta(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .active-item", timeout=5000)
        assert "ETA" in page.query_selector("#queue .active-item").inner_text()

    def test_per_item_action_buttons(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        html = page.inner_html("#queue")
        assert "itemAction(" in html
        assert "retry" in html.lower()

    def test_queue_speed_metric_element_exists(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        assert page.wait_for_selector("#queue-speed", timeout=5000) is not None

    def test_backend_chips_populated(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.inner_text("#backend-version") == "0.1.34"

    def test_theme_toggle(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.click("#theme-btn")
        assert page.evaluate("document.documentElement.dataset.theme") in ("dark", "light")


class TestDevPage:
    def test_dev_page_renders(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        text = page.inner_text("body")
        assert "API Documentation" in text and "Test Runner" in text

    def test_dev_nav_active(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        assert page.query_selector('.nav a.active').get_attribute("data-page") == "dev"


class TestBandwidthPage:
    def test_bandwidth_page_renders(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        assert "Bandwidth" in page.inner_text("body")


class TestOptionsPage:
    def test_options_page_renders(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/options")
        page.wait_for_selector(".show-options", state="visible", timeout=5000)
        assert "Options" in page.inner_text("body")
