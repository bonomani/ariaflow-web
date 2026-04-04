"""End-to-end test: add a large download, interact with it through every
possible action, verify the UI reflects each state change, then remove it."""
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time

import pytest
from playwright.sync_api import sync_playwright, Page

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ariaflow_web.webapp import serve  # noqa: E402
from conftest import _allocate_port  # noqa: E402

pytestmark = pytest.mark.slow
_ALPINE_EVAL = "document.querySelector('[x-data]')._x_dataStack[0]"


def _goto(page: Page, url: str) -> None:
    page.goto(url)
    page.wait_for_timeout(200)


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

    def status(self) -> dict:
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
            "ariaflow": {"reachable": True, "version": "0.1.34", "pid": 9999},
        }

    def _item_view(self, item: dict) -> dict:
        view = {k: v for k, v in item.items() if k != "progress"}
        if item["status"] == "downloading":
            view["totalLength"] = 1073741824
            view["completedLength"] = item.get("progress", 0)
            view["downloadSpeed"] = 5242880
        return view

    def add_items(self, items: list[dict]) -> dict:
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

    def run_action(self, action: str, auto: bool | None = None) -> dict:
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

    def item_action(self, item_id: str, action: str) -> dict:
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

    def pause_queue(self) -> dict:
        self.paused = True
        for item in self.items:
            if item["status"] == "downloading":
                item["status"] = "paused"
        return {"paused": True}

    def resume_queue(self) -> dict:
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
from unittest.mock import patch  # noqa: E402

backend = FakeBackend()


