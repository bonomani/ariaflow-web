"""Meta-test: verify every actionable element in the UI has a corresponding test."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

STATIC_DIR = Path(__file__).resolve().parents[1] / "src" / "ariaflow_web" / "static"
TEST_DIR = Path(__file__).resolve().parent
UCC_DECLARATIONS = Path(__file__).resolve().parents[1] / "docs" / "ucc-declarations.yaml"


def _load_ucc_declarations() -> dict:
    """Load the canonical UCC declaration artifact (BGS-Verified evidence)."""
    import yaml
    return yaml.safe_load(UCC_DECLARATIONS.read_text(encoding="utf-8"))


_UCC = _load_ucc_declarations()

# JS function names invoked by Alpine @click/@change/@input handlers
ACTION_RE = re.compile(r'@(?:click|change|input)(?:\.[a-z0-9.]+)?="([^"(]+)\(')

# Normalize dynamic template expressions to base function name
TEMPLATE_RE = re.compile(r'\$\{[^}]+\}')


def _extract_actions() -> set[str]:
    """Extract all unique JS function names from inline event handlers in static files."""
    actions: set[str] = set()
    paths = [STATIC_DIR / "index.html", STATIC_DIR / "app.js"]
    paths.extend(sorted((STATIC_DIR / "_fragments").glob("*.html")))
    for path in paths:
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
# Sourced from docs/ucc-declarations.yaml (UCC declaration artifact).
COVERAGE_MAP: dict[str, str] = _UCC["coverage_map"]


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
