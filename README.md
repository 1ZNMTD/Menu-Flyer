# printdrop — フォルダ監視型 PDF 印刷ジョブ送信アプリ

指定フォルダに PDF を置く(投げ込む)だけで、指定のプリンター(印刷機)へ印刷ジョブを送信するアプリです。ジョブは **プリンター側に保留(保存)** され、プリンターの操作パネルから印刷を実行できます。

```
[監視フォルダに PDF を置く]
        │  自動検知(書き込み完了を待ってから処理)
        ▼
[IPP で印刷ジョブを送信]  ← job-hold-until=indefinite を付与
        │
        ▼
[プリンター側にジョブが保留(保存)される]
        │  操作パネルの「保留ジョブ / 蓄積文書」から選んで印刷
        ▼
[送信済み PDF は sent/ フォルダへ自動移動]
```

## 特長

- **外部ライブラリ不要** — Python 3.9 以降の標準ライブラリのみで動作(Windows / macOS / Linux)
- **IPP (Internet Printing Protocol) 直接送信** — プリンタードライバー不要。ネットワークプリンターの大半(RICOH・Canon・EPSON・京セラ・富士フイルムBI・brother 等の複合機/レーザープリンター)が対応
- **ジョブをプリンターに保存** — 標準属性 `job-hold-until=indefinite` により、送信したジョブはすぐには印刷されず、プリンター側に保留されます
- **安全なファイル検知** — コピー途中のファイルを掴まないよう、サイズが安定してから送信
- **自動整理** — 送信成功で `sent/`、リトライしても失敗したら `error/` へ移動

## セットアップ

### 1. 設定ファイルを作成

```bash
python -m printdrop --init
```

カレントディレクトリに `config.json` のひな形ができます。

### 2. プリンターの URI を設定

`config.json` の `printer_uri` を自分のプリンターに合わせて編集します。

```json
{
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
  "tls_verify": false,
  "job_attributes": {
    "job-hold-until": "indefinite",
    "copies": 1
  }
}
```

**プリンター URI の調べ方**

| 方法 | 手順 |
|---|---|
| プリンターの IP アドレスから | 多くの機種は `ipp://<IPアドレス>:631/ipp/print` で受け付けます。機種により `/printer`(RICOH 等)や `/ipp` の場合もあります |
| プリンターの設定画面 | 本体パネルまたは Web 管理画面(ブラウザで `http://<IPアドレス>`)のネットワーク設定に IPP の URL が表示されます |
| macOS / Linux | `ippfind`(CUPS 付属)でネットワーク上の IPP プリンターを検索できます |

### 3. 接続確認

```bash
python -m printdrop --check
```

プリンター名・機種・状態が表示されれば接続 OK です。

### 4. テスト送信(任意)

```bash
python -m printdrop --once test.pdf
```

PDF を 1 件だけ送信します。プリンターのパネルに保留ジョブが現れるか確認してください。

### 5. 監視を開始

```bash
python -m printdrop
```

以後、`inbox/`(`watch_folder`)に PDF を置くと自動で送信されます。`Ctrl+C` で停止します。

## ジョブの「保存(保留)」について

`job_attributes` の `"job-hold-until": "indefinite"` により、ジョブは印刷されずにプリンター内に保留されます。印刷するには、プリンターの操作パネルからジョブを選択して実行(リリース)します。メーカーによって機能の呼び方が異なります。

| メーカー | パネルでの呼称(例) |
|---|---|
| RICOH | 保留文書 / 蓄積文書(プリンター機能内) |
| Canon | ホールド / 留め置き印刷 |
| 富士フイルムBI (旧富士ゼロックス) | セキュリティープリント / サンプルプリント / 保存プリント |
| 京セラ | ジョブボックス(保留) |
| EPSON / brother | 保留ジョブ |

送信者名はパネル上で `requesting_user_name` の値として表示されます。

**すぐに印刷したい場合**(保存せずそのまま印刷): `job_attributes` から `"job-hold-until"` の行を削除してください。

