/**
 * Store.js — スプレッドシートの読み書き
 * 列は1行目の見出し名で特定するので、列の並べ替え・列の追加をしても動く（見出し名は変えないこと）。
 */

var TH_SHEET_TASKS = 'タスク';
var TH_SHEET_ARCHIVE = 'アーカイブ';
var TH_SHEET_LOG = 'ログ';

var TH_FIELDS = [
  ['id', 'ID'], ['status', '状態'], ['title', 'タイトル'], ['detail', '詳細'], ['due', '期限'],
  ['priority', '優先度'], ['source', '出典'], ['sourceUrl', '出典リンク'], ['sourceKey', '出典キー'],
  ['requester', '依頼者'], ['contact', '連絡先'], ['tags', 'タグ'], ['account', 'アカウント'],
  ['createdAt', '作成日時'], ['updatedAt', '更新日時'], ['doneAt', '完了日時']
];

function ss_() {
  var id = props_().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID が未設定です。setup() を実行してください。');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。setup() を実行してください。');
  return sh;
}

/** 見出し → 列番号(0始まり) */
function colMap_(sh) {
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var map = {};
  TH_FIELDS.forEach(function (f) {
    var i = header.indexOf(f[1]);
    if (i < 0) throw new Error('シート「' + sh.getName() + '」に見出し「' + f[1] + '」がありません');
    map[f[0]] = i;
  });
  map._width = header.length;
  return map;
}

function rowToTask_(row, map) {
  var t = {};
  TH_FIELDS.forEach(function (f) {
    var v = row[map[f[0]]];
    if (Object.prototype.toString.call(v) === '[object Date]') {
      v = f[0] === 'due' ? normalizeDue_(v) : Utilities.formatDate(v, TH_TZ, 'yyyy-MM-dd HH:mm:ss');
    }
    t[f[0]] = v === null || v === undefined ? '' : String(v);
  });
  t.due = normalizeDue_(t.due);
  if (TH_STATUS.indexOf(t.status) < 0) t.status = '未着手'; // 手入力で不正な値が入った場合
  if (TH_PRIORITY.indexOf(t.priority) < 0) t.priority = '中';
  t.sourceUrl = safeUrl_(t.sourceUrl);
  return t;
}

function taskToRow_(t, map) {
  var row = new Array(map._width);
  for (var i = 0; i < row.length; i++) row[i] = '';
  TH_FIELDS.forEach(function (f) { row[map[f[0]]] = sanitizeCell_(t[f[0]]); });
  return row;
}

function listTasks_() {
  var sh = sheet_(TH_SHEET_TASKS);
  var map = colMap_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, map._width).getValues();
  var out = [];
  var noId = [];
  rows.forEach(function (r, i) {
    if (!r[map.id] && !r[map.title]) return; // 空行
    var t = rowToTask_(r, map);
    if (!t.id) { noId.push({ i: i, t: t }); return; }
    out.push(t);
  });
  // シートに手で追加された行（ID なし）には ID と作成日時を付ける
  if (noId.length) {
    withLock_(function () {
      var now = nowStr_();
      noId.forEach(function (x) {
        var rowNo = x.i + 2;
        if (sh.getRange(rowNo, map.id + 1).getValue()) return;
        x.t.id = newId_();
        sh.getRange(rowNo, map.id + 1).setValue(x.t.id);
        if (!x.t.createdAt) { x.t.createdAt = now; sh.getRange(rowNo, map.createdAt + 1).setValue(now); }
        if (!x.t.source) { x.t.source = '手入力'; sh.getRange(rowNo, map.source + 1).setValue('手入力'); }
        out.push(x.t);
      });
    });
  }
  return out;
}

