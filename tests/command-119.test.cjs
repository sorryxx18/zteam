const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../command.js'),'utf8');
const NOW=Date.parse('2026-10-19T10:00:00+08:00');
const item=(extra={})=>({t:'2026/10/19 09:30:08',kind:'救護',code:'',status:'已出勤',place:'臺北市大安區羅斯福路123號5樓',lat:25.02403,lng:121.52481,district:'大安區',...extra});
function harness(search='',now=NOW){
 const nodes=new Map(),intervals=new Map(),timeouts=new Map(),events=new Map(),marks=[];let seq=0,observer;
 const node=()=>({innerHTML:'',textContent:'',className:'',dataset:{},isConnected:true,scrolls:[],scrollIntoView(o){this.scrolls.push(o)},getBoundingClientRect(){return {top:20,bottom:400}},querySelectorAll(){return this.rows||[]},addEventListener(n,f){this[n]=f},setAttribute(n,v){this[n]=v},get classList(){return {toggle:(n,on)=>{const set=new Set(this.className.split(' ').filter(Boolean));on?set.add(n):set.delete(n);this.className=[...set].join(' ')},remove:n=>{this.className=this.className.split(' ').filter(x=>x!==n).join(' ')},add:n=>{this.className+=' '+n}}}});
 for(const id of ['#cmd','#view','#cmd119','#cmd119Bar','#cmd119Scope','#cmdSide','#cmdFull','#cmdLive','#cmdMap','#cmdClock','#cmdCount','#cmdPhase'])nodes.set(id,node());
 class Clock extends Date{static now(){return now}}
 const ctx=vm.createContext({console,Date:Clock,Intl,URLSearchParams,AbortController,location:{search},COMMAND:{demo:true,now:'2026-12-31T23:40',countdown:{name:'跨年',at:'2027-01-01T00:00:00'},phases:[{name:'進場',from:'16:00'},{name:'晚會高峰',from:'20:00'},{name:'煙火',from:'23:55'},{name:'散場',from:'00:10'},{name:'收場',from:'02:00'}],c119:{url:'https://worker.example/cases',districts:['大安區','信義區','南港區'],refresh:60000}},
 $:s=>nodes.get(s)||null,esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),document:{createElement:node},
 setInterval:(fn,ms)=>{intervals.set(++seq,{fn,ms});return seq},clearInterval:id=>intervals.delete(id),setTimeout:(fn,ms)=>{timeouts.set(++seq,{fn,ms});return seq},clearTimeout:id=>timeouts.delete(id),
 window:{innerHeight:844,innerWidth:1920,addEventListener:(n,f)=>{const prev=events.get(n);events.set(n,()=>{prev?.();f()})}},MutationObserver:class{constructor(fn){observer=this;this.fn=fn}observe(){}disconnect(){this.disconnected=true}},
 maplibregl:{Popup:class{constructor(o){this.options=o}setLngLat(p){this.coords=p;return this}setText(t){this.text=t;return this}addTo(map){this.map=map;return this}on(n,f){this[n]=f;return this}remove(){this.removed=true;this.close?.();return this}},Marker:class{constructor({element}){this.element=element;marks.push(this)}setLngLat(p){this.coords=p;return this}addTo(map){this.map=map;return this}remove(){this.removed=true}}},
 fetch:async()=>({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})})});
 vm.runInContext(source,ctx);
 return {ctx,nodes,intervals,timeouts,events,marks,advance:ms=>now+=ms,get observer(){return observer},run:s=>vm.runInContext(s,ctx)};
}
test('有火災整條案件列紅底，火災消失後恢復原底色',async()=>{
 const h=harness();h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item({kind:'火災'})]})});await h.run('cmd119Start()');assert.match(h.nodes.get('#cmd119Bar').className,/has-fire/);
 h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})});await h.run('cmd119Update()');assert.doesNotMatch(h.nodes.get('#cmd119Bar').className,/has-fire/);h.run('cmd119Stop()');
 const css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');assert.match(css,/\.cmd \.cmd119-bar\.has-fire\s*\{[^}]*background:\s*var\(--c-red\)/);
});
test('真實臺北時鐘與示意時間分離，12/31以前階段未開始、示意經過分鐘不歸零',()=>{
 const h=harness();h.run('cmdTick()');assert.equal(h.nodes.get('#cmdClock').textContent,'10:00:00');assert.equal(h.run('cmdReal()'),NOW);assert.equal(h.run('cmdPhase()'),-1);assert.match(h.nodes.get('#cmdPhase').innerHTML,/未開始/);assert.doesNotMatch(h.nodes.get('#cmdPhase').innerHTML,/class="on"/);assert.equal(h.run("cmdMins(cmdAt('2026-12-31T23:22'))"),18);
 assert.match(h.nodes.get('#cmdCount').textContent,/^距跨年 \d+ 天 \d{2}:\d{2}:\d{2}$/);
});
test('cmdnow僅覆寫真實時鐘並照速前進，跨年倒數與過午夜及01時邊界',()=>{
 const h=harness('?cmdnow=2026-12-31T23:59:30');h.run('cmdTick()');assert.equal(h.nodes.get('#cmdCount').textContent,'距跨年 00:00:30');assert.equal(h.run('cmdPhase()'),2);assert.equal(h.run("cmdMins(cmdAt('2026-12-31T23:22'))"),18);assert.match(h.nodes.get('#cmdCount').innerHTML,/cmdcount-seconds/);
 h.advance(30000);h.run('cmdTick()');assert.equal(h.nodes.get('#cmdCount').textContent,'🎆 新年快樂');h.advance(3600000);h.run('cmdTick()');assert.equal(h.nodes.get('#cmdCount').textContent,'跨年已結束');assert.equal(h.run('cmdPhase()'),3);
 const zone=harness('?cmdnow=2026-12-31T21:00:00%2B08:00');assert.equal(zone.run('cmdReal()'),Date.parse('2026-12-31T21:00:00+08:00'));assert.equal(zone.run('cmdPhase()'),1);
 const data=fs.readFileSync(path.join(__dirname,'../command-data.js'),'utf8');assert.match(data,/countdown: \{ name: "跨年", at: "2027-01-01T00:00:00" \}/);
});
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
 for(const rule of [/\.cmd \.cmdmapwrap\s*\{[^}]*min-height:\s*0/,/\.cmd \.cmdmapwrap > \.cmdmap\s*\{[^}]*height:\s*100%/,/\.cmd \.cmd119-row\s*\{[^}]*white-space:\s*nowrap/,/\.cmd \.cmd119-bar\s*\{[^}]*height:\s*auto/,/\.cmd \.cmd119-row\s*\{[^}]*min-height:\s*58px/,/\.cmd \.cmd119-summary\s*\{[^}]*260px/,/\.cmd \.cmd119 ul\s*\{[^}]*overflow-x:\s*auto/,/scroll-snap-type:\s*x/,/flex:\s*0 0 210px/,/\.cmd \.amappin\.c119\.fire/,/\.cmd \.amappin\.c119\.ems/,/\.cmd \.amappin\.c119\.other/])assert.match(css,rule);
});
test('renderCommand掛載119區塊、地圖load接點、側欄重畫保留資料及清理舊session',async()=>{
 const h=harness();let map,calls=0;
 h.ctx.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases:[item()]})}};
 h.ctx.amapLoad=async()=>{};h.ctx.amapStyle=async()=>({});h.ctx.maplibregl.NavigationControl=class{};
 h.ctx.maplibregl.Map=class{constructor(){map=this}addControl(){}once(_,fn){this.load=fn}resize(){}remove(){this.removed=true}};
 h.ctx.cctvStopIn=()=>{};
 h.run(`cmdData=()=>({demo:true,stats:{},center:[25,121],zoom:14,zones:[],issues:[],social:[],posts:[]});cmdTick=cmdNumsDraw=cmdSocialDraw=cmdLiveDraw=cmdCamsDraw=cmdWeatherStart=()=>{};renderCommand()`);
 await new Promise(r=>setImmediate(r));
 assert.match(h.nodes.get('#view').innerHTML,/id="cmdNums"[\s\S]*id="cmd119Bar"[\s\S]*class="cmdmain"/);assert.doesNotMatch(h.run('$("#cmdSide")?.innerHTML || ""'),/cmd119/);
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
 assert.equal(h.marks.filter(m=>!m.removed).length,2);assert.equal(h.nodes.get('#cmd119Scope').textContent,'只看轄區');h.nodes.get('#cmd119Scope').click();assert.equal(h.nodes.get('#cmd119Scope').textContent,'看全市');assert.equal(h.marks.filter(m=>!m.removed).length,1);assert.equal(h.marks.at(-1).element.className,'amappin c119 fire');assert.match(h.marks.at(-1).element.title,/09:30 火災/);assert.doesNotMatch(h.marks.at(-1).element.title,/123號/);assert.equal(h.marks.at(-1).element['aria-label'],h.marks.at(-1).element.title);
 h.nodes.get('#cmd').click({target:{closest:s=>s==='[data-cmd119]'?{dataset:{cmd119:'0'}}:null}});assert.deepEqual(Array.from(flights[0].center),[121.52481,25.02403]);
 h.nodes.get('#cmd119Scope').click();assert.equal(h.nodes.get('#cmd119Scope').textContent,'只看轄區');assert.equal(h.marks.filter(m=>!m.removed).length,2);
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
test('案件列全部列出、摘要計數與路名短標、來源時間、安全HTML、空清單及延遲',()=>{
 const h=harness();h.ctx.payload={ok:true,fetchedAt:NOW-180000,cases:Array.from({length:12},(_,i)=>item({kind:i?'救護':'火災',status:'<svg onload="evil()">'}))};
 h.run('cmd119Session={root:$("#cmd"),model:cmd119Model(payload),city:false,marks:[]};cmd119Draw()');
 let html=h.nodes.get('#cmd119').innerHTML;assert.equal((html.match(/data-cmd119=/g)||[]).length,12);assert.doesNotMatch(html,/還有 \d+ 件/);assert.match(html,/火災 1・救護 11・其他 0/);assert.match(html,/has-fire/);assert.match(html,/119 大安・信義・南港/);assert.match(html,/title="[^"]*臺北市大安區羅斯福路/);assert.match(html,/<span[^>]*>羅斯福路<\/span>/);assert.match(html,/資料可能延遲/);assert.match(html,/09:57/);assert.match(html,/noopener noreferrer/);assert.match(html,/&lt;svg/);assert.doesNotMatch(html,/<svg|123號/);
 h.run('cmd119Session.model.cases=[];cmd119Draw()');assert.match(h.nodes.get('#cmd119').innerHTML,/目前無案件/);
 h.run('cmd119Session.model=null;cmd119Draw()');assert.match(h.nodes.get('#cmd119').innerHTML,/119 資料暫時無法取得/);
});
test('三區篩選、火災優先後依時間降冪；全市不信任偽造district',()=>{
 const h=harness();h.ctx.payload={ok:true,cases:[item(),item({kind:'火災',t:'2026/10/19 09:00:00'}),item({t:'2026/10/19 09:59:00'}),item({place:'臺北市中山區中山北路',district:'中山區'}),item({place:'臺北市中山區中山北路',district:'大安區'})]};
 h.run('model=cmd119Model(payload)');const list=h.run('cmd119Visible(model,false)');assert.equal(list.length,3);assert.equal(list[0].kind,'火災');assert.ok(list[1].t>list[2].t);assert.equal(h.run('cmd119Visible(model,true).length'),5);
});
test('卡片與地圖選取共用zoom18、popup、捲動與119角標；關閉及空白地圖取消',async()=>{
 const h=harness(),flights=[],listeners={};h.ctx.map={flyTo:o=>flights.push(o),on:(n,f)=>listeners[n]=f,off:(n,f)=>{if(listeners[n]===f)delete listeners[n]}};
 await h.run('cmd119Start()');h.run('cmdMapObj=map;cmd119MapReady(map)');const row={dataset:{cmd119:'0'},scrolls:[],scrollIntoView(o){this.scrolls.push(o)},setAttribute(){},classList:{toggle(){}}};h.nodes.get('#cmd119').rows=[row];
 h.nodes.get('#cmdMap').getBoundingClientRect=()=>({top:950,bottom:1450});h.nodes.get('#cmd').click({target:{closest:()=>row}});
 assert.equal(flights[0].zoom,18);assert.equal(flights[0].duration,800);assert.equal(h.nodes.get('#cmdMap').scrolls.length,1);assert.equal(row.scrolls.length,1);assert.equal(row.scrolls[0].inline,'nearest');assert.equal(h.run('cmd119Session.selected'),h.run('cmd119Key(cmd119Session.model.cases[0])'));assert.match(h.run('cmd119Session.popup.text'),/09:30 救護｜臺北市大安區羅斯福路｜已出勤/);assert.match(h.marks.at(-1).element.innerHTML,/119/);assert.match(h.marks.at(-1).element.className,/selected/);assert.match(h.nodes.get('#cmd119').innerHTML,/selected/);
 const popup=h.run('cmd119Session.popup');popup.remove();assert.equal(h.run('cmd119Session.selected'),null);assert.doesNotMatch(h.marks.at(-1).element.className,/selected/);
 h.nodes.get('#cmdMap').getBoundingClientRect=()=>({top:10,bottom:500});h.marks.at(-1).element.click({stopPropagation(){}});assert.equal(flights.length,2);assert.equal(h.nodes.get('#cmdMap').scrolls.length,1,'桌機可見地圖不捲');assert.equal(h.run('cmd119Session.popup.options.closeOnClick'),false);listeners.click({originalEvent:{target:{closest:()=>null}}});assert.equal(h.run('cmd119Session.selected'),null);assert.equal(h.run('cmd119Session.popup'),null);h.run('cmd119Stop()');assert.equal(listeners.click,undefined);
});
test('minute更新以時間案類路名保留同一popup且不fly/scroll；更換案件、消失與範圍切換清除',async()=>{
 const h=harness(),flights=[];h.ctx.map={flyTo:o=>flights.push(o),on(){},off(){}};let cases=[item(),item({t:'2026/10/19 09:20:00',kind:'火災'})];h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,fetchedAt:NOW,cases})});
 await h.run('cmd119Start()');h.run('cmdMapObj=map;cmd119MapReady(map);cmd119Select(cmd119Visible(cmd119Session.model,false)[1])');const popup=h.run('cmd119Session.popup'),key=h.run('cmd119Session.selected');
 cases=[item({status:'到達現場',lat:25.025}),item({t:'2026/10/19 09:50:00',kind:'其他'})];await h.run('cmd119Update()');assert.equal(h.run('cmd119Session.selected'),key);assert.equal(h.run('cmd119Session.popup'),popup);assert.equal(popup.removed,undefined);assert.match(popup.text,/到達現場/);assert.equal(flights.length,1);assert.equal(h.nodes.get('#cmdMap').scrolls.length,0);
 h.run('cmd119Select(cmd119Visible(cmd119Session.model,false)[0])');assert.ok(popup.removed);assert.equal(flights.length,2);cases=[];await h.run('cmd119Update()');assert.equal(h.run('cmd119Session.selected'),null);assert.equal(h.run('cmd119Session.popup'),null);
 cases=[item({place:'臺北市中山區中山北路',district:'中山區'}),item({lat:null})];await h.run('cmd119Update()');assert.match(h.nodes.get('#cmd119').innerHTML,/disabled[\s\S]*無定位/);h.run('cmd119Select(cmd119Visible(cmd119Session.model,false)[0])');assert.equal(flights.length,2);h.nodes.get('#cmd119Scope').click();h.run('cmd119Select(cmd119Visible(cmd119Session.model,true)[0])');h.nodes.get('#cmd119Scope').click();assert.equal(h.run('cmd119Session.selected'),null);h.run('cmd119Stop()');
});
test('選取視覺包含亮卡、放大外圈及有限次動畫，角標獨立定位',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');
 for(const rule of [/\.cmd \.cmd119-row\.selected\s*\{/,/\.cmd \.amappin\.c119\.selected\s*\{[^}]*width:\s*42px/,/\.cmd \.amappin\.c119 small\s*\{[^}]*position:\s*absolute/,/animation:\s*cmd119-pulse [^;]* 2/,/prefers-reduced-motion: reduce/])assert.ok(rule.test(css),String(rule));
});
test('只消費Worker白名單、不讀raw精確欄位；地址降階到路段',()=>{
 const h=harness();const raw=item();for(const k of ['csPlace','csX','csY'])Object.defineProperty(raw,k,{get(){throw Error('不得讀raw')}});
 h.ctx.payload={ok:true,fetchedAt:NOW,cases:[raw,item({place:'臺北市信義區信義路五段99號',district:'信義區',lat:'25',lng:Infinity}),item({place:'<img onerror=alert(1)>',district:'信義區'})]};
 const m=h.run('cmd119Model(payload)');assert.equal(m.cases[0].place,'臺北市大安區羅斯福路');assert.equal(m.cases[1].place,'臺北市信義區信義路五段');assert.equal(m.cases[1].lat,null);assert.equal(m.cases[1].lng,null);assert.equal(m.cases[2].place,'位置待提供');assert.doesNotMatch(JSON.stringify(m),/123號|99號|csPlace|csX|csY|onerror/);
});
