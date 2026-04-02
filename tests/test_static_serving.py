"""Static file serving, path traversal, and HTML validation tests."""
from __future__ import annotations

import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import start_server, stop_server  # noqa: E402


@pytest.fixture(scope="module")
def web_server():
    url, server, patches, _ = start_server()
    yield url
    stop_server(server, patches)


class TestStaticFiles:
    def test_css_served_with_correct_type(self, web_server: str) -> None:
        resp = urllib.request.urlopen(f"{web_server}/static/style.css", timeout=5)
        assert "text/css" in resp.headers.get("Content-Type", "")
        assert ":root" in resp.read().decode()

    def test_js_served_with_correct_type(self, web_server: str) -> None:
        resp = urllib.request.urlopen(f"{web_server}/static/app.js", timeout=5)
        assert "javascript" in resp.headers.get("Content-Type", "")
        assert "function" in resp.read().decode()

    def test_html_references_css_and_js(self, web_server: str) -> None:
        body = urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode()
        assert "/static/style.css" in body and "/static/app.js" in body

    def test_html_has_version_substituted(self, web_server: str) -> None:
        body = urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode()
        assert "__ARIAFLOW_WEB_VERSION__" not in body and "v0." in body

    def test_html_has_pid_substituted(self, web_server: str) -> None:
        body = urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode()
        assert "__ARIAFLOW_WEB_PID__" not in body


class TestPathTraversal:
    def test_dotdot_blocked(self, web_server: str) -> None:
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(f"{web_server}/static/../webapp.py", timeout=5)
        assert exc.value.code in (403, 404)

    def test_absolute_path_blocked(self, web_server: str) -> None:
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(f"{web_server}/static//etc/passwd", timeout=5)
        assert exc.value.code in (403, 404)

    def test_nonexistent_file_404(self, web_server: str) -> None:
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(f"{web_server}/static/nonexistent.xyz", timeout=5)
        assert exc.value.code == 404

    def test_directory_listing_blocked(self, web_server: str) -> None:
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(f"{web_server}/static/", timeout=5)
        assert exc.value.code in (403, 404)


class TestHTMLValidation:
    def test_html_is_valid_structure(self, web_server: str) -> None:
        soup = BeautifulSoup(urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode(), "html.parser")
        assert soup.find("html") and soup.find("head") and soup.find("body")
        assert soup.find("title").string == "ariaflow"

    def test_all_ids_are_unique(self, web_server: str) -> None:
        soup = BeautifulSoup(urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode(), "html.parser")
        ids = [el.get("id") for el in soup.find_all(id=True)]
        assert [i for i in ids if ids.count(i) > 1] == []

    def test_all_links_have_href(self, web_server: str) -> None:
        soup = BeautifulSoup(urllib.request.urlopen(f"{web_server}/", timeout=5).read().decode(), "html.parser")
        for link in soup.find_all("a"):
            assert link.get("href"), f"Link without href: {link}"

    def test_css_balanced_braces(self, web_server: str) -> None:
        css = urllib.request.urlopen(f"{web_server}/static/style.css", timeout=5).read().decode()
        assert css.count("{") == css.count("}")

    def test_js_balanced_parens(self, web_server: str) -> None:
        js = urllib.request.urlopen(f"{web_server}/static/app.js", timeout=5).read().decode()
        assert js.count("(") == js.count(")")
