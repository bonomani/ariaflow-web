"""Code quality and static analysis tests using ruff, mypy, and coverage."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


class TestRuff:
    def test_ruff_passes(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "ruff", "check", str(SRC)],
            capture_output=True, text=True, timeout=30,
        )
        assert result.returncode == 0, f"ruff check failed:\n{result.stdout}\n{result.stderr}"


class TestMypy:
    def test_mypy_passes(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "mypy", str(SRC), "--ignore-missing-imports"],
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, f"mypy failed:\n{result.stdout}\n{result.stderr}"


class TestPythonCompile:
    """Verify all Python files compile without syntax errors or warnings."""

    def test_all_py_files_compile(self) -> None:
        result = subprocess.run(
            [sys.executable, "-W", "error", "-m", "py_compile", str(SRC / "ariaflow_web" / "webapp.py")],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"Compile failed:\n{result.stderr}"

    @pytest.mark.parametrize("module", ["client", "cli", "bonjour", "__init__"])
    def test_module_compiles(self, module: str) -> None:
        path = SRC / "ariaflow_web" / f"{module}.py"
        result = subprocess.run(
            [sys.executable, "-W", "error", "-m", "py_compile", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"{module}.py compile failed:\n{result.stderr}"
