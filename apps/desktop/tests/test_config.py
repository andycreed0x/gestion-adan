from pathlib import Path

import pytest

from gestion_desktop.config import ConfigurationError, load_settings


def write_environment(root: Path, contents: str) -> None:
    (root / ".env").write_text(contents, encoding="utf-8")


def test_load_settings_prefers_desktop_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    write_environment(
        tmp_path,
        "SUPABASE_URL=https://desktop.example.supabase.co\n"
        "NEXT_PUBLIC_SUPABASE_URL=https://web.example.supabase.co\n"
        "SUPABASE_SECRET_KEY=test-key\n",
    )

    settings = load_settings(tmp_path)

    assert settings.url == "https://desktop.example.supabase.co"
    assert settings.secret_key == "test-key"


def test_load_settings_falls_back_to_existing_web_url(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    write_environment(
        tmp_path,
        "NEXT_PUBLIC_SUPABASE_URL=https://web.example.supabase.co\n"
        "SUPABASE_SECRET_KEY=test-key\n",
    )

    assert load_settings(tmp_path).url == "https://web.example.supabase.co"


def test_load_settings_reports_missing_names_without_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    write_environment(tmp_path, "SUPABASE_URL=https://desktop.example.supabase.co\n")

    with pytest.raises(ConfigurationError) as raised:
        load_settings(tmp_path)

    assert "SUPABASE_SECRET_KEY" in str(raised.value)
    assert "test-key" not in str(raised.value)
