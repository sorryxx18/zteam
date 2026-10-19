const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const NOW = Date.parse('2026-10-19T14:00:00Z');
const fixture = () => ({ ok: true, now: NOW, days: 1, items: [], lastFetch: { news: NOW, threads: NOW, fb: NOW } });
const response = (data, headers = {}) => ({ ok: true, headers: { get: k => headers[k] ?? null }, json: async () => data, text: async () => '' });
function harness() {
  const nodes = new Map(['#wBox', '#wLocal', '#wTaipei', '#wList', '#wNote'].map(k => [k, { innerHTML: '', textContent: '' }]));
  class Clock extends Date { static now() { return NOW; } }
  const ctx = vm.createContext({ Date: Clock, Intl, console, AbortSignal, location: { pathname: '/watch/' },
    sessionStorage: { getItem() {}, removeItem() {} }, document: { addEventListener() {} }, setInterval() {}, setTimeout: fn => { fn(); },
    $: k => nodes.get(k), esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fetch: async () => response(fixture()) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'watch.js'), 'utf8'), ctx);
  return { ctx, nodes, run: s => vm.runInContext(s, ctx), set(data = fixture(), state = '') { ctx.data = data; ctx.state = state; vm.runInContext('watch = data; watchState = state;', ctx); } };
}

test('watchFetch 保留快取 header metadata，沒有 header 不當成零', async () => {
  for (const [headers, state, age] of [[{ 'x-cache': 'HIT', 'x-cache-age': '72' }, 'HIT', 72], [{}, 'unknown', 'unknown'], [{ 'x-cache-age': 'bad' }, 'unknown', 'unknown']]) {
    const h = harness(); h.ctx.fetch = async () => response(fixture(), headers);
    const d = await h.run('watchFetch(1)');
    assert.ok(d.delivery, '成功讀取應包含 delivery metadata');
    assert.deepEqual(JSON.parse(JSON.stringify(d.delivery)), { via: 'cache', cacheState: state, cacheAgeSeconds: age, receivedAt: NOW });
  }
});

test('快取例外、非 JSON、ok:false 保留 GAS 備援並標示來源；雙失敗仍拋錯', async () => {
  for (const failure of [async () => { throw Error('offline'); }, async () => ({ json: async () => { throw Error('invalid JSON'); } }), async () => response({ ok: false })]) {
    const h = harness(), calls = [];
    h.ctx.fetch = async (url, options) => { calls.push({ url, options }); return url.includes('workers.dev') ? failure() : response(fixture()); };
    const d = await h.run('watchFetch(3, 45000)');
    assert.ok(d.delivery, 'GAS 成功讀取亦應包含 metadata');
    assert.deepEqual(JSON.parse(JSON.stringify(d.delivery)), { via: 'gas', cacheState: 'unknown', cacheAgeSeconds: 'unknown', receivedAt: NOW });
    assert.equal(calls.length, 2); assert.match(calls[0].url, /workers.dev\/\?days=3/); assert.match(calls[1].url, /script.google.com.*\?days=3/);
    assert.ok(calls.every(c => c.options.signal));
  }
  const h = harness(); h.ctx.fetch = async () => { throw Error('offline'); };
  await assert.rejects(h.run('watchFetch(1)'), /offline/);
});

test('真實 Summary 與來源卡區分頁面讀取、資料產生、最近入庫與未知來源檢查', () => {
  const h = harness(), d = fixture();
  d.now = NOW - 60000; d.delivery = { via: 'cache', cacheState: 'HIT', cacheAgeSeconds: 60, receivedAt: NOW };
  d.lastFetch = { news: NOW - 30 * 60000, threads: NOW - 20 * 60000, fb: NOW - 10 * 60000 };
  h.set(d); h.run('drawWatch()');
  const html = h.nodes.get('#wBox').innerHTML.replace(/\s/g, ' ');
  assert.ok(html.includes('頁面讀取：10/19 22:00｜每5分鐘自動讀取'));
  assert.ok(html.includes('資料產生：10/19 21:59'));
  assert.ok(html.includes('最近入庫：10/19 21:30'));
  assert.ok(html.includes('來源成功檢查：待提供'));
  assert.doesNotMatch(html, /每 5 分鐘自動更新|資料 21:50|successfulCheck/);
});

