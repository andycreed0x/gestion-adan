from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
    from gestion_desktop.app import main as run_app

    run_app()


if __name__ == "__main__":
    main()
