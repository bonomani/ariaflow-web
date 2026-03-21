from __future__ import annotations

import argparse

from . import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ariaflow-web",
        description="Local dashboard frontend for ariaflow.",
    )
    parser.add_argument("--version", action="version", version=f"ariaflow-web {__version__}")
    return parser


def main() -> int:
    build_parser().parse_args()
    return 0
