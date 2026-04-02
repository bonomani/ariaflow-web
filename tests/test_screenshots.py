"""Screenshot tests and JS error detection on all pages."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from playwright.sync_api import Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server  # noqa: E402

pytestmark = pytest.mark.slow
SCREENSHOT_DIR = Path(__file__).resolve().parent / "screenshots"

def _goto(page: Page, url: str) -> None:
    page.goto(url)
    page.wait_for_timeout(200)


@pytest.fixture(scope="module")
def web_server():
    url, server, patches, _ = start_server()
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    yield url
    stop_server(server, patches)


@pytest.fixture(scope="module")
def browser_context(shared_browser):
    ctx = shared_browser.new_context(viewport={"width": 1280, "height": 900})
    yield ctx
    ctx.close()


@pytest.fixture()
def page(browser_context, web_server) -> Page:
    p = browser_context.new_page()
    yield p
    p.close()


class TestScreenshots:
    @pytest.mark.parametrize("path,name,expected_text", [
        ("/", "dashboard", "ariaflow"),
        ("/bandwidth", "bandwidth", "Bandwidth"),
        ("/lifecycle", "lifecycle", "Service Status"),
        ("/options", "options", "Options"),
        ("/log", "log", "Log"),
        ("/dev", "dev", "Developer"),
    ])
    def test_page_screenshot(self, page: Page, web_server: str, path: str, name: str, expected_text: str) -> None:
        _goto(page, f"{web_server}{path}")
        page.wait_for_timeout(800)
        shot = SCREENSHOT_DIR / f"{name}.png"
        page.screenshot(path=str(shot), full_page=True)
        assert shot.stat().st_size > 5000
        assert expected_text in page.inner_text("body")

    def test_dashboard_has_queue_items(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.wait_for_selector(".item.compact", timeout=8000)
        page.screenshot(path=str(SCREENSHOT_DIR / "dashboard_with_items.png"), full_page=True)
        assert len(page.query_selector_all(".item.compact")) >= 1

    def test_dark_and_light_theme(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].applyTheme('dark')")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SCREENSHOT_DIR / "theme_dark.png"))
        dark = (SCREENSHOT_DIR / "theme_dark.png").stat().st_size
        page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].applyTheme('light')")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SCREENSHOT_DIR / "theme_light.png"))
        light = (SCREENSHOT_DIR / "theme_light.png").stat().st_size
        assert dark > 5000 and light > 5000 and dark != light

    def test_mobile_screenshot(self, browser_context, web_server: str) -> None:
        p = browser_context.new_page()
        p.set_viewport_size({"width": 375, "height": 667})
        p.goto(f"{web_server}/")
        p.wait_for_timeout(1000)
        p.screenshot(path=str(SCREENSHOT_DIR / "mobile.png"), full_page=True)
        assert (SCREENSHOT_DIR / "mobile.png").stat().st_size > 5000
        p.close()


class TestNoJSErrors:
    @pytest.mark.parametrize("path", ["/", "/bandwidth", "/lifecycle", "/options", "/log", "/dev"])
    def test_no_js_errors(self, page: Page, web_server: str, path: str) -> None:
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{web_server}{path}")
        page.wait_for_timeout(1500)
        assert errors == [], f"JS errors on {path}: {errors}"
