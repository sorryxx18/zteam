// 隔離瀏覽器測試：定位資料為合成案例，不寫入正式後端。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 48881, debug = 48882;
const base = process.env.OPS_TEST_URL || `http://127.0.0.1:${port}/newyear/`;
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


  ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}if(d.method==='Runtime.exceptionThrown')exceptions.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);};
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await ev(expression))return;await sleep(200);}throw Error('等待失敗: '+expression);};
  await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:base});
  await until(`typeof app!=='undefined'&&app.cameras.length>0&&typeof feed!=='undefined'&&!!feed.data`);
  console.log('REAL_FEED',await ev(`JSON.stringify({cameras:app.cameras.length,cars:feed.data.cars.length,message:feed.message(),statusLoaded:app.statusLoaded})`));
  if(process.env.OPS_REQUIRE_BACKEND==='1'){await until('app.statusLoaded');assert.equal(await ev('app.canEdit'),false,'anonymous runtime cannot edit');console.log('PUBLIC_STATUS_API_OK');}
  for(const id of ['133','257','277']){
    await ev(`selectCamera('${id}')`);
    try{
      await until(`document.querySelector('#video-player')?.readyState>=2&&document.querySelector('#video-player').currentTime>1&&!document.querySelector('#video-player').paused`);
      const before=await ev(`document.querySelector('#video-player').currentTime`);await sleep(1200);
      const after=await ev(`document.querySelector('#video-player').currentTime`);assert.ok(after>before+.3,'video frame clock advances');
      console.log('LIVE_VIDEO_OK',await ev(`JSON.stringify({id:app.selected.id,name:document.querySelector('#inspector h2').textContent,currentTime:document.querySelector('#video-player').currentTime,ready:document.querySelector('#video-player').readyState,state:document.querySelector('#camera-state').textContent})`));
    }catch(e){throw Error(`官方攝影機 ${id} 未通過真實播放驗證: `+await ev(`document.querySelector('#camera-state').textContent`));}
  }
  fs.mkdirSync('/tmp/zteam-newyear-live',{recursive:true});let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/zteam-newyear-live/standalone.png',Buffer.from(shot.data,'base64'));
  await ev('closeInspector()');assert.equal(await ev('cctvPlayers.size'),0,'all players stopped');
  assert.equal(exceptions.length,0,'runtime exceptions: '+exceptions.join(';'));
  console.log('真實官方影像與獨立勤務測試頁定位讀取通過；未攔截API、未寫正式勤務資料。');cleanup(0);
}catch(e){console.error(e.stack);cleanup(1);}