/** 取込済み判定用：出典キー（#n を除いた部分）の集合 */
function existingSourceKeys_() {
  var sh = sheet_(TH_SHEET_TASKS);
  var map = colMap_(sh);
  var last = sh.getLastRow();
  var set = {};
  if (last < 2) return set;
  sh.getRange(2, map.sourceKey + 1, last - 1, 1).getValues().forEach(function (r) {
    var k = String(r[0] || '');
    if (k) set[k.split('#')[0]] = true;
  });
  return set;
}

function newId_() {
  return 'T' + Utilities.formatDate(new Date(), TH_TZ, 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 8);
}

/** 新規タスクを追加（appendRow は別スクリプトと同時に書いても行が重ならない） */
function appendTasks_(list) {
  if (!list.length) return [];
  var sh = sheet_(TH_SHEET_TASKS);
  var map = colMap_(sh);
  var now = nowStr_();
  var c = cfg_();
  var saved = [];
  list.forEach(function (t) {
    var rec = {
      id: newId_(), status: t.status || '未整理', title: t.title, detail: t.detail || '', due: t.due || '',
      priority: t.priority || '中', source: t.source || 'その他', sourceUrl: t.sourceUrl || '', sourceKey: t.sourceKey || '',
      requester: t.requester || '', contact: t.contact || '', tags: t.tags || '', account: t.account || c.ACCOUNT_NAME,
      createdAt: now, updatedAt: now, doneAt: t.status === '完了' ? now : ''
    };
    sh.appendRow(taskToRow_(rec, map));
    saved.push(rec);
  });
  return saved;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** ID で1件更新。状態の変化に合わせて完了日時を付け外しする */
function updateTask_(id, patch) {
  return withLock_(function () {
    var sh = sheet_(TH_SHEET_TASKS);
    var map = colMap_(sh);
    var last = sh.getLastRow();
    if (last < 2) throw new Error('タスクが見つかりません');
    var ids = sh.getRange(2, map.id + 1, last - 1, 1).getValues();
    var idx = -1;
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { idx = i; break; }
    if (idx < 0) throw new Error('タスクが見つかりません（シートで削除・移動された可能性があります）');
    var rowNo = idx + 2;
    var range = sh.getRange(rowNo, 1, 1, map._width);
    var cur = rowToTask_(range.getValues()[0], map);
    var next = {};
    Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    var now = nowStr_();
    if (patch.status && patch.status !== cur.status) {
      if (patch.status === '完了') next.doneAt = now;
      else if (cur.status === '完了') next.doneAt = '';
    }
    next.updatedAt = now;
    // 自分の列だけ書き戻す（利用者が追加した列は触らない）
    var row = range.getValues()[0];
    TH_FIELDS.forEach(function (f) { row[map[f[0]]] = sanitizeCell_(next[f[0]]); });
    range.setValues([row]);
    return next;
  });
}

function logEvent_(level, msg) {
  try {
    var sh = ss_().getSheetByName(TH_SHEET_LOG);
    if (!sh) return;
    sh.appendRow([nowStr_(), level, sanitizeCell_(clip_(msg, 2000)), cfg_().ACCOUNT_NAME]);
    var n = sh.getLastRow();
    if (n > 1200) sh.deleteRows(2, n - 1000);
  } catch (e) {
    console.error('logEvent_ failed: ' + e);
  }
  if (level === 'ERROR') console.error(msg); else console.log(msg);
}

function recentErrors_(hours) {
  var sh = ss_().getSheetByName(TH_SHEET_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  var since = Utilities.formatDate(new Date(Date.now() - hours * 3600000), TH_TZ, 'yyyy-MM-dd HH:mm:ss');
  var n = Math.min(sh.getLastRow() - 1, 300);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues().filter(function (r) {
    var ts = Object.prototype.toString.call(r[0]) === '[object Date]' ? Utilities.formatDate(r[0], TH_TZ, 'yyyy-MM-dd HH:mm:ss') : String(r[0]);
    return r[1] === 'ERROR' && ts >= since;
  }).map(function (r) { return { at: String(r[0]), msg: String(r[2]), account: String(r[3]) }; });
}
