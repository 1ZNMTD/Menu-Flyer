import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './load.mjs';

const g = loadGas();
// 2026-10-13 は火曜日
const T = { y: 2026, m: 10, d: 13 };
const due = (s, t = T) => g.parseDue_(s, t);

test('明示日付', () => {
  assert.equal(due('2026/10/20までに提出'), '2026-10-20');
  assert.equal(due('2026年11月3日'), '2026-11-03');
  assert.equal(due('期限: 2026-12-01'), '2026-12-01');
  assert.equal(due('10/20までにお願いします'), '2026-10-20');
  assert.equal(due('１０月２５日締切'), '2026-10-25');
  assert.equal(due('11月5日(木)まで'), '2026-11-05');
});

test('年またぎ', () => {
  assert.equal(due('1/10まで', { y: 2026, m: 12, d: 20 }), '2027-01-10');
  assert.equal(due('10/1の件', T), '2026-10-01'); // 直近の過去日はそのまま（期限切れとして見える）
});

test('相対表現', () => {
  assert.equal(due('本日中に対応'), '2026-10-13');
  assert.equal(due('明日までに'), '2026-10-14');
  assert.equal(due('明後日の会議'), '2026-10-15');
  assert.equal(due('3日以内に返信'), '2026-10-16');
  assert.equal(due('今週中に'), '2026-10-16');
  assert.equal(due('来週中に'), '2026-10-23');
  assert.equal(due('金曜までに'), '2026-10-16');
  assert.equal(due('来週月曜日まで'), '2026-10-19');
  assert.equal(due('再来週の水曜'), '2026-10-28');
  assert.equal(due('月末までに'), '2026-10-31');
  assert.equal(due('来月末締切'), '2026-11-30');
  assert.equal(due('20日まで'), '2026-10-20');
  assert.equal(due('5日まで'), '2026-11-05');
});

test('期限語の付いた候補を優先', () => {
  assert.equal(due('10/15の会議の資料を10/14までに'), '2026-10-14');
  assert.equal(due('明日の打合せ後、金曜までにまとめ'), '2026-10-16');
});

test('誤検出しない', () => {
  assert.equal(due('電話 03-1234-5678'), '');
  assert.equal(due('週末に読む'), '');
  assert.equal(due('バージョン1.2/3'), '');
  assert.equal(due('13/40'), '');
  assert.equal(due(''), '');
});

test('優先度', () => {
  assert.equal(g.detectPriority_('【至急】見積'), '高');
  assert.equal(g.detectPriority_('お手すきの際に'), '低');
  assert.equal(g.detectPriority_('資料送付'), '中');
});

test('箇条書きパース（AI出力形式）', () => {
  const text = [
    '# 今日のタスク',
    '- 見積書を作成 @2026-10-20 !高 #案件A >山田',
    '- [ ] 議事録を共有 @明日',
    '- [x] 終わったもの',
    '1. 請求書の確認 | 期限: 10/31 | 優先: 低 | メモ: 経理に確認',
    '・来週月曜までに企画書',
    'ただの文章は無視',
  ].join('\n');
  const r = g.parseBulletTasks_(text, T);
  assert.equal(r.length, 4);
  assert.deepEqual({ ...r[0] }, { title: '見積書を作成', detail: '', due: '2026-10-20', priority: '高', tags: '案件A', requester: '山田' });
  assert.equal(r[1].title, '議事録を共有');
  assert.equal(r[1].due, '2026-10-14');
  assert.equal(r[2].title, '請求書の確認');
  assert.equal(r[2].due, '2026-10-31');
  assert.equal(r[2].priority, '低');
  assert.equal(r[2].detail, '経理に確認');
  assert.equal(r[3].due, '2026-10-19');
});

test('メール抽出（ルール）', () => {
  const r = g.extractFromEmail_({
    subject: 'Re: Fwd: 【至急】見積のご確認',
    body: '山田様\n明日までにご確認をお願いします。\n\n> 以前の引用\nOn Mon, X wrote:\n古い本文 10/1まで',
    from: '"佐藤 花子" <sato@example.com>',
  }, T);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '【至急】見積のご確認');
  assert.equal(r[0].due, '2026-10-14');
  assert.equal(r[0].priority, '高');
  assert.equal(r[0].requester, '佐藤 花子');
  assert.ok(!r[0].detail.includes('古い本文'));
});

test('メール抽出: 箇条書き優先', () => {
  const r = g.extractFromEmail_({ subject: '[Claude] タスク', body: '- A @明日\n- B !高' }, T, { preferBullets: true });
  assert.equal(r.length, 2);
  assert.equal(r[1].priority, '高');
});

test('出典判定', () => {
  assert.equal(g.detectSource_({ subject: '[Claude] 抽出結果' }), 'Claude');
  assert.equal(g.detectSource_({ subject: 'Fwd: [ChatGPT] x' }), 'ChatGPT');
  assert.equal(g.detectSource_({ subject: '[電話] 田中様' }), '電話');
  assert.equal(g.detectSource_({ subject: '新着通知', from: 'info@ni-collabo.example' }), 'NIコラボ');
  assert.equal(g.detectSource_({ subject: 'x', to: 'me+task@gmail.com' }, 'me+task@gmail.com'), 'AI(その他)');
  assert.equal(g.detectSource_({ subject: 'x', from: 'a@b' }), 'Gmail');
  assert.equal(g.detectSource_({ subject: '承認依頼', from: 'Notice <notify@corp.example>' }, '', 'notify@corp.example'), 'NIコラボ');
  assert.equal(g.detectSource_({ subject: '承認依頼', body: '…\n\nNI Collabo 360 からの通知です' }), 'NIコラボ');
});

test('plusAddress', () => {
  assert.equal(g.plusAddress_('me@gmail.com', 'task'), 'me+task@gmail.com');
  assert.equal(g.emailAddress_('A <X@Y.com>'), 'x@y.com');
});
