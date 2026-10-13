/**
 * Config.js — 設定（スクリプト プロパティ）
 * 値の変更は Apps Script エディタ「プロジェクトの設定 → スクリプト プロパティ」で行う。
 * APIキー等の秘密情報はコードやシートに書かず、必ずスクリプト プロパティに置くこと。
 */

var TH_VERSION = '1.0.0';

var TH_DEFAULTS = {
  ROLE: 'main',                 // main = 画面・まとめメール・取込 / collector = 取込のみ（会社アカウント等）
  ACCOUNT_NAME: '',             // シートに記録するアカウント名（空ならメールアドレス）
  AI_MODE: 'gemini',            // gemini = Gemini で抽出（失敗時ルール）/ rules = ルールのみ（外部送信なし）
  GEMINI_MODEL: 'gemini-flash-latest',
  GEMINI_DAILY_LIMIT: '80',     // 1日の Gemini 呼び出し上限（無料枠超過を防ぐ）
  GEMINI_PER_RUN_LIMIT: '5',    // 1回の取込で Gemini を使う最大件数（超えた分はルールで処理）
  GMAIL_QUERY: '(label:taskhub-in OR to:{PLUS}) -in:spam -in:trash',
  INITIAL_LOOKBACK_DAYS: '3',
  MAX_MESSAGES_PER_RUN: '30',
  DIGEST_HOUR: '7',
  DIGEST_TO: '',                // 空なら自分宛
  DIGEST_SKIP_EMPTY: 'true',
  ARCHIVE_AFTER_DAYS: '30',
  ALLOWED_EMAILS: '',           // 画面を使えるアカウント（空なら自分のみ）
  NICOLLABO_FROM: ''            // NIコラボ通知の送信元アドレス（カンマ区切り。空なら本文の「NI Collabo」表記で判定）
};

var TH_LABEL_IN = 'taskhub-in';
var TH_LABEL_DONE = 'taskhub-done';
var TH_TZ = 'Asia/Tokyo';

function props_() {
  return PropertiesService.getScriptProperties();
}

function cfg_() {
  var p = props_().getProperties();
  var c = {};
  Object.keys(TH_DEFAULTS).forEach(function (k) {
    c[k] = p[k] !== undefined && p[k] !== '' ? p[k] : TH_DEFAULTS[k];
  });
  c.SPREADSHEET_ID = p.SPREADSHEET_ID || '';
  c.GEMINI_API_KEY = p.GEMINI_API_KEY || '';
  c.ME = Session.getEffectiveUser().getEmail();
  if (!c.ACCOUNT_NAME) c.ACCOUNT_NAME = c.ME;
  if (!c.DIGEST_TO) c.DIGEST_TO = c.ME;
  return c;
}

function aiEnabled_(c) {
  return c.AI_MODE === 'gemini' && !!c.GEMINI_API_KEY;
}

/** Asia/Tokyo の今日 {y,m,d} */
function todayYmd_() {
  var s = Utilities.formatDate(new Date(), TH_TZ, 'yyyy-MM-dd');
  return strToYmd_(s);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), TH_TZ, 'yyyy-MM-dd HH:mm:ss');
}
