"""設定ファイル (config.json) の読み込みと検証."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict

DEFAULT_CONFIG = {
    "watch_folder": "./inbox",
    "sent_folder": "./sent",
    "error_folder": "./error",
    "printer_uri": "ipp://192.168.1.50:631/ipp/print",
    "requesting_user_name": "menu-flyer",
    "poll_interval_seconds": 2.0,
    "stability_seconds": 3.0,
    "max_retries": 3,
    "retry_wait_seconds": 5.0,
    "timeout_seconds": 60.0,
    "tls_verify": False,
    "job_attributes": {
        "job-hold-until": "indefinite",
        "copies": 1,
    },
}


class ConfigError(Exception):
    """設定ファイルの不備."""


@dataclass
class Config:
    watch_folder: Path
    sent_folder: Path
    error_folder: Path
    printer_uri: str
    requesting_user_name: str = "printdrop"
    poll_interval_seconds: float = 2.0
    stability_seconds: float = 3.0
    max_retries: int = 3
    retry_wait_seconds: float = 5.0
    timeout_seconds: float = 60.0
    tls_verify: bool = False
    job_attributes: Dict[str, Any] = field(default_factory=dict)


def load_config(path: Path) -> Config:
    """config.json を読み込み、パスを設定ファイル基準の絶対パスに解決する."""
    if not path.is_file():
        raise ConfigError(
            f"設定ファイルが見つかりません: {path}\n"
            f"`python -m printdrop --init` でひな形を作成できます。"
        )
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"設定ファイルの JSON が不正です: {exc}") from exc

    merged = {**DEFAULT_CONFIG, **raw}

    printer_uri = str(merged["printer_uri"]).strip()
    is_placeholder = "printer_uri" not in raw  # ひな形の例のまま未設定
    if not printer_uri or is_placeholder:
        raise ConfigError("printer_uri にお使いのプリンターの URI を設定してください。")

    base = path.resolve().parent

    def resolve(key: str) -> Path:
        return (base / Path(str(merged[key])).expanduser()).resolve()

    job_attributes = merged.get("job_attributes") or {}
    if not isinstance(job_attributes, dict):
        raise ConfigError("job_attributes はオブジェクト (辞書) で指定してください。")

    return Config(
        watch_folder=resolve("watch_folder"),
        sent_folder=resolve("sent_folder"),
        error_folder=resolve("error_folder"),
        printer_uri=printer_uri,
        requesting_user_name=str(merged["requesting_user_name"]),
        poll_interval_seconds=float(merged["poll_interval_seconds"]),
        stability_seconds=float(merged["stability_seconds"]),
        max_retries=int(merged["max_retries"]),
        retry_wait_seconds=float(merged["retry_wait_seconds"]),
        timeout_seconds=float(merged["timeout_seconds"]),
        tls_verify=bool(merged["tls_verify"]),
        job_attributes=job_attributes,
    )


def write_template(path: Path) -> None:
    """設定ファイルのひな形を書き出す (既存ファイルは上書きしない)."""
    if path.exists():
        raise ConfigError(f"既にファイルが存在します: {path}")
    path.write_text(
        json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
