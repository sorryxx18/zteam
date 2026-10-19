const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../command.js'),'utf8');
const NOW=Date.parse('2026-10-19T10:00:00+08:00');
const item=(extra={})=>({t:'2026/10/19 09:30:08',kind:'救護',code:'',status:'已出勤',place:'臺北市大安區羅斯福路123號5樓',lat:25.02403,lng:121.52481,district:'大安區',...extra});
function harness(){
 const nodes=new Map(),intervals=new Map(),timeouts=new Map(),events=new Map(),marks=[];let seq=0,observer;
 const node=()=>({innerHTML:'',textContent:'',isConnected:true,addEventListener(n,f){this[n]=f},setAttribute(n,v){this[n]=v}});
 for(const id of ['#cmd','#view','#cmd119','#cmd119Scope','#cmdSide','#cmdFull','#cmdLive','#cmdMap'])nodes.set(id,node());
 class Clock extends Date{static now(){return NOW}}
 const ctx=vm.createContext({console,Date:Clock,Intl,URLSearchParams,AbortController,location:{search:''},COMMAND:{c119:{url:'https://worker.example/cases',districts:['大安區','信義區','南港區'],refresh:60000}},
 $:s=>nodes.get(s)||null,esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),document:{createElement:node},
 setInterval:(fn,ms)=>{intervals.set(++seq,{fn,ms});return seq},clearInterval:id=>intervals.delete(id),setTimeout:(fn,ms)=>{timeouts.set(++seq,{fn,ms});return seq},clearTimeout:id=>timeouts.delete(id),
 window:{addEventListener:(n,f)=>{const prev=events.get(n);events.set(n,()=>{prev?.();f()})}},MutationObserver:class{constructor(fn){observer=this;this.fn=fn}observe(){}disconnect(){this.disconnected=true}},
 maplibregl:{Marker:class{constructor({element}){this.element=element;marks.push(this)}setLngLat(p){this.coords=p;return this}addTo(map){this.map=map;return this}remove(){this.removed=true}}},
 fetch:async()=>({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})})});
 vm.runInContext(source,ctx);
 return {ctx,nodes,intervals,timeouts,events,marks,get observer(){return observer},run:s=>vm.runInContext(s,ctx)};
}
test('地址只有行政區時仍在三區清單，未知或互相矛盾的區不混入',()=>{
 const h=harness();h.ctx.payload={ok:true,cases:[item({place:'臺北市大安區'}),item({district:'中山區'}),item({place:'未知',district:'未知'})]};
 const list=h.run('cmd119Visible(cmd119Model(payload),false)');assert.equal(list.length,1);assert.equal(list[0].place,'位置待提供');
});
test('逾時解除載入且abort；重疊舊回應、離頁晚到回應與舊map均不可污染',async()=>{
 const h=harness(),pending=[],signals=[];
 h.ctx.fetch=(_,o)=>{signals.push(o.signal);return new Promise(resolve=>pending.push(resolve))};
 const first=h.run('cmd119Start()');assert.equal(h.timeouts.size,1);
 for(const {fn} of [...h.timeouts.values()])fn();await first;assert.ok(signals[0].aborted);assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);
 const old=h.run('cmd119Update()'),fresh=h.run('cmd119Update()');assert.ok(signals[1].aborted);
 pending[2]({ok:true,json:async()=>({ok:true,fetchedAt:NOW,stale:true,cases:[item({kind:'火災'})]})});await fresh;assert.match(h.nodes.get('#cmd119').innerHTML,/資料可能延遲/);
 pending[1]({ok:true,json:async()=>({ok:true,cases:[]})});await old;assert.match(h.nodes.get('#cmd119').innerHTML,/火災/);
 const late=h.run('cmd119Update()');h.events.get('pagehide')();assert.ok(signals[3].aborted);assert.equal(h.intervals.size,0);await late;assert.equal(h.timeouts.size,0);
 h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:false})});await h.run('cmd119Start()');h.ctx.oldmap={};h.ctx.newmap={};h.run('cmdMapObj=newmap;cmd119MapReady(oldmap)');assert.equal(h.run('cmd119Session.map'),undefined);
 pending[3]({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})});await new Promise(r=>setImmediate(r));assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);h.run('cmd119Stop()');
});
test('無效座標不畫點也不能flyTo，但案件仍列出；失敗清掉已存在標記',async()=>{
 const h=harness();h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item(),...[null,'',0,Infinity,NaN,26].map(lat=>item({lat}))]})});
 const flights=[];h.ctx.map={flyTo:x=>flights.push(x)};await h.run('cmd119Start()');h.run('cmdMapObj=map;cmd119MapReady(map)');assert.equal(h.marks.length,1);assert.equal((h.nodes.get('#cmd119').innerHTML.match(/data-cmd119=/g)||[]).length,7);
 h.nodes.get('#cmd').click({target:{closest:()=>({dataset:{cmd119:'1'}})}});assert.equal(flights.length,0);
 h.ctx.fetch=async()=>({ok:false});await h.run('cmd119Update()');assert.ok(h.marks.every(m=>m.removed));assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);h.run('cmd119Stop()');
});
test('地址防線拒絕夾帶門牌後才出現路字的偽路名',()=>{
 const h=harness();h.ctx.payload={ok:true,cases:[item({place:'臺北市大安區123號某路'}),item({place:'臺北市大安區和平東路2段123號'}),item({place:'臺北市大安區信義路99弄1號'})]};
 const m=h.run('cmd119Model(payload)');assert.equal(m.cases[0].place,'位置待提供');assert.equal(m.cases[1].place,'臺北市大安區和平東路2段');assert.equal(m.cases[2].place,'臺北市大安區信義路');assert.doesNotMatch(JSON.stringify(m),/123號|99弄/);
});
test('窄版與地圖容器樣式限於cmd，119點有分類樣式',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');
 for(const rule of [/\.cmd \.cmdmapwrap\s*\{[^}]*min-height:\s*0/,/\.cmd \.cmdmapwrap > \.cmdmap\s*\{[^}]*height:\s*100%/,/\.cmd \.cmd119-row\s*\{[^}]*overflow-wrap:\s*anywhere/,/\.cmd \.amappin\.c119\.fire/,/\.cmd \.amappin\.c119\.ems/,/\.cmd \.amappin\.c119\.other/])assert.match(css,rule);
});
test('renderCommand掛載119區塊、地圖load接點、側欄重畫保留資料及清理舊session',async()=>{
 const h=harness();let map,calls=0;
 h.ctx.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})}};
 h.ctx.amapLoad=async()=>{};h.ctx.amapStyle=async()=>({});h.ctx.maplibregl.NavigationControl=class{};
 h.ctx.maplibregl.Map=class{constructor(){map=this}addControl(){}once(_,fn){this.load=fn}resize(){}remove(){this.removed=true}};
 h.ctx.cctvStopIn=()=>{};
 h.run(`cmdData=()=>({demo:false,stats:{},center:[25,121],zoom:14,zones:[],issues:[],social:[],posts:[]});cmdTick=cmdNumsDraw=cmdSocialDraw=cmdLiveDraw=cmdCamsDraw=cmdWeatherStart=()=>{};renderCommand()`);
 await new Promise(r=>setImmediate(r));
 assert.match(h.nodes.get('#view').innerHTML,/cmd119Scope/);assert.match(h.run('$("#cmdSide")?.innerHTML || ""'),/cmd119/);
 map.load();assert.equal(h.marks.filter(m=>!m.removed).length,1);
 h.run('cmdSideDraw()');assert.match(h.nodes.get('#cmd119').innerHTML,/09:30/);
 const old=map;h.run('renderCommand()');await new Promise(r=>setImmediate(r));assert.ok(old.removed);assert.ok(h.marks[0].removed);assert.equal([...h.intervals.values()].filter(x=>x.ms===60000).length,1);assert.equal(calls,1,'同一面板重畫不得多抓一次');h.run('cmd119Stop()');
});
test('資料先到或地圖先到都畫點；全市切換、點清單flyTo、安全標籤與重畫移除',async()=>{
 for(const early of [true,false]){
 const h=harness();let release;h.ctx.fetch=()=>new Promise(r=>release=r);const p=h.run('cmd119Start()');
 const flights=[];h.ctx.map={flyTo:o=>flights.push(o)};h.run('cmdMapObj=map');
 if(early)h.run('cmd119MapReady(map)');
 release({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item({kind:'火災',status:'<b>已派遣</b>'}),item({lat:NaN}),item({place:'臺北市中山區中山北路',district:'中山區',kind:'其他'})]})});await p;
 if(!early){assert.equal(h.marks.length,0);h.run('cmd119MapReady(map)')}
 assert.equal(h.marks.filter(m=>!m.removed).length,1);assert.equal(h.marks.at(-1).element.className,'amappin c119 fire');assert.match(h.marks.at(-1).element.title,/09:30 火災/);assert.doesNotMatch(h.marks.at(-1).element.title,/123號/);assert.equal(h.marks.at(-1).element['aria-label'],h.marks.at(-1).element.title);
 h.nodes.get('#cmd').click({target:{closest:s=>s==='[data-cmd119]'?{dataset:{cmd119:'0'}}:null}});assert.deepEqual(Array.from(flights[0].center),[121.52481,25.02403]);
 h.nodes.get('#cmd119Scope').click();assert.equal(h.nodes.get('#cmd119Scope').textContent,'全市');assert.equal(h.marks.filter(m=>!m.removed).length,2);
 h.nodes.get('#cmd119Scope').click();assert.equal(h.marks.filter(m=>!m.removed).length,1);
 h.run('cmd119Stop()');assert.ok(h.marks.every(m=>m.removed));assert.equal(h.intervals.size,0);
 }
});
test('更新失敗隔離119、不留舊點；空URL不發請求；重進離頁清理',async()=>{
 const h=harness();let calls=0;h.ctx.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})}};
 await h.run('cmd119Start()');assert.match(h.nodes.get('#cmd119').innerHTML,/09:30/);assert.equal(h.intervals.size,1);assert.equal([...h.intervals.values()][0].ms,60000);
 await h.run('cmd119Start()');assert.equal(h.intervals.size,1);assert.equal(calls,2);
 h.ctx.fetch=async()=>{throw Error('offline')};await h.run('cmd119Update()');assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);assert.doesNotMatch(h.nodes.get('#cmd119').innerHTML,/09:30/);
 h.nodes.get('#cmd').isConnected=false;h.observer.fn();assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);assert.ok(h.observer.disconnected);
 h.nodes.get('#cmd').isConnected=true;h.ctx.COMMAND.c119.url='';await h.run('cmd119Start()');assert.equal(calls,2);assert.equal(h.intervals.size,0);assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);h.events.get('pagehide')();assert.equal(h.run('cmd119Session'),null);
});
test('清單最多10件與剩餘數、來源時間、安全HTML、空清單及延遲',()=>{
 const h=harness();h.ctx.payload={ok:true,fetchedAt:NOW-180000,cases:Array.from({length:12},(_,i)=>item({kind:i?'救護':'火災',status:'<svg onload="evil()">'}))};
 h.run('cmd119Session={root:$("#cmd"),model:cmd119Model(payload),city:false,marks:[]};cmd119Draw()');
 let html=h.nodes.get('#cmd119').innerHTML;assert.equal((html.match(/data-cmd119=/g)||[]).length,10);assert.match(html,/還有 2 件/);assert.match(html,/資料可能延遲/);assert.match(html,/09:57/);assert.match(html,/noopener noreferrer/);assert.match(html,/每分鐘更新/);assert.match(html,/&lt;svg/);assert.doesNotMatch(html,/<svg|123號/);
 h.run('cmd119Session.model.cases=[];cmd119Draw()');assert.match(h.nodes.get('#cmd119').innerHTML,/目前無案件/);
 h.run('cmd119Session.model=null;cmd119Draw()');assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);
});
test('三區篩選、火災優先後依時間降冪；全市不信任偽造district',()=>{
 const h=harness();h.ctx.payload={ok:true,cases:[item(),item({kind:'火災',t:'2026/10/19 09:00:00'}),item({t:'2026/10/19 09:59:00'}),item({place:'臺北市中山區中山北路',district:'中山區'}),item({place:'臺北市中山區中山北路',district:'大安區'})]};
 h.run('model=cmd119Model(payload)');const list=h.run('cmd119Visible(model,false)');assert.equal(list.length,3);assert.equal(list[0].kind,'火災');assert.ok(list[1].t>list[2].t);assert.equal(h.run('cmd119Visible(model,true).length'),5);
});
test('只消費Worker白名單、不讀raw精確欄位；地址降階到路段',()=>{
 const h=harness();const raw=item();for(const k of ['csPlace','csX','csY'])Object.defineProperty(raw,k,{get(){throw Error('不得讀raw')}});
 h.ctx.payload={ok:true,fetchedAt:NOW,cases:[raw,item({place:'臺北市信義區信義路五段99號',district:'信義區',lat:'25',lng:Infinity}),item({place:'<img onerror=alert(1)>',district:'信義區'})]};
 const m=h.run('cmd119Model(payload)');assert.equal(m.cases[0].place,'臺北市大安區羅斯福路');assert.equal(m.cases[1].place,'臺北市信義區信義路五段');assert.equal(m.cases[1].lat,null);assert.equal(m.cases[1].lng,null);assert.equal(m.cases[2].place,'位置待提供');assert.doesNotMatch(JSON.stringify(m),/123號|99號|csPlace|csX|csY|onerror/);
});
