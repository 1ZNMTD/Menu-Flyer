# TaskHub — 取りこぼさない個人タスク管理

Gmail（個人・会社）、NIコラボの通知、Claude / ChatGPT の会話、メモ、電話依頼を **1か所に集めて** 管理する、自分専用のタスク管理アプリです。
Google Apps Script + Google スプレッドシートで動くので、**サーバー代は0円** です。

```
 Gmail（個人）─┐                                 ┌─ 画面（PC・スマホ）
 Gmail（会社）─┤  15分ごと自動取込                │   未整理 / 今日 / 予定 / 待ち / 完了
 NIコラボ通知 ─┤  ─────────────▶  [未整理] ─仕分け─▶ [タスク] ─▶ 毎朝のまとめメール
 他のメール  ─┘  （Gemini or ルールで抽出）      │
 Claude/ChatGPT/メモ ── 貼り付け or 自分+task@ へ送信 ┘
 電話依頼・思いつき ── 画面から手入力（電話メモ専用フォームあり）
```

## できること（v1.0）

| 機能 | 内容 |
|---|---|
| Gmail 自動取込 | ラベル `taskhub-in` が付いたメール、または `自分+task@gmail.com` 宛のメールを15分ごとに取込。期限（「明日まで」「来週金曜」「10/20」等）・優先度（至急 等）・依頼者を自動抽出 |
| AI 抽出（任意） | Gemini API（無料枠）でメール本文からタスクを抽出。上限超過・エラー時は自動でルール抽出に切替 |
| 未整理（受信箱） | 自動取込したものはいったん「未整理」へ。**採用 / 編集して採用 / 待ち / 却下** を選ぶ（誤登録と見落としを防ぐ） |
| 手入力 | 1行クイック追加（`見積作成 @金曜 !高 #案件A`）、詳細入力、**電話メモ**（相手・連絡先・用件・折返し要否） |
| AI・メモ取込 | Claude / ChatGPT の出力やメモを貼り付け → 候補を確認して一括登録。AI に頼む定型文つき |
| 複数アカウント | 会社の Google Workspace 側に「取込専用（collector）」を置き、同じシートへ集約 |
| まとめメール | 毎朝7時に「期限切れ・今日・3日以内・未整理」を自分にメール |
| 自動整理 | 完了・却下から30日たったものを「アーカイブ」シートへ移動 |
| シートで直接編集 | データは普通のスプレッドシート。手作業での修正・一括編集も可能 |

## はじめかた

1. **[docs/SETUP.md](docs/SETUP.md)** の手順でセットアップ（約15〜20分。コピー＆貼り付けのみ）
2. **[docs/USAGE.md](docs/USAGE.md)** で毎日の使い方を確認
3. **[docs/SECURITY.md](docs/SECURITY.md)** で注意点（情報の扱い・無料AIの学習利用など）を確認

## フォルダ構成

```
src/            ソース（Apps Script）
  Config.js     設定（スクリプト プロパティ）
  Util.js       共通処理・入力チェック・数式インジェクション対策
  Extract.js    ルールベース抽出（日本語の期限・優先度・箇条書き）
  Store.js      スプレッドシート読み書き
  Gemini.js     Gemini API 連携
  Gmail.js      Gmail 取込
  Api.js        画面（Web アプリ）用の関数
  Jobs.js       定期実行（取込・まとめメール・アーカイブ）
  Setup.js      初期設定用の関数
  Index.html    画面
dist/           Apps Script に貼り付ける完成品（Code.gs / Index.html / appsscript.json）
tests/          自動テスト（Node.js）
docs/           手順書
```

## 開発者向け

```bash
npm test          # テスト（Node.js 20 以上）
npm run build     # src/ → dist/ を生成
npm run check     # dist/ が最新か確認（CI でも実行）
```

clasp を使う場合は `.clasp.json.example` を `.clasp.json` にコピーして scriptId を設定し、`npm run push`。
