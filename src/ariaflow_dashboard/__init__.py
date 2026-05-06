__all__ = ["__version__", "__install_mode__"]

__version__ = "0.1.550"


def _detect_install_mode() -> str:
    """Return 'git' if running from a git checkout, 'release' otherwise."""
    from pathlib import Path

    repo_root = Path(__file__).resolve().parent.parent.parent
    if (repo_root / ".git").exists():
        return "git"
    return "release"


__install_mode__ = _detect_install_mode()
