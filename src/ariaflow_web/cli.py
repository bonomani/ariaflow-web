from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ariaflow-web",
        description="Local dashboard frontend for ariaflow.",
    )
    parser.add_argument("--version", action="version", version="ariaflow-web 0.1.0")
    return parser


def main() -> int:
    build_parser().parse_args()
    return 0
