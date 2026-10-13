/**
 * Jobs.js — 定期実行（トリガー）から呼ばれる処理
 *   jobIngest       15分ごと : Gmail 取込
 *   jobDailyDigest  毎朝     : 今日のタスクまとめメール
 *   jobArchive      毎週     : 完了・却下から一定日数たったものをアーカイブへ移動
 */

function jobIngest() {
  try {
    runIngestOnce_();
  } catch (e) {
    logEvent_('ERROR', 'Gmail 取込に失敗: ' + (e && e.stack ? e.stack : e));
    throw e; // Google からの失敗通知メールも届くようにする
  }
}

/** 取込の二重起動防止（定期実行と「今すぐ取込」が重なった場合） */
function runIngestOnce_() {
  var p = props_();
  var until = +(p.getProperty('INGEST_RUNNING_UNTIL') || 0);
  if (until > Date.now()) return { busy: true };
  p.setProperty('INGEST_RUNNING_UNTIL', String(Date.now() + 6 * 60000));
  try {
    return ingestGmail_();
  } finally {
    p.deleteProperty('INGEST_RUNNING_UNTIL');
  }
}

function jobDailyDigest() {
  var c = cfg_();
  if (c.ROLE === 'collector') return;
  try {
    var today = ymdToStr_(todayYmd_());
    var soon = ymdToStr_(addDays_(todayYmd_(), 3));
    var tasks = listTasks_();
    var active = tasks.filter(function (t) { return t.status === '未着手' || t.status === '進行中' || t.status === '待ち'; });
    var overdue = active.filter(function (t) { return t.due && t.due < today; });
    var dueToday = active.filter(function (t) { return t.due === today; });
    var upcoming = active.filter(function (t) { return t.due > today && t.due <= soon; });
    var inbox = tasks.filter(function (t) { return t.status === '未整理'; });
    var errors = recentErrors_(24);
    if (c.DIGEST_SKIP_EMPTY === 'true' && !overdue.length && !dueToday.length && !upcoming.length && !inbox.length && !errors.length) return;

    var url = '';
    try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
    var sections = [
      ['期限切れ', overdue], ['今日が期限', dueToday], ['3日以内', upcoming], ['未整理（要仕分け）', inbox.slice(0, 20)]
    ];
    var html = ['<div style="font-family:sans-serif;font-size:14px;line-height:1.6">'];
    var text = [];
    sections.forEach(function (sec) {
      if (!sec[1].length) return;
      html.push('<h3 style="margin:16px 0 4px">' + esc_(sec[0]) + '（' + sec[1].length + '）</h3><ul style="margin:0;padding-left:20px">');
      text.push('■ ' + sec[0] + '（' + sec[1].length + '）');
      sec[1].sort(byDue_).forEach(function (t) {
        var meta = [t.due ? '期限 ' + t.due : '', t.priority === '高' ? '優先:高' : '', t.source, t.requester].filter(String).join(' / ');
        html.push('<li>' + esc_(t.title) + ' <span style="color:#666">' + esc_(meta) + '</span></li>');
        text.push('・' + t.title + '  ' + meta);
      });
      html.push('</ul>');
    });
    if (inbox.length > 20) html.push('<p>…ほか未整理 ' + (inbox.length - 20) + ' 件</p>');
    if (errors.length) {
      html.push('<p style="color:#b00">直近24時間のエラー: ' + errors.length + ' 件（シート「ログ」を確認してください）</p>');
      text.push('※ 直近24時間のエラー: ' + errors.length + ' 件');
    }
    if (url) { html.push('<p><a href="' + esc_(url) + '">TaskHub を開く</a></p>'); text.push(url); }
    html.push('</div>');

    MailApp.sendEmail({
      to: c.DIGEST_TO,
      subject: '[TaskHub] ' + today + ' 期限切れ' + overdue.length + '・今日' + dueToday.length + '・未整理' + inbox.length,
      body: text.join('\n'),
      htmlBody: html.join(''),
      name: 'TaskHub'
    });
  } catch (e) {
    logEvent_('ERROR', 'まとめメールに失敗: ' + (e && e.stack ? e.stack : e));
    throw e;
  }
}

function jobArchive() {
  var c = cfg_();
  if (c.ROLE === 'collector') return;
  withLock_(function () {
    var sh = sheet_(TH_SHEET_TASKS);
    var ar = sheet_(TH_SHEET_ARCHIVE);
    var map = colMap_(sh);
    var last = sh.getLastRow();
    if (last < 2) return;
    var days = +c.ARCHIVE_AFTER_DAYS || 30;
    var limit = Utilities.formatDate(new Date(Date.now() - days * 86400000), TH_TZ, 'yyyy-MM-dd HH:mm:ss');
    var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    var move = [];
    rows.forEach(function (r, i) {
      var t = rowToTask_(r, map);
      var ts = t.doneAt || t.updatedAt;
      if ((t.status === '完了' || t.status === '却下') && ts && ts < limit) move.push({ i: i, t: t });
    });
    if (!move.length) return;
    var arMap = colMap_(ar);
    var out = move.map(function (x) { return taskToRow_(x.t, arMap); });
    var width = arMap._width;
    ar.getRange(ar.getLastRow() + 1, 1, out.length, width).setValues(out);
    // 下の行から消す（行番号のずれを防ぐ）
    for (var k = move.length - 1; k >= 0; k--) sh.deleteRow(move[k].i + 2);
    logEvent_('INFO', 'アーカイブ: ' + move.length + ' 件を移動');
  });
}

function byDue_(a, b) {
  var x = a.due || '9999', y = b.due || '9999';
  return x < y ? -1 : x > y ? 1 : 0;
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
