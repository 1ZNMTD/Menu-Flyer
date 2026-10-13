import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGas } from './gasmock.mjs';

const ME = 'me@gmail.com';
const at = (s) => new Date(s);

function mail(id, o) {
  return { id, thread: o.thread || id, subject: '', body: '', from: '"山田 太郎" <yamada@example.com>', date: at('2026-10-13T08:00:00+09:00'), ...o };
}

test('setup → シート・ラベル・トリガーが作られる', () => {
  const { g, props, books, triggers, labels } = makeGas();
  g.setup();
  const ss = books[props.SPREADSHEET_ID];
  assert.ok(ss.getSheetByName('タスク'));
  assert.ok(ss.getSheetByName('アーカイブ'));
  assert.ok(ss.getSheetByName('ログ'));
  assert.equal(ss.getSheetByName('シート1'), null);
  assert.deepEqual(triggers.map((t) => t.getHandlerFunction()).sort(), ['jobArchive', 'jobDailyDigest', 'jobIngest']);
  assert.ok(labels.has('taskhub-in') && labels.has('taskhub-done'));
  g.setup(); // 2回実行しても重複しない
  assert.equal(triggers.length, 3);
  assert.equal(ss.getSheetByName('タスク').getLastRow(), 1);
});

test('Gmail 取込: 未整理に入り、重複・自分の送信は除外、次回は差分のみ', () => {
  const messages = [
    mail('m1', { subject: '【至急】見積のお願い', body: '明日までにお送りください。\n> 引用' }),
    mail('m2', { subject: 'Re: 見積のお願い', body: '承知しました', from: `自分 <${ME}>`, thread: 'm1' }),
    mail('m3', { subject: '[Claude] 抽出', body: '- 議事録を共有 @金曜 !高\n- 請求書確認', from: ME, to: 'me+task@gmail.com' }),
    mail('m4', { subject: '=HYPERLINK("https://evil","x")', body: 'ご確認ください' }),
  ];
  const { g, props, books, env, advance } = makeGas({ messages });
  const now = () => env.Date.now();
  g.setup();
  const st = g.ingestGmail_();
  assert.match(env._lastQuery, /newer_than:3d/);
  assert.equal(st.created, 4);
  const tasks = g.listTasks_();
  assert.equal(tasks.length, 4);
  assert.ok(tasks.every((t) => t.status === '未整理'));
  const t1 = tasks.find((t) => t.title === '【至急】見積のお願い');
  assert.equal(t1.due, '2026-10-14');
  assert.equal(t1.priority, '高');
  assert.equal(t1.requester, '山田 太郎');
  assert.equal(t1.source, 'Gmail');
  assert.match(t1.sourceUrl, /^https:\/\/mail\.google\.com\/mail\/\?authuser=me%40gmail\.com#all\/m1$/);
  const claude = tasks.filter((t) => t.source === 'Claude');
  assert.equal(claude.length, 2);
  assert.equal(claude[0].due, '2026-10-16');
  assert.notEqual(claude[0].sourceKey, claude[1].sourceKey);

  // 数式インジェクション: セルには文字列として保存される（モックでは ' を外した値＝表示値）
  const sh = books[props.SPREADSHEET_ID].getSheetByName('タスク');
  const titles = sh.data.slice(1).map((r) => r[2]);
  assert.ok(titles.includes('=HYPERLINK("https://evil","x")'));

  // 2回目: 同じメールは取り込まない
  advance(15 * 60000);
  const st2 = g.ingestGmail_();
  assert.match(env._lastQuery, /after:\d+/);
  assert.equal(st2.created, 0);
  assert.equal(g.listTasks_().length, 4);

  // 新着だけ取り込む
  messages.push(mail('m5', { subject: '資料送付のお願い', body: 'お手すきの際に', date: new Date(now() + 20 * 60000) }));
  advance(15 * 60000);
  const st3 = g.ingestGmail_();
  assert.equal(st3.created, 1);
  assert.equal(g.listTasks_().find((t) => t.title === '資料送付のお願い').priority, '低');
});

test('件数上限で打ち切ったら、残りは次回に取り込む', () => {
  const messages = Array.from({ length: 5 }, (_, i) => mail('x' + i, { subject: '依頼' + i, date: at(`2026-10-13T0${i}:00:00+09:00`) }));
  const { g, props } = makeGas({ messages });
  g.setup();
  props.MAX_MESSAGES_PER_RUN = '2';
  assert.equal(g.ingestGmail_().created, 2);
  assert.equal(g.ingestGmail_().created, 2);
  assert.equal(g.ingestGmail_().created, 1);
  assert.equal(g.ingestGmail_().created, 0);
  assert.deepEqual([...g.listTasks_().map((t) => t.title)].sort(), ['依頼0', '依頼1', '依頼2', '依頼3', '依頼4']);
});

test('Gemini: 成功時は AI 結果、429 ならルールにフォールバック', () => {
  let mode = 'ok';
  const fetch = () => {
    if (mode === '429') return { getResponseCode: () => 429, getContentText: () => '{}' };
    const out = { tasks: [{ title: '見積書を送付する', due: '2026-10-21', priority: '高', detail: '', requester: '山田' },
      { title: '', due: 'x', priority: '?' }] };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) };
  };
  const messages = [mail('g1', { subject: 'お願い', body: '来週水曜までに見積を' })];
  const { g, props, fetched, env } = makeGas({ messages, fetch });
  g.setup();
  props.GEMINI_API_KEY = 'k';
  g.ingestGmail_();
  const t = g.listTasks_();
  assert.equal(t.length, 1);
  assert.equal(t[0].title, '見積書を送付する');
  assert.equal(fetched[0].opt.headers['x-goog-api-key'], 'k');
  assert.ok(!fetched[0].url.includes('k='), 'APIキーを URL に入れない');

  mode = '429';
  messages.push(mail('g2', { subject: '確認依頼', body: '明日までにご確認ください', date: new Date(env.Date.now() + 60000) }));
  g.ingestGmail_();
  const t2 = g.listTasks_().find((x) => x.sourceKey.includes('g2'));
  assert.equal(t2.title, '確認依頼');
  assert.equal(t2.due, '2026-10-14');
  assert.ok(+props.GEMINI_BLOCKED_UNTIL > env.Date.now());
});

