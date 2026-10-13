/**
 * Gmail.js — Gmail からの自動取込
 *  対象: GMAIL_QUERY に一致するメール（既定: ラベル taskhub-in が付いたもの、または 自分+task@ 宛）
 *  前回実行時刻以降のメールだけを見て、メールID で重複を防ぐ。
 *  取り込んだ候補は「未整理」に入り、画面で 採用/却下 する（誤登録・取りこぼし防止）。
 */

function ingestGmail_() {
  var c = cfg_();
  var p = props_();
  var me = c.ME.toLowerCase();
  var plus = plusAddress_(me, 'task');
  var startedAt = Date.now();
  var last = +(p.getProperty('LAST_GMAIL_RUN') || 0);
  var afterSec = last ? Math.floor(last / 1000) - 900 : 0; // 15分重ねて取りこぼしを防ぐ
  var q = String(c.GMAIL_QUERY).replace(/\{PLUS\}/g, plus);
  q = '(' + q + ')' + (afterSec ? ' after:' + afterSec : ' newer_than:' + (+c.INITIAL_LOOKBACK_DAYS || 3) + 'd');

  var threads = GmailApp.search(q, 0, 100);
  var msgs = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (afterSec && m.getDate().getTime() < afterSec * 1000) return;
      msgs.push({ m: m, th: th });
    });
  });
  msgs.sort(function (a, b) { return a.m.getDate() - b.m.getDate(); });

  var seen = existingSourceKeys_();
  var maxRun = +c.MAX_MESSAGES_PER_RUN || 30;
  var aiBudget = +c.GEMINI_PER_RUN_LIMIT || 5;
  var today = todayYmd_();
  var doneLabel = GmailApp.getUserLabelByName(TH_LABEL_DONE);
  var stat = { scanned: msgs.length, created: 0, skipped: 0, ai: 0 };
  var processed = 0;
  var lastProcessedAt = 0;
  var hitLimit = false;

  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i].m;
    var key = 'gmail:' + me + ':' + m.getId();
    if (seen[key]) { stat.skipped++; continue; }
    if (processed >= maxRun) { hitLimit = true; break; }
    if (Date.now() - startedAt > 240000) { hitLimit = true; break; } // 実行時間上限(6分)対策

    var from = m.getFrom();
    var to = [m.getTo(), m.getCc(), m.getBcc ? m.getBcc() : ''].join(',').toLowerCase();
    var toPlus = to.indexOf(plus) >= 0;
    // 自分が送ったメール（返信など）は除外。ただし 自分+task@ 宛は取込用なので対象
    if (emailAddress_(from) === me && !toPlus) { seen[key] = true; stat.skipped++; continue; }
    if (m.isInTrash()) { stat.skipped++; continue; }

    var mail = { subject: m.getSubject(), body: m.getPlainBody(), from: from, to: to, date: m.getDate() };
    var source = detectSource_(mail, plus, c.NICOLLABO_FROM);
    var isAiPaste = toPlus || source === 'Claude' || source === 'ChatGPT' || source === 'AI(その他)' || source === 'メモ';
    var cands = null;
    // AI の出力やメモを転送したものは箇条書きを優先（Gemini 不要）
    if (isAiPaste) {
      var bl = parseBulletTasks_(stripQuoted_(mail.body), today);
      if (bl.length) cands = bl;
    }
    if (!cands && aiBudget > 0) {
      var ai = geminiExtract_('メール', '件名: ' + mail.subject + '\n差出人: ' + from + '\n\n' + stripQuoted_(mail.body));
      if (ai) {
        aiBudget--; stat.ai++;
        cands = ai.length ? ai : null;
        if (!ai.length) {
          // AI が「タスクなし」と判定しても、条件に一致したメールなので確認用に1件残す
          cands = extractFromEmail_(mail, today);
          cands[0].tags = 'AI:タスクなし?';
        }
      }
    }
    if (!cands) cands = extractFromEmail_(mail, today);

    var url = 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + '#all/' + m.getId();
    var snippet = clip_(stripQuoted_(mail.body).trim(), 800);
    var recs = cands.map(function (t, n) {
      return {
        status: '未整理', title: t.title, due: t.due, priority: t.priority,
        detail: (t.detail ? t.detail + '\n\n' : '') + '― 元メール ―\n件名: ' + mail.subject + '\n差出人: ' + from + '\n' + snippet,
        source: source, sourceUrl: url, sourceKey: key + (n ? '#' + n : ''),
        requester: t.requester || senderName_(from), tags: t.tags || '', account: c.ACCOUNT_NAME
      };
    });
    appendTasks_(recs);
    seen[key] = true;
    stat.created += recs.length;
    processed++;
    lastProcessedAt = m.getDate().getTime();
    if (doneLabel) {
      try { msgs[i].th.addLabel(doneLabel); } catch (e) { /* ラベル付けの失敗は致命的ではない */ }
    }
  }

  // 件数上限で打ち切った場合は、最後に処理したメールの時刻から次回再開する
  var nextFrom = hitLimit ? (lastProcessedAt || last) : startedAt;
  if (nextFrom) p.setProperty('LAST_GMAIL_RUN', String(nextFrom));
  p.setProperty('LAST_GMAIL_STAT', JSON.stringify({ at: nowStr_(), stat: stat, more: hitLimit }));
  if (stat.created) logEvent_('INFO', 'Gmail 取込: 新規 ' + stat.created + ' 件（AI ' + stat.ai + ' 件）' + (hitLimit ? ' 残りは次回' : ''));
  return stat;
}