const delivered = (age = 0, state = 'HIT') => ({ ...fixture(), delivery: { via: 'cache', cacheState: state, cacheAgeSeconds: age, receivedAt: NOW } });
test('7 分鐘界限看回應產生與快取實際年齡；短暫 STALE 只提示背景更新', () => {
  const h = harness();
  for (const [age, generatedAge, readAge, state, warning] of [[420, 7, 0, 'HIT', false], [421, 0, 0, 'HIT', true], [0, 7.01, 0, 'HIT', true], [300, 0, 121, 'HIT', true], [60, 1, 0, 'STALE', false]]) {
    const d = delivered(age, state); d.now = NOW - generatedAge * 60000; d.delivery.receivedAt = NOW - readAge * 1000; h.set(d);
    const model = h.run('watchFreshness(watch, watchState, Date.now())');
    assert.equal(model.warning, warning, JSON.stringify({ age, generatedAge, readAge, state }));
    const html = h.run('watchSummary([])');
    if (warning) { assert.match(html, /可能不是最新/); assert.match(html, /background:#fff3cd/); assert.doesNotMatch(html, /✅/); }
    else { assert.doesNotMatch(html, /可能不是最新/); if (state === 'STALE') assert.match(html, /背景更新中/); }
  }
});

test('錯誤保留舊事件與錯誤狀態，無事件結論限定目前收錄資料', () => {
  const h = harness(); h.set(delivered());
  let html = h.run('watchSummary([])');
  assert.match(html, /目前收錄資料中，未發現轄區或臺北市相關事件/);
  assert.doesNotMatch(html, /轄區、臺北市都沒事件|轄區沒事件/);
  const d = delivered(); d.items = [{ s: 'news', t: NOW - 60000, x: '合成測試：臺北市內湖區火警', o: '合成新聞', u: 'https://example.test/event' }];
  h.set(d); h.run('watch.items = watch.items.map(wTier); drawWatch()');
  html = h.nodes.get('#wBox').innerHTML;
  assert.match(html, /目前收錄資料中，未發現轄區相關事件/);
  assert.doesNotMatch(html, /轄區沒事件/);
  h.set(d, 'error'); h.run('drawWatch()');
  html = h.nodes.get('#wBox').innerHTML;
  assert.match(html, /讀取失敗/); assert.match(html, /可能不是最新/); assert.match(html, /wverdict alert/);
  assert.match(h.nodes.get('#wTaipei').innerHTML, /合成測試/);
  assert.equal(h.run('watch.items.length'), 1);
});

test('各來源最近入庫使用 75/120/180 分鐘界限，不將無新資料斷言為採集失敗', () => {
  const h = harness();
  for (const [source, limit] of [['threads', 75], ['fb', 120], ['news', 180]]) {
    for (const [minutes, warning] of [[limit, false], [limit + 0.01, true]]) {
      const d = delivered(); d.lastFetch[source] = NOW - minutes * 60000; h.set(d);
      const model = h.run(`watchSourceFreshness(watch, '${source}', Date.now())`);
      assert.equal(model.warning, warning);
      h.run('drawWatch()'); const html = h.nodes.get('#wBox').innerHTML;
      if (warning) { assert.match(html, /近期無新資料，採集狀態待確認/); assert.match(html, /background:#fff3cd/); }
      assert.doesNotMatch(html, /排程失敗|採集失敗|採集正常|successfulCheck/);
    }
  }
});

test('缺少、未來、無效時間與未知快取年齡不冒充健康或零分鐘', () => {
  const h = harness();
  for (const [value, text] of [[undefined, '待提供'], [null, '待提供'], ['', '待提供'], ['bad', '待確認'], [NOW + 1, '待確認'], [NaN, '待確認']]) {
    h.ctx.value = value;
    assert.equal(h.run('watchTimestamp(value, Date.now()).text'), text);
    for (const field of ['now', 'receivedAt', 'lastFetch']) {
      const d = delivered();
      if (field === 'receivedAt') d.delivery.receivedAt = value; else if (field === 'lastFetch') d.lastFetch = { news: value, threads: value, fb: value }; else d.now = value;
      h.set(d); h.run('drawWatch()');
      const html = h.nodes.get('#wBox').innerHTML;
      assert.equal(h.run('watchFreshness(watch, watchState, Date.now()).warning'), true, field);
      assert.match(html, /background:#fff3cd/); assert.ok(html.includes(text)); assert.doesNotMatch(html, /Invalid Date|NaN|✅/);
    }
  }
  const d = delivered('unknown'); h.set(d);
  assert.equal(h.run('watchFreshness(watch, watchState, Date.now()).warning'), true);
  assert.match(h.run('watchSummary([])'), /快取時間待確認/);
  d.delivery.via = 'gas'; h.set(d);
  assert.equal(h.run('watchFreshness(watch, watchState, Date.now()).warning'), false);
});

test('loadWatch 真實讀取與重試失敗仍保留舊卡片、讀取 metadata 與頻率設定', async () => {
  const h = harness(), d = fixture();
  d.items = [{ s: 'news', t: NOW - 60000, x: '合成測試：大安區火警', o: '合成新聞', u: 'https://example.test/local' }];
  h.ctx.fetch = async () => response(d, { 'x-cache': 'HIT', 'x-cache-age': '72' });
  await h.run('loadWatch(1)');
  assert.equal(h.run('watch.delivery.via'), 'cache'); assert.equal(h.run('watch.delivery.cacheAgeSeconds'), 72);
  assert.match(h.nodes.get('#wLocal').innerHTML, /合成測試/);
  let calls = 0; h.ctx.fetch = async () => { calls++; throw Error('offline'); };
  await h.run('loadWatch(1)');
  assert.equal(h.run('watchState'), 'error'); assert.equal(calls, 14);
  assert.equal(h.run('watch.delivery.receivedAt'), NOW); assert.equal(h.run('watch.items.length'), 1);
  assert.match(h.nodes.get('#wLocal').innerHTML, /合成測試/);
  assert.match(h.nodes.get('#wBox').innerHTML, /讀取失敗/);
  assert.equal(h.run('WATCH_REFRESH'), 300000); assert.equal(h.run('WATCH_CACHE_TIMEOUT'), 20000); assert.equal(h.run('WATCH_TIMEOUT'), 70000);
});

test('HTTP 快取失敗即使 JSON ok:true 仍走 GAS', async () => {
  const h = harness(), calls = [];
  h.ctx.fetch = async url => { calls.push(url); return { ...response(fixture()), ok: !url.includes('workers.dev'), status: 503 }; };
  const d = await h.run('watchFetch(1)');
  assert.equal(d.delivery.via, 'gas'); assert.equal(calls.length, 2);
});

test('空事件區文案限定目前收錄資料，不斷言現場沒有事件', () => {
  const h = harness();
  h.set(delivered()); h.run('drawWatch()');
  assert.match(h.nodes.get('#wLocal').innerHTML, /目前收錄資料中/);
  assert.match(h.nodes.get('#wTaipei').innerHTML, /目前收錄資料中/);
  assert.match(h.nodes.get('#wList').innerHTML, /目前收錄資料中/);
});

test('HTTP GAS 失敗即使 JSON ok:true 也不可當作成功讀取', async () => {
  const h = harness();
  h.ctx.fetch = async () => ({ ...response(fixture()), ok: false, status: 503 });
  await assert.rejects(h.run('watchFetch(1)'), /GAS HTTP 503/);
});



