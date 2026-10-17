// 隔離瀏覽器測試：定位資料為合成案例，不寫入正式後端。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 48861, debug = 48862;
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

  function fixture() {
    const now=Date.now(),track=[[25.033,121.564,now-600000],[25.0333,121.564,now-580000],[25.034,121.564,now-100000],[25.0343,121.564,now-90000]];
    return {ok:true,cars:[{device:'信義91測試',last:{lat:25.0343,lng:121.564,t:now-360000,acc:78.2,speed:4,batt:80},track}]};
  }
  ws.onmessage=async e=>{
    const d=JSON.parse(e.data);
    if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}
    if(d.method==='Runtime.exceptionThrown')exceptions.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);
    if(d.method==='Fetch.requestPaused'){
      const requestId=d.params.requestId,r=d.params.request;
      let data;
      if(r.url.includes('CCTVByLBS'))data={locations:Array.from({length:15},(_,i)=>({cctvId:String(i),cctvName:'合成路口'+i,lat:25.035+i*0.0001,lng:121.565,roadType:'平面道路',videoStreamURL:'https://cctv.gov.taipei/test'+i+'.m3u8'}))};
      else{
        const body=JSON.parse(r.postData||'{}');
        if(body.action==='fleet_data'){
          if(mode==='failure'){await send('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'});return;}
          data=mode==='empty'?{ok:true,cars:[]}:fixture();
        }else if(body.action==='ops_status_set'){writes++;saved=body.status;data={ok:true};}
        else data={ok:true,statuses:saved==='待命'?[]:[{device:'信義91測試',status:saved,updated_at:new Date().toISOString()}],canEdit:staff,options:['待命','出勤','返隊']};
      }
      await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
    }
  };
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const until=async expression=>{for(let i=0;i<180;i++){if(await ev(expression))return;await sleep(200);}throw Error('等待失敗: '+expression);};
  const check=(value,message)=>{assert.ok(value,message);checks++;console.log('✓ '+message);};
  await send('Runtime.enable');await send('Page.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*script.google.com/macros/s/*'},{urlPattern:'*itsapi.taipei.gov.tw/*'}]});
  await send('Page.navigate',{url:base});
  await until('document.readyState === "complete"');
  check(await ev(`document.title.includes('跨年勤務')`),'頁面以跨年勤務為主，不是獨立車隊頁');
  await until(`document.querySelector('#feed-status')?.textContent.includes('資料更新')`);
  await until('app.cameras.length===15');
  await ev('cfg.preview=false;loadStatuses()');
  check(await ev(`document.body.innerText.includes('正式管制資料待提供')&&document.body.innerText.includes('正式進駐資料待提供')`),'正式資料缺口明示，未偽造管制／人力部署');
  check(await ev(`document.querySelector('#recent-count').textContent.includes('0')`),'查詢成功不把過期車當成近期回報');
  await ev(`document.querySelector('#tab-cameras').click()`);
  check(await ev(`document.querySelectorAll('#list [data-camera]').length===15`),'整個範圍15支監視器皆列出，不受最近四支限制');
  await ev(`document.querySelector('[data-camera="0"]').click()`);
  check(await ev(`!!document.querySelector('#inspector video')`),'點監視器在詳情內開播放器');
  check(await ev(`document.querySelectorAll('.leaflet-marker-icon.chosen .camera-pin').length===1`),'選取的監視器在主圖上明確標示');
  await ev(`document.querySelector('#inspector-close').click()`);
  check(await ev(`cctvPlayers.size===0 && !document.querySelector('#inspector video')`),'關閉影像釋放播放器');
  await ev(`document.querySelector('#tab-fleet').click();document.querySelector('[data-device]').click()`);
  check(await ev(`document.querySelector('#inspector').innerText.includes('待命')&&document.querySelector('#inspector').innerText.includes('定位已過期')`),'人工待命與定位過期分開顯示');
  check(await ev(`document.querySelector('#duty-status').disabled`),'公開訪客不能提交勤務狀態');
  check(writes===0,'訪客流程無勤務寫入');
  staff=true;await ev('loadStatuses()');
  check(await ev(`!document.querySelector('#duty-status').disabled`),'已驗證幕僚可選取勤務狀態');
  await ev(`document.querySelector('#duty-status').value='出勤';document.querySelector('#duty-save').click()`);
  await until(`document.querySelector('#save-status')?.textContent.includes('已儲存')`);
  check(writes===1&&saved==='出勤','幕僚選取寫入後重新讀取確認，非僅本機儲存');
  mode='failure';await ev('loadFleet()');
  check(await ev(`document.querySelector('#feed-status').textContent.includes('讀取失敗')&&!!document.querySelector('[data-device]')`),'定位失敗保留上次成功資料並標示');
  mode='empty';await ev('loadFleet()');
  check(await ev(`app.vehicleLayers.size===0&&document.querySelector('#list').innerText.includes('沒有近期')`),'成功空資料清除舊車');
  await ev(`document.querySelector('#live-tab').click()`);
  check(await ev(`document.querySelector('#inspector').innerText.includes('尚未公布')&&!document.querySelector('#inspector iframe')`),'未公布的跨年直播不以舊影片冒充即時');
  fs.mkdirSync('/tmp/zteam-newyear-qa',{recursive:true});
  for(const [width,height] of [[1440,900],[390,844],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});
    await sleep(350);
    check(await ev('document.documentElement.scrollWidth<=window.innerWidth'),`${width}x${height}無橫向溢出`);
    check(await ev(`document.querySelector('#map').getBoundingClientRect().top>=document.querySelector('header').getBoundingClientRect().bottom-1`),`${width}x${height}地圖不遮頁首`);
    if(width===390){
      await ev(`selectCamera('0')`); await sleep(500);
      check(await ev(`(()=>{const c=app.cameras.find(c=>c.id==='0');return map.latLngToContainerPoint([c.lat,c.lng]).y+document.querySelector('#map').getBoundingClientRect().top<document.querySelector('#sidebar').getBoundingClientRect().top-10})()`),'手機選取路口不被底部詳情面板蓋住');
    }
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/zteam-newyear-qa/${width}.png`,Buffer.from(shot.data,'base64'));
  }
  check(exceptions.length===0,'無未捕捉JavaScript例外: '+exceptions.join(';'));
  console.log(`全部 ${checks} 項勤務頁檢查通過（定位及勤務資料為隔離合成案例，未寫正式後端）`);
  cleanup(0);
}catch(e){console.error(e.stack);cleanup(1);}
