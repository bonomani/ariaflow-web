"""Smoke tests for the ariaflow-web static file server."""
from __future__ import annotations

import threading
import time
import unittest
import urllib.request

from unittest.mock import patch
from ariaflow_web.webapp import serve


class WebSmokeTests(unittest.TestCase):
    def test_local_web_server_smoke(self) -> None:
        with patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"}):
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
                # API discovery (only remaining API endpoint)
                import json
                resp = urllib.request.urlopen("http://127.0.0.1:8765/api/discovery", timeout=5)
                discovery = json.loads(resp.read().decode("utf-8"))
                self.assertIn("available", discovery)
                # Unknown API paths return 404
                try:
                    urllib.request.urlopen("http://127.0.0.1:8765/api/status", timeout=5)
                    self.fail("Expected 404")
                except urllib.error.HTTPError as exc:
                    self.assertEqual(exc.code, 404)
            finally:
                server.shutdown()
                server.server_close()

    def test_backend_url_injection(self) -> None:
        with patch("ariaflow_web.webapp.discover_http_services", return_value={"available": False, "items": [], "reason": "none"}):
            server = serve(host="127.0.0.1", port=8766, backend_url="http://custom:9999")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            time.sleep(0.2)
            try:
                page = urllib.request.urlopen("http://127.0.0.1:8766/", timeout=5).read().decode("utf-8")
                self.assertIn("http://custom:9999", page)
                self.assertIn("__ARIAFLOW_BACKEND_URL__", page)
            finally:
                server.shutdown()
                server.server_close()
