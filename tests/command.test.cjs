const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function harness(search = '?preview=1') {
  const nodes = new Map();
  const node = () => ({ innerHTML: '', textContent: '', isConnected: true, addEventListener() {}, querySelectorAll() { return []; }, setAttribute(k,v) { this[k]=v; }, remove() {} });
  const $ = s => { if (!nodes.has(s)) nodes.set(s, node()); return nodes.get(s); };
  const maps = [], pins = [];
  class MapStub {
    constructor(options) { this.options=options; this.sources={}; this.layers=[]; maps.push(this); }
    addControl() {} once(_, cb) { this.load=cb; } on() {} resize() {} remove() { this.removed=true; }
    fitBounds(bounds) { assert.ok(bounds.flat().every(Number.isFinite)); this.bounds=bounds; }
    addSource(id, source) { this.sources[id]=source; } addLayer(layer) { this.layers.push(layer); }
    getSource(id) { return this.sources[id]; }
  }
  const ctx = vm.createContext({ console, URLSearchParams, Intl, Date, location: {search: search.includes('cmd=') ? search : search + (search ? '&' : '?') + 'cmd=newyear'}, $, document: { createElement: node, querySelectorAll: () => [] },
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    setInterval: () => 1, clearInterval() {}, setTimeout, cctvStopIn() {}, cctvLoad: () => Promise.resolve(), cctvNear: () => [],
    amapLoad: () => Promise.resolve(), amapStyle: () => Promise.resolve({}),
    maplibregl: { Map: MapStub, NavigationControl: class {}, Marker: class { constructor({element}) { pins.push(element); } setLngLat() {return this;} addTo() {return this;} } }
  });
  const run = code => vm.runInContext(code, ctx);
  const load = file => run(fs.readFileSync(path.join(root,file),'utf8'));
  load('command-data.js'); load('command.js');
  return {run,load,$,maps,pins,ctx};
}

test('活動地圖載入期間離開或重進，舊成功／失敗不得建圖或刪除新請求', async () => {
  for (const stage of ['load', 'style']) for (const fail of [false, true]) for (const replaced of [false, true]) {
    let settle;
    const gate = new Promise((resolve, reject) => { settle = () => fail ? reject(new Error('offline')) : resolve({}); });
    const box = { isConnected: true, classList: {contains: () => false}, innerHTML: '', querySelector() { throw new Error('stale DOM write'); } };
    let activeBox = box, constructions = 0;
    const ctx = vm.createContext({ URL, window: {}, location: {href:'http://localhost/'}, document: {},
      $: () => activeBox, esc: String, maplibregl: {Map: class {constructor() { constructions++; throw new Error('Container not found'); }}}, gate });
    const run = code => vm.runInContext(code, ctx);
    run(fs.readFileSync(path.join(root,'actmap.js'),'utf8'));
    run(`amapLoad = () => ${stage === 'load' ? 'gate' : 'Promise.resolve()'}; amapStyle = () => ${stage === 'style' ? 'gate' : 'Promise.resolve({})'};`);
    const job = run('drawAmap({id:"1151231", map:{center:[25,121]}})');
    await new Promise(r => setImmediate(r));
    box.isConnected = false; activeBox = replaced ? {...box, isConnected:true} : null;
    if (replaced) run('amaps["1151231"] = {pending:true, replacement:true}');
    settle();
    await assert.doesNotReject(job);
    assert.equal(constructions, 0);
    assert.equal(run('!!amaps["1151231"]?.replacement'), replaced);
    if (!replaced) assert.equal(run('amaps["1151231"]'), undefined);
  }
});

test('正式空資料保留完整面板，不洩漏示意且使用真實時間', async () => {
  const h=harness('?preview=1&cmdnow=2027-01-01T00:20');
  h.run('COMMAND.demo = false; renderCommand()');
  await new Promise(resolve => setImmediate(resolve));
  for (const id of ['cmdPhase','cmdCount','cmdNums','cmdSide','cmdSocial','cmdCams']) {
    const n=h.$('#'+id);
    assert.match(n.innerHTML+n.textContent,/待提供/,id);
    assert.doesNotMatch(n.innerHTML+n.textContent,/undefined|NaN|松智路|Threads|目前沒有/);
  }
  assert.match(h.$('#cmdNums').innerHTML,/class="cmdnum lights pending"/);
  assert.doesNotMatch(h.$('#view').innerHTML,/示意|全部是假資料/);
  for (const id of ['cmdFull','cmdMap','cmdSide','cmdCams','cmdSocial']) assert.match(h.$('#view').innerHTML,new RegExp(id));
  assert.ok(Math.abs(h.run('cmdNow()')-Date.now()) < 1000);
  assert.doesNotThrow(() => h.maps[0].load());
  assert.equal(h.maps[0].layers.length,0);
  assert.equal(h.pins.length,0);
});

