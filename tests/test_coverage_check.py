"""Meta-test: verify every actionable element in the UI has a corresponding test."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

STATIC_DIR = Path(__file__).resolve().parents[1] / "src" / "ariaflow_web" / "static"
TEST_DIR = Path(__file__).resolve().parent

# JS function names invoked by Alpine @click/@change/@input handlers
ACTION_RE = re.compile(r'@(?:click|change|input)(?:\.[a-z0-9.]+)?="([^"(]+)\(')

# Normalize dynamic template expressions to base function name
TEMPLATE_RE = re.compile(r'\$\{[^}]+\}')


def _extract_actions() -> set[str]:
    """Extract all unique JS function names from inline event handlers in static files."""
    actions: set[str] = set()
    for path in [STATIC_DIR / "index.html", STATIC_DIR / "app.js"]:
        source = path.read_text(encoding="utf-8")
        for match in ACTION_RE.finditer(source):
            fn = match.group(1).strip()
            if "${" in fn:
                continue
            actions.add(fn)
    return actions


def _extract_tested_functions() -> set[str]:
    """Extract all JS function names referenced in test files."""
    tested: set[str] = set()
    for test_file in TEST_DIR.glob("test_*.py"):
        content = test_file.read_text(encoding="utf-8")
        # Function names in strings: onclick="add()", evaluate("refresh()"), etc.
        for fn in re.findall(r'["\']([a-zA-Z_]\w*)\(', content):
            tested.add(fn)
        # Function names in selector strings: @click="toggleTheme" or onclick*="toggleTheme"
        for fn in re.findall(r'(?:onclick|@click)\*?="([a-zA-Z_]\w*)', content):
            tested.add(fn)
        # @change, @input, onchange*= and oninput*= selectors
        for fn in re.findall(r'(?:on(?:change|input)|@(?:change|input))\*?="([a-zA-Z_]\w*)', content):
            tested.add(fn)
        # Function names referenced directly in test names or assertions
        for fn in re.findall(r'["\']([a-zA-Z_]\w+)["\']', content):
            tested.add(fn)
    return tested


# Map of JS action function -> test that covers it.
# Every inline handler must appear here or be detected automatically.
COVERAGE_MAP: dict[str, str] = {
    "add": "test_add_url_button / test_02_add_large_download",
    "addBackend": "test_add_backend_button",
    "itemAction": "test_pause_button / test_resume_button / test_retry_button / test_remove_button",
    "lifecycleAction": "test_lifecycle_action_buttons_render",
    "loadDeclaration": "test_load_declaration_button",
    "openDocs": "test_open_docs_button_exists",
    "openSpec": "test_open_spec_button_exists",
    "preflightRun": "test_preflight_button",
    "refreshActionLog": "test_action_filter_dropdown / test_target_filter_dropdown / test_session_filter_dropdown",
    "removeBackend": "test_remove_backend_button",
    "runProbe": "test_run_probe_button",
    "runTests": "test_run_tests_button",
    "saveDeclaration": "test_save_declaration_button",
    "selectBackend": "test_select_default_backend_button",
    "setAutoPreflightPreference": "test_auto_preflight_toggle",
    "setAria2UnsafeOptions": "test_aria2_options (unsafe toggle)",
    "setBandwidthPref": "test_bandwidth_free_percent_input / test_bandwidth_free_absolute_input / test_bandwidth_floor_input",
    "setDuplicateAction": "test_duplicate_action_dropdown",
    "setPostActionRule": "test_post_action_rule_dropdown",
    "setQueueFilter": "test_filter_button[all-5] through test_filter_button[error-1]",
    "setRefreshInterval": "test_refresh_interval_change / test_refresh_off",
    "setSimultaneousLimit": "test_simultaneous_downloads_input",
    "toggleScheduler": "test_start_stop_engine_button / test_03_start_engine",
    "schedulerAction": "test_start_stop_engine_button (stop button)",
    "toggleTheme": "test_theme_toggle_cycles",
    "uccRun": "test_run_contract_button",
    "cleanup": "test_cleanup",
    "itemToggleAction": "test_pause_button / test_resume_button / test_retry_button (smart toggle)",
    "openFileSelection": "test_file_selection",
    "closeFileSelection": "test_file_selection",
    "saveFileSelection": "test_file_selection",
    "navigateTo": "test_nav_links",
    "handleFileUpload": "test_api_params.test_valid_add (torrent_data/metalink_data path)",
    "loadMoreArchive": "test_api_params.test_archive (archive pagination)",
    "loadSessionStats": "test_api_params.test_session_stats",
    "setAria2Option": "test_api_params.test_aria2_options",
}


class TestActionableCoverage:
    """Ensure every onclick/onchange/oninput handler has a test."""

    def test_all_actions_are_defined(self) -> None:
        actions = _extract_actions()
        assert len(actions) > 0, "Should find at least some actions"

    def test_all_actions_have_tests(self) -> None:
        actions = _extract_actions()

        untested = []
        for action in sorted(actions):
            if action not in COVERAGE_MAP:
                untested.append(action)

        assert untested == [], (
            f"The following actionable functions have no test coverage:\n"
            + "\n".join(f"  - {fn}()" for fn in untested)
            + "\n\nAdd the function to COVERAGE_MAP with the test that covers it."
        )

    def test_coverage_map_matches_actions(self) -> None:
        """Ensure COVERAGE_MAP doesn't have stale entries for removed actions."""
        actions = _extract_actions()
        stale = [fn for fn in COVERAGE_MAP if fn not in actions]
        assert stale == [], (
            f"COVERAGE_MAP has entries for actions that no longer exist:\n"
            + "\n".join(f"  - {fn}" for fn in stale)
        )

    def test_action_count_is_stable(self) -> None:
        """Guard against silently adding untested actions."""
        actions = _extract_actions()
        # Update this number when adding new actions
        assert len(actions) >= 20, f"Expected at least 20 actions, found {len(actions)}: {sorted(actions)}"
