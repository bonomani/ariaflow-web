from __future__ import annotations

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ariaflow_dashboard.cli import build_parser  # noqa: E402


class CliTests(unittest.TestCase):
    def test_cli_parser_uses_expected_defaults(self) -> None:
        args = build_parser().parse_args([])

        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 8001)
