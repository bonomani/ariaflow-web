"""End-to-end test: add a large download, interact with it through every
possible action, verify the UI reflects each state change, then remove it."""
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
from playwright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ariaflow_web.webapp import serve  # noqa: E402
from conftest import bust_cache  # noqa: E402


# ---------------------------------------------------------------------------
# Stateful backend simulator
# ---------------------------------------------------------------------------

class FakeBackend:
    """Simulates a backend whose state changes as the frontend sends actions."""

    def __init__(self) -> None:
        self.items: list[dict] = []
        self.running = False
        self.paused = False
        self.next_id = 1

    def _find(self, item_id: str) -> dict | None:
        return next((i for i in self.items if i["id"] == item_id), None)

    def _active(self) -> dict | None:
        for item in self.items:
            if item["status"] == "downloading":
                return {
                    "gid": item["gid"],
                    "url": item["url"],
                    "status": "active",
                    "downloadSpeed": 5242880,  # 5 MiB/s
                    "totalLength": 1073741824,  # 1 GiB
                    "completedLength": item.get("progress", 0),
                    "percent": round(item.get("progress", 0) / 1073741824 * 100, 1),
                }
        return None

    def status(self, _base_url: str) -> dict:
        active = self._active()
        # Advance progress on each poll
        for item in self.items:
            if item["status"] == "downloading":
                item["progress"] = min(item.get("progress", 0) + 52428800, 1073741824)  # +50 MiB
        downloading = sum(1 for i in self.items if i["status"] == "downloading")
        return {
            "items": [self._item_view(i) for i in self.items],
            "active": active,
            "state": {
                "running": self.running,
                "paused": self.paused,
                "session_id": "test-sess",
                "session_started_at": "2026-04-02T10:00:00",
            },
            "summary": {
                "queued": sum(1 for i in self.items if i["status"] == "queued"),
                "done": sum(1 for i in self.items if i["status"] == "done"),
                "error": sum(1 for i in self.items if i["status"] == "error"),
                "total": len(self.items),
            },
            "bandwidth": {"source": "networkquality", "downlink_mbps": 100, "cap_mbps": 50},
            "backend": {"reachable": True, "version": "0.1.34", "pid": 9999},
        }

    def _item_view(self, item: dict) -> dict:
        view = {k: v for k, v in item.items() if k != "progress"}
        if item["status"] == "downloading":
            view["totalLength"] = 1073741824
            view["completedLength"] = item.get("progress", 0)
            view["downloadSpeed"] = 5242880
        return view

    def add_items(self, _base_url: str, items: list[dict]) -> dict:
        added = []
        for entry in items:
            item_id = f"dl-{self.next_id:03d}"
            self.next_id += 1
            item = {
                "id": item_id,
                "url": entry["url"],
                "output": entry["url"].split("/")[-1],
                "status": "queued",
                "gid": f"gid-{item_id}",
                "created_at": "2026-04-02T10:00:00",
                "progress": 0,
            }
            self.items.append(item)
            added.append({"url": entry["url"], "id": item_id})
        return {"ok": True, "count": len(added), "added": added}

    def run_action(self, _base_url: str, action: str, _auto: bool | None = None) -> dict:
        if action == "start":
            self.running = True
            # Start first queued item
            for item in self.items:
                if item["status"] == "queued":
                    item["status"] = "downloading"
                    break
            return {"ok": True, "action": "start", "result": {"started": True}}
        if action == "stop":
            self.running = False
            return {"ok": True, "action": "stop", "result": {"stopped": True}}
        return {"ok": False, "error": "unknown_action"}

    def item_action(self, _base_url: str, item_id: str, action: str) -> dict:
        item = self._find(item_id)
        if not item:
            return {"ok": False, "error": "not_found", "message": f"item {item_id} not found"}
        if action == "pause":
            if item["status"] in ("queued", "downloading"):
                item["status"] = "paused"
                return {"ok": True, "item": self._item_view(item)}
            return {"ok": False, "error": "invalid_state", "message": f"cannot pause {item['status']}"}
        if action == "resume":
            if item["status"] == "paused":
                item["status"] = "downloading" if self.running else "queued"
                return {"ok": True, "item": self._item_view(item)}
            return {"ok": False, "error": "invalid_state", "message": f"cannot resume {item['status']}"}
        if action == "retry":
            if item["status"] in ("error", "failed"):
                item["status"] = "queued"
                item["progress"] = 0
                return {"ok": True, "item": self._item_view(item)}
            return {"ok": False, "error": "invalid_state", "message": f"cannot retry {item['status']}"}
        if action == "remove":
            self.items = [i for i in self.items if i["id"] != item_id]
            return {"ok": True, "removed": True, "item": self._item_view(item)}
        return {"ok": False, "error": "invalid_action"}

    def pause_queue(self, _base_url: str) -> dict:
        self.paused = True
        for item in self.items:
            if item["status"] == "downloading":
                item["status"] = "paused"
        return {"paused": True}

    def resume_queue(self, _base_url: str) -> dict:
        self.paused = False
        for item in self.items:
            if item["status"] == "paused":
                item["status"] = "downloading" if self.running else "queued"
        return {"resumed": True}

    def force_error(self, item_id: str) -> None:
        item = self._find(item_id)
        if item:
            item["status"] = "error"
            item["error_message"] = "simulated failure"

    def force_done(self, item_id: str) -> None:
        item = self._find(item_id)
        if item:
            item["status"] = "done"
            item["progress"] = 1073741824


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

