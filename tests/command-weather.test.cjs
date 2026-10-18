const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const NOW=Date.parse('2026-10-18T19:30:00+08:00');
const gas=()=>({ok:true,at:NOW,obs:{station:'信義',time:NOW,temp:0,weather:'晴',wind:0,rainToday:0},warnings:[]});
const meteo=()=>({current:{time:'2026-10-18T19:30',temperature_2m:26,weather_code:0,wind_speed_10m:3},hourly:{time:['2026-10-18T19:00','2026-10-18T20:00','2026-10-18T21:00','2026-10-18T22:00'],precipitation_probability:[70,0,20,30],wind_speed_10m:[3,4,5,6]}});
function harness(){
 const nodes=new Map();const node=()=>({innerHTML:'',textContent:'',hidden:false,isConnected:true,classList:{toggle(){}},addEventListener(){}});
 for(const id of ['#cmd','#view','#cmdWeather','#cmdWeatherWarning'])nodes.set(id,node());
 const intervals=new Map(),timeouts=new Map(),events=new Map();let seq=0,observer;
 class Clock extends Date {static now(){return NOW;}}
 const ctx=vm.createContext({Date:Clock,console,Intl,URLSearchParams,AbortController,location:{search:''},COMMAND:{},
 $:s=>nodes.get(s)||null,esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 setInterval:(fn,ms)=>{intervals.set(++seq,{fn,ms});return seq},clearInterval:id=>intervals.delete(id),
 setTimeout:(fn,ms)=>{timeouts.set(++seq,{fn,ms});return seq},clearTimeout:id=>timeouts.delete(id),
 window:{addEventListener:(name,fn)=>events.set(name,fn)},
 MutationObserver:class{constructor(fn){observer=this;this.fn=fn;}observe(){}disconnect(){this.disconnected=true}},
 fetch:async url=>({ok:true,json:async()=>url.includes('script.google')?gas():meteo()})});
 vm.runInContext(fs.readFileSync(path.join(root,'command.js'),'utf8'),ctx);
 return {ctx,nodes,intervals,timeouts,events,get observer(){return observer},run:s=>vm.runInContext(s,ctx)};
}
test('天氣正規化保留零值、毫秒時間與未來三整點',()=>{
 const h=harness();h.ctx.g=gas();h.ctx.m=meteo();const r=h.run('cmdWeatherModel(g,m,Date.now())');
 assert.equal(r.current.temp,0);assert.equal(r.current.rain,0);assert.equal(r.current.wind,0);
 assert.deepEqual(Array.from(r.forecast,p=>p.time),['20:00','21:00','22:00']);assert.equal(r.forecast[0].rain,0);
});
test('官方失敗、過期、無效與未來觀測使用備援',()=>{
 for(const time of [NOW-91*60000,'bad',null,NOW+3600000]){
  const h=harness();h.ctx.g=gas();h.ctx.g.obs.time=time;h.ctx.m=meteo();
  const r=h.run('cmdWeatherModel(g,m,Date.now())');assert.equal(r.current.source,'備援：Open-Meteo');assert.equal(r.current.rain,null);
 }
});
test('只保留有效官方特報；未知不當成沒有',()=>{
 const h=harness();h.ctx.g=gas();h.ctx.m=meteo();h.ctx.g.warnings=[{name:'大雨',start:NOW-1000,end:NOW+60000},{name:'過期',start:NOW-60000,end:NOW-1}];
 const r=h.run('cmdWeatherModel(g,m,Date.now())');assert.deepEqual(Array.from(r.warnings,w=>w.name),['大雨']);
 assert.equal(h.run('cmdWeatherModel(null,m,Date.now()).officialKnown'),false);
});
test('未知天氣碼與過期備援不冒充晴天或新資料',()=>{
 const h=harness();h.ctx.m=meteo();h.ctx.m.current.weather_code=999;
 assert.equal(h.run('cmdWeatherModel(null,m,Date.now()).current.sky'),'待提供');
 h.ctx.m.current.time='2026-10-18T10:00';assert.equal(h.run('cmdWeatherModel(null,m,Date.now()).current'),null);
});
test('只更新天氣DOM，雙來源失敗清除舊數值及警示',async()=>{
 const h=harness();await h.run('cmdWeatherStart()');
 assert.match(h.nodes.get('#cmdWeather').innerHTML,/0°C/);
 h.ctx.fetch=async()=>{throw Error('offline')};await h.run('cmdWeatherUpdate()');
 const html=h.nodes.get('#cmdWeather').innerHTML;assert.match(html,/—/);assert.match(html,/天氣暫時無法取得/);assert.doesNotMatch(html,/°C|0 mm/);
 assert.equal(h.nodes.get('#cmdWeatherWarning').hidden,true);h.run('cmdWeatherStop()');
});
test('官方可用而預報失敗不得清掉有效觀測',async()=>{
 const h=harness();h.ctx.fetch=async url=>{if(url.includes('open-meteo'))throw Error('forecast offline');return{ok:true,json:async()=>gas()}};
 await h.run('cmdWeatherStart()');assert.match(h.nodes.get('#cmdWeather').innerHTML,/0°C/);assert.match(h.nodes.get('#cmdWeather').innerHTML,/預報待提供/);h.run('cmdWeatherStop()');
});
test('天氣更新不重建地圖或播放器；重畫與離頁清理timer',async()=>{
 const h=harness();h.ctx.cmdMapDraw=()=>{throw Error('不得重畫map')};h.ctx.cmdLiveDraw=()=>{throw Error('不得重畫live')};
 await h.run('cmdWeatherStart()');await h.run('cmdWeatherStart()');assert.equal(h.intervals.size,1);assert.equal([...h.intervals.values()][0].ms,600000);
 h.nodes.get('#cmd').isConnected=false;h.observer.fn();assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);
 h.nodes.get('#cmd').isConnected=true;await h.run('cmdWeatherStart()');h.events.get('pagehide')();assert.equal(h.intervals.size,0);
});
test('逾時清空而不永遠載入；卸載中止請求',async()=>{
 const h=harness();const signals=[];h.ctx.fetch=(_,opts)=>{signals.push(opts.signal);return new Promise(()=>{})};
 const p=h.run('cmdWeatherStart()');assert.equal(h.timeouts.size,2);
 for(const {fn} of [...h.timeouts.values()])fn();await p;
 assert.match(h.nodes.get('#cmdWeather').innerHTML,/天氣暫時無法取得/);assert.ok(signals.every(s=>s.aborted));h.run('cmdWeatherStop()');assert.equal(h.intervals.size,0);
});
test('離頁的晚到回應不可污染重新進入的天氣卡',async()=>{
 const h=harness();let releases=[];h.ctx.fetch=()=>new Promise(resolve=>releases.push(resolve));
 const p=h.run('cmdWeatherStart()');h.run('cmdWeatherStop()');
 h.ctx.fetch=async()=>{throw Error('new failure')};await h.run('cmdWeatherStart()');
 for(const resolve of releases)resolve({ok:true,json:async()=>gas()});await p;
 assert.match(h.nodes.get('#cmdWeather').innerHTML,/天氣暫時無法取得/);h.run('cmdWeatherStop()');
});
