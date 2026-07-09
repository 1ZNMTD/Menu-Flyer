"""アプリ本体: フォルダ監視 → IPP 送信 → 処理済みフォルダへ移動."""

from __future__ import annotations

import logging
import shutil
import time
from datetime import datetime
from pathlib import Path

from . import ipp
from .config import Config
from .watcher import FolderWatcher

log = logging.getLogger("printdrop")


def _unique_destination(folder: Path, name: str) -> Path:
    """移動先のファイル名。重複時はタイムスタンプを付けて回避する."""
    dest = folder / name
    if not dest.exists():
        return dest
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    stem, suffix = Path(name).stem, Path(name).suffix
    dest = folder / f"{stem}_{stamp}{suffix}"
    counter = 1
    while dest.exists():
        dest = folder / f"{stem}_{stamp}-{counter}{suffix}"
        counter += 1
    return dest


class PrintDropApp:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.watcher = FolderWatcher(
            config.watch_folder, stability_seconds=config.stability_seconds
        )

    def ensure_folders(self) -> None:
        for folder in (
            self.config.watch_folder,
            self.config.sent_folder,
            self.config.error_folder,
        ):
            folder.mkdir(parents=True, exist_ok=True)

    def check_printer(self) -> None:
        """起動時の接続確認。プリンター名と状態をログに出す."""
        resp = ipp.get_printer_attributes(
            self.config.printer_uri,
            timeout=self.config.timeout_seconds,
            tls_verify=self.config.tls_verify,
        )
        name = resp.first(ipp.TAG_PRINTER_ATTRS, "printer-name")
        make = resp.first(ipp.TAG_PRINTER_ATTRS, "printer-make-and-model")
        state = resp.first(ipp.TAG_PRINTER_ATTRS, "printer-state")
        state_names = {3: "idle (待機中)", 4: "processing (印刷中)", 5: "stopped (停止)"}
        log.info(
            "プリンターに接続できました: %s / %s / 状態: %s",
            name or "(名称不明)",
            make or "(機種不明)",
            state_names.get(state, str(state)),
        )

    def submit_pdf(self, path: Path) -> int | None:
        """PDF 1 件を送信し job-id を返す。失敗時は例外を送出."""
        pdf_data = path.read_bytes()
        resp = ipp.print_pdf(
            self.config.printer_uri,
            pdf_data,
            job_name=path.name,
            requesting_user_name=self.config.requesting_user_name,
            job_attributes=self.config.job_attributes,
            timeout=self.config.timeout_seconds,
            tls_verify=self.config.tls_verify,
        )
        return resp.job_id

    def process_file(self, path: Path) -> None:
        """リトライ付きで送信し、結果に応じて sent/error へ移動する."""
        last_error: Exception | None = None
        for attempt in range(1, self.config.max_retries + 1):
            try:
                job_id = self.submit_pdf(path)
                dest = _unique_destination(self.config.sent_folder, path.name)
                shutil.move(str(path), str(dest))
                log.info(
                    "送信完了: %s -> ジョブ ID %s (プリンター側に保留中) / 移動先: %s",
                    path.name,
                    job_id if job_id is not None else "(不明)",
                    dest,
                )
                return
            except (ipp.IppError, OSError) as exc:
                last_error = exc
                log.warning(
                    "送信失敗 (%d/%d 回目): %s - %s",
                    attempt,
                    self.config.max_retries,
                    path.name,
                    exc,
                )
                if attempt < self.config.max_retries:
                    time.sleep(self.config.retry_wait_seconds)

        dest = _unique_destination(self.config.error_folder, path.name)
        try:
            shutil.move(str(path), str(dest))
            log.error(
                "リトライ上限に達したため error フォルダへ移動しました: %s (%s)",
                dest,
                last_error,
            )
        except OSError as exc:
            log.error("error フォルダへの移動にも失敗しました: %s (%s)", path, exc)

    def run_forever(self) -> None:
        self.ensure_folders()
        try:
            self.check_printer()
        except ipp.IppError as exc:
            log.warning("起動時の接続確認に失敗しました (監視は続行します): %s", exc)

        log.info("フォルダ監視を開始します: %s", self.config.watch_folder)
        log.info("送信先プリンター: %s", self.config.printer_uri)
        if self.config.job_attributes.get("job-hold-until"):
            log.info(
                "ジョブはプリンター側に保留されます (job-hold-until=%s)。"
                "プリンターのパネルから印刷を実行してください。",
                self.config.job_attributes["job-hold-until"],
            )
        while True:
            for path in self.watcher.poll():
                log.info("PDF を検出しました: %s", path.name)
                self.process_file(path)
            time.sleep(self.config.poll_interval_seconds)
