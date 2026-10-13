/**
 * Setup.js — 初期設定（Apps Script エディタから手動で実行する関数）
 *   setup()           : メインアカウントで実行。シート作成・ラベル作成・トリガー登録
 *   setupCollector()  : 会社アカウント等で実行。取込だけ行い、メインのシートに書き込む
 *   checkStatus()     : 設定と動作状況をログに表示
 *   testGemini()      : Gemini API キーの動作確認
 *   uninstall()       : トリガーを全て削除（停止）
 */

function setup() {
  var p = props_();
  if (!p.getProperty('SPREADSHEET_ID')) {
    var ss = SpreadsheetApp.create('TaskHub データ');
    p.setProperty('SPREADSHEET_ID', ss.getId());
  }
  p.setProperty('ROLE', 'main');
  prepareSpreadsheet_();
  ensureLabels_();
  installTriggers_('main');
  checkStatus();
  console.log('完了。次に「デプロイ → 新しいデプロイ → ウェブアプリ」で画面を公開してください（アクセス: 自分のみ）。');
}

function setupCollector() {
  var p = props_();
  if (!p.getProperty('SPREADSHEET_ID')) {
    throw new Error('スクリプト プロパティ SPREADSHEET_ID に、メインアカウントのスプレッドシートIDを設定してから実行してください。');
  }
  p.setProperty('ROLE', 'collector');
  colMap_(sheet_(TH_SHEET_TASKS)); // 書き込み権限と見出しの確認
  ensureLabels_();
  installTriggers_('collector');
  checkStatus();
}

function prepareSpreadsheet_() {
  var ss = ss_();
  var headers = TH_FIELDS.map(function (f) { return f[1]; });
  [TH_SHEET_TASKS, TH_SHEET_ARCHIVE].forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0 || !sh.getRange(1, 1).getValue()) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eef7');
      sh.setFrozenRows(1);
    } else {
      // 既存シートに足りない見出しがあれば右端に追加
      var cur = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      headers.forEach(function (h) {
        if (cur.indexOf(h) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold'); cur.push(h); }
      });
    }
    // 日付等が自動変換されないよう、全体を書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    var map = colMap_(sh);
    var rows = sh.getMaxRows() - 1;
    sh.getRange(2, map.status + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(TH_STATUS, true).setAllowInvalid(false).build());
    sh.getRange(2, map.priority + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(TH_PRIORITY, true).setAllowInvalid(false).build());
    sh.setColumnWidth(map.title + 1, 320);
    sh.setColumnWidth(map.detail + 1, 260);
  });
  var log = ss.getSheetByName(TH_SHEET_LOG) || ss.insertSheet(TH_SHEET_LOG);
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, 4).setValues([['日時', '種別', '内容', 'アカウント']]).setFontWeight('bold');
    log.setFrozenRows(1);
    log.getRange(1, 1, log.getMaxRows(), 4).setNumberFormat('@');
  }
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
}

function ensureLabels_() {
  [TH_LABEL_IN, TH_LABEL_DONE].forEach(function (n) {
    if (!GmailApp.getUserLabelByName(n)) GmailApp.createLabel(n);
  });
}

var TH_HANDLERS = ['jobIngest', 'jobDailyDigest', 'jobArchive'];

function installTriggers_(role) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TH_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('jobIngest').timeBased().everyMinutes(15).create();
  if (role === 'main') {
    var hour = Math.min(23, Math.max(0, +cfg_().DIGEST_HOUR || 7));
    ScriptApp.newTrigger('jobDailyDigest').timeBased().atHour(hour).everyDays(1).inTimezone(TH_TZ).create();
    ScriptApp.newTrigger('jobArchive').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone(TH_TZ).create();
  }
}

function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('トリガーを全て削除しました（データとシートはそのまま残ります）。再開は setup() / setupCollector()。');
}

function checkStatus() {
  var c = cfg_();
  var lines = [
    'TaskHub ' + TH_VERSION,
    '役割: ' + c.ROLE + ' / アカウント: ' + c.ACCOUNT_NAME,
    'スプレッドシート: ' + (c.SPREADSHEET_ID ? 'https://docs.google.com/spreadsheets/d/' + c.SPREADSHEET_ID : '未設定'),
    'AI: ' + (aiEnabled_(c) ? 'Gemini (' + c.GEMINI_MODEL + ')' : 'ルールのみ' + (c.AI_MODE === 'gemini' ? '（GEMINI_API_KEY 未設定）' : '')),
    'Gmail 検索条件: ' + String(c.GMAIL_QUERY).replace(/\{PLUS\}/g, plusAddress_(c.ME, 'task')),
    'タスク取込用アドレス: ' + plusAddress_(c.ME, 'task'),
    'トリガー: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '),
    '前回取込: ' + (props_().getProperty('LAST_GMAIL_STAT') || 'まだ実行されていません')
  ];
  try { lines.push('画面URL: ' + (ScriptApp.getService().getUrl() || '未デプロイ')); } catch (e) { lines.push('画面URL: 未デプロイ'); }
  console.log(lines.join('\n'));
  return lines.join('\n');
}

function testGemini() {
  var r = geminiExtract_('メール', '件名: 見積のお願い\n差出人: 山田\n\nお世話になります。来週水曜までに見積書をお送りいただけますか。至急でお願いします。');
  console.log(r === null ? 'Gemini は使えません（AI_MODE / GEMINI_API_KEY / 上限 / ログ を確認）' : JSON.stringify(r, null, 2));
}
