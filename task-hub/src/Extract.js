/**
 * Extract.js — ルールベースのタスク抽出（GAS 非依存・テスト対象）
 *   - parseDue_(text, today)       : 日本語の期限表現 → 'yyyy-MM-dd'
 *   - detectPriority_(text)        : 至急/お手すき 等 → 高/中/低
 *   - parseBulletTasks_(text, today): 箇条書き（AI 出力・メモ）→ タスク候補配列
 *   - extractFromEmail_(mail, today): メール1通 → タスク候補（ルール版）
 * today は {y,m,d}（Asia/Tokyo の今日）
 */

var TH_DEADLINE_HINT = /^(?:\s|\(|（|[月火水木金土日]|曜|日|\)|）)*(まで|迄|締切|締め切り|〆切|〆|期限|必着|中に|中|厳守)/;
var TH_WD = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };

/** 全角数字・記号を半角に */
function toHalfWidth_(s) {
  return String(s || '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/／/g, '/').replace(/－/g, '-').replace(/：/g, ':');
}

/**
 * テキスト中の期限候補を全て拾い、「まで/締切」等が直後に付くものを優先、なければ最初に出たものを返す。
 */
function parseDue_(text, today) {
  if (!text || !today) return '';
  var s = toHalfWidth_(text);
  var cands = [];
  function push(idx, len, ymd) {
    if (!ymd || !isValidYmd_(ymd.y, ymd.m, ymd.d)) return;
    var after = s.slice(idx + len, idx + len + 8);
    cands.push({ idx: idx, ymd: ymd, hint: TH_DEADLINE_HINT.test(after) });
  }
  var m, re;

  // 1) yyyy-MM-dd / yyyy/M/d / yyyy年M月d日
  re = /(?:^|[^\d])(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})\s*日?/g;
  while ((m = re.exec(s))) {
    var off = m[0].indexOf(m[1]);
    push(m.index + off, m[0].length - off, { y: +m[1], m: +m[2], d: +m[3] });
  }
  // 2) M/d, M月d日（年なし）
  re = /(?:^|[^\d\/.\-])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})(?![\d\/])\s*日?/g;
  while ((m = re.exec(s))) {
    var off2 = m[0].indexOf(m[1]);
    var mo = +m[1], d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    var y = today.y;
    // 半年以上前の日付は来年とみなす（12月に「1/10」等）
    if (isValidYmd_(y, mo, d) && diffDays_(today, { y: y, m: mo, d: d }) < -180) y += 1;
    push(m.index + off2, m[0].length - off2, { y: y, m: mo, d: d });
  }
  // 3) 相対表現
  var rel = [
    [/今日中|本日中|今日|本日|きょう中?/g, 0],
    [/明後日|あさって/g, 2],
    [/明日|あした|翌日/g, 1]
  ];
  rel.forEach(function (r) {
    var mm;
    while ((mm = r[0].exec(s))) push(mm.index, mm[0].length, addDays_(today, r[1]));
  });
  // 4) N日後 / N日以内
  re = /(\d{1,3})\s*日(?:後|以内)/g;
  while ((m = re.exec(s))) push(m.index, m[0].length, addDays_(today, +m[1]));
  // 5) 今週中 / 来週中 → 金曜
  re = /(今週|来週)中/g;
  while ((m = re.exec(s))) {
    var base = m[1] === '来週' ? addDays_(startOfWeek_(today), 7) : startOfWeek_(today);
    var fri = addDays_(base, 4);
    if (diffDays_(today, fri) < 0) fri = today;
    push(m.index, m[0].length, fri);
  }
  // 6) (今週|来週|再来週)?の?X曜
  re = /(再来週|来週|今週)?の?([月火水木金土日])曜(?:日)?/g;
  while ((m = re.exec(s))) {
    var wd = TH_WD[m[2]];
    var target;
    if (m[1]) {
      var weeks = m[1] === '再来週' ? 2 : m[1] === '来週' ? 1 : 0;
      // 週は月曜始まり。日曜は週末扱い（月曜起点 +6）
      target = addDays_(startOfWeek_(today), weeks * 7 + (wd === 0 ? 6 : wd - 1));
    } else {
      var delta = (wd - dow_(today) + 7) % 7;
      target = addDays_(today, delta);
    }
    push(m.index, m[0].length, target);
  }
  // 7) 月末 / 来月末
  re = /(来月|今月)?末/g;
  while ((m = re.exec(s))) {
    if (!m[1] && !/月末/.test(s.slice(Math.max(0, m.index - 1), m.index + 1))) continue;
    var yy = today.y, mo2 = today.m;
    if (m[1] === '来月') { mo2 += 1; if (mo2 > 12) { mo2 = 1; yy += 1; } }
    push(m.index, m[0].length, { y: yy, m: mo2, d: lastDayOfMonth_(yy, mo2) });
  }
  // 8) 「20日まで」（月なし、直後に期限語があるものだけ）
  re = /(?:^|[^\d\/月])(\d{1,2})日(?=\s*(?:まで|迄|締切|〆|期限|必着))/g;
  while ((m = re.exec(s))) {
    var dd = +m[1];
    var y3 = today.y, m3 = today.m;
    if (dd < today.d) { m3 += 1; if (m3 > 12) { m3 = 1; y3 += 1; } }
    var off3 = m[0].indexOf(m[1]);
    push(m.index + off3, m[0].length - off3, { y: y3, m: m3, d: dd });
  }

  if (!cands.length) return '';
  cands.sort(function (a, b) {
    if (a.hint !== b.hint) return a.hint ? -1 : 1;
    return a.idx - b.idx;
  });
  return ymdToStr_(cands[0].ymd);
}

