from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.parse
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_web.webapp import serve  # noqa: E402


def request_json(url: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


class WebSmokeTests(unittest.TestCase):
    def test_status_payload_falls_back_to_local_backend_pid_from_port(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ARIA_QUEUE_DIR"] = tmp
            status_payload = {
                "items": [],
                "state": {"running": False, "paused": False},
                "summary": {"queued": 0, "done": 0, "error": 0},
                "backend": {"reachable": True},
            }
            declaration_payload = {"uic": {}, "ucc": {}, "policy": {}}
            with patch("ariaflow_web.webapp.get_lifecycle_from", return_value={}), \
                 patch("ariaflow_web.webapp.get_status_from", return_value=status_payload), \
                 patch("ariaflow_web.webapp.get_log_from", return_value={"items": []}), \
                 patch("ariaflow_web.webapp.get_declaration_from", return_value=declaration_payload), \
                 patch("ariaflow_web.webapp.add_items_from", return_value={"ok": True, "count": 0, "added": []}), \
                 patch("ariaflow_web.webapp.preflight_from", return_value={"status": "pass"}), \
                 patch("ariaflow_web.webapp.run_action_from", return_value={"ok": True, "action": "start", "result": {"started": True}}), \
                 patch("ariaflow_web.webapp.run_ucc_from", return_value={"result": {"outcome": "converged", "observation": "ok"}}), \
                 patch("ariaflow_web.webapp.save_declaration_from", return_value={"saved": True, "declaration": declaration_payload}), \
                 patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"}), \
                 patch("ariaflow_web.webapp.set_session_from", return_value={"ok": True, "session": "batch-1"}), \
                 patch("ariaflow_web.webapp.pause_from", return_value={"paused": True}), \
                 patch("ariaflow_web.webapp.resume_from", return_value={"resumed": True}), \
                 patch("ariaflow_web.webapp.lifecycle_action_from", return_value={"ok": True, "lifecycle": {}}), \
                 patch("ariaflow_web.webapp._local_pid_for_port", return_value=4242):
                server = serve(host="127.0.0.1", port=8767)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                time.sleep(0.2)
                try:
                    status = request_json(
                        "http://127.0.0.1:8767/api/status?" + urllib.parse.urlencode({"backend": "http://127.0.0.1:8000"})
                    )
                    self.assertEqual(status["backend"]["pid"], 4242)
                    self.assertEqual(status["backend"]["url"], "http://127.0.0.1:8000")
                finally:
                    server.shutdown()
                    server.server_close()

    def test_networkquality_timeout_label_is_probe_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ARIA_QUEUE_DIR"] = tmp
            lifecycle_payload = {
                "ariaflow": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "target": "ariaflow", "completion": "complete", "message": "ariaflow installed 1.0.0; current production 1.0.0; updates via Homebrew tap"}},
                "aria2": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "target": "aria2", "completion": "complete", "message": "aria2 installed 1.0.0; current production 1.0.0; runtime engine dependency"}},
                "networkquality": {"meta": {"contract": "UCC"}, "result": {"outcome": "unchanged", "observation": "warn", "reason": "timeout", "target": "networkquality", "completion": "complete", "message": "networkquality available at /usr/bin/networkquality; probe timed out"}},
                "aria2-launchd": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "target": "aria2-launchd", "completion": "complete", "message": "aria2 launchd loaded (1.0.0); optional advanced auto-start integration"}},
            }
            status_payload = {
                "items": [],
                "state": {"running": False, "paused": False},
                "summary": {"queued": 0, "done": 0, "error": 0},
            }
            declaration_payload = {"uic": {}, "ucc": {}, "policy": {}}
            with patch("ariaflow_web.webapp.get_lifecycle_from", return_value=lifecycle_payload), \
                 patch("ariaflow_web.webapp.get_status_from", return_value=status_payload), \
                 patch("ariaflow_web.webapp.get_log_from", return_value={"items": []}), \
                 patch("ariaflow_web.webapp.get_declaration_from", return_value=declaration_payload), \
                 patch("ariaflow_web.webapp.add_items_from", return_value={"ok": True, "count": 0, "added": []}), \
                 patch("ariaflow_web.webapp.preflight_from", return_value={"status": "pass"}), \
                 patch("ariaflow_web.webapp.run_action_from", return_value={"ok": True, "action": "start", "result": {"started": True}}), \
                 patch("ariaflow_web.webapp.run_ucc_from", return_value={"result": {"outcome": "converged", "observation": "ok"}}), \
                 patch("ariaflow_web.webapp.save_declaration_from", return_value={"saved": True, "declaration": declaration_payload}), \
                 patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"}), \
                 patch("ariaflow_web.webapp.set_session_from", return_value={"ok": True, "session": "batch-1"}), \
                 patch("ariaflow_web.webapp.pause_from", return_value={"paused": True}), \
                 patch("ariaflow_web.webapp.resume_from", return_value={"resumed": True}), \
                 patch("ariaflow_web.webapp.lifecycle_action_from", return_value={"ok": True, "lifecycle": lifecycle_payload}):
                server = serve(host="127.0.0.1", port=8766)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                time.sleep(0.2)
                try:
                    lifecycle_page = urllib.request.urlopen("http://127.0.0.1:8766/lifecycle", timeout=5).read().decode("utf-8")
                    self.assertIn("installed · probe timeout", lifecycle_page)
                    self.assertNotIn("installed · slow", lifecycle_page)
                finally:
                    server.shutdown()
                    server.server_close()

    def test_local_web_server_smoke(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ARIA_QUEUE_DIR"] = tmp
            lifecycle_payload = {
                "ariaflow": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "target": "ariaflow", "completion": "complete", "message": "ariaflow installed 1.0.0; current production 1.0.0; updates via Homebrew tap"}},
                "aria2": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "target": "aria2", "completion": "complete", "message": "aria2 installed 1.0.0; current production 1.0.0; runtime engine dependency"}},
                "networkquality": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "ready", "target": "networkquality", "completion": "complete", "message": "networkquality available"}},
                "aria2-launchd": {"meta": {"contract": "UCC"}, "result": {"outcome": "converged", "observation": "ok", "reason": "match", "target": "aria2-launchd", "completion": "complete", "message": "aria2 launchd loaded (1.0.0); optional advanced auto-start integration"}},
                "session_id": "batch-1",
                "session_started_at": "2026-03-21T00:00:00+0100",
                "session_last_seen_at": "2026-03-21T00:00:00+0100",
                "session_closed_at": None,
                "session_closed_reason": None,
            }
            status_payload = {
                "items": [],
                "state": {"running": False, "paused": False},
                "summary": {"queued": 0, "done": 0, "error": 0},
            }
            declaration_payload = {"uic": {}, "ucc": {}, "policy": {}}
            def add_items_response(_base_url: str, items: list[dict]) -> dict:
                return {"ok": True, "count": len(items), "added": [{"url": item["url"]} for item in items]}
            with patch("ariaflow_web.webapp.get_lifecycle_from", return_value=lifecycle_payload), \
                 patch("ariaflow_web.webapp.get_status_from", return_value=status_payload), \
                 patch("ariaflow_web.webapp.get_log_from", return_value={"items": []}), \
                 patch("ariaflow_web.webapp.get_declaration_from", return_value=declaration_payload), \
                 patch("ariaflow_web.webapp.add_items_from", side_effect=add_items_response), \
                 patch("ariaflow_web.webapp.preflight_from", return_value={"status": "pass"}), \
                 patch("ariaflow_web.webapp.run_action_from", return_value={"ok": True, "action": "start", "result": {"started": True}}), \
                 patch("ariaflow_web.webapp.run_ucc_from", return_value={"result": {"outcome": "converged", "observation": "ok"}}), \
                 patch("ariaflow_web.webapp.save_declaration_from", return_value={"saved": True, "declaration": declaration_payload}), \
                 patch("ariaflow_web.webapp.discover_http_services", return_value={"available": True, "items": [{"url": "http://example.local:8000", "role": "api"}], "reason": "ok"}), \
                 patch("ariaflow_web.webapp.set_session_from", return_value={"ok": True, "session": lifecycle_payload["session_id"]}), \
                 patch("ariaflow_web.webapp.pause_from", return_value={"paused": True}), \
                 patch("ariaflow_web.webapp.resume_from", return_value={"resumed": True}), \
                 patch("ariaflow_web.webapp.lifecycle_action_from", return_value={"ok": True, "lifecycle": lifecycle_payload}):
                server = serve(host="127.0.0.1", port=8765)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                time.sleep(0.2)
                try:
                    page = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=5).read().decode("utf-8")
                    self.assertIn("ariaflow", page)
                    self.assertIn("Web UI", page)
                    bandwidth_page = urllib.request.urlopen("http://127.0.0.1:8765/bandwidth", timeout=5).read().decode("utf-8")
                    self.assertIn("Bandwidth", bandwidth_page)
                    lifecycle_page = urllib.request.urlopen("http://127.0.0.1:8765/lifecycle", timeout=5).read().decode("utf-8")
                    self.assertIn("Service Status", lifecycle_page)
                    options_page = urllib.request.urlopen("http://127.0.0.1:8765/options", timeout=5).read().decode("utf-8")
                    self.assertIn("Options", options_page)
                    log_page = urllib.request.urlopen("http://127.0.0.1:8765/log", timeout=5).read().decode("utf-8")
                    self.assertIn("Log", log_page)
                    self.assertIn("action-filter", log_page)
                    self.assertIn("target-filter", log_page)
                    self.assertIn("session-filter", log_page)
                    status = request_json("http://127.0.0.1:8765/api/status")
                    self.assertIn("items", status)
                    self.assertIn("state", status)
                    self.assertIn("summary", status)
                    encoded_status = request_json(
                        "http://127.0.0.1:8765/api/status?" + urllib.parse.urlencode({"backend": "http://127.0.0.1:8000"})
                    )
                    self.assertIn("items", encoded_status)
                    log_data = request_json("http://127.0.0.1:8765/api/log")
                    self.assertIn("items", log_data)
                    declaration = request_json("http://127.0.0.1:8765/api/declaration")
                    self.assertIn("uic", declaration)
                    options = request_json("http://127.0.0.1:8765/api/options")
                    self.assertIn("uic", options)
                    lifecycle = request_json("http://127.0.0.1:8765/api/lifecycle")
                    self.assertIn("ariaflow", lifecycle)
                    self.assertIn("meta", lifecycle["ariaflow"])
                    self.assertIn("session_id", lifecycle)
                    discovery = request_json("http://127.0.0.1:8765/api/discovery")
                    self.assertTrue(discovery["available"])
                    self.assertEqual(discovery["items"][0]["url"], "http://example.local:8000")
                    session = request_json(
                        "http://127.0.0.1:8765/api/session",
                        method="POST",
                        payload={"action": "new"},
                    )
                    self.assertTrue(session["ok"])
                    self.assertIn("session", session)
                    lifecycle_action = request_json(
                        "http://127.0.0.1:8765/api/lifecycle/action",
                        method="POST",
                        payload={"target": "refresh", "action": "run"},
                    )
                    self.assertTrue(lifecycle_action["ok"])
                    self.assertIn("lifecycle", lifecycle_action)
                    saved = request_json(
                        "http://127.0.0.1:8765/api/declaration",
                        method="POST",
                        payload=declaration,
                    )
                    self.assertTrue(saved["saved"])
                    added = request_json(
                        "http://127.0.0.1:8765/api/add",
                        method="POST",
                        payload={"items": [{"url": "https://example.com/file.gguf"}]},
                    )
                    self.assertTrue(added["ok"])
                    self.assertEqual(added["added"][0]["url"], "https://example.com/file.gguf")
                    added_many = request_json(
                        "http://127.0.0.1:8765/api/add",
                        method="POST",
                        payload={"items": [{"url": "https://example.com/one.gguf"}, {"url": "https://example.com/two.gguf"}]},
                    )
                    self.assertIsInstance(added_many["added"], list)
                    self.assertEqual(added_many["count"], 2)
                    paused = request_json("http://127.0.0.1:8765/api/pause", method="POST")
                    self.assertIn("paused", paused)
                    resumed = request_json("http://127.0.0.1:8765/api/resume", method="POST")
                    self.assertIn("resumed", resumed)
                    run = request_json(
                        "http://127.0.0.1:8765/api/run",
                        method="POST",
                        payload={"action": "start", "auto_preflight_on_run": False},
                    )
                    self.assertTrue(run["ok"])
                    self.assertEqual(run["action"], "start")
                    self.assertTrue(run["result"]["started"])
                finally:
                    server.shutdown()
                    server.server_close()
