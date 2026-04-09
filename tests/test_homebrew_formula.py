from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "homebrew_formula.py"
SPEC = importlib.util.spec_from_file_location("homebrew_formula_script", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
homebrew_formula_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(homebrew_formula_script)


class HomebrewFormulaScriptTests(unittest.TestCase):
    def test_version_from_tag_requires_stable_shape(self) -> None:
        with self.assertRaises(SystemExit):
            homebrew_formula_script.version_from_tag("v0.1.18-alpha.1")

    def test_render_formula_adds_backend_dependency(self) -> None:
        formula = homebrew_formula_script.render_formula(
            version="0.1.18",
            url="https://example.invalid/v0.1.18.tar.gz",
            sha256="abc123",
        )

        self.assertIn('version "0.1.18"', formula)
        self.assertIn('depends_on "ariaflow"', formula)
        self.assertIn('head "https://github.com/bonomani/ariaflow-dashboard.git", branch: "main"', formula)
        self.assertIn('PYTHONPATH="#{libexec}/src:${PYTHONPATH}"', formula)
        self.assertNotIn("#{PYTHONPATH}", formula)


if __name__ == "__main__":
    unittest.main()
