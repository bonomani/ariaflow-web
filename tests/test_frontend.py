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

pytestmark = pytest.mark.slow

def _goto(page: Page, url: str) -> None:
    """Navigate and wait for Alpine."""
    page.goto(url)
    page.wait_for_timeout(200)


@pytest.fixture(scope="module")
def web_server():
    url, _, web_srv, backend_srv, patches, _ = start_server()
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


# ---------------------------------------------------------------------------
# HTML structure (BeautifulSoup — no JS)
# ---------------------------------------------------------------------------

class TestHTMLStructure:
    @pytest.fixture(autouse=True)
    def _fetch_html(self, web_server: str) -> None:
        html = urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode()
        self.soup = BeautifulSoup(html, "html.parser")

    def test_nav_has_all_pages(self) -> None:
        hrefs = [a.get("href") for a in self.soup.select(".nav a")]
        for p in ("/", "/bandwidth", "/lifecycle", "/options", "/log", "/dev"):
            assert p in hrefs

    def test_queue_filter_bar_exists(self) -> None:
        assert self.soup.select_one(".filter-bar") is not None

    def test_search_input_exists(self) -> None:
        assert self.soup.select_one('input[x-model="queueSearch"]') is not None

    def test_global_speed_chart_container(self) -> None:
        assert self.soup.select_one('[x-html="globalSparklineSvg"]') is not None

    def test_refresh_control_exists(self) -> None:
        assert self.soup.select_one("#refresh-interval") is not None

    def test_theme_button_exists(self) -> None:
        btn = self.soup.find("button", attrs={"@click": "toggleTheme()"})
        assert btn is not None

    def test_developer_page_sections(self) -> None:
        devs = self.soup.find_all(attrs={"x-show": lambda v: v and "dev" in v})
        assert len(devs) >= 2

    def test_queue_metrics_exist(self) -> None:
        for attr in ("sumQueued", "sumDone", "sumError", "transferSpeedText"):
            assert self.soup.find(attrs={"x-text": attr}) is not None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class TestRoutes:
    @pytest.mark.parametrize("path", ["/", "/bandwidth", "/lifecycle", "/options", "/log", "/dev"])
    def test_page_returns_200(self, web_server: str, path: str) -> None:
        resp = urllib.request.urlopen(f"{web_server}{path}", timeout=5)
        assert resp.status == 200
        assert "text/html" in resp.headers.get("Content-Type", "")

    def test_api_discovery_endpoint(self, web_server: str) -> None:
        resp = urllib.request.urlopen(f"{web_server}/api/discovery", timeout=5)
        assert resp.status == 200
        assert isinstance(json.loads(resp.read().decode()), dict)


# ---------------------------------------------------------------------------
# Playwright interactive tests
# ---------------------------------------------------------------------------

def _wait_for_dashboard_items(page: Page, web_server: str) -> None:
    """Navigate to dashboard and wait for queue items to render."""
    _goto(page, f"{web_server}/")
    page.wait_for_selector(".item.compact:not(.add-card)", timeout=8000)


class TestDashboardInteractive:
    def test_dashboard_renders_queue_items(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        assert len(page.query_selector_all(".item.compact:not(.add-card)")) >= 1

    def test_filter_chips_show_counts(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        btn = page.query_selector('.filter-bar .filter-btn')
        assert btn is not None
        assert "5" in btn.inner_text()

    def test_filter_by_status(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        page.click('.filter-bar .filter-btn:has-text("done")')
        page.wait_for_timeout(300)
        assert len(page.query_selector_all(".item.compact:not(.add-card)")) == 1

    def test_filter_by_error(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        page.click('.filter-bar .filter-btn:has-text("error")')
        page.wait_for_timeout(300)
        assert len(page.query_selector_all(".item.compact:not(.add-card)")) == 1

    def test_search_filters_queue(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        page.fill('input[x-model="queueSearch"]', "big.iso")
        page.wait_for_timeout(300)
        items = page.query_selector_all(".item.compact:not(.add-card)")
        assert len(items) == 1 and "big.iso" in items[0].inner_text()

    def test_search_no_results(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        page.fill('input[x-model="queueSearch"]', "nonexistent_xyz")
        page.wait_for_timeout(300)
        text = page.inner_text("body")
        assert "no " in text.lower() or "No " in text

    def test_active_item_shows_progress(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        el = page.query_selector(".item.compact:not(.add-card).active-item")
        assert el is not None
        assert "50%" in el.inner_text()

    def test_active_item_shows_eta(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        el = page.query_selector(".item.compact:not(.add-card).active-item")
        assert el is not None
        assert "ETA" in el.inner_text()

    def test_per_item_action_buttons(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        html = page.inner_html("body")
        assert "itemAction(" in html
        assert "Retry" in html or "retry" in html.lower()

    def test_queue_speed_metric_element_exists(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        el = page.wait_for_selector('[x-text="transferSpeedText"]', timeout=8000)
        assert el is not None

    def test_backend_chips_populated(self, page: Page, web_server: str) -> None:
        _wait_for_dashboard_items(page, web_server)
        el = page.query_selector('[x-text="backendVersionText"]')
        assert el is not None
        assert el.inner_text() == "v0.1.34"

    def test_theme_toggle(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.click('button:has-text("Theme")')
        assert page.evaluate("document.documentElement.dataset.theme") in ("dark", "light")


class TestDevPage:
    def test_dev_page_renders(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/dev")
        page.wait_for_selector("body.page-dev", timeout=8000)
        page.wait_for_timeout(300)
        text = page.inner_text("body")
        assert "API Documentation" in text and "Test Suite" in text

    def test_dev_nav_active(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/dev")
        page.wait_for_selector("body.page-dev", timeout=8000)
        active = page.query_selector('.nav a.active')
        assert active is not None
        assert active.get_attribute("href") == "/dev"


class TestBandwidthPage:
    def test_bandwidth_page_renders(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/bandwidth")
        page.wait_for_selector("body.page-bandwidth", timeout=8000)
        assert "Bandwidth" in page.inner_text("body")


class TestOptionsPage:
    def test_options_page_renders(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/options")
        page.wait_for_selector("body.page-options", timeout=8000)
        assert "Options" in page.inner_text("body")
