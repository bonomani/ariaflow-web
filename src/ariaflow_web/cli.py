from __future__ import annotations

import argparse

from aria_queue.webapp import serve
from . import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ariaflow-web",
        description="Local dashboard frontend for ariaflow.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--version", action="version", version=f"ariaflow-web {__version__}")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    server = serve(host=args.host, port=args.port)
    print(f"Serving on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
    return 0
