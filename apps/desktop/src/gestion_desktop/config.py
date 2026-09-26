from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


class ConfigurationError(RuntimeError):
    """Raised when the desktop client cannot load its required settings."""


@dataclass(frozen=True, slots=True)
class Settings:
    url: str
    secret_key: str


def load_settings(project_root: Path) -> Settings:
    """Load local Supabase settings without exposing their values."""
    load_dotenv(project_root / ".env", override=False)

    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    secret_key = os.getenv("SUPABASE_SECRET_KEY")

    missing: list[str] = []
    if not url:
        missing.append("SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL)")
    if not secret_key:
        missing.append("SUPABASE_SECRET_KEY")
    if missing:
        raise ConfigurationError(
            "Faltan variables requeridas para la aplicación de escritorio: "
            + ", ".join(missing)
        )

    return Settings(url=url, secret_key=secret_key)