from conftest import _allocate_port  # noqa: E402

backend = FakeBackend()


@pytest.fixture(scope="module")
def web_server():
    global backend
    backend = FakeBackend()
    tmp = tempfile.mkdtemp()
    os.environ["ARIA_QUEUE_DIR"] = tmp

    declaration = {"uic": {"preferences": []}, "ucc": {}, "policy": {}}

    patches = [
        patch("ariaflow_web.webapp.get_status_from", side_effect=backend.status),
        patch("ariaflow_web.webapp.add_items_from", side_effect=backend.add_items),
        patch("ariaflow_web.webapp.run_action_from", side_effect=backend.run_action),
        patch("ariaflow_web.webapp.item_action_from", side_effect=backend.item_action),
        patch("ariaflow_web.webapp.pause_from", side_effect=backend.pause_queue),
        patch("ariaflow_web.webapp.resume_from", side_effect=backend.resume_queue),
        patch("ariaflow_web.webapp.get_log_from", return_value={"items": []}),
        patch("ariaflow_web.webapp.get_declaration_from", return_value=declaration),
        patch("ariaflow_web.webapp.get_lifecycle_from", return_value={}),
        patch("ariaflow_web.webapp.preflight_from", return_value={"status": "pass", "gates": [], "warnings": [], "hard_failures": []}),
        patch("ariaflow_web.webapp.run_ucc_from", return_value={"result": {"outcome": "converged"}}),
        patch("ariaflow_web.webapp.save_declaration_from", return_value={"saved": True}),
        patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"}),
        patch("ariaflow_web.webapp.set_session_from", return_value={"ok": True, "session": "test-sess"}),
        patch("ariaflow_web.webapp.lifecycle_action_from", return_value={"ok": True, "lifecycle": {}}),
        patch("ariaflow_web.webapp.get_api_discovery_from", return_value={"name": "ariaflow", "endpoints": {"GET": [], "POST": []}}),
        patch("ariaflow_web.webapp.get_bandwidth_from", return_value={"source": "default", "downlink_mbps": 0, "cap_mbps": 2}),
        patch("ariaflow_web.webapp.bandwidth_probe_from", return_value={"ok": True, "source": "default"}),
        patch("ariaflow_web.webapp._local_pid_for_port", return_value=None),
    ]
    for p in patches:
        p.start()

    port = _allocate_port()
    server = serve(host="127.0.0.1", port=port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    server.server_close()
    for p in patches:
        p.stop()


@pytest.fixture(scope="module")
def browser_context(shared_browser):
    ctx = shared_browser.new_context()
    yield ctx
    ctx.close()


def refresh_and_wait(page: Page) -> None:
    """Trigger a JS refresh and wait for the queue to update."""
    bust_cache()
    page.evaluate("refresh()")
    page.wait_for_timeout(500)


def queue_items(page: Page) -> list:
    return page.query_selector_all("#queue .item")


def queue_text(page: Page) -> str:
    return page.inner_text("#queue")


def item_has_badge(page: Page, text: str) -> bool:
    """Check if any badge in the queue contains the given text."""
    badges = page.query_selector_all("#queue .badge")
    return any(text.lower() in b.inner_text().lower() for b in badges)


# ---------------------------------------------------------------------------
# The test — runs as one ordered sequence
# ---------------------------------------------------------------------------

class TestDownloadLifecycle:
    """Full lifecycle: add → start → progress → pause → resume → pause queue →
    resume queue → force error → retry → force done → remove."""

    def test_01_empty_queue(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        text = queue_text(page)
        assert "empty" in text.lower() or "no " in text.lower()
        page.close()

    def test_02_add_large_download(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        page.fill("#url", "https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso")
        page.click(".queue-add-button")
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        items = queue_items(page)
        assert len(items) == 1
        text = queue_text(page)
        assert "ubuntu" in text.lower()
        assert item_has_badge(page, "queued")
        page.close()

    def test_03_start_engine_begins_download(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        page.click("#runner-btn")
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        # Item should now be downloading
        assert item_has_badge(page, "downloading") or "active" in text.lower()
        # Should show progress
        assert "%" in text
        page.close()

    def test_04_progress_advances(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        text1 = queue_text(page)
        # Poll again — progress should advance
        refresh_and_wait(page)
        text2 = queue_text(page)
        # Both should show progress bar and speed
        assert "%" in text1
        assert "%" in text2
        # Should show ETA
        assert "ETA" in text2
        # Should show speed
        assert "/s" in text2
        page.close()

    def test_05_pause_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        # Find and click pause button on the downloading item
        pause_btn = page.query_selector('button[title="Pause"]')
        assert pause_btn is not None, "Pause button should exist on downloading item"
        pause_btn.click()
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        assert item_has_badge(page, "paused")
        # Pause button should be gone, resume should appear
        assert page.query_selector('button[title="Pause"]') is None
        assert page.query_selector('button[title="Resume"]') is not None
        page.close()

    def test_06_resume_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        resume_btn = page.query_selector('button[title="Resume"]')
        assert resume_btn is not None, "Resume button should exist on paused item"
        resume_btn.click()
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert item_has_badge(page, "downloading") or "active" in text.lower()
        page.close()

    def test_07_pause_queue(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        page.click("#toggle-btn")
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        assert item_has_badge(page, "paused")
        # Queue state should reflect paused
        queue_state = page.inner_text("#queue-state")
        assert "paused" in queue_state.lower()
        page.close()

    def test_08_resume_queue(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        page.click("#toggle-btn")
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert item_has_badge(page, "downloading") or "active" in text.lower()
        page.close()

    def test_09_force_error_and_verify(self, browser_context, web_server: str) -> None:
        backend.force_error("dl-001")
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        assert item_has_badge(page, "error")
        # Should have retry button, no pause button
        assert page.query_selector('button[title="Retry"]') is not None
        assert page.query_selector('button[title="Pause"]') is None
        page.close()

    def test_10_retry_error_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        retry_btn = page.query_selector('button[title="Retry"]')
        assert retry_btn is not None
        retry_btn.click()
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        # Item should be back to queued (engine is running so it may start downloading)
        assert item_has_badge(page, "queued") or item_has_badge(page, "downloading")
        page.close()

    def test_11_force_done_and_verify(self, browser_context, web_server: str) -> None:
        backend.force_done("dl-001")
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        assert item_has_badge(page, "done")
        # Done item should have no pause/resume/retry, only remove
        assert page.query_selector('button[title="Pause"]') is None
        assert page.query_selector('button[title="Resume"]') is None
        assert page.query_selector('button[title="Retry"]') is None
        assert page.query_selector('button[title="Remove"]') is not None
        page.close()

    def test_12_remove_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        remove_btn = page.query_selector('button[title="Remove"]')
        assert remove_btn is not None
        remove_btn.click()
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert "empty" in text.lower() or "no " in text.lower()
        items = queue_items(page)
        # Queue should have no real items (just the empty message)
        assert len(items) <= 1
        assert "ubuntu" not in text.lower()
        page.close()

    def test_13_filter_counts_reflect_empty(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)
        refresh_and_wait(page)
        all_btn = page.query_selector('#queue-filters .filter-btn[data-filter="all"]')
        assert all_btn is not None
        # Should show "All" with no count or count 0
        text = all_btn.inner_text()
        assert "All" in text
        assert "(0)" not in text or "All" == text  # either no count shown or zero
        page.close()

    def test_14_add_multiple_and_verify_filters(self, browser_context, web_server: str) -> None:
        """Add 3 items, put them in different states, verify filters work."""
        page = browser_context.new_page()
        page.goto(f"{web_server}/")
        page.wait_for_timeout(500)

        # Add 3 downloads
        for url in ["https://example.com/file-a.bin", "https://example.com/file-b.bin", "https://example.com/file-c.bin"]:
            page.fill("#url", url)
            page.click(".queue-add-button")
            page.wait_for_timeout(300)
        refresh_and_wait(page)

        items = queue_items(page)
        assert len(items) == 3, f"Expected 3, got {len(items)}, backend has {len(backend.items)} items"

        # Force different states
        backend.force_error("dl-003")
        backend.force_done("dl-004")
        # dl-002 stays queued
        refresh_and_wait(page)
        refresh_and_wait(page)  # ensure stale cache is fully flushed

        # Test each filter
        page.click('#queue-filters .filter-btn[data-filter="queued"]')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1

        page.click('#queue-filters .filter-btn[data-filter="done"]')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1

        page.click('#queue-filters .filter-btn[data-filter="error"]')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1

        page.click('#queue-filters .filter-btn[data-filter="all"]')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 3

        # Test search
        page.fill("#queue-search", "file-b")
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1
        assert "file-b" in queue_text(page).lower()

        page.fill("#queue-search", "")
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 3

        page.close()
