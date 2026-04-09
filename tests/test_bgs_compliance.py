"""BGS compliance check.

Runs the BGS validator from the BGSPrivate sibling repo against this
project's docs/governance/BGS.md + docs/governance/bgs-decision.yaml. The validator location is
configurable via the ARIAFLOW_BGS_ROOT env var (default: ../BGSPrivate
relative to this repo root). Skipped when the validator isn't reachable.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BGS_ENTRY = REPO_ROOT / "docs" / "governance" / "BGS.md"
DEFAULT_BGS_ROOT = REPO_ROOT.parent / "BGSPrivate"
BGS_ROOT = Path(os.environ.get("ARIAFLOW_BGS_ROOT", str(DEFAULT_BGS_ROOT)))
VALIDATOR = BGS_ROOT / "bgs" / "tools" / "check-bgs-compliance.py"


def test_bgs_compliance_passes() -> None:
    """The BGS adopter validator must report PASS for this repo."""
    if not VALIDATOR.exists():
        pytest.skip(
            f"BGS validator not found at {VALIDATOR}. "
            "Set ARIAFLOW_BGS_ROOT to the BGSPrivate checkout root to enable."
        )
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR),
            str(BGS_ENTRY),
            "--member-repos-root",
            str(BGS_ROOT),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    output = result.stdout + result.stderr
    assert "PASS" in output, f"BGS validator did not report PASS:\n{output}"
    assert "FAIL" not in output, f"BGS validator reported FAIL:\n{output}"
