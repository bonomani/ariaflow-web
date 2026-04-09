"""BGS SHA drift detector.

Compares the bgs_version_ref pinned in docs/bgs-decision.yaml against
the current HEAD of the BGSPrivate sibling repo. Drift is reported as a
warning (the test still passes) so unrelated work isn't blocked, but
agents see the message and can bump the pin.

Skipped when BGSPrivate isn't reachable.
"""
from __future__ import annotations

import os
import re
import subprocess
import warnings
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DECISION = REPO_ROOT / "docs" / "governance" / "bgs-decision.yaml"
BGS_ROOT = Path(os.environ.get("ARIAFLOW_BGS_ROOT", str(REPO_ROOT.parent / "BGSPrivate")))


def _git_short_sha(repo: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


def test_bgs_sha_pin_is_current() -> None:
    """Warn (do not fail) when the pinned BGS SHA differs from BGSPrivate HEAD."""
    if not BGS_ROOT.exists():
        pytest.skip(f"BGSPrivate not at {BGS_ROOT}; set ARIAFLOW_BGS_ROOT to enable")

    yaml = pytest.importorskip("yaml")
    data = yaml.safe_load(DECISION.read_text(encoding="utf-8"))
    pinned = data.get("bgs_version_ref", "")
    match = re.match(r"^bgs@([A-Za-z0-9._-]+)$", pinned)
    assert match, f"bgs_version_ref must match 'bgs@<sha>', got {pinned!r}"
    pinned_sha = match.group(1)

    head_sha = _git_short_sha(BGS_ROOT / "bgs")
    if head_sha is None:
        pytest.skip(f"Could not read git HEAD of {BGS_ROOT / 'bgs'}")

    if not (pinned_sha.startswith(head_sha) or head_sha.startswith(pinned_sha)):
        warnings.warn(
            f"BGS SHA drift: pinned bgs@{pinned_sha} but BGSPrivate/bgs HEAD is {head_sha}. "
            f"Bump bgs_version_ref + member_version_refs in {DECISION.name} when ready.",
            stacklevel=1,
        )
