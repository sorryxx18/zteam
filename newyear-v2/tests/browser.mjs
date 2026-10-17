// 隔離瀏覽器測試：定位資料為合成案例，不寫入正式後端。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 48901, debug = 48902;
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


  function fixture(){const t=Date.now()-360000;return {ok:true,cars:[{device:'QA-CAR',last:{lat:25.035,lng:121.565,t,acc:78,speed:4},track:[]},{device:'QA-NEIGHBOR',last:{lat:25.0351,lng:121.5655,t,acc:10,speed:0},track:[]}]};}
  const data={event:'1151231',preview:true,bounds:[[25.028,121.555],[25.046,121.576]],livestream:null,
   areas:[{name:'隔離測試區域',source:'隔離合成案例',geometry:{type:'Polygon',coordinates:[[[121.56,25.03],[121.57,25.03],[121.57,25.04],[121.56,25.04],[121.56,25.03]]]}}],
   stations:[{name:'隔離測試進駐點',unit:'合成中隊',vehicles:'QA-CAR',personnel:3,contact:'隔離測試無真實電話',lat:25.035,lng:121.565,source:'隔離合成案例'}]};
  ws.onmessage=async e=>{
   const d=JSON.parse(e.data);
   if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}
   if(d.method==='Runtime.exceptionThrown')exceptions.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);
   if(d.method==='Fetch.requestPaused'){
    const requestId=d.params.requestId,r=d.params.request;let body,content='application/json';
    if(r.url.includes('newyear-v2/data.js')){content='application/javascript';body='window.NYE_DATA='+JSON.stringify(data)+';';}
    else if(r.url.includes('CCTVByLBS'))body=JSON.stringify({locations:Array.from({length:15},(_,i)=>({cctvId:String(i),cctvName:'合成路口'+i,lat:25.035+i*0.0001,lng:121.565,roadType:'平面道路',videoStreamURL:'https://cctv.gov.taipei/test'+i+'.m3u8'}))});
    else {const action=JSON.parse(r.postData||'{}').action;
     if(action!=='fleet_data'){writes++;body=JSON.stringify({ok:false,error:'測試拒絕任何非定位查詢'});}
     else if(mode==='failure'){await send('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'});return;}
     else body=JSON.stringify(mode==='empty'?{ok:true,cars:[]}:fixture());
    }
    await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:content},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(body).toString('base64')});
   }
  };
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const until=async expression=>{for(let i=0;i<140;i++){if(await ev(expression))return;await sleep(200);}throw Error('等待失敗: '+expression);};
  const check=(v,m)=>{assert.ok(v,m);checks++;console.log('✓ '+m);};
  await send('Runtime.enable');await send('Page.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*script.google.com*'},{urlPattern:'*CCTVByLBS*'},{urlPattern:'*newyear-v2/data.js*'}]});
  await send('Page.navigate',{url:base});
  await until(`typeof v2!=='undefined'&&v2.cameras.length===15&&typeof feed!=='undefined'&&feed.data?.cars.length===2`);
  check(await ev(`!!document.querySelector('link[href^="../style.css"]')&&!!document.querySelector('.brand .emblem')&&getComputedStyle(document.body).fontFamily.includes('Huninn')`),'實際共用原站樣式、隊徽與Huninn字體');
  check(await ev(`document.body.textContent.includes('115')&&document.body.textContent.includes('跨年')`),'活動脈絡位於整頁中，不是另一套地圖系統');
  check(await ev(`!document.querySelector('.panel-tabs')`),'勤務資訊不再拆成部署／車輛／影像切換分頁');
  check(await ev(`!document.querySelector('#layer-cameras').checked`),'初始主圖不被全部鏡頭淹沒');
  check(await ev(`document.querySelectorAll('#camera-catalog [data-camera]').length===15`),'所有鏡頭仍可在路口查找區找到，不縮成幾支');
  await ev(`document.querySelector('[data-vehicle="QA-CAR"]').click()`);
  check(await ev(`document.querySelector('#context-title').textContent.includes('QA-CAR')&&/過期|舊位置/.test(document.querySelector('#context-body').textContent)&&/78|不準|不足/.test(document.querySelector('#context-body').textContent)`),'選車同處顯示車號、過期及定位品質');
  check(await ev(`document.querySelectorAll('#nearby-cameras [data-watch]').length>0`),'選車帶出依最後定位找出的相關路口');
  await ev(`document.querySelector('#nearby-cameras [data-watch]').click()`);
  check(await ev(`!!document.querySelector('#video-dock video')&&document.querySelector('#context-title').textContent.includes('QA-CAR')`),'看相關影像時保留原車輛勤務，不跳離上下文');
  await ev(`document.querySelector('#camera-close').click()`);
  check(await ev(`document.querySelector('#video-dock').hidden&&cctvPlayers.size===0&&document.querySelector('#context-title').textContent.includes('QA-CAR')`),'關閉播放器保留所選勤務');
  await ev(`overview();selectStation(0)`);
  check(await ev(`document.querySelector('#context-body').textContent.includes('合成中隊')&&document.querySelector('#context-body').textContent.includes('隔離測試無真實電話')`),'進駐點同處顯示單位、人車與聯絡資料');
  check(await ev(`document.querySelector('#context-body').textContent.includes('QA-CAR')&&!document.querySelector('#context-body').textContent.includes('QA-NEIGHBOR')`),'編組只依明確車號，附近另一台不冒充指派');
  await ev(`selectArea(0)`);
  check(await ev(`document.querySelector('#context-body').textContent.includes('隔離測試進駐點')&&document.querySelector('#context-body').textContent.includes('QA-NEIGHBOR')`),'點區域同處整合範圍內進駐及最後定位車');
  await ev(`document.querySelector('#context-reset').click()`);
  check(await ev(`document.querySelector('#video-dock').hidden&&cctvPlayers.size===0&&!!document.querySelector('#overview-list [data-vehicle]')`),'返回全場恢復部署與車清單並釋放播放器');
  mode='failure';await ev(`feed.load(60)`);
  check(await ev(`feed.failed&&feed.data.cars.length===2&&/失敗/.test(document.querySelector('#feed-status').textContent)`),'唯讀定位失敗保留上次成功資料與失敗提示');
  mode='empty';await ev(`feed.load(60)`);
  check(await ev(`feed.data.cars.length===0&&!document.querySelector('#overview-list [data-vehicle]')`),'成功空資料不殘留舊車');
  mode='success';await ev(`feed.load(60)`);
  fs.mkdirSync('/tmp/nye-v2-qa',{recursive:true});
  for(const [width,height]of [[1440,1000],[390,844],[844,390]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});await sleep(300);
   await ev(`overview();selectVehicle('QA-CAR')`);
   check(await ev(`document.querySelectorAll('.selection-ring').length===1`),'所選地點始終在主圖有唯一高亮，不因圖層隱藏而失去位置');
   check(await ev(`document.documentElement.scrollWidth<=innerWidth`),`${width}×${height}無水平溢出`);
   check(await ev(`document.querySelector('#map').getBoundingClientRect().top>=document.querySelector('header').getBoundingClientRect().bottom`),`${width}×${height}主圖不蓋頁首`);
   if(width<=900)console.log('MOBILE_LAYOUT',await ev(`JSON.stringify({h:innerHeight,w:innerWidth,selected:document.body.className,map:document.querySelector('#map').getBoundingClientRect().toJSON(),panel:document.querySelector('.context-panel').getBoundingClientRect().toJSON(),title:document.querySelector('#context-title').getBoundingClientRect().toJSON()})`));
   if(width<=900)check(await ev(`(()=>{const m=document.querySelector('#map').getBoundingClientRect(),p=document.querySelector('.context-panel').getBoundingClientRect(),t=document.querySelector('#context-title').getBoundingClientRect();return m.top>=0&&m.bottom<=innerHeight&&(p.top>=m.bottom||p.left>=m.right)&&p.bottom<=innerHeight+1&&t.top>=0&&t.bottom<=innerHeight})()`),`${width}×${height}選取後地圖與所選勤務同屏可見，不必往下找`);
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(`/tmp/nye-v2-qa/${width}.png`,Buffer.from(shot.data,'base64'));
  }
  check(writes===0,'預覽未呼叫勤務API或其他寫入');
  check(exceptions.length===0,'無未捕捉JavaScript例外：'+exceptions.join(';'));
  console.log(`全部 ${checks} 項新版流程檢查通過；資料為隔離合成，未寫正式後端。`);cleanup(0);
}catch(e){console.error(e.stack);cleanup(1);}