test('示意保留完整資訊，角標僅示意，切換清除選區與舊地圖', async () => {
  const h=harness();
  h.run('renderCommand()');
  await new Promise(resolve => setImmediate(resolve));
  h.maps[0].load();
  assert.match(h.$('#view').innerHTML,/>示意<\/span>/);
  for (const label of ['現況','影響','下一步','缺什麼']) assert.match(h.$('#cmdSide').innerHTML,new RegExp(label));
  assert.match(h.$('#cmdSide').innerHTML,/滿七成/);
  h.run('COMMAND.demo=false; renderCommand()');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.run('cmdSel'),null);
  assert.equal(h.maps[0].removed,true);
  assert.match(h.$('#cmdCams').innerHTML,/待提供/);
  assert.doesNotMatch(h.$('#cmdSide').innerHTML,/松智路/);
  h.maps[1].load();
  assert.equal(h.maps[1].layers.length,0);
  h.run('COMMAND.demo=true; COMMAND.zones=[]; COMMAND.issues=[]; renderCommand()');
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotThrow(() => h.maps[2].load());
});

test('正式地圖只畫核定且有效態勢區，車輛只呈現位置與最後回報', async () => {
  const h=harness();
  h.run(`COMMAND.demo=false; COMMAND.live.zones=[
    {...COMMAND.zones[0], id:'control', name:'交通管制區'},
    {...COMMAND.zones[1], id:'approved', name:'核定態勢區', approved:true},
    {id:'bad', approved:true, light:'red'}];
    COMMAND.live.cars=[{name:'正式車',lat:25,lng:121,state:'送醫中',reportedAt:'2026-12-31T23:39'}];
    renderCommand()`);
  await new Promise(resolve => setImmediate(resolve));
  h.maps[0].load();
  assert.equal(h.maps[0].sources.cmdzones.data.features.length,1);
  assert.equal(h.maps[0].sources.cmdzones.data.features[0].properties.id,'approved');
  assert.doesNotMatch(h.$('#cmdSide').innerHTML,/交通管制區/);
  // 車輛改由現場地圖同一個定位來源（AMAP_FLEET）即時畫，資料檔裡的 cars 不再畫成圖釘，也不帶狀態字
  assert.equal(h.pins.find(p => (p.title||'').includes('正式車')), undefined);
  assert.ok(h.pins.every(p => !/送醫|回程|待命|busy/.test((p.title||'')+(p.className||''))));
});

test('模式切換後忽略舊地圖非同步成功與失敗', async () => {
  for (const rejectOld of [false,true]) {
    const h=harness(); let resolve, reject;
    h.ctx.amapLoad=() => new Promise((a,b) => {resolve=a; reject=b;});
    h.run('renderCommand()');
    h.ctx.amapLoad=() => Promise.resolve();
    h.run('COMMAND.demo=false; renderCommand()');
    await new Promise(r => setImmediate(r));
    if (rejectOld) reject(new Error('old')); else resolve();
    await new Promise(r => setImmediate(r));
    assert.equal(h.maps.length,1);
    assert.doesNotMatch(h.$('#cmdMap').innerHTML,/載入失敗/);
  }
});

test('舊地圖 load 與影像錯誤不得污染重畫後畫面', async () => {
  const h=harness(); let reject;
  h.ctx.cctvLoad=() => new Promise((_,b) => {reject=b;});
  h.run('renderCommand()');
  await new Promise(r => setImmediate(r));
  const old=h.maps[0];
  h.run('COMMAND.demo=false; renderCommand()');
  await new Promise(r => setImmediate(r));
  old.load(); reject(new Error('old camera'));
  await new Promise(r => setImmediate(r));
  assert.equal(old.layers.length,0);
  assert.equal(h.run('cmdFeats'),null);
  assert.match(h.$('#cmdCams').innerHTML,/待提供/);
  assert.doesNotMatch(h.$('#cmdCams').innerHTML,/失敗/);
});

test('跨年活動下僅 preview=1 出現指揮面板入口', () => {
  for (const search of ['', '?preview=0', '?preview', '?preview=1']) {
    const h=harness(search);
    h.ctx.ACTIVITIES=[{id:'1151231',title:'跨年',date:'2026-12-31',hidden:true,place:'市府',lanes:[],items:[]},
      {id:'other',title:'其他活動',date:'2026-12-31',place:'市府',lanes:[],items:[]}];
    h.ctx.amaps={}; h.ctx.dayN=s => Date.parse(s)/86400000;
    h.load('activity.js'); h.run('renderActivity()');
    const html=h.$('#view').innerHTML;
    assert.equal((html.match(/開啟指揮面板/g)||[]).length,0);   // 2026-10-19 入口改成活動看板的「戰情室」分頁，卡片內的按鈕拿掉
  }
});

