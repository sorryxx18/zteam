'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg = window.NYE_DATA;
const app = {tab:'deployment',cameras:[],cameraState:'載入中',vehicleLayers:new Map(),statusRows:[],statusLoaded:false,statusFailed:false,canEdit:false,options:['待命','出勤','返隊'],selected:null,saving:false,statusRequest:0};
const map = L.map('map',{zoomControl:false}).fitBounds(cfg.bounds);
L.control.zoom({position:'bottomleft'}).addTo(map);
const bases={
 '臺灣通用電子地圖':L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',{maxZoom:19,attribution:'© 內政部國土測繪中心'}),
 '正射影像':L.tileLayer('https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',{maxZoom:19,attribution:'© 內政部國土測繪中心'}),
 'Esri 街道圖':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
 'OpenStreetMap':L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'})
};
bases['臺灣通用電子地圖'].addTo(map);
L.control.layers(bases,null,{position:'bottomleft',collapsed:true}).addTo(map);
const groups={areas:L.layerGroup().addTo(map),stations:L.layerGroup().addTo(map),fleet:L.layerGroup().addTo(map),cameras:L.layerGroup().addTo(map)};
const feed = Fleet.createFeed(API_URL,drawFleet);
const ago = t => {const m=Math.max(0,Math.floor((Date.now()-Number(t))/60000));return m<1?'1 分鐘內':m<60?`${m} 分鐘前`:`${Math.floor(m/60)} 小時前`;};
const time = Ops.formatTime;
const duty = device => app.statusLoaded ? Ops.statusFor(app.statusRows,device).status : '尚未確認';
const carBy = device => feed.data?.cars.find(c=>c.device===device);
const match = name => String(name).toLocaleLowerCase().includes($('#search').value.trim().toLocaleLowerCase());
function loadFleet(){return feed.load(Number($('#minutes').value));}
function drawFleet(){
 $('#feed-status').textContent=feed.message(); $('#feed-status').classList.toggle('failure',feed.failed);
 if(!feed.data){$('#recent-count').textContent='尚無成功定位資料';renderList();return;}
 const seen=new Set();
 for(const c of feed.data.cars){
  if(!Number.isFinite(Number(c.last.lat))||!Number.isFinite(Number(c.last.lng)))continue;
  seen.add(c.device);const s=Fleet.positionStatus(c.last);
  const icon=L.divIcon({className:'',html:`<span class="car-pin ${s.state==='old'?'old':''} ${s.poor?'poor':''}">${esc(c.device)}${s.state==='old'?' · 舊位置':''}</span>`,iconAnchor:[12,12]});
  let layer=app.vehicleLayers.get(c.device);
  if(!layer){layer={marker:L.marker([c.last.lat,c.last.lng],{title:c.device,entityKind:'vehicle',entityId:c.device}).on('click',()=>selectVehicle(c.device)).addTo(groups.fleet),line:L.polyline([],{color:'#b73c35',weight:3,opacity:.5}).addTo(groups.fleet)};app.vehicleLayers.set(c.device,layer);}
  layer.marker.setLatLng([c.last.lat,c.last.lng]).setIcon(icon);
  layer.line.setLatLngs(Fleet.trackSegments(c.track).map(seg=>seg.map(p=>[p[0],p[1]])));
 }
 for(const [id,l] of app.vehicleLayers)if(!seen.has(id)){groups.fleet.removeLayer(l.marker);groups.fleet.removeLayer(l.line);app.vehicleLayers.delete(id);}
 const recent=feed.data.cars.filter(c=>Fleet.positionStatus(c.last).state!=='old').length;
 $('#recent-count').textContent=`近期回報 ${recent} 台 · 查詢 ${feed.data.cars.length} 台`;
 if(app.selected?.kind==='vehicle'){
  const c=carBy(app.selected.id);
  if(!c)closeInspector();else updateVehicleFix(c);
 }
 refreshSelection();renderList();
}
function drawDeploymentLayers(){
 groups.areas.clearLayers();groups.stations.clearLayers();
 cfg.areas.forEach((a,i)=>L.geoJSON(a.geometry,{style:{color:'#b24c3c',weight:2,fillOpacity:.12}}).on('click',()=>selectArea(i)).addTo(groups.areas));
 cfg.stations.forEach((s,i)=>L.marker([s.lat,s.lng],{title:s.name,entityKind:'station',entityId:i,icon:L.divIcon({className:'',html:`<span class="station-pin">${esc(s.name)}</span>`})}).on('click',()=>selectStation(i)).addTo(groups.stations));
}
async function loadCameras(){
 app.cameraState='載入中';renderList();
 try{app.cameras=Ops.cameras(await cctvLoad(),cfg.bounds);app.cameraState='ready';groups.cameras.clearLayers();
  for(const c of app.cameras)L.marker([c.lat,c.lng],{title:c.name,entityKind:'camera',entityId:c.id,icon:L.divIcon({className:'',html:'<span class="camera-pin" aria-hidden="true">▣</span>',iconAnchor:[11,11]})}).on('click',()=>selectCamera(c.id)).addTo(groups.cameras);
 }catch(e){app.cameraState='讀取失敗';}
 renderList();
}
function renderList(){
 const list=$('#list'),scroll=list.scrollTop;
 if(app.tab==='deployment'){
  const areas=cfg.areas.map((a,i)=>({...a,i})).filter(a=>match(a.name));const stations=cfg.stations.map((s,i)=>({...s,i})).filter(s=>match(s.name+' '+s.unit));
  list.innerHTML=`<p class="section-label">當下管制</p>${!cfg.areas.length?'<div class="empty"><b>正式管制資料待提供</b><p>尚未繪製管制區，不代表現場沒有管制。收到正式範圍後納入。</p></div>':areas.map(a=>`<button class="list-row" data-area="${a.i}"><span class="row-top"><b>${esc(a.name)}</b><span class="badge">管制</span></span></button>`).join('')||'<p class="empty">沒有符合的管制區。</p>'}<p class="section-label">進駐部署</p>${!cfg.stations.length?'<div class="empty"><b>正式進駐資料待提供</b><p>預留單位、車輛、人力及聯絡方式；未填入示意人車或假聯絡資料。</p></div>':stations.map(s=>`<button class="list-row" data-station="${s.i}"><span class="row-top"><b>${esc(s.name)}</b><span class="badge">進駐</span></span><span class="row-sub">${esc(s.unit||'單位待補')}</span></button>`).join('')||'<p class="empty">沒有符合的進駐點。</p>'}<p class="provenance">定位、人工勤務與影像是不同來源。資料缺漏會明示，不以讀取成功推論全場即時。</p>`;
 }else if(app.tab==='fleet'){
  const cars=(feed.data?.cars||[]).filter(c=>match(c.device));
  list.innerHTML=`<p class="section-label">車輛位置 · 近 ${feed.minutes||$('#minutes').value} 分鐘</p>${!feed.data?`<p class="empty">${feed.failed?'定位讀取失敗，尚無可顯示資料。':'定位讀取中…'}</p>`:cars.map(c=>{const s=Fleet.positionStatus(c.last);return `<button class="list-row" data-device="${esc(c.device)}"><span class="row-top"><b>${esc(c.device)}</b><span class="badge duty">${esc(duty(c.device))}</span></span><span class="row-sub"><span class="badge ${s.state==='old'?'stale':'fresh'}">${s.state==='old'?'定位已過期':'近期定位'}</span> ${ago(c.last.t)} · ${esc(s.quality)}</span></button>`;}).join('')||'<div class="empty"><b>沒有近期車輛資料</b><p>可在「資料與工具」擴大查詢範圍；不代表所有車都在線或沒有車輛部署。</p></div>'}${app.statusFailed?'<p class="provenance">勤務狀態讀取失敗；有舊資料時保留，未成功讀取時不假設目前仍待命。</p>':''}<p class="provenance">勤務預設待命，由幕僚更正；與定位是否即時分開判讀。測試設備尚未刪除。</p>`;
 }else{
  const cams=app.cameras.filter(c=>match(c.name));
  list.innerHTML=`<p class="section-label">區域路口影像 · ${app.cameras.length} 支</p>${app.cameraState!=='ready'?`<div class="empty"><b>監視器清單${esc(app.cameraState)}</b>${app.cameraState==='讀取失敗'?'<button data-retry-cameras>重新讀取</button>':''}</div>`:cams.map(c=>`<button class="list-row" data-camera="${esc(c.id)}"><span class="row-top"><b>${esc(c.name)}</b><span class="badge">觀看</span></span><span class="row-sub">臺北市交通管制工程處</span></button>`).join('')||'<p class="empty">範圍內沒有符合的官方攝影機。</p>'}<p class="provenance">暫以涵蓋信義百貨區及周邊的搜尋外框列出全部可取得鏡頭；外框待核對，不是正式管制範圍。每支影像的可用狀態於點選後確認。</p>`;
 }
 list.scrollTop=scroll;
}
function refreshSelection(){
 for(const group of Object.values(groups))group.eachLayer(layer=>{
  const el=layer.getElement?.();
  if(el)el.classList.toggle('chosen',!!app.selected&&layer.options.entityKind===app.selected.kind&&String(layer.options.entityId)===String(app.selected.id));
 });
}
function openInspector(kind,id,title,content){
 cctvStopIn($('#inspector'));app.selected={kind,id};
 $('#inspector').hidden=false;$('#sidebar').classList.add('inspecting');$('#sidebar').classList.remove('collapsed');
 $('#inspector').innerHTML=`<button id="inspector-close">← 返回勤務資訊</button><div class="inspector-kind">${esc(kind==='vehicle'?'車輛勤務':kind==='camera'?'路口即時影像':kind==='live'?'101 煙火直播':kind==='area'?'管制範圍':'進駐部署')}</div><h2>${esc(title)}</h2>${content}`;
 refreshSelection();$('#inspector-close').onclick=closeInspector;$('#inspector-close').focus({preventScroll:true});
}
function closeInspector(){cctvStopIn($('#inspector'));$('#inspector').replaceChildren();$('#inspector').hidden=true;app.selected=null;refreshSelection();$('#sidebar').classList.remove('inspecting');}
function focusPoint(point){
 map.setView(point,17,{animate:false});
 if(innerWidth<=900){const r=$('#sidebar').getBoundingClientRect();map.panBy(innerHeight<=500?[r.width/2,0]:[0,r.height/2],{animate:false});}
}
function selectArea(i){const a=cfg.areas[i];if(!a)return;openInspector('area',i,a.name,`<p>${esc(a.description||'說明待補')}</p><p class="provenance">資料來源：${esc(a.source||'待提供')}</p>`);}
function selectStation(i){const s=cfg.stations[i];if(!s)return;openInspector('station',i,s.name,`<dl><dt>單位</dt><dd>${esc(s.unit||'待提供')}</dd><dt>車輛</dt><dd>${esc(s.vehicles||'待提供')}</dd><dt>人力</dt><dd>${esc(s.personnel??'待提供')}</dd><dt>聯絡方式</dt><dd>${esc(s.contact||'待提供')}</dd></dl><p class="provenance">資料來源：${esc(s.source||'待提供')}</p>`);focusPoint([s.lat,s.lng]);}
function selectVehicle(device){
 const c=carBy(device);if(!c)return;
 const r=Ops.statusFor(app.statusRows,device);
 openInspector('vehicle',device,device,`<div id="fix-quality"></div><dl><dt>最後定位</dt><dd id="fix-time"></dd><dt>定位品質</dt><dd id="fix-accuracy"></dd><dt>速度</dt><dd id="fix-speed"></dd><dt>勤務更新</dt><dd>${app.statusLoaded?(r.isDefault?'預設待命，尚無人工更正':esc(time(r.updated_at))):'勤務資料尚未確認'}</dd></dl><div class="duty-form"><label for="duty-status">勤務狀態 · 幕僚選取</label><div class="duty-controls"><select id="duty-status" ${app.canEdit&&!app.statusFailed?'':'disabled'}>${app.options.map(s=>`<option${s===r.status?' selected':''}>${esc(s)}</option>`).join('')}</select><button class="primary" id="duty-save" ${app.canEdit&&!app.statusFailed?'':'disabled'}>儲存</button></div><p id="save-status" class="save-note" role="status"></p></div><p class="info-note">「待命」是人工勤務欄位的預設值，不代表車輛持續在線，也不能取代現場確認。</p>${cfg.preview?'<p class="provenance">獨立測試頁：勤務狀態暫以預設待命展示，尚未啟用更正與多人儲存。</p>':app.canEdit?'':'<p class="provenance">更正勤務需既有管理者／中隊帳號。</p>'}`);
 updateVehicleFix(c);focusPoint([c.last.lat,c.last.lng]);$('#duty-save').onclick=saveDuty;
}
function updateVehicleFix(c){const s=Fleet.positionStatus(c.last);$('#fix-quality').innerHTML=`<span class="badge ${s.state==='old'?'stale':'fresh'}">${s.state==='old'?'定位已過期':'近期定位'}</span> <span class="provenance">${ago(c.last.t)}</span>`;$('#fix-time').textContent=time(c.last.t);$('#fix-accuracy').textContent=s.quality;$('#fix-speed').textContent=s.speedKmh===null?'不顯示（過期／品質不足）':s.speedKmh+' km/h';}
function selectCamera(id){
 const c=app.cameras.find(x=>x.id===id);if(!c)return;
 openInspector('camera',id,c.name,'<div class="video-screen"><video id="video-player" muted playsinline controls></video></div><div id="camera-state" role="status">連線中…</div><div class="camera-actions"><button id="camera-fullscreen">放大影像</button><button id="camera-retry">重新連線</button></div><p class="provenance">影像來源：<a href="https://its.taipei.gov.tw/" target="_blank" rel="noopener">臺北市即時交通資訊網</a>。播放中仍可能有傳輸延遲；斷線不代表現場沒有車流或人潮。</p>');
 focusPoint([c.lat,c.lng]);
 const video=$('#video-player'),state=$('#camera-state');
 cctvPlay(video,c.url,(text,bad)=>{if(!state.isConnected)return;state.textContent=text==='即時'?'串流播放中 · 可能有延遲':text;state.classList.toggle('failure',!!bad);});
 $('#camera-retry').onclick=()=>selectCamera(id);$('#camera-fullscreen').onclick=()=>{if(video.requestFullscreen)video.requestFullscreen().catch(()=>{state.textContent='無法全螢幕，請使用播放器的放大按鈕。';});else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();};
}
function selectLive(){
 openInspector('live','101','101 煙火直播','<div class="empty"><b>本年度官方直播來源尚未公布</b><p>目前未接入直播，不以過往煙火影片或錄影冒充即時畫面。</p></div><p class="provenance">取得並驗證本年度官方直播網址後，會在此直接提供觀看。</p>');
}
async function opsPost(payload){
 let token='';try{token=localStorage.getItem('fct_token')||sessionStorage.getItem('fct_token')||'';}catch(e){}
 const r=await fetch(API_URL,{method:'POST',body:JSON.stringify({...payload,token}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();if(!d.ok)throw Error(d.error||'讀取失敗');return d;
}
async function loadStatuses(force=false){
 if(cfg.preview){app.statusLoaded=true;app.statusRows=[];app.canEdit=false;app.statusFailed=false;renderList();return true;}
 if(app.saving&&!force)return false;const request=++app.statusRequest;
 try{const d=await opsPost({action:'ops_status_data'});if(request!==app.statusRequest)return false;
  const changed=app.canEdit!==d.canEdit||JSON.stringify(app.statusRows)!==JSON.stringify(d.statuses||[])||!app.statusLoaded||app.statusFailed;
  app.statusRows=d.statuses||[];app.canEdit=d.canEdit===true;app.statusLoaded=true;app.statusFailed=false;
  if(Array.isArray(d.options)&&d.options.length)app.options=d.options;
  if(changed&&app.selected?.kind==='vehicle'&&!app.saving)selectVehicle(app.selected.id);renderList();return true;
 }catch(e){if(request!==app.statusRequest)return false;app.statusFailed=true;app.canEdit=false;renderList();if(app.selected?.kind==='vehicle'&&!app.saving)selectVehicle(app.selected.id);return false;}
}
async function saveDuty(){
 if(!app.canEdit||app.saving||app.selected?.kind!=='vehicle')return;
 const device=app.selected.id,status=$('#duty-status').value;app.saving=true;app.statusRequest++;$('#duty-save').disabled=true;$('#duty-status').disabled=true;$('#save-status').textContent='正在儲存…';
 try{await opsPost({action:'ops_status_set',device,status});const confirmed=await loadStatuses(true);
  if(!confirmed||Ops.statusFor(app.statusRows,device).status!==status)throw Error('尚未確認');
  if(app.selected?.kind==='vehicle'&&app.selected.id===device){selectVehicle(device);$('#save-status').textContent='已儲存，並重新讀取確認。';}
 }catch(e){if(app.selected?.kind==='vehicle'&&app.selected.id===device)$('#save-status').textContent='儲存結果尚未確認，請重新讀取後再操作；勿視為已儲存。';}
 finally{app.saving=false;if($('#duty-save'))$('#duty-save').disabled=!app.canEdit;if($('#duty-status'))$('#duty-status').disabled=!app.canEdit;}
}
$('#list').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-device'))selectVehicle(b.dataset.device);if(b.hasAttribute('data-camera'))selectCamera(b.dataset.camera);if(b.hasAttribute('data-station'))selectStation(Number(b.dataset.station));if(b.hasAttribute('data-area'))selectArea(Number(b.dataset.area));if(b.hasAttribute('data-retry-cameras'))loadCameras();};
$('.panel-tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;closeInspector();app.tab=b.dataset.tab;$('#search').value='';$('.panel-tabs').querySelectorAll('button').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderList();};
$('#search').oninput=renderList;$('#minutes').onchange=()=>{closeInspector();loadFleet();};$('#overview').onclick=()=>map.fitBounds(cfg.bounds);
$('#layers').onchange=e=>{const name=e.target.id.replace('layer-','');if(!groups[name])return;if(e.target.checked)groups[name].addTo(map);else map.removeLayer(groups[name]);};
$('#live-tab').onclick=selectLive;$('#mobile-panel-toggle').onclick=()=>{const collapsed=$('#sidebar').classList.toggle('collapsed');$('#mobile-panel-toggle').textContent=collapsed?'展開':'收合';$('#mobile-panel-toggle').setAttribute('aria-expanded',String(!collapsed));};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){$('#fullscreen').textContent='請另開此頁';}};
new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('.map-cell'));
window.addEventListener('focus',()=>loadStatuses());window.addEventListener('pagehide',()=>cctvStopIn($('#inspector')));
drawDeploymentLayers();renderList();loadFleet();loadStatuses();loadCameras();setInterval(loadFleet,15000);setInterval(()=>loadStatuses(),15000);setInterval(drawFleet,5000);
