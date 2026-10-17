const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../fleet-common.js');
const fleet = fs.existsSync(file) ? require(file) : {};

test('軌跡按時間排序、同時間去重，距離上個保留點不足25公尺不加點', () => {
  assert.equal(typeof fleet.trackSegments, 'function', '尚未實作共用軌跡過濾');
  const a = [25, 121, 1000], b = [25.0001, 121, 2000], c = [25.0003, 121, 3000];
  const input = [c, b, a, [...b]];
  assert.deepEqual(fleet.trackSegments(input), [[a, c]]);
  assert.equal(input.length, 4, '不修改原始資料');
});

test('原始回報間隔超過5分鐘分段，靜止點不能造成假斷線', () => {
  const a = [25, 121, 1000], b = [25.0001, 121, 181000], c = [25.0003, 121, 361000];
  const d = [25.001, 121, 662000], e = [25.0013, 121, 663000];
  assert.deepEqual(fleet.trackSegments([a, b, c, d, e]), [[a, c], [d, e]]);
  assert.deepEqual(fleet.trackSegments([a, [25.001, 121, 301000]]).length, 1, '剛好5分鐘不斷線');
});

test('最新精確度超過50公尺提示定位不準並隱藏速度', () => {
  assert.equal(typeof fleet.positionStatus, 'function', '尚未實作定位品質');
  const s = fleet.positionStatus({ t: 1000000, acc: 78.2, speed: 4.5 }, 1000000);
  assert.equal(s.quality, '定位不準（精確度 78.2 公尺）');
  assert.equal(s.speedKmh, null);
  assert.equal(s.poor, true);
});

test('精確度未知不當作0；50公尺可顯示速度；過期不顯示速度', () => {
  for (const acc of ['', ' ', null, undefined, -1, 'abc']) {
    const s = fleet.positionStatus({ t: 1000000, acc, speed: 4.5 }, 1000000);
    assert.equal(s.quality, '精確度未知');
    assert.equal(s.speedKmh, null);
  }
  const valid = { t: 1000000, acc: 50, speed: 4.5 };
  assert.equal(fleet.positionStatus(valid, 1000000).speedKmh, 16);
  assert.equal(fleet.positionStatus(valid, 1300000).state, 'old');
  assert.equal(fleet.positionStatus(valid, 1300000).speedKmh, null);
  assert.equal(fleet.positionStatus(valid, 1060000).state, 'warn');
});

test('空軌跡與無效經緯度安全排除', () => {
  assert.deepEqual(fleet.trackSegments([]), []);
  assert.deepEqual(fleet.trackSegments([[NaN, 121, 1], [91, 121, 2], null]), []);
});

test('讀取失敗保留上次成功資料；初次失敗不冒充沒有車', async () => {
  assert.equal(typeof fleet.createFeed, 'function', '尚未實作共用資料狀態');
  const original = global.fetch;
  try {
    let fail = false;
    global.fetch = async () => { if (fail) throw Error('offline'); return { ok: true, json: async () => ({ ok: true, cars: [] }) }; };
    const feed = fleet.createFeed('/read-only', () => {});
    await feed.load(60);
    const data = feed.data;
    assert.match(feed.message(), /資料更新/);
    fail = true;
    await feed.load(720);
    assert.equal(feed.data, data);
    assert.equal(feed.minutes, 60, '失敗切換不能把舊資料當成新時間範圍');
    assert.match(feed.message(), /讀取失敗.*保留/);
    const empty = fleet.createFeed('/read-only', () => {});
    await empty.load(60);
    assert.equal(empty.data, null);
    assert.match(empty.message(), /讀取失敗.*尚無/);
  } finally { global.fetch = original; }
});

test('較舊查詢晚回來不覆蓋新時間範圍，失敗後可恢復', async () => {
  const original = global.fetch;
  try {
    const responses = [];
    global.fetch = () => new Promise(resolve => responses.push(resolve));
    const feed = fleet.createFeed('/read-only', () => {});
    const old = feed.load(60), fresh = feed.load(720);
    responses[1]({ok:true,json:async()=>({ok:true,cars:[],tag:'new'})});
    await fresh;
    responses[0]({ok:true,json:async()=>({ok:true,cars:[],tag:'old'})});
    await old;
    assert.equal(feed.data.tag, 'new');
    assert.equal(feed.minutes, 720);
    assert.match(feed.message(feed.lastSuccess + 45001), /更新延遲/);
    global.fetch = async () => ({ok:false});
    await feed.load(720);
    assert.equal(feed.failed, true);
    global.fetch = async () => ({ok:true,json:async()=>({ok:true,cars:[]})});
    await feed.load(720);
    assert.equal(feed.failed, false);
    assert.match(feed.message(), /資料更新/);
  } finally { global.fetch = original; }
});

test('12秒讀取逾時中止並顯示失敗，不永久停留載入中', async (t) => {
  const original = global.fetch;
  t.mock.timers.enable({apis:['setTimeout']});
  try {
    global.fetch = (_url, {signal}) => new Promise((_resolve,reject) => signal.addEventListener('abort',()=>reject(Error('timeout'))));
    const feed = fleet.createFeed('/read-only', () => {});
    const loading = feed.load(60);
    assert.equal(feed.pending, true);
    t.mock.timers.tick(12000);
    await loading;
    assert.equal(feed.pending, false);
    assert.equal(feed.failed, true);
    assert.match(feed.message(), /讀取失敗/);
  } finally { global.fetch = original; t.mock.timers.reset(); }
});
