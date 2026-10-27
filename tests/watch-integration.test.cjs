const test = require('node:test'), assert = require('node:assert/strict');
const { merge, trend } = require('../watch-integration.js');
const NOW = Date.parse('2026-10-27T13:30:00+08:00');
const post = (code, x = '大安區消防火警', t = NOW - 1000) => ({ s: 'threads', o: 'tester', u: 'https://www.threads.com/@tester/post/' + code, x, t });
test('同篇脆文跨網域與帳號路徑去重，保留較完整內文與留言，來源物件不被修改', () => {
  const a = post('Abc'), b = { ...post('Abc', '大安區消防火警已處理完畢'), u: 'https://www.threads.net/@other/post/Abc?x=1', _lab: true, tag: '台北', classification: { category: '轉述' } };
  a.h = '消防車'; const saved = JSON.stringify(a), result = merge([a], [b]);
  assert.equal(result.length, 1); assert.equal(result[0].h, '消防車'); assert.equal(result[0].x, b.x); assert.equal(result[0]._lab, true); assert.equal(JSON.stringify(a), saved);
});
test('不同貼文即使文字相同仍保留；FB故事識別碼不能被去掉', () => {
  assert.equal(merge([post('A')], [post('B')]).length, 2);
  const fb = id => ({ ...post('x'), s: 'fb', u: 'https://facebook.com/permalink.php?story_fbid=' + id + '&id=1' });
  assert.equal(merge([fb('111')], [fb('222')]).length, 2);
});
test('趨勢按發布時間計篇數，不按採集時間；同篇多次出現關鍵字也只算一次', () => {
  const items = [post('A', '消防消防消防'), post('B', '消防', NOW - 7 * 3600000), { ...post('C', '消防'), s: 'news' }, post('future', '消防', NOW + 1)];
  const r = trend(items, .25, 'threads', '', '消防', NOW);
  assert.equal(r.total, 1); assert.equal(r.posts, 1); assert.equal(r.bins.reduce((s, b) => s + b.count, 0), 1);
});
test('時間邊界、轄區篩選、標籤與零篇時段皆保留', () => {
  const items = [{ ...post('A', '現場', NOW - 6 * 3600000), tag: '消防', _loc: true }, { ...post('B'), _loc: false }];
  const r = trend(items, .25, '', '1', '消防', NOW);
  assert.equal(r.total, 1); assert.equal(r.bins.length, 7); assert.equal(r.bins[0].count, 1); assert.equal(r.bins.at(-1).count, 0);
});