/** 月曜始まりの週の月曜 */
function startOfWeek_(o) {
  var w = dow_(o);
  return addDays_(o, w === 0 ? -6 : 1 - w);
}

function detectPriority_(text) {
  var s = String(text || '');
  if (/大至急|至急|緊急|急ぎで|急ぎ|ASAP|urgent|本日中|今日中|重要|最優先/i.test(s)) return '高';
  if (/お手すき|お手隙|急ぎません|いつでも|余裕があれば|時間があれば|低優先/.test(s)) return '低';
  return '中';
}

/** 依頼らしさのスコア（0〜） */
function taskLikeScore_(text) {
  var s = String(text || '');
  var n = 0;
  [/お願い(?:します|いたします|致します|できますか|できませんか)/, /ください|下さい/, /ご確認/, /ご対応|対応(?:を|して)/,
    /依頼/, /提出/, /締切|締め切り|〆切|期限/, /まで(?:に)?/, /返信|回答|ご回答/, /至急|急ぎ/, /TODO|ToDo|todo/,
    /承認|決裁|申請/, /作成|準備|手配|送付/]
    .forEach(function (re) { if (re.test(s)) n++; });
  return n;
}

var TH_BULLET = /^\s*(?:[-*+・●○■□☐▪︎•]|\d{1,2}[.)．、]|[①-⑳]|\[\s?\]|- \[\s?\])\s*(.+)$/;

/**
 * 箇条書きテキスト → タスク候補
 *  書式（どれも任意）:  - タスク名 @2026-10-20 !高 #案件A >依頼者
 *  @明日 / @10/20 / @金曜 なども可。@ が無ければ本文中の期限表現を拾う。
 *  完了済み（[x]）や見出し（#, ##）は無視。
 */
