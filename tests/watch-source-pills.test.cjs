const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'watch.js'), 'utf8');
function page() {
  const nodes = Object.fromEntries(['#view', '#wBox', '#wList', '#wReload'].map(k => [k, { innerHTML: '', listeners: {}, addEventListener(n, f) { this.listeners[n] = f; }, scrollIntoView() {} }]));
  const ctx = vm.createContext({ console, URL, Intl, Date, AbortSignal, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, location: { pathname: '/' }, document: { addEventListener() {}, querySelectorAll() { return []; } }, $: k => nodes[k], esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), fetch: async () => ({ text: async () => '' }) });
  vm.runInContext(source, ctx);
  vm.runInContext('watch={ok:true,days:1,now:Date.now(),at:Date.now(),lastFetch:{news:Date.now()-181*60000,threads:Date.now(),fb:Date.now()},items:[]};Object.assign(watchF,{days:"0.25",src:"",loc:"",q:""});drawWatchList=()=>{};renderWatch()', ctx);
  return { ctx, nodes, html: () => nodes['#wBox'].innerHTML };
}
test('sources render as native pills and keep click-again-to-clear for both source and locality', () => {
  const p = page();
  assert.match(p.html(), /<button class="ghost chip wsource[^\"]*"[^>]*data-k="src" data-v="news"/);
  assert.equal((p.html().match(/class="ghost chip wsource/g) || []).length, 4);
  assert.doesNotMatch(p.html(), /class="card stat[^\"]*"[^>]*data-k=/);
  for (const [k, v] of [['src', 'news'], ['src', 'threads'], ['src', 'fb'], ['loc', '1']]) {
    const button = { dataset: { k, v }, classList: { contains: c => c === 'wsource' } };
    const event = { target: { closest: selector => selector === '[data-k]' ? button : null } };
    p.nodes['#wBox'].listeners.click(event);
    assert.equal(vm.runInContext(`watchF.${k}`, p.ctx), v);
    p.nodes['#wBox'].listeners.click(event);
    assert.equal(vm.runInContext(`watchF.${k}`, p.ctx), '');
  }
});
test('with a local event, summary order is heading, verdict, cards, populated highlights, tools', () => {
  const p = page();
  vm.runInContext('watch.items=[{s:"news",x:"臺北市大安區仁愛路住宅起火",u:"https://example.invalid/test",o:"測試",t:Date.now()-60000}].map(wTier);drawWatch()',p.ctx);
  const html = p.html();
  const positions = ['class="wsumhead"', 'class="wverdict', 'class="grid wstats wsumgrid"', 'class="wsumlist"', 'class="wtools"'].map(s => html.indexOf(s));
  assert.ok(positions.every((n, i) => n >= 0 && (!i || n > positions[i - 1])), positions.join(','));
  assert.match(html, /<ul class="wsumlist"><li>.*臺北市大安區仁愛路住宅起火/);
});
test('verdict and all data/status messages match fixed approved text, independently of git', () => {
  const now=Date.parse('2026-10-20T12:00:00+08:00');
  const scenarios=[
    {items:[],verdict:'✅轄區、臺北市都沒事件'},
    {items:[{s:'news',x:'臺北市大安區住宅起火'}],verdict:'🚨轄區 1 件：臺北市大安區住宅起火（1 分鐘前）'},
    {items:[{s:'threads',x:'臺北市大安區住宅起火'}],verdict:'⚠️轄區 1 件（未證實）：臺北市大安區住宅起火（1 分鐘前）'},
    {items:[{s:'news',x:'臺北市內湖區住宅起火'}],verdict:'🚨轄區沒事件；臺北市 1 件：臺北市內湖區住宅起火（1 分鐘前）'},
  ];
  for(const row of scenarios){
    const p=page(); p.ctx.Date=class extends Date {static now(){return now;}};
    const items=row.items.map(i=>({...i,t:now-60000,u:'https://example.invalid/test',o:'測試'}));
    vm.runInContext(`watch.items=${JSON.stringify(items)}.map(wTier);watch.now=${now};drawWatch()`,p.ctx);
    const actual=p.html().match(/<p class="wverdict[^>]*>(.*?)<span class="wupd/)[1].replace(/<[^>]+>/g,'');
    assert.equal(actual,row.verdict);
  }
  const statuses=[
    {state:'',wake:0,made:now,text:'資料 12:00・每 5 分鐘自動更新'},
    {state:'error',wake:0,made:now,text:'⚠️ 暫時連不上，下面是 12:00 的資料，會自動重試'},
    {state:'',wake:1,made:now,text:'😴 系統值宿休眠中，叫醒重新抓取…'},
    {state:'loading',wake:0,made:now,text:'🔄 資料載入中…'},
    {state:'',wake:0,made:Date.parse('2026-10-20T11:40:00+08:00'),text:'⚠️ 11:40 之後的消息可能還沒進來，重大狀況請以 119 和無線電為準'},
  ];
  for(const row of statuses){
    const p=page();p.ctx.Date=class extends Date {static now(){return now;}};
    vm.runInContext(`watch.now=${row.made};watchState=${JSON.stringify(row.state)};watchWake=${row.wake};drawWatch()`,p.ctx);
    assert.equal(p.html().match(/<span class="wupd[^>]*>(.*?)<\/span>/)[1],row.text);
  }
});
test('source dates follow Taipei calendar: same day short, previous day dated, missing omitted', () => {
  const p=page(), now=Date.parse('2026-10-20T00:10:00+08:00');
  p.ctx.Date=class extends Date { static now() { return now; } };
  vm.runInContext(`watch.now=${now};watch.lastFetch={news:${now-30*60000},threads:${now-5*60000},fb:0};drawWatch()`,p.ctx);
  assert.match(p.html(), /data-source="news"[^>]*>新聞 10\/19\s+23:40<\/span>/);
  assert.match(p.html(), /data-source="threads"[^>]*>Threads 00:05<\/span>/);
  assert.doesNotMatch(p.html(), /data-source="fb"/);
  vm.runInContext('watch.lastFetch={news:0,threads:0,fb:0};drawWatch()',p.ctx);
  assert.doesNotMatch(p.html(), /class="note wsrcupd"/);
});
test('source timestamps are consolidated and only over-threshold sources get the hint', () => {
  const html = page().html();
  assert.match(html, /class="note wsrcupd"/);
  assert.match(html, /class="late"[^>]*data-source="news"[^>]*>新聞 (?:\d{1,2}\/\d{1,2}\s+)?\d{2}:\d{2}<\/span>/);
  assert.doesNotMatch(html, /class="late"[^>]*data-source="(?:threads|fb)"/);
  assert.match(html, /id="wSourceHint"[^>]*hidden>這個來源目前沒有新消息/);
  assert.doesNotMatch(html, /點數字卡/);
});
test('holding a stale timestamp shows the hint, while taps and scrolling cancel it', () => {
  const p = page(), box = p.nodes['#wBox'], hint = { hidden: true }, jobs = new Map();
  let id = 0;
  p.ctx.setTimeout = fn => { jobs.set(++id, fn); return id; };
  p.ctx.clearTimeout = key => jobs.delete(key);
  box.querySelector = () => hint;
  const target = { isConnected: true };
  const event = { clientX: 20, clientY: 20, target: { closest: () => target } };
  assert.equal(typeof box.listeners.pointerdown, 'function');
  box.listeners.pointerdown(event); box.listeners.pointerup(event);
  for (const fn of jobs.values()) fn();
  assert.equal(hint.hidden, true, 'a short tap must not show the tooltip');
  box.listeners.pointerdown(event);
  for (const fn of jobs.values()) fn(); jobs.clear();
  assert.equal(hint.hidden, false, 'long hold shows the requested text');
  box.listeners.pointerdown(event); box.listeners.pointermove({clientX:40,clientY:20});
  for (const fn of jobs.values()) fn();
  assert.equal(hint.hidden, true, 'scroll movement cancels the hold');
});
test('reload retries with retained data show only the requested public-facing button text', async () => {
  const p=page(), messages=[];
  Object.defineProperty(p.nodes['#wReload'],'textContent',{set: text=>messages.push(text)});
  p.ctx.setTimeout=fn=>{fn();return 1;};
  vm.runInContext('let attempts=0;watchFetch=async()=>{if(++attempts<=2)throw new Error("temporary");return {ok:true,items:[],lastFetch:{},now:Date.now()};}',p.ctx);
  await vm.runInContext('loadWatch(1)',p.ctx);
  assert.deepEqual(messages,['自動重試中（1）…','自動重試中（2）…']);
  assert.equal(vm.runInContext('watchState',p.ctx),'');
});
test('initial loading, retry and failure screens avoid internal service terminology', () => {
  const p = page();
  for (const [state, retry] of [['loading', 0], ['loading', 1], ['error', 0]]) {
    vm.runInContext(`watch=null;watchState="${state}";watchTry=${retry};drawWatch()`, p.ctx);
    assert.doesNotMatch(p.html(), /快取|GAS|採集|後端/i);
  }
});
test('75/120/180-minute limits stay unchanged and only the source beyond its limit turns orange', () => {
  const p=page(), now=Date.now();
  p.ctx.Date=class extends Date { static now() { return now; } };
  const limits={news:180,threads:75,fb:120};
  const reset=()=>vm.runInContext(`watch.lastFetch={news:${now-180*60000},threads:${now-75*60000},fb:${now-120*60000}};drawWatch()`,p.ctx);
  reset();assert.doesNotMatch(p.html(), /class="late"/);
  for(const [key,limit] of Object.entries(limits)) {
    reset();vm.runInContext(`watch.lastFetch.${key}=${now-limit*60000-1};drawWatch()`,p.ctx);
    assert.equal((p.html().match(/class="late"/g)||[]).length,1);
    assert.ok(p.html().includes(`class="late" data-source="${key}"`));
  }
});
