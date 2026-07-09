"""CLI エントリポイント: python -m printdrop"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import __version__, ipp
from .app import PrintDropApp
from .config import ConfigError, load_config, write_template


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="printdrop",
        description=(
            "指定フォルダに置かれた PDF を検知し、IPP で指定プリンターへ"
            "印刷ジョブを送信するアプリ。既定ではジョブはプリンター側に"
            "保留 (保存) され、パネル操作で印刷を実行します。"
        ),
    )
    parser.add_argument(
        "-c",
        "--config",
        type=Path,
        default=Path("config.json"),
        help="設定ファイルのパス (既定: ./config.json)",
    )
    parser.add_argument(
        "--init",
        action="store_true",
        help="設定ファイルのひな形を作成して終了",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="プリンターへの接続確認のみ行って終了",
    )
    parser.add_argument(
        "--once",
        type=Path,
        metavar="PDF",
        help="指定した PDF を 1 件だけ送信して終了 (動作テスト用)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="詳細ログ")
    parser.add_argument(
        "--version", action="version", version=f"printdrop {__version__}"
    )
    args = parser.parse_args(argv)

    _setup_logging(args.verbose)
    log = logging.getLogger("printdrop")

    if args.init:
        try:
            write_template(args.config)
        except ConfigError as exc:
            log.error("%s", exc)
            return 1
        log.info(
            "設定ファイルを作成しました: %s\n"
            "printer_uri をお使いのプリンターに合わせて編集してください。",
            args.config,
        )
        return 0

    try:
        config = load_config(args.config)
    except ConfigError as exc:
        log.error("%s", exc)
        return 1

    app = PrintDropApp(config)

    if args.check:
        try:
            app.check_printer()
        except ipp.IppError as exc:
            log.error("接続確認に失敗しました: %s", exc)
            return 1
        return 0

    if args.once:
        pdf = args.once
        if not pdf.is_file():
            log.error("ファイルが見つかりません: %s", pdf)
            return 1
        try:
            job_id = app.submit_pdf(pdf)
        except ipp.IppError as exc:
            log.error("送信に失敗しました: %s", exc)
            return 1
        log.info("送信完了: %s -> ジョブ ID %s", pdf.name, job_id)
        return 0

    try:
        app.run_forever()
    except KeyboardInterrupt:
        log.info("停止しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