test('正式部分資料與缺欄位不崩潰，不顯示 NaN 或誤判零件事件', async () => {
  const h=harness();
  h.run(`COMMAND.demo=false; COMMAND.live={stats:{ems:0},issues:[{title:'正式事件'}],social:[{text:'正式輿情'}],phases:[{}],cars:[{}]}; renderCommand()`);
  await new Promise(r => setImmediate(r));
  assert.doesNotThrow(() => h.maps[0].load());
  assert.equal(h.pins.length,0);
  assert.match(h.$('#cmdNums').innerHTML,/<b>0<\/b>/);
  for (const id of ['cmdSide','cmdSocial','cmdPhase']) assert.doesNotMatch(h.$('#'+id).innerHTML,/NaN|undefined/);
  h.run('COMMAND.live = null; renderCommand()');
  assert.doesNotMatch(h.$('#cmdSide').innerHTML,/0 件/);
});

require('./command-weather.test.cjs');
test('天氣整合保留其他卡片且不呈現資料檔示意天氣', () => {
  const h=harness(); h.run('renderCommand()');
  assert.match(h.$('#view').innerHTML,/cmdWeatherWarning/);
  assert.match(h.$('#cmdNums').innerHTML,/id="cmdWeather"/);
  assert.match(h.$('#cmdNums').innerHTML,/救護出勤/);
  assert.doesNotMatch(h.$('#cmdNums').innerHTML,/16°C/);
});
test('正式缺時間與安全文字，天氣僅從即時來源取得', () => {
  const h=harness();
  h.run(`COMMAND.demo=false; COMMAND.live={weather:{temp:0,rain:0,sky:'<img src=x>',wind:'東風'},issues:[{title:'<script>',level:'red'}],social:[{text:'<img src=x>'}]}; renderCommand()`);
  assert.match(h.$('#cmdSide').innerHTML,/<span class="cmdago">待提供<\/span>/);
  assert.doesNotMatch(h.$('#cmdSocial').innerHTML,/待提供 分鐘/);
  assert.doesNotMatch(h.$('#cmdNums').innerHTML,/0°C|0%/);
  assert.doesNotMatch(h.$('#cmdSide').innerHTML+h.$('#cmdSocial').innerHTML+h.$('#cmdNums').innerHTML,/<script>|<img/);
});

test('舊播放器狀態回呼不得寫入新畫面', async () => {
  const h=harness(); let report;
  h.ctx.cctvNear=() => [{name:'影像',url:'test'}];
  h.ctx.cctvPlay=(_,__,callback) => {report=callback;};
  h.$('#cmdCams').querySelectorAll=() => [{}];
  h.run('renderCommand()');
  await new Promise(r => setImmediate(r));
  h.run('COMMAND.demo=false; renderCommand()');
  h.$('#cmdCs0').textContent='待提供';
  report('舊影像狀態');
  assert.equal(h.$('#cmdCs0').textContent,'待提供');
});

test('正式資料與示意陣列隔離，僅明確 true 啟用示意', () => {
  const h=harness();
  assert.ok(h.run('typeof cmdData === "function"'), '需要明確的雙模式資料選擇器');
  assert.ok(h.run('cmdData().issues.length > 0'));
  h.run('COMMAND.demo = false');
  assert.equal(h.run('cmdData().issues.length'),0);
  assert.equal(h.run('cmdData().zones.length'),0);
  assert.equal(h.run('cmdData().stats.ems'),undefined);
  h.run('COMMAND.live.issues = [{title:"正式事件"}]');
  assert.equal(h.run('cmdData().issues[0].title'),'正式事件');
  h.run('COMMAND.demo = "true"');
  assert.equal(h.run('cmdData().issues[0].title'),'正式事件');
});

test('10/31 同志遊行：?cmd=pride 用真資料、未回報燈號灰色、畫遊行路線、階段全算當天', async () => {
  const h = harness('?preview=1&cmd=pride&cmdnow=2026-10-31T15:00');
  assert.equal(h.run('COMMAND.key'), 'pride');
  assert.equal(h.run('cmdData().demo'), false);
  assert.equal(h.run('cmdData().zones.length'), 4);
  assert.equal(h.run('cmdData().routes.length'), 2);
  h.run('renderCommand()'); await new Promise(r => setImmediate(r));
  assert.match(h.$('#cmdNums').innerHTML, /待回報/);
  const map = h.maps.at(-1); map.load();
  assert.ok(map.sources.cmdroutes);
  assert.equal(h.run('cmdPhase()'), 1);
});
