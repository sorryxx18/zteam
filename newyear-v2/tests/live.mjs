// 真實官方影像及正式定位唯讀驗證，無攔截／無寫入。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 48911, debug = 48912;
const base = process.env.V2_TEST_URL || `http://127.0.0.1:${port}/newyear-v2/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-browser-'));
const server = spawn('/usr/bin/python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--mute-audio', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, mode = 'success', exceptions = [], checks = 0, staff=false, saved='待命', writes=0;
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



  const actions=[];
  ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}if(d.method==='Runtime.exceptionThrown')exceptions.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);if(d.method==='Network.requestWillBeSent'&&d.params.request.url.includes('script.google.com')&&d.params.request.method==='POST')actions.push(JSON.parse(d.params.request.postData||'{}').action);};
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const until=async expression=>{for(let i=0;i<180;i++){if(await ev(expression))return;await sleep(200);}throw Error('等待失敗: '+expression);};
  await send('Runtime.enable');await send('Network.enable');await send('Page.enable');await send('Page.navigate',{url:base});
  await until(`typeof v2!=='undefined'&&v2.cameras.length>0&&typeof feed!=='undefined'&&!!feed.data`);
  console.log('REAL_FEED',await ev(`JSON.stringify({cameras:v2.cameras.length,cars:feed.data.cars.length,message:feed.message()})`));
  for(const id of ['133','257','277']){
   await ev(`selectCamera('${id}')`);
   await until(`document.querySelector('#video-dock video')?.readyState>=2&&document.querySelector('#video-dock video').currentTime>1&&!document.querySelector('#video-dock video').paused`);
   const before=await ev(`document.querySelector('#video-dock video').currentTime`);await sleep(1000);
   const after=await ev(`document.querySelector('#video-dock video').currentTime`);assert.ok(after>before+.3,'video frame clock advances');
   console.log('LIVE_VIDEO_OK',await ev(`JSON.stringify({name:document.querySelector('#context-title').textContent,currentTime:document.querySelector('#video-dock video').currentTime,ready:document.querySelector('#video-dock video').readyState,state:document.querySelector('#video-status').textContent})`));
  }
  fs.mkdirSync('/tmp/nye-v2-live',{recursive:true});
  for(const [width,height]of [[1440,1000],[390,844]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});await sleep(300);
   const size=(await send('Page.getLayoutMetrics')).cssContentSize;
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.min(size.height,2400),scale:1}});
   fs.writeFileSync(`/tmp/nye-v2-live/${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await ev(`document.querySelector('#camera-close').click()`);assert.equal(await ev('cctvPlayers.size'),0,'player stopped');
  assert.ok(actions.length>0&&actions.every(a=>a==='fleet_data'),'only fleet_data readonly action: '+actions.join(','));
  assert.equal(exceptions.length,0,'runtime exceptions: '+exceptions.join(';'));
  console.log('公開真實串流、定位唯讀、播放器釋放通過；無合成資料／無勤務寫入。');cleanup(0);
}catch(e){console.error(e.stack);cleanup(1);}