test('AI_MODE=rules なら外部送信しない', () => {
  const { g, props, fetched } = makeGas({ messages: [mail('r1', { subject: 'a', body: 'b' })], fetch: () => { throw new Error('should not call'); } });
  g.setup();
  props.GEMINI_API_KEY = 'k';
  props.AI_MODE = 'rules';
  g.ingestGmail_();
  assert.equal(fetched.length, 0);
});

test('画面 API: 追加・更新・完了・一括取込', () => {
  const { g } = makeGas();
  g.setup();
  const a = g.apiQuickAdd('見積作成 @金曜 !高 #案件A');
  assert.equal(a.title, '見積作成');
  assert.equal(a.due, '2026-10-16');
  assert.equal(a.status, '未着手');
  assert.equal(a.source, '手入力');

  const u = g.apiUpdate(a.id, { status: '完了' });
  assert.equal(u.status, '完了');
  assert.ok(u.doneAt);
  const u2 = g.apiUpdate(a.id, { status: '進行中', title: '見積作成（再）' });
  assert.equal(u2.doneAt, '');
  assert.equal(g.listTasks_()[0].title, '見積作成（再）');
  assert.throws(() => g.apiUpdate(a.id, { status: 'bad' }));
  assert.throws(() => g.apiUpdate('nope', { status: '完了' }), /見つかりません/);

  const p = g.apiParseText('- A @明日\n- B', 'ChatGPT');
  assert.equal(p.method, 'rules');
  assert.equal(p.tasks.length, 2);
  const saved = g.apiCreateMany(p.tasks, '未整理');
  assert.equal(saved.length, 2);
  assert.equal(saved[0].source, 'ChatGPT');
  assert.equal(saved[0].status, '未整理');

  const free = g.apiParseText('今日の打合せメモ\n来週月曜までに資料をまとめる', 'メモ');
  assert.equal(free.tasks.length, 1);
  assert.equal(free.tasks[0].due, '2026-10-19');

  const boot = g.apiBootstrap();
  assert.equal(boot.tasks.length, 3);
  assert.equal(boot.today, '2026-10-13');
  assert.equal(boot.plus, 'me+task@gmail.com');
});

test('他人はアクセスできない', () => {
  const { g, env } = makeGas();
  g.setup();
  env._activeUser = 'other@example.com';
  assert.throws(() => g.apiBootstrap(), /アクセス権/);
  env._activeUser = '';
  assert.throws(() => g.apiBootstrap(), /アクセス権/);
});

test('まとめメールとアーカイブ', () => {
  const { g, sent, advance, books, props } = makeGas();
  g.setup();
  g.apiCreate({ title: '期限切れ<b>', due: '2026-10-10' });
  g.apiCreate({ title: '今日', due: '2026-10-13' });
  const d = g.apiCreate({ title: '済み' });
  g.apiUpdate(d.id, { status: '完了' });
  g.jobDailyDigest();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /期限切れ1・今日1・未整理0/);
  assert.ok(sent[0].htmlBody.includes('期限切れ&lt;b&gt;'), 'HTML エスケープされる');

  advance(31 * 86400000);
  g.jobArchive();
  const ss = books[props.SPREADSHEET_ID];
  assert.equal(g.listTasks_().length, 2);
  assert.equal(ss.getSheetByName('アーカイブ').getLastRow(), 2);
  assert.equal(ss.getSheetByName('アーカイブ').data[1][2], '済み');
});

test('collector は取込のみ・画面なし', () => {
  const { g, props, triggers } = makeGas();
  g.setup();
  g.uninstall();
  props.ROLE = 'collector';
  g.setupCollector();
  assert.deepEqual(triggers.map((t) => t.getHandlerFunction()), ['jobIngest']);
});

test('シートに手で追加した行（ID なし）に ID が付く', () => {
  const { g, props, books } = makeGas();
  g.setup();
  const sh = books[props.SPREADSHEET_ID].getSheetByName('タスク');
  const row = new Array(16).fill('');
  row[2] = '手で書いたタスク';
  row[4] = '2026/10/30';
  sh.appendRow(row);
  const t = g.listTasks_();
  assert.equal(t.length, 1);
  assert.match(t[0].id, /^T\d{6}-/);
  assert.equal(t[0].status, '未着手');
  assert.equal(t[0].due, '2026-10-30');
  assert.equal(t[0].source, '手入力');
  assert.equal(sh.data[1][0], t[0].id);
  assert.equal(g.listTasks_()[0].id, t[0].id); // 2回目は変わらない
  g.apiUpdate(t[0].id, { status: '完了' });
});
