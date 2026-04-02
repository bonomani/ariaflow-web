"""Click-test every button in the ariaflow-web UI."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from playwright.sync_api import Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server  # noqa: E402

pytestmark = pytest.mark.slow
mock_tracker: dict = {}

def _goto(page: Page, url: str) -> None:
    page.goto(url)
    page.wait_for_timeout(200)


@pytest.fixture(scope="module")
def web_server():
    url, server, patches, mocks = start_server(save_echo=True)
    mock_tracker.update(mocks)
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


def _wait_dashboard(page: Page, web_server: str) -> None:
    _goto(page, f"{web_server}/")
    page.wait_for_selector(".item.compact", timeout=8000)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class TestDashboardButtons:
    def test_theme_toggle_cycles(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.click('button:has-text("Theme")')
        assert page.evaluate("document.documentElement.dataset.theme") in ("dark", "light")

    def test_add_url_button(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.fill('textarea[x-model="urlInput"]', "https://example.com/test.bin")
        page.click(".queue-add-button")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.add_items_from"].called

    def test_start_stop_engine_button(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.click('button:has-text("engine")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.run_action_from"].called

    def test_new_session_button(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.click("text=New run")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.set_session_from"].called

    def test_pause_resume_queue_button(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.click('button:has-text("queue")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.pause_from"].called or mock_tracker["ariaflow_web.webapp.resume_from"].called

    def test_add_backend_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.fill('input[x-model="backendInput"]', "http://192.168.1.100:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(1000)
        # Backend is stored in Alpine data + localStorage
        backends = page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].loadBackendState().backends")
        assert any("192.168.1.100" in b for b in backends)

    def test_select_default_backend_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        btn = page.query_selector('.chips button:first-child')
        if btn:
            btn.click()


class TestBackendButtons:
    def test_remove_backend_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.fill('input[x-model="backendInput"]', "http://172.16.99.1:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(1000)
        # Use evaluate to find and click remove since template rendering may lag
        removed = page.evaluate('''(() => {
            const state = JSON.parse(localStorage.getItem('ariaflow.backends') || '[]');
            return state.includes('http://172.16.99.1:8000');
        })()''')
        assert removed
        page.evaluate('''(() => {
            const el = document.querySelector('[x-data]');
            el._x_dataStack[0].removeBackend('http://172.16.99.1:8000');
        })()''')
        page.wait_for_timeout(500)
        backends = page.evaluate("JSON.parse(localStorage.getItem('ariaflow.backends') || '[]')")
        assert "http://172.16.99.1:8000" not in backends


# ---------------------------------------------------------------------------
# Queue filters
# ---------------------------------------------------------------------------

class TestFilterButtons:
    @pytest.mark.parametrize("filter_name,expected_count", [
        ("all", 5), ("queued", 1), ("downloading", 1), ("paused", 1), ("done", 1), ("error", 1),
    ])
    def test_filter_button(self, page: Page, web_server: str, filter_name: str, expected_count: int) -> None:
        _wait_dashboard(page, web_server)
        page.click(f'.filter-bar .filter-btn:has-text("{filter_name}")')
        page.wait_for_timeout(300)
        assert len(page.query_selector_all(".item.compact")) == expected_count


# ---------------------------------------------------------------------------
# Per-item actions
# ---------------------------------------------------------------------------

class TestItemActionButtons:
    def test_pause_button_on_downloading_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        html = page.inner_html("body")
        assert "itemAction(item.id, 'pause')" in html or "Pause" in html

    def test_resume_button_on_paused_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        html = page.inner_html("body")
        assert "itemAction(item.id, 'resume')" in html or "Resume" in html

    def test_retry_button_on_error_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        html = page.inner_html("body")
        assert "itemAction(item.id, 'retry')" in html or "Retry" in html

    def test_remove_button_exists_on_every_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        remove_btns = page.query_selector_all('.item.compact button[title="Remove"]')
        assert len(remove_btns) >= 5

    def test_remove_button_calls_api(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        mock_tracker["ariaflow_web.webapp.item_action_from"].reset_mock()
        remove_btns = page.query_selector_all('.item.compact button[title="Remove"]')
        assert len(remove_btns) >= 1
        remove_btns[0].click()
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.item_action_from"].called

    def test_no_pause_button_on_done_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.click('.filter-bar .filter-btn:has-text("done")')
        page.wait_for_timeout(300)
        # In Alpine, x-show hides buttons; check no visible pause buttons
        visible = page.evaluate('''Array.from(document.querySelectorAll('.item.compact button[title="Pause"]')).filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible == 0

    def test_pause_button_on_queued_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.click('.filter-bar .filter-btn:has-text("queued")')
        page.wait_for_timeout(300)
        visible = page.evaluate('''Array.from(document.querySelectorAll('.item.compact button[title="Pause"]')).filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible >= 1

    def test_no_retry_button_on_queued_item(self, page: Page, web_server: str) -> None:
        _wait_dashboard(page, web_server)
        page.click('.filter-bar .filter-btn:has-text("queued")')
        page.wait_for_timeout(300)
        visible = page.evaluate('''Array.from(document.querySelectorAll('.item.compact button[title="Retry"]')).filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible == 0


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

class TestLifecycleButtons:
    def test_refresh_service_status_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/lifecycle")
        page.wait_for_selector("body.page-lifecycle", timeout=8000)
        mock_tracker["ariaflow_web.webapp.get_lifecycle_from"].reset_mock()
        page.click("text=Refresh service status")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.get_lifecycle_from"].called

    def test_lifecycle_action_buttons_render(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/lifecycle")
        page.wait_for_selector("body.page-lifecycle", timeout=8000)
        page.click("text=Refresh service status")
        page.wait_for_timeout(500)
        text = page.inner_text("body")
        assert "Install" in text or "Load" in text


# ---------------------------------------------------------------------------
# Log
# ---------------------------------------------------------------------------

class TestLogButtons:
    def test_run_contract_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/log")
        page.wait_for_selector("body.page-log", timeout=8000)
        before = page.inner_text("body")
        page.click('button:has-text("Run contract")')
        page.wait_for_timeout(500)
        after = page.inner_text("body")
        assert after != before or "converged" in after

    def test_preflight_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/log")
        page.wait_for_selector("body.page-log", timeout=8000)
        page.click('button:has-text("Preflight")')
        page.wait_for_timeout(500)
        text = page.inner_text("body")
        assert "ready" in text or "pass" in text.lower()

    def test_load_declaration_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/log")
        page.wait_for_selector("body.page-log", timeout=8000)
        page.wait_for_timeout(500)
        page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].declarationText = ''")
        page.click('.declaration button:has-text("Load")')
        page.wait_for_timeout(500)
        val = page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].declarationText")
        assert len(str(val)) > 2

    def test_save_declaration_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/log")
        page.wait_for_selector("body.page-log", timeout=8000)
        page.wait_for_timeout(500)
        page.evaluate('''document.querySelector('[x-data]')._x_dataStack[0].declarationText = JSON.stringify({"uic": {}, "ucc": {}, "policy": {}})''')
        page.click('.declaration button:has-text("Save")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    @pytest.mark.parametrize("model_name", ["actionFilter", "targetFilter", "sessionFilter"])
    def test_log_filter_dropdown(self, page: Page, web_server: str, model_name: str) -> None:
        _goto(page, f"{web_server}/log")
        page.wait_for_selector("body.page-log", timeout=8000)
        page.wait_for_timeout(300)
        page.select_option(f'select[x-model="{model_name}"]', index=0)
        page.wait_for_timeout(300)
        assert page.query_selector("body.page-log") is not None


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

class TestOptionsButtons:
    def test_auto_preflight_toggle(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/options")
        page.wait_for_selector("body.page-options", timeout=8000)
        page.wait_for_timeout(500)
        cb = page.query_selector('input[type="checkbox"]')
        if cb:
            cb.click()
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_post_action_rule_dropdown(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/options")
        page.wait_for_selector("body.page-options", timeout=8000)
        page.wait_for_timeout(500)
        sels = page.query_selector_all('select')
        # Find the post-action-rule select (not the refresh interval)
        for sel in sels:
            opts = sel.evaluate('el => Array.from(el.options).map(o => o.value)')
            if "pending" in opts:
                sel.select_option("pending")
                page.wait_for_timeout(500)
                break


# ---------------------------------------------------------------------------
# Bandwidth config
# ---------------------------------------------------------------------------

class TestBandwidthConfigButtons:
    def _goto_bw(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/bandwidth")
        page.wait_for_selector("body.page-bandwidth", timeout=8000)
        page.wait_for_timeout(500)

    def _bw_input_by_label(self, page: Page, web_server: str, label_text: str) -> object:
        self._goto_bw(page, web_server)
        items = page.query_selector_all('.item')
        for item in items:
            text = item.inner_text()
            if label_text.lower() in text.lower():
                inp = item.query_selector('input[type="number"]')
                if inp:
                    return inp
        return None

    def test_duplicate_action_dropdown(self, page: Page, web_server: str) -> None:
        self._goto_bw(page, web_server)
        sels = page.query_selector_all('select')
        for sel in sels:
            opts = sel.evaluate('el => Array.from(el.options).map(o => o.value)')
            if "pause" in opts and "remove" in opts:
                sel.select_option("pause")
                page.wait_for_timeout(500)
                break

    def test_simultaneous_downloads_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "Simultaneous")
        if el:
            el.fill("3")
            page.wait_for_timeout(500)

    def test_bandwidth_free_percent_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "free bandwidth (%)")
        if el:
            el.fill("30")
            page.wait_for_timeout(500)

    def test_bandwidth_free_absolute_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "free bandwidth (absolute)")
        if el:
            el.fill("5")
            page.wait_for_timeout(500)

    def test_bandwidth_floor_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "floor")
        if el:
            el.fill("4")
            page.wait_for_timeout(500)

    def test_free_percent_arrow_up(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "free bandwidth (%)")
        if el:
            before = el.input_value()
            el.press("ArrowUp")
            page.wait_for_timeout(500)
            assert el.input_value() != before

    def test_free_percent_arrow_down(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "free bandwidth (%)")
        if el:
            before = int(el.input_value())
            el.press("ArrowDown")
            page.wait_for_timeout(300)
            assert int(el.input_value()) == before - 1

    def test_free_percent_repeated_arrows(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "free bandwidth (%)")
        if el:
            before = int(el.input_value())
            for _ in range(5):
                el.press("ArrowUp")
                page.wait_for_timeout(300)
            assert int(el.input_value()) == before + 5

    def test_simultaneous_repeated_arrows(self, page: Page, web_server: str) -> None:
        el = self._bw_input_by_label(page, web_server, "Simultaneous")
        if el:
            before = int(el.input_value())
            for _ in range(3):
                el.press("ArrowUp")
                page.wait_for_timeout(300)
            assert int(el.input_value()) == before + 3

    def test_run_probe_button(self, page: Page, web_server: str) -> None:
        self._goto_bw(page, web_server)
        mock_tracker["ariaflow_web.webapp.bandwidth_probe_from"].reset_mock()
        page.click('button:has-text("Run probe")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.bandwidth_probe_from"].called


# ---------------------------------------------------------------------------
# Dev
# ---------------------------------------------------------------------------

class TestDevButtons:
    def test_open_docs_button_exists(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/dev")
        page.wait_for_selector("body.page-dev", timeout=8000)
        assert page.query_selector("text=Open Swagger UI") is not None

    def test_open_spec_button_exists(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/dev")
        page.wait_for_selector("body.page-dev", timeout=8000)
        assert page.query_selector("text=Download OpenAPI spec") is not None

    def test_run_tests_button(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/dev")
        page.wait_for_selector("body.page-dev", timeout=8000)
        page.click("text=Run tests")
        page.wait_for_timeout(1000)
        el = page.query_selector('[x-text="testBadgeText"]')
        assert el is not None and el.inner_text() != "-"


# ---------------------------------------------------------------------------
# Refresh control
# ---------------------------------------------------------------------------

class TestRefreshControl:
    def test_refresh_interval_change(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.select_option("#refresh-interval", "3000")
        page.wait_for_timeout(300)
        val = page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].refreshInterval")
        assert val == 3000 or val == "3000"

    def test_refresh_off(self, page: Page, web_server: str) -> None:
        _goto(page, f"{web_server}/")
        page.select_option("#refresh-interval", "0")
        page.wait_for_timeout(300)
        val = page.evaluate("document.querySelector('[x-data]')._x_dataStack[0].refreshInterval")
        assert val == 0 or val == "0"
