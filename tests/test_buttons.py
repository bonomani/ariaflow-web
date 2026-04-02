"""Click-test every button in the ariaflow-web UI."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from playwright.sync_api import Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server  # noqa: E402

mock_tracker: dict = {}


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


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class TestDashboardButtons:
    def test_theme_toggle_cycles(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        initial = page.evaluate("document.documentElement.dataset.theme")
        page.click("#theme-btn")
        assert page.evaluate("document.documentElement.dataset.theme") in ("dark", "light")

    def test_add_url_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.fill("#url", "https://example.com/test.bin")
        page.click(".queue-add-button")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.add_items_from"].called

    def test_start_stop_engine_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#runner-btn", timeout=5000)
        page.click("#runner-btn")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.run_action_from"].called

    def test_new_session_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click("text=New run")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.set_session_from"].called

    def test_pause_resume_queue_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#toggle-btn", timeout=5000)
        page.click("#toggle-btn")
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.pause_from"].called or mock_tracker["ariaflow_web.webapp.resume_from"].called

    def test_add_backend_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.fill("#backend-input", "http://192.168.1.100:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(300)
        assert "192.168.1.100" in page.inner_html("#backend-panel")

    def test_select_default_backend_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_timeout(300)
        btn = page.query_selector('#backend-panel button:first-child')
        if btn:
            btn.click()


class TestBackendButtons:
    def test_remove_backend_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.fill("#backend-input", "http://172.16.99.1:8000")
        page.click(".backend-add-button")
        page.wait_for_timeout(300)
        remove_btns = page.query_selector_all('#backend-panel button[title="Remove backend"]')
        assert len(remove_btns) >= 1
        remove_btns[-1].click()
        page.wait_for_timeout(300)
        assert "172.16.99.1" not in page.inner_html("#backend-panel")


# ---------------------------------------------------------------------------
# Queue filters
# ---------------------------------------------------------------------------

class TestFilterButtons:
    @pytest.mark.parametrize("filter_name,expected_count", [
        ("all", 5), ("queued", 1), ("downloading", 1), ("paused", 1), ("done", 1), ("error", 1),
    ])
    def test_filter_button(self, page: Page, web_server: str, filter_name: str, expected_count: int) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        page.click(f'#queue-filters .filter-btn[data-filter="{filter_name}"]')
        page.wait_for_timeout(300)
        assert len(page.query_selector_all("#queue .item")) == expected_count


# ---------------------------------------------------------------------------
# Per-item actions
# ---------------------------------------------------------------------------

class TestItemActionButtons:
    def test_pause_button_on_downloading_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.query_selector('button[onclick*="itemAction(\'item-1\',\'pause\')"]') is not None

    def test_resume_button_on_paused_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.query_selector('button[onclick*="itemAction(\'item-5\',\'resume\')"]') is not None

    def test_retry_button_on_error_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.query_selector('button[onclick*="itemAction(\'item-4\',\'retry\')"]') is not None

    def test_remove_button_exists_on_every_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        for item_id in ("item-1", "item-2", "item-3", "item-4", "item-5"):
            assert page.query_selector(f'button[onclick*="itemAction(\'{item_id}\',\'remove\')"]') is not None

    def test_remove_button_calls_api(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        mock_tracker["ariaflow_web.webapp.item_action_from"].reset_mock()
        page.query_selector('button[onclick*="itemAction(\'item-3\',\'remove\')"]').click()
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.item_action_from"].called

    def test_no_pause_button_on_done_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.query_selector('button[onclick*="itemAction(\'item-3\',\'pause\')"]') is None

    def test_no_pause_button_on_queued_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.query_selector('button[onclick*="itemAction(\'item-2\',\'pause\')"]') is None

    def test_no_retry_button_on_queued_item(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.wait_for_selector("#queue .item", timeout=5000)
        assert page.query_selector('button[onclick*="itemAction(\'item-2\',\'retry\')"]') is None


# ---------------------------------------------------------------------------
# Lifecycle
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
        assert "Install" in page.inner_text("#lifecycle") or "Load" in page.inner_text("#lifecycle")


# ---------------------------------------------------------------------------
# Log
# ---------------------------------------------------------------------------

class TestLogButtons:
    def test_run_contract_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        before = page.inner_text("#contract-trace")
        page.click('button:has-text("Run contract")')
        page.wait_for_timeout(500)
        after = page.inner_text("#contract-trace")
        assert after != before or "converged" in after

    def test_preflight_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.click('button:has-text("Preflight")')
        page.wait_for_timeout(500)
        assert "ready" in page.inner_text("#preflight") or "pass" in page.inner_text("#preflight").lower()

    def test_load_declaration_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        page.evaluate('document.getElementById("declaration").value = ""')
        page.click('.declaration button:has-text("Load")')
        page.wait_for_timeout(500)
        assert len(page.evaluate('document.getElementById("declaration").value')) > 2

    def test_save_declaration_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        page.evaluate('document.getElementById("declaration").value = JSON.stringify({"uic": {}, "ucc": {}, "policy": {}})')
        page.click('.declaration button:has-text("Save")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    @pytest.mark.parametrize("select_id", ["action-filter", "target-filter", "session-filter"])
    def test_log_filter_dropdown(self, page: Page, web_server: str, select_id: str) -> None:
        page.goto(f"{web_server}/log")
        page.wait_for_selector(".show-log", state="visible", timeout=5000)
        page.wait_for_timeout(300)
        page.select_option(f"#{select_id}", index=0)
        page.wait_for_timeout(300)
        assert page.query_selector("#action-log") is not None


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

class TestOptionsButtons:
    def test_auto_preflight_toggle(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/options")
        page.wait_for_selector(".show-options", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        cb = page.query_selector('input[type="checkbox"][onchange*="setAutoPreflightPreference"]')
        if cb:
            cb.click()
            page.wait_for_timeout(500)
            assert mock_tracker["ariaflow_web.webapp.save_declaration_from"].called

    def test_post_action_rule_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/options")
        page.wait_for_selector(".show-options", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        sel = page.query_selector('select[onchange*="setPostActionRule"]')
        if sel:
            page.select_option('select[onchange*="setPostActionRule"]', "pending")
            page.wait_for_timeout(500)


# ---------------------------------------------------------------------------
# Bandwidth config
# ---------------------------------------------------------------------------

class TestBandwidthConfigButtons:
    def _bw_input(self, page: Page, web_server: str, selector: str) -> object:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        return page.query_selector(f'input[oninput*="{selector}"]')

    def test_duplicate_action_dropdown(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        page.wait_for_timeout(500)
        sel = page.query_selector('select[onchange*="setDuplicateAction"]')
        if sel:
            page.select_option('select[onchange*="setDuplicateAction"]', "pause")
            page.wait_for_timeout(500)

    def test_simultaneous_downloads_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "setSimultaneousLimit")
        if el:
            el.fill("3")
            page.wait_for_timeout(500)

    def test_bandwidth_free_percent_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "bandwidth_free_percent")
        if el:
            el.fill("30")
            page.wait_for_timeout(500)

    def test_bandwidth_free_absolute_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "bandwidth_free_absolute_mbps")
        if el:
            el.fill("5")
            page.wait_for_timeout(500)

    def test_bandwidth_floor_input(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "bandwidth_floor_mbps")
        if el:
            el.fill("4")
            page.wait_for_timeout(500)

    def test_free_percent_arrow_up(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "bandwidth_free_percent")
        if el:
            before = el.input_value()
            el.press("ArrowUp")
            page.wait_for_timeout(500)
            el = page.query_selector('input[oninput*="bandwidth_free_percent"]')
            assert el.input_value() != before

    def test_free_percent_arrow_down(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "bandwidth_free_percent")
        if el:
            el.fill("30")
            page.wait_for_timeout(500)
            el = page.query_selector('input[oninput*="bandwidth_free_percent"]')
            el.press("ArrowDown")
            page.wait_for_timeout(500)
            el = page.query_selector('input[oninput*="bandwidth_free_percent"]')
            assert el.input_value() == "29"

    def test_free_percent_repeated_arrows(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "bandwidth_free_percent")
        if el:
            el.fill("20")
            page.wait_for_timeout(500)
            for _ in range(5):
                el = page.query_selector('input[oninput*="bandwidth_free_percent"]')
                el.press("ArrowUp")
                page.wait_for_timeout(300)
            el = page.query_selector('input[oninput*="bandwidth_free_percent"]')
            assert int(el.input_value()) == 25

    def test_simultaneous_repeated_arrows(self, page: Page, web_server: str) -> None:
        el = self._bw_input(page, web_server, "setSimultaneousLimit")
        if el:
            el.fill("1")
            page.wait_for_timeout(500)
            for _ in range(3):
                el = page.query_selector('input[oninput*="setSimultaneousLimit"]')
                el.press("ArrowUp")
                page.wait_for_timeout(300)
            el = page.query_selector('input[oninput*="setSimultaneousLimit"]')
            assert int(el.input_value()) == 4

    def test_run_probe_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/bandwidth")
        page.wait_for_selector(".show-bandwidth", state="visible", timeout=5000)
        mock_tracker["ariaflow_web.webapp.bandwidth_probe_from"].reset_mock()
        page.click('button:has-text("Run probe")')
        page.wait_for_timeout(500)
        assert mock_tracker["ariaflow_web.webapp.bandwidth_probe_from"].called


# ---------------------------------------------------------------------------
# Dev
# ---------------------------------------------------------------------------

class TestDevButtons:
    def test_open_docs_button_exists(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        assert page.query_selector("text=Open Swagger UI") is not None

    def test_open_spec_button_exists(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        assert page.query_selector("text=Download OpenAPI spec") is not None

    def test_run_tests_button(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/dev")
        page.wait_for_selector(".show-dev", state="visible", timeout=5000)
        page.click("text=Run tests")
        page.wait_for_timeout(1000)
        assert page.inner_text("#test-badge") != "-"


# ---------------------------------------------------------------------------
# Refresh control
# ---------------------------------------------------------------------------

class TestRefreshControl:
    def test_refresh_interval_change(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "3000")
        assert page.evaluate("refreshInterval") == 3000

    def test_refresh_off(self, page: Page, web_server: str) -> None:
        page.goto(f"{web_server}/")
        page.select_option("#refresh-interval", "0")
        assert page.evaluate("refreshInterval") == 0
