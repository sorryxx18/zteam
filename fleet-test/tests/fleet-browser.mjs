// 隔離瀏覽器測試：定位資料為合成案例，不寫入正式後端。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 48761, debug = 48762;
const base = process.env.FLEET_TEST_URL || `http://127.0.0.1:${port}/fleet-test/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-browser-'));
const server = spawn('/usr/bin/python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--mute-audio', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, mode = 'success', exceptions = [], checks = 0;
const timer = setTimeout(() => { console.error('瀏覽器測試逾時'); cleanup(1); }, 150000);
function cleanup(code) {
  clearTimeout(timer);
  if (ws) ws.close();
  chrome.kill('SIGKILL'); server.kill('SIGKILL');
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(code); }, 400);
}
try {
  let tabs;
  for (let i = 0; i < 50; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${debug}/json`)).json(); if (tabs.length) break; } catch {}
    await sleep(200);
  }
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  function fixture() {
    const now = Date.now();
    const track = [[25.033,121.564,now-600000],[25.0331,121.564,now-590000],[25.0333,121.564,now-580000],[25.034,121.564,now-100000],[25.0343,121.564,now-90000]];
    const car = (device, age, acc) => ({ device, last: { lat:25.0343,lng:121.564,t:now-age,acc,speed:4.5,batt:80 }, track });
    return { ok:true,now,cars:[car('定位測試',10000,78.2),car('過期測試',360000,10),car('正常測試',10000,10)] };
  }
  ws.onmessage = async e => {
    const d = JSON.parse(e.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(Error(d.error.message)) : p.resolve(d.result); }
    if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Fetch.requestPaused') {
      const requestId = d.params.requestId;
      if (mode === 'failure') await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      else await send('Fetch.fulfillRequest', { requestId, responseCode:200, responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}], body:Buffer.from(JSON.stringify(mode === 'empty' ? {ok:true,cars:[]} : fixture())).toString('base64') });
    }
  };
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const until = async (expression) => {
    for (let i=0;i<160;i++) { if (await ev(expression)) return; await sleep(200); }
    throw Error('等待失敗: '+expression);
  };
  const check = (value, message) => { assert.ok(value, message); checks++; console.log('✓ '+message); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns:[{urlPattern:'*script.google.com/macros/s/*'}] });
  for (const name of ['index.html','3d.html']) {
    exceptions = []; mode = 'success';
    await send('Emulation.setDeviceMetricsOverride', { width:1280,height:900,deviceScaleFactor:1,mobile:false });
    await send('Page.navigate', { url:new URL(name, base).href });
    await until(`document.body.innerText.includes('資料更新')`);
    check(await ev(`document.body.innerText.includes('定位不準') && document.body.innerText.includes('定位已過期')`), name+' 定位品質／過期狀態可見');
    const lengths = await ev(name === 'index.html' ? `layers['定位測試'].line.getLatLngs().map(x=>x.length)` : `map.getSource('tracks')._data.features.filter(f=>f.properties.device==='定位測試').map(f=>f.geometry.coordinates.length)`);
    check(JSON.stringify(lengths)==='[2,2]', name+' 25公尺取樣且5分鐘斷線');
    await ev(`document.querySelector('[data-d="定位測試"]').click()`);
    await until(`!!document.querySelector('${name==='index.html'?'.leaflet-popup-content':'.maplibregl-popup-content'}')`);
    check(await ev(`(()=>{const t=document.querySelector('${name==='index.html'?'.leaflet-popup-content':'.maplibregl-popup-content'}').innerText;return t.includes('定位不準')&&!t.includes('km/h')})()`), name+' 低精確度彈窗隱藏速度');
    mode = 'failure'; await ev('load()');
    check(await ev(`document.querySelector('#upd').textContent.includes('讀取失敗') && document.body.innerText.includes('定位測試')`), name+' 失敗保留舊車輛與失敗標示');
    mode = 'empty'; await ev('load()');
    await until(`!document.body.innerText.includes('定位測試')`);
    check(await ev(`document.body.innerText.includes('沒有近期資料')`), name+' 空資料不是讀取失敗且移除過期圖示');
    check(await ev(name==='index.html'?`Object.keys(layers).length===0`:`Object.keys(markers).length===0 && map.getSource('tracks')._data.features.length===0`), name+' 圖層清除');
    await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await sleep(250);
    mode='success'; await ev('load()');
    check(await ev('document.documentElement.scrollWidth<=window.innerWidth'), name+' 手機無橫向溢出');
    check(await ev(`document.querySelector('#map').getBoundingClientRect().top >= document.querySelector('header').getBoundingClientRect().bottom - 1`), name+' 手機地圖不遮住多行更新狀態');
    fs.mkdirSync('/tmp/zteam-fleet-qa', {recursive:true});
    const shot = await send('Page.captureScreenshot', {format:'png'});
    fs.writeFileSync('/tmp/zteam-fleet-qa/'+name+'.png', Buffer.from(shot.data,'base64'));
    mode='failure';
    await send('Page.reload', {ignoreCache:true});
    await until(`document.querySelector('#upd')?.textContent.includes('讀取失敗')`);
    check(await ev(`document.body.innerText.includes('尚無可顯示資料') && !document.body.innerText.includes('載入中')`), name+' 初次離線不一直顯示載入中');
    check(exceptions.length===0, name+' 無未捕捉JavaScript例外: '+exceptions.join(';'));
  }
  console.log(`全部 ${checks} 項瀏覽器檢查通過（合成資料，非正式定位回報驗收）`);
  cleanup(0);
} catch(e) { console.error(e.stack); cleanup(1); }