function parseBulletTasks_(text, today) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  var out = [];
  lines.forEach(function (line) {
    if (/^\s*(?:-\s*)?\[[xX✓✔]\]/.test(line)) return;
    if (/^\s*#{1,6}\s/.test(line)) return;
    var m = TH_BULLET.exec(line);
    if (!m) return;
    var body = m[1].replace(/^\[\s?\]\s*/, '').trim();
    if (!body) return;
    var due = '', priority = '', tags = [], requester = '';
    body = body.replace(/(?:^|\s)@(\S+)/g, function (_, tok) {
      if (!due) due = normalizeDue_(tok) || parseDue_(tok, today);
      return ' ';
    });
    body = body.replace(/(?:^|\s)!(高|中|低|high|mid|middle|low|!+)(?=\s|$)/gi, function (_, p) {
      p = p.toLowerCase();
      priority = p === '高' || p === 'high' || /^!+$/.test(p) ? '高' : p === '低' || p === 'low' ? '低' : '中';
      return ' ';
    });
    body = body.replace(/(?:^|\s)#([^\s#]+)/g, function (_, t) { tags.push(t); return ' '; });
    body = body.replace(/(?:^|\s)>(\S+)/g, function (_, r) { requester = r; return ' '; });
    // 「タイトル | 期限:… | 優先:…」形式も許容
    var parts = body.split(/\s*[|｜]\s*/);
    var title = parts.shift();
    var detail = [];
    parts.forEach(function (p) {
      var kv = /^(期限|due|優先度?|priority|依頼者|メモ|詳細|note)\s*[:：]\s*(.+)$/i.exec(p.trim());
      if (!kv) { if (p.trim()) detail.push(p.trim()); return; }
      var k = kv[1].toLowerCase(), v = kv[2].trim();
      if (k === '期限' || k === 'due') due = due || normalizeDue_(v) || parseDue_(v, today);
      else if (/^優先|priority/.test(k)) priority = priority || detectPriorityToken_(v);
      else if (k === '依頼者') requester = requester || v;
      else detail.push(v);
    });
    title = String(title || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    if (!due) due = parseDue_(title, today);
    out.push({
      title: clip_(title, 200),
      detail: detail.join('\n'),
      due: due,
      priority: priority || detectPriority_(title),
      tags: tags.join(' '),
      requester: requester
    });
  });
  return out;
}

function detectPriorityToken_(v) {
  v = String(v).toLowerCase();
  if (/高|high|!/.test(v)) return '高';
  if (/低|low/.test(v)) return '低';
  return '中';
}

/** 件名の Re:/Fwd:/[xxx] を除去 */
function cleanSubject_(subject) {
  var s = String(subject || '').trim();
  var prev;
  do {
    prev = s;
    s = s.replace(/^(?:re|fw|fwd|転送|返信)\s*[:：]\s*/i, '').replace(/^\[(?:claude|chatgpt|gpt|ai|メモ|memo|電話|task|タスク)\]\s*/i, '');
  } while (s !== prev);
  return s.trim();
}

/** 件名タグ・送信元から出典を判定 */
function detectSource_(mail, ownPlusAddress, nicollaboFrom) {
  var subj = String(mail.subject || '');
  var from = String(mail.from || '').toLowerCase();
  var body = String(mail.body || '').slice(0, 2000);
  var tag = /^\s*(?:(?:re|fw|fwd)\s*[:：]\s*)*\[([^\]]+)\]/i.exec(subj);
  if (tag) {
    var t = tag[1].toLowerCase();
    if (t === 'claude') return 'Claude';
    if (t === 'chatgpt' || t === 'gpt') return 'ChatGPT';
    if (t === 'ai') return 'AI(その他)';
    if (t === 'メモ' || t === 'memo') return 'メモ';
    if (t === '電話') return '電話';
  }
  var niList = String(nicollaboFrom || '').toLowerCase().split(/[,\s]+/).filter(String);
  if (niList.some(function (a) { return from.indexOf(a) >= 0; })) return 'NIコラボ';
  if (/ni-?collabo|nicollabo|ni collabo/i.test(from) || /NI\s*Collabo|NIコラボ/i.test(subj + ' ' + body)) return 'NIコラボ';
  if (ownPlusAddress && String(mail.to || '').toLowerCase().indexOf(ownPlusAddress.toLowerCase()) >= 0) return 'AI(その他)';
  return 'Gmail';
}

/**
 * メール1通 → タスク候補（ルール版）
 * mail: {subject, body, from, to, date}
 * 本文に箇条書きタスクがあれば（AI 出力の転送など）それを使い、無ければ件名から1件作る。
 */
function extractFromEmail_(mail, today, opts) {
  opts = opts || {};
  var subject = cleanSubject_(mail.subject);
  var body = String(mail.body || '');
  var head = stripQuoted_(body).slice(0, 3000);
  if (opts.preferBullets) {
    var bl = parseBulletTasks_(head, today);
    if (bl.length) return bl.slice(0, 20);
  }
  var text = subject + '\n' + head;
  return [{
    title: clip_(subject || firstLine_(head) || '(件名なし)', 200),
    detail: clip_(head.trim(), 1000),
    due: parseDue_(text, today),
    priority: detectPriority_(text),
    tags: taskLikeScore_(text) === 0 ? '要確認' : '',
    requester: senderName_(mail.from)
  }];
}

/** 引用部分（> で始まる行、「〜wrote:」以降、署名以降）を落とす */
function stripQuoted_(body) {
  var lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^\s*>/.test(l)) continue;
    if (/^On .+wrote:\s*$/.test(l) || /^\d{4}年\d{1,2}月\d{1,2}日.*(?:書きました|wrote)[:：]?\s*$/.test(l)) break;
    if (/^-{2,}\s*Original Message|^-{5,}\s*Forwarded message/i.test(l)) break;
    if (/^--\s*$/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

function firstLine_(s) {
  var lines = String(s || '').split('\n');
  for (var i = 0; i < lines.length; i++) if (lines[i].trim()) return lines[i].trim();
  return '';
}

/** "山田 太郎 <yamada@example.com>" → "山田 太郎" */
function senderName_(from) {
  var s = String(from || '').trim();
  var m = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(s);
  return clip_((m ? m[1] : s).trim(), 100);
}

/** "xxx <a@b>" → "a@b" */
function emailAddress_(from) {
  var m = /<([^>]+)>/.exec(String(from || ''));
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

/** user@example.com → user+task@example.com */
function plusAddress_(email, tag) {
  var at = String(email || '').indexOf('@');
  if (at < 0) return '';
  return email.slice(0, at) + '+' + tag + email.slice(at);
}
