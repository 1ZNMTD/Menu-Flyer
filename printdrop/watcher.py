"""フォルダ監視: 書き込みが完了して安定した PDF だけを検出する.

標準ライブラリのみで動くようポーリング方式を採用。
コピー中のファイルを掴まないよう、サイズ・更新時刻が
stability_seconds の間変化しないことを確認してから通知する。
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterator, List, Set


@dataclass
class _Observation:
    size: int
    mtime: float
    stable_since: float


class FolderWatcher:
    def __init__(self, folder: Path, stability_seconds: float = 3.0) -> None:
        self.folder = folder
        self.stability_seconds = stability_seconds
        self._observations: Dict[Path, _Observation] = {}
        self._reported: Set[Path] = set()

    def poll(self, now: float | None = None) -> List[Path]:
        """1 回スキャンし、新たに「安定した」PDF の一覧を返す."""
        now = time.monotonic() if now is None else now
        ready: List[Path] = []
        seen: Set[Path] = set()

        for path in self._scan_pdfs():
            seen.add(path)
            try:
                stat = path.stat()
            except OSError:
                continue  # スキャン直後に消えた場合など

            obs = self._observations.get(path)
            if obs is None or obs.size != stat.st_size or obs.mtime != stat.st_mtime:
                self._observations[path] = _Observation(
                    size=stat.st_size, mtime=stat.st_mtime, stable_since=now
                )
                self._reported.discard(path)
                continue

            if (
                path not in self._reported
                and now - obs.stable_since >= self.stability_seconds
                and stat.st_size > 0
            ):
                self._reported.add(path)
                ready.append(path)

        # 消えたファイルの記録を掃除
        for path in list(self._observations):
            if path not in seen:
                del self._observations[path]
                self._reported.discard(path)

        return sorted(ready)

    def _scan_pdfs(self) -> Iterator[Path]:
        try:
            entries = list(self.folder.iterdir())
        except OSError:
            return iter(())
        return (
            p
            for p in entries
            if p.is_file()
            and p.suffix.lower() == ".pdf"
            and not p.name.startswith((".", "~"))
        )
