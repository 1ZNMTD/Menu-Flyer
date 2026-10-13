/**
 * Util.js — GAS 非依存の純粋関数（Node のテストからも読み込む）
 */

var TH_STATUS = ['未整理', '未着手', '進行中', '待ち', '完了', '却下'];
var TH_PRIORITY = ['高', '中', '低'];
var TH_SOURCE = ['手入力', '電話', 'Gmail', 'NIコラボ', 'Claude', 'ChatGPT', 'AI(その他)', 'メモ', 'その他'];
var TH_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** スプレッドシートの数式インジェクション対策。= + - @ で始まる文字列は先頭に ' を付けて文字列として保存する */
function sanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  // 制御文字（改行・タブ以外）を除去
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function clip_(s, max) {
  s = s === null || s === undefined ? '' : String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** {y,m,d} → 'yyyy-MM-dd' */
function ymdToStr_(o) {
  return o.y + '-' + pad2_(o.m) + '-' + pad2_(o.d);
}

/** 'yyyy-MM-dd' → {y,m,d}（不正なら null） */
function strToYmd_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  var o = { y: +m[1], m: +m[2], d: +m[3] };
  return isValidYmd_(o.y, o.m, o.d) ? o : null;
}

function isValidYmd_(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** {y,m,d} に n 日加算 */
function addDays_(o, n) {
  var t = new Date(Date.UTC(o.y, o.m - 1, o.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 曜日 0=日 ... 6=土 */
function dow_(o) {
  return new Date(Date.UTC(o.y, o.m - 1, o.d)).getUTCDay();
}

function diffDays_(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

function lastDayOfMonth_(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 期限文字列の正規化。'yyyy-MM-dd' / 'yyyy/M/d' を受け付け、それ以外は '' */
function normalizeDue_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    // Sheets が Date 型に変換してしまった場合（GAS 側で TZ 変換済みの値を渡す想定）
    return v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  }
  var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(String(v).trim());
  if (!m) return '';
  return isValidYmd_(+m[1], +m[2], +m[3]) ? m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]) : '';
}

/** URL は https のみ許可（javascript: 等を排除） */
function safeUrl_(u) {
  u = String(u || '').trim();
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '';
}

function validateTaskInput_(input, partial) {
  var out = {};
  var err = [];
  function has(k) {
    return input && Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  }
  if (!partial || has('title')) {
    var t = String((input && input.title) || '').replace(/\s+/g, ' ').trim();
    if (!t) err.push('タイトルは必須です');
    out.title = clip_(t, 200);
  }
  if (has('detail')) out.detail = clip_(String(input.detail || ''), 5000);
  if (has('due')) {
    var d = String(input.due || '').trim();
    var nd = normalizeDue_(d);
    if (d && !nd) err.push('期限の形式が不正です（yyyy-MM-dd）');
    out.due = nd;
  }
  if (has('priority')) {
    if (TH_PRIORITY.indexOf(input.priority) < 0) err.push('優先度が不正です');
    out.priority = input.priority;
  }
  if (has('status')) {
    if (TH_STATUS.indexOf(input.status) < 0) err.push('状態が不正です');
    out.status = input.status;
  }
  if (has('source')) {
    out.source = TH_SOURCE.indexOf(input.source) >= 0 ? input.source : 'その他';
  }
  ['requester', 'contact', 'tags'].forEach(function (k) {
    if (has(k)) out[k] = clip_(String(input[k] || '').trim(), 200);
  });
  if (has('sourceUrl')) out.sourceUrl = safeUrl_(input.sourceUrl);
  if (err.length) throw new Error(err.join(' / '));
  return out;
}
