const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','watch.js'),'utf8');
const NOW=Date.parse('2026-10-27T07:43:00+08:00');
const title='獨家》北市懷愛館離譜意外！親友送別到一半消防設備無預警噴水- 社會';
const news={s:'news',x:title,u:'https://news.google.com/rss/articles/opaque?oc=5',o:'中時',t:Date.parse('2026-10-26T12:34:28+08:00')};
const url='https://www.chinatimes.com/realtimenews/20261026001645-260402?chdtv';
function page(){
 const nodes=Object.fromEntries(['#view','#wBox','#wList','#wReload','#wNote','#wLocal','#wTaipei','#wSearchResults'].map(k=>[k,{innerHTML:'',textContent:'',listeners:{},addEventListener(n,f){this.listeners[n]=f},scrollIntoView(){}}]));
 const c=vm.createContext({URL,Intl,AbortSignal,Date:class extends Date {static now(){return NOW}},location:{pathname:'/'},document:{addEventListener(){},querySelectorAll(){return []}},setInterval(){},setTimeout(){return 1},clearTimeout(){},$:k=>nodes[k],esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),fetch:async()=>({ok:true,json:async()=>({ok:true,title:title.split('- 社會')[0]})})});
 vm.runInContext(source,c);vm.runInContext(`watch={ok:true,days:1,now:Date.now(),lastFetch:{},items:[${JSON.stringify(news)}].map(wTier)};renderWatch()`,c);
 return {c,nodes,run:s=>vm.runInContext(s,c)};
}
test('real news and FB copy classify as local equipment incident, not a fire or circle topic',()=>{
 const p=page();for(const s of ['news','fb']){const result=p.run(`wTier(${JSON.stringify({...news,s})})`);assert.equal(result._g,'local');assert.equal(result._type,'equipment');assert.equal(result._m,false)}
});
test('education, drills, hypothetical faults, adverts and unrelated spray do not become incidents',()=>{
 const p=page();for(const x of ['台北消防設備故障演練今天登場','台北消防宣導：如果灑水頭故障怎麼辦','台北消防設備故障維修保養，歡迎洽詢','台北親水公園突然噴水，大家很開心','台北警報器可能故障，教你如何檢查','台北消防設備沒有故障']){assert.ok(!['taipei','local','taiwan'].includes(p.run(`wTier(${JSON.stringify({...news,x})})._g`)),x)}
});
test('ordinary fire, official incident reminder and disabled alarm keep meaningful classification',()=>{
 const p=page();for(const [x,type] of [['台北住宅起火，消防設備故障','fire'],['台北消防設備突然噴水，提醒民眾繞道','equipment'],['台北大安區警報器失靈','equipment']]){const i=p.run(`wTier(${JSON.stringify({...news,x})})`);assert.ok(['taipei','local'].includes(i._g));assert.equal(i._type,type)}
});
test('six-hour miss has a real widen action; 24h finds old news and dedicated results show it',()=>{
 const p=page();p.run('watchF.q="懷愛館";drawWatchList()');assert.match(p.nodes['#wSearchResults'].innerHTML,/data-search-widen/);assert.equal(p.run('watchFiltered().length'),0);
 p.run('watchF.days="1";drawWatchList()');assert.equal(p.run('watchFiltered().length'),1);assert.match(p.nodes['#wSearchResults'].innerHTML,/懷愛館/);assert.match(p.nodes['#wLocal'].innerHTML,/懷愛館/);
});
test('widen button requests 3-day data when not loaded, preserving search',()=>{
 const p=page();p.run('watchF.q="懷愛館";let loaded=0;loadWatch=d=>loaded=d;');p.nodes['#wBox'].listeners.click({target:{closest:s=>s==='[data-search-widen]'?{}:null}});assert.equal(p.run('loaded'),3);assert.equal(p.run('watchF.days'),'3');assert.equal(p.run('watchF.q'),'懷愛館');
});
test('source and locality constraints stay applied to dedicated search; match outside list top 10 remains visible',()=>{
 const p=page();p.run('watchF.days="1";watchF.q="懷愛館";watch.items.unshift(...Array.from({length:20},(_,i)=>wTier({s:"news",o:"測試",x:"台北住宅起火"+i,u:"https://x/"+i,t:Date.now()-i})));drawWatchList()');assert.match(p.nodes['#wSearchResults'].innerHTML,/懷愛館/);assert.equal(p.run('watchFiltered().length'),1);p.run('watchF.src="threads";drawWatchList()');assert.equal(p.run('watchFiltered().length'),0);
});
test('pasted canonical URL matches stored Google URL by fetched title, and direct stored URLs match without request',async()=>{
 const p=page();p.run(`watchF.days="1";watchF.q=${JSON.stringify(url)}`);await p.run('watchResolveLink(watchF.q)');assert.equal(p.run('watchFiltered().length'),1);assert.match(p.nodes['#wSearchResults'].innerHTML,/懷愛館/);assert.equal(p.run(`wSearchMatch({u:"https://www.chinatimes.com/realtimenews/20261026001645-260402?utm_source=a"},${JSON.stringify(url)})`),true);
});
test('failed title lookup is explicit, not an assertion of no collection; no stale async result leaks into new query',async()=>{
 const p=page();p.c.fetch=async()=>{throw new Error('offline')};p.run(`watchF.days="1";watchF.q=${JSON.stringify(url)}`);await p.run('watchResolveLink(watchF.q)');assert.match(p.nodes['#wSearchResults'].innerHTML,/無法辨識/);
 let done;p.c.fetch=()=>new Promise(r=>done=r);const pending=p.run('watchResolveLink(watchF.q)');p.run('watchF.q="別的搜尋"');done({ok:true,json:async()=>({ok:true,title})});await pending;assert.equal(p.run('wSearchMatch(watch.items[0])'),false);
});

test('different Facebook permalink story IDs are not treated as the same URL',()=>{const p=page();assert.equal(p.run('wSearchMatch({u:"https://www.facebook.com/permalink.php?story_fbid=111&id=22"},"https://www.facebook.com/permalink.php?story_fbid=222&id=22")'),false)});

test('Google mixed-page summary cannot invent a device incident',()=>{const p=page();assert.equal(p.run('wTier({s:"fb",o:"Google收錄",x:"台北消防設備保養心得｜別篇提到台北消防設備突然噴水"})._g'),"circle")});
