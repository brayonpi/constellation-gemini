"""One-command, network-free verification entry point for replay bundles."""

from __future__ import annotations

import sys
from pathlib import Path

from .cli import verify_file


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m constellation.verify_bundle <mission-replay.zip>")
        return 2
    return verify_file(Path(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