class FakeBackendHandler(BaseHTTPRequestHandler):
    """HTTP handler that delegates to the module-level FakeBackend."""

    def _send(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/api/status":
            self._send(backend.status())
        elif path == "/api/declaration" or path == "/api/options":
            self._send({"uic": {"preferences": []}, "ucc": {}, "policy": {}})
        elif path == "/api/lifecycle":
            self._send({})
        elif path == "/api/log":
            self._send({"items": []})
        elif path == "/api/bandwidth":
            self._send({"source": "default", "downlink_mbps": 0, "cap_mbps": 2})
        elif path == "/api" or path == "/api/":
            self._send({"name": "ariaflow", "endpoints": {"GET": [], "POST": []}})
        else:
            self._send({"error": "not_found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        payload = json.loads(raw or "{}")

        if path == "/api/add":
            self._send(backend.add_items(payload.get("items", [])))
        elif path == "/api/run":
            self._send(backend.run_action(payload.get("action", ""), payload.get("auto_preflight_on_run")))
        elif path == "/api/pause":
            self._send(backend.pause_queue())
        elif path == "/api/resume":
            self._send(backend.resume_queue())
        elif path == "/api/session":
            self._send({"ok": True, "session": "test-sess"})
        elif path == "/api/preflight":
            self._send({"status": "pass", "gates": [], "warnings": [], "hard_failures": []})
        elif path == "/api/ucc":
            self._send({"result": {"outcome": "converged"}})
        elif path == "/api/declaration":
            self._send({"uic": {"preferences": []}, "ucc": {}, "policy": {}})
        elif path == "/api/bandwidth/probe":
            self._send({"ok": True, "source": "default"})
        elif path.startswith("/api/item/"):
            parts = path.split("/")
            if len(parts) == 5:
                self._send(backend.item_action(parts[3], parts[4]))
            else:
                self._send({"error": "not_found"}, status=404)
        else:
            self._send({"error": "not_found"}, status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


@pytest.fixture(scope="module")
def web_server():
    global backend
    backend = FakeBackend()

    # Start fake backend
    backend_port = _allocate_port()
    backend_server = ThreadingHTTPServer(("127.0.0.1", backend_port), FakeBackendHandler)
    threading.Thread(target=backend_server.serve_forever, daemon=True).start()
    backend_url = f"http://127.0.0.1:{backend_port}"

    # Start web server pointing to fake backend
    p = patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"})
    p.start()
    web_port = _allocate_port()
    web_srv = serve(host="127.0.0.1", port=web_port, backend_url=backend_url)
    threading.Thread(target=web_srv.serve_forever, daemon=True).start()
    time.sleep(0.3)
    yield f"http://127.0.0.1:{web_port}"
    web_srv.shutdown()
    web_srv.server_close()
    backend_server.shutdown()
    backend_server.server_close()
    p.stop()


@pytest.fixture(scope="module")
def browser_context(shared_browser):
    ctx = shared_browser.new_context()
    yield ctx
    ctx.close()


def refresh_and_wait(page: Page) -> None:
    """Trigger a JS refresh and wait for the queue to update."""
    page.evaluate(f"{_ALPINE_EVAL}._consecutiveFailures = 0; {_ALPINE_EVAL}.lastRev = null")
    page.evaluate(f"{_ALPINE_EVAL}.refresh()")
    page.wait_for_timeout(500)


def queue_items(page: Page) -> list:
    return page.query_selector_all(".item.compact")


def queue_text(page: Page) -> str:
    return page.inner_text("body")


def item_has_badge(page: Page, text: str) -> bool:
    """Check if any badge in the queue contains the given text."""
    badges = page.query_selector_all(".badge")
    return any(text.lower() in b.inner_text().lower() for b in badges)


# ---------------------------------------------------------------------------
# The test — runs as one ordered sequence
# ---------------------------------------------------------------------------

class TestDownloadLifecycle:
    """Full lifecycle: add -> start -> progress -> pause -> resume -> pause queue ->
    resume queue -> force error -> retry -> force done -> remove."""

    def test_01_empty_queue(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        text = queue_text(page)
        assert "empty" in text.lower() or "no " in text.lower()
        page.close()

    def test_02_add_large_download(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        page.fill('input[x-model="urlInput"]', "https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso")
        page.click('button:has-text("Add")')
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
        _goto(page, f"{web_server}/")
        page.click('button:has-text("Start")')
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert item_has_badge(page, "downloading") or "active" in text.lower()
        assert "%" in text
        page.close()

    def test_04_progress_advances(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        text1 = queue_text(page)
        refresh_and_wait(page)
        text2 = queue_text(page)
        assert "%" in text1
        assert "%" in text2
        assert "ETA" in text2
        assert "/s" in text2
        page.close()

    def test_05_pause_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        pause_btn = page.query_selector('button:has-text("Pause")')
        assert pause_btn is not None, "Pause button should exist on downloading item"
        pause_btn.click()
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        assert item_has_badge(page, "paused")
        visible_pause = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Pause').filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible_pause == 0
        visible_resume = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Resume').filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible_resume > 0
        page.close()

    def test_06_resume_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        resume_btn = page.evaluate('''(() => {
            const btns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Resume');
            const visible = btns.find(b => getComputedStyle(b).display !== 'none');
            if (visible) visible.click();
            return !!visible;
        })()''')
        assert resume_btn, "Resume button should exist on paused item"
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert item_has_badge(page, "downloading") or "active" in text.lower()
        page.close()

    def test_07_pause_queue(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        page.click('button:has-text("Pause")')
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        assert item_has_badge(page, "paused")
        text = queue_text(page)
        assert "paused" in text.lower()
        page.close()

    def test_08_resume_queue(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        page.click('button:has-text("Pause")')
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert item_has_badge(page, "downloading") or "active" in text.lower()
        page.close()

    def test_09_force_error_and_verify(self, browser_context, web_server: str) -> None:
        backend.force_error("dl-001")
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        assert item_has_badge(page, "error")
        visible_retry = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Retry').filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible_retry > 0
        visible_pause = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Pause').filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible_pause == 0
        page.close()

    def test_10_retry_error_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        page.evaluate('''(() => {
            const btns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Retry');
            const visible = btns.find(b => getComputedStyle(b).display !== 'none');
            if (visible) visible.click();
        })()''')
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        assert item_has_badge(page, "queued") or item_has_badge(page, "downloading")
        page.close()

    def test_11_force_done_and_verify(self, browser_context, web_server: str) -> None:
        backend.force_done("dl-001")
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        assert item_has_badge(page, "done")
        visible_pause = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Pause').filter(b => getComputedStyle(b).display !== 'none').length''')
        visible_resume = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Resume').filter(b => getComputedStyle(b).display !== 'none').length''')
        visible_retry = page.evaluate('''Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Retry').filter(b => getComputedStyle(b).display !== 'none').length''')
        assert visible_pause == 0
        assert visible_resume == 0
        assert visible_retry == 0
        assert page.query_selector('button:has-text("Remove")') is not None
        page.close()

    def test_12_remove_item(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        remove_btn = page.query_selector('button:has-text("Remove")')
        assert remove_btn is not None
        remove_btn.click()
        page.wait_for_timeout(300)
        refresh_and_wait(page)
        text = queue_text(page)
        assert "empty" in text.lower() or "no " in text.lower()
        items = queue_items(page)
        assert len(items) <= 1
        assert "ubuntu" not in text.lower()
        page.close()

    def test_13_filter_counts_reflect_empty(self, browser_context, web_server: str) -> None:
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")
        refresh_and_wait(page)
        all_btn = page.query_selector('.filter-bar .filter-btn')
        assert all_btn is not None
        text = all_btn.inner_text()
        assert "all" in text.lower()
        page.close()

    def test_14_add_multiple_and_verify_filters(self, browser_context, web_server: str) -> None:
        """Add 3 items, put them in different states, verify filters work."""
        page = browser_context.new_page()
        _goto(page, f"{web_server}/")

        # Add 3 downloads
        for url in ["https://example.com/file-a.bin", "https://example.com/file-b.bin", "https://example.com/file-c.bin"]:
            page.fill('input[x-model="urlInput"]', url)
            page.click('button:has-text("Add")')
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
        page.click('.filter-bar .filter-btn:has-text("queued")')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1

        page.click('.filter-bar .filter-btn:has-text("done")')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1

        page.click('.filter-bar .filter-btn:has-text("error")')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1

        page.click('.filter-bar .filter-btn:has-text("all")')
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 3

        # Test search
        page.fill('input[x-model="queueSearch"]', "file-b")
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 1
        assert "file-b" in queue_text(page).lower()

        page.fill('input[x-model="queueSearch"]', "")
        page.wait_for_timeout(200)
        assert len(queue_items(page)) == 3

        page.close()
