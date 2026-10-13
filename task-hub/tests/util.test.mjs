import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './load.mjs';

const g = loadGas();

test('数式インジェクション対策', () => {
  assert.equal(g.sanitizeCell_('=IMPORTXML("http://evil")'), "'=IMPORTXML(\"http://evil\")");
  assert.equal(g.sanitizeCell_('+81 90'), "'+81 90");
  assert.equal(g.sanitizeCell_('@me'), "'@me");
  assert.equal(g.sanitizeCell_('-1'), "'-1");
  assert.equal(g.sanitizeCell_('普通の文字'), '普通の文字');
  assert.equal(g.sanitizeCell_('a\u0000b'), 'ab');
  assert.equal(g.sanitizeCell_(null), '');
});

test('URL は https のみ', () => {
  assert.equal(g.safeUrl_('javascript:alert(1)'), '');
  assert.equal(g.safeUrl_('http://example.com'), '');
  assert.equal(g.safeUrl_('https://mail.google.com/mail/#all/abc'), 'https://mail.google.com/mail/#all/abc');
  assert.equal(g.safeUrl_('https://x" onmouseover="a'), '');
});

test('期限の正規化', () => {
  assert.equal(g.normalizeDue_('2026/1/5'), '2026-01-05');
  assert.equal(g.normalizeDue_('2026-02-30'), '');
  assert.equal(g.normalizeDue_('明日'), '');
  assert.equal(g.normalizeDue_(new Date(2026, 0, 9)), '2026-01-09');
});

test('入力検証', () => {
  assert.throws(() => g.validateTaskInput_({ title: '  ' }), /タイトル/);
  assert.throws(() => g.validateTaskInput_({ title: 'a', due: 'xx' }), /期限/);
  assert.throws(() => g.validateTaskInput_({ title: 'a', status: '謎' }), /状態/);
  const v = g.validateTaskInput_({ title: ' a  b ', due: '2026/10/1', priority: '高', source: '不明', sourceUrl: 'javascript:x' });
  assert.equal(v.title, 'a b');
  assert.equal(v.due, '2026-10-01');
  assert.equal(v.source, 'その他');
  assert.equal(v.sourceUrl, '');
  const p = g.validateTaskInput_({ status: '完了' }, true);
  assert.deepEqual({ ...p }, { status: '完了' });
});