**注意**: 保留ジョブの保持期間・件数の上限は機種の設定に依存します。また一部の機種は `job-hold-until` に未対応で、その場合は即時印刷されるか、エラーが返ります(`--once` でのテストを推奨)。機種固有の「文書ボックスへの保存」や PIN 付き印刷が必要な場合は、`job_attributes` にその機種がサポートする IPP 属性を追加できます(整数はそのまま数値で、キーワードは文字列で記述)。

## 設定リファレンス

| キー | 説明 | 既定値 |
|---|---|---|
| `watch_folder` | 監視するフォルダ(PDF の投入先)。設定ファイルからの相対パス可 | `./inbox` |
| `sent_folder` | 送信成功した PDF の移動先 | `./sent` |
| `error_folder` | 送信失敗した PDF の移動先 | `./error` |
| `printer_uri` | プリンターの IPP URI(`ipp://` `ipps://` `http://` `https://`) | (必須) |
| `requesting_user_name` | プリンターに表示される送信者名 | `menu-flyer` |
| `poll_interval_seconds` | フォルダを確認する間隔(秒) | `2.0` |
| `stability_seconds` | ファイルのサイズ変化が止まってから送信するまでの待ち時間(秒) | `3.0` |
| `max_retries` | 送信失敗時のリトライ回数 | `3` |
| `retry_wait_seconds` | リトライ間隔(秒) | `5.0` |
| `timeout_seconds` | 通信タイムアウト(秒) | `60.0` |
| `tls_verify` | `ipps://` 使用時に証明書を検証するか(プリンターは自己署名証明書が多いため既定は無効) | `false` |
| `job_attributes` | ジョブに付与する IPP 属性。`copies`(部数)、`sides`(`two-sided-long-edge` で両面)、`print-color-mode`(`monochrome` / `color`)、`media`(`iso_a4_210x297mm`)なども指定可能 | `job-hold-until` + `copies` |

## 常駐(自動起動)させるには

### Windows(タスクスケジューラ)

1. タスクスケジューラで「基本タスクの作成」
2. トリガー:「ログオン時」または「スタートアップ時」
3. 操作:プログラム `pythonw.exe`、引数 `-m printdrop -c C:\path\to\config.json`、開始場所はアプリのフォルダ

### Linux(systemd)

`/etc/systemd/system/printdrop.service`:

```ini
[Unit]
Description=printdrop PDF print spooler
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 -m printdrop -c /opt/printdrop/config.json
WorkingDirectory=/opt/printdrop
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now printdrop
```

### macOS

`launchd` の LaunchAgent、またはログイン項目にシェルスクリプトを登録してください。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `--check` で接続失敗 | IP アドレス・ポート(通常 631)・パスを確認。プリンターの Web 管理画面で IPP が有効か確認 |
| `client-error-document-format-not-supported` | 機種が PDF ダイレクト印刷に未対応。その場合は PC のプリンタードライバー経由の運用をご検討ください |
| ジョブが保留されず即印刷される | 機種が `job-hold-until` 未対応。`--check` は成功するのに保留されない場合、機種固有の蓄積印刷用 IPP 属性が必要なことがあります |
| ジョブがパネルに見つからない | 「プリンター」→「保留ジョブ / 蓄積文書」等のメニューを確認。`requesting_user_name` の名前で探してください |
| 送信したのに何も起きない | `error/` フォルダとログ出力を確認。`-v` オプションで詳細ログが出ます |

## 開発

```bash
python -m unittest discover -s tests   # テスト実行(12 件)
```

構成:

- `printdrop/ipp.py` — 純 Python の最小 IPP クライアント(RFC 8010/8011)
- `printdrop/watcher.py` — 書き込み完了を待つフォルダ監視
- `printdrop/config.py` — 設定の読み込み・検証
- `printdrop/app.py` — 監視 → 送信 → 移動の本体ループ
- `printdrop/__main__.py` — CLI(`--init` / `--check` / `--once`)
