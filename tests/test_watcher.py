"""フォルダ監視 (安定検出) のテスト."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from printdrop.watcher import FolderWatcher


class WatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self._tmp.name)
        self.watcher = FolderWatcher(self.folder, stability_seconds=1.0)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_stable_pdf_is_reported_once(self) -> None:
        pdf = self.folder / "menu.pdf"
        pdf.write_bytes(b"%PDF-1.4 data")

        self.assertEqual(self.watcher.poll(now=0.0), [])  # 初回観測
        self.assertEqual(self.watcher.poll(now=0.5), [])  # まだ安定時間未満
        self.assertEqual(self.watcher.poll(now=1.5), [pdf])  # 安定 → 通知
        self.assertEqual(self.watcher.poll(now=2.0), [])  # 二重通知しない

    def test_growing_file_is_not_reported(self) -> None:
        pdf = self.folder / "big.pdf"
        pdf.write_bytes(b"part1")
        self.assertEqual(self.watcher.poll(now=0.0), [])
        pdf.write_bytes(b"part1part2")  # コピー継続中を模擬
        self.assertEqual(self.watcher.poll(now=1.5), [])  # サイズ変化 → リセット
        self.assertEqual(self.watcher.poll(now=2.0), [])
        self.assertEqual(self.watcher.poll(now=3.0), [pdf])  # 変化が止まって通知

    def test_non_pdf_and_hidden_files_ignored(self) -> None:
        (self.folder / "note.txt").write_bytes(b"x")
        (self.folder / ".hidden.pdf").write_bytes(b"x")
        (self.folder / "~temp.pdf").write_bytes(b"x")
        self.assertEqual(self.watcher.poll(now=0.0), [])
        self.assertEqual(self.watcher.poll(now=5.0), [])

    def test_empty_pdf_not_reported(self) -> None:
        (self.folder / "empty.pdf").write_bytes(b"")
        self.assertEqual(self.watcher.poll(now=0.0), [])
        self.assertEqual(self.watcher.poll(now=5.0), [])

    def test_removed_file_forgotten(self) -> None:
        pdf = self.folder / "gone.pdf"
        pdf.write_bytes(b"%PDF")
        self.watcher.poll(now=0.0)
        pdf.unlink()
        self.assertEqual(self.watcher.poll(now=2.0), [])
        # 同名ファイルが再び置かれたら改めて検出できる
        pdf.write_bytes(b"%PDF new")
        self.assertEqual(self.watcher.poll(now=3.0), [])
        self.assertEqual(self.watcher.poll(now=4.5), [pdf])


if __name__ == "__main__":
    unittest.main()
