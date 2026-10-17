'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg = window.NYE_DATA;
const v2 = {cameras:[],selected:null,watching:null,cameraState:'載入中',vehicleLayers:new Map(),preview:true};
const map = L.map('map',{zoomControl:false}).fitBounds(cfg.bounds);
L.control.zoom({position:'bottomleft'}).addTo(map);
L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',{maxZoom:19,attribution:'© 內政部國土測繪中心'}).addTo(map);
const groups = {areas:L.layerGroup().addTo(map),stations:L.layerGroup().addTo(map),fleet:L.layerGroup().addTo(map),cameras:L.layerGroup()};
const focusLayer = L.layerGroup().addTo(map);
const feed = Fleet.createFeed(API_URL,drawFleet);
const cars = () => feed.data?.cars || [];
const carBy = device => cars().find(c=>c.device===device);
const position = p => p && p.lat != null && p.lng != null && String(p.lat).trim() !== '' && String(p.lng).trim() !== '' && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat))<=90 && Math.abs(Number(p.lng))<=180;
const time = Ops.formatTime;
function vehicleButton(device) {
 const c = carBy(device), s = c?.last ? Fleet.positionStatus(c.last) : null;
 return `<button class="ghost entity-row" data-vehicle="${esc(device)}"><b>${esc(device)}</b>${s?` <span class="tag ${s.state==='old'?'warn':'ok'}">${s.state==='old'?'定位已過期':'近期定位'}</span><span class="note">${esc(s.quality)} · ${esc(time(c.last.t))}</span>`:'<span class="note">目前查詢沒有這台車的定位</span>'}</button>`;
}
function stationButton(s,i) { return `<button class="ghost entity-row" data-station="${i}"><b>${esc(s.name)}</b><span class="note">${esc(s.unit||'單位待提供')}</span></button>`; }
function areaButton(a,i) { return `<button class="ghost entity-row" data-area="${i}"><b>${esc(a.name)}</b><span class="tag">管制範圍</span></button>`; }
function overviewHTML() {
 return `<div id="overview-list"><h3 class="section-label">管制範圍</h3>${cfg.areas.length?`<div class="entity-list">${cfg.areas.map(areaButton).join('')}</div>`:'<div class="empty"><b>正式管制資料待提供</b><p>尚未繪製範圍，不代表現場沒有管制。</p></div>'}<h3 class="section-label">進駐部署</h3>${cfg.stations.length?`<div class="entity-list">${cfg.stations.map(stationButton).join('')}</div>`:'<div class="empty"><b>正式進駐／支援名冊待提供</b><p>單位、編組車、人力及聯絡資料尚未提供；不填入示意人車。</p></div>'}<h3 class="section-label">車輛最後定位 <span class="tag">${cars().length} 台</span></h3><p class="note">以下為實際定位來源，不是跨年正式編組名冊。</p><div class="entity-list">${cars().map(c=>vehicleButton(c.device)).join('') || `<p class="empty">${feed.data?'此查詢範圍沒有車輛定位，不代表沒有部署。':feed.failed?'定位讀取失敗，尚無成功資料。':'正在讀取真實車輛定位…'}</p>`}</div></div>`;
}
function renderContext() {
 const selected = v2.selected;
 let title = '全場勤務總覽', html = '', related = [];
 if (!selected) html = overviewHTML();
 else if (selected.kind === 'vehicle') {
  const c = carBy(selected.id); title = selected.id;
  if (!c) html = '<p class="empty">這台車已不在目前查詢結果中；不是已解除勤務的證明。</p>';
  else {
   const s = Fleet.positionStatus(c.last);
   html = `<p><span class="tag warn">人工勤務：待命</span></p><p class="note">預設示意，不儲存；未讀取正式人工勤務資料，不代表目前在線或已獲指派。</p><dl><dt>最後定位</dt><dd>${esc(time(c.last.t))}（台北）</dd><dt>時效</dt><dd>${s.state==='old'?'定位已過期（超過 5 分鐘）':s.state==='warn'?'1–5 分鐘內回報':'1 分鐘內回報'}</dd><dt>品質</dt><dd>${esc(s.quality)}</dd><dt>速度</dt><dd>${s.speedKmh===null?'不顯示（過期／品質不足）':s.speedKmh+' km/h'}</dd><dt>正式編組</dt><dd>${cfg.stations.filter(st=>DutyV2.assignedDevices(st).includes(c.device)).map(st=>esc(st.name)).join('、')||'正式編組資料尚未提供／尚未列入，不依相鄰位置推論'}</dd></dl>`;
   if (position(c.last)) related = DutyV2.nearby(v2.cameras,Number(c.last.lat),Number(c.last.lng));
  }
 } else if (selected.kind === 'station') {
  const s = cfg.stations[selected.id]; if (!s) { overview(); return; }
  const assigned = DutyV2.assignedDevices(s); title = s.name;
  html = `<dl><dt>單位</dt><dd>${esc(s.unit||'待提供')}</dd><dt>車輛</dt><dd>${esc(Array.isArray(s.vehicles)?s.vehicles.join('、'):s.vehicles||'待提供')}</dd><dt>人力</dt><dd>${esc(s.personnel??'待提供')}</dd><dt>聯絡方式</dt><dd>${esc(s.contact||'待提供')}</dd></dl><p class="note">資料來源：${esc(s.source||'待提供')}。僅下列明列車號屬本點編組，不把附近車輛當支援。</p><h3>明確編組車</h3><div class="entity-list">${assigned.map(vehicleButton).join('')||'<p class="empty">未提供明確編組車號。</p>'}</div>`;
  if (position(s)) related = DutyV2.nearby(v2.cameras,Number(s.lat),Number(s.lng));
 } else if (selected.kind === 'area') {
  const a = cfg.areas[selected.id]; if (!a) { overview(); return; } title = a.name;
  const inArea = p => position(p) && DutyV2.insideArea(Number(p.lat),Number(p.lng),a.geometry);
  const stations = cfg.stations.map((s,i)=>({s,i})).filter(({s})=>inArea(s)), vehicles = cars().filter(c=>inArea(c.last));
  html = `<p>${esc(a.description||'管制說明待提供')}</p><p class="note">來源：${esc(a.source||'待提供')}</p><p class="empty">以下依真實多邊形（含孔洞）比對空間位置，僅表示在範圍內，不是正式指派關係；過期位置也不是車輛仍在現場的證明。</p><h3>範圍內進駐點</h3><div class="entity-list">${stations.map(({s,i})=>stationButton(s,i)).join('')||'<p class="note">無可確認的範圍內進駐點。</p>'}</div><h3>範圍內最後定位車</h3><div class="entity-list">${vehicles.map(c=>vehicleButton(c.device)).join('')||'<p class="note">目前查詢沒有範圍內最後定位。</p>'}</div>`;
  const center = areaCenter(a);
  related = center ? DutyV2.nearby(v2.cameras.filter(inArea),center.lat,center.lng) : [];
 } else if (selected.kind === 'camera') {
  const c = v2.cameras.find(c=>c.id===selected.id); title = c?.name || '路口影像';
  html = '<p>單獨查看路口。這是交通影像，不代表勤務、部署或人潮已獲確認。</p>';
 }
 $('#context-title').textContent = title; $('#context-body').innerHTML = html;
 $('#nearby-cameras').innerHTML = selected && selected.kind !== 'camera' ? `<h3>${selected.kind==='area'?'範圍內相關鏡頭':'附近路口鏡頭'}</h3><p class="note">依${selected.kind==='vehicle'?'最後定位':'所選位置'}關聯，觀看時保留上方勤務資料。距離不代表可見範圍。</p><div class="chips">${related.map(c=>`<button class="ghost chip" data-watch="${esc(c.id)}">${esc(c.name)} · ${c.m} 公尺</button>`).join('') || `<p class="note">${v2.cameraState==='ready'?'目前沒有可關聯鏡頭。':'鏡頭清單'+esc(v2.cameraState)}</p>`}</div>` : '';
 refreshSelection();
}
function areaCenter(a) {
 try { const bounds=L.geoJSON(a.geometry).getBounds(); return bounds.isValid()?bounds.getCenter():null; } catch(e) { return null; }
}
function closeCamera() {
 const dock=$('#video-dock'), old=dock.querySelector('video');
 cctvStopIn(dock);
 // 移除舊節點，使尚在等待 HLS 載入的舊 cctvPlay 也不能重新連線。
 const video=document.createElement('video'); video.controls=true; video.muted=true; video.playsInline=true;
 old.replaceWith(video); v2.watching=null; dock.hidden=true; $('#video-status').textContent='影像已關閉'; $('.context-panel').scrollTop=0;
}
function watchCamera(id) {
 const c=v2.cameras.find(c=>String(c.id)===String(id)); if (!c) return;
 closeCamera(); v2.watching=c.id; $('#video-dock').hidden=false; $('#video-title').textContent=c.name;
 const video=$('#video-dock video');
 requestAnimationFrame(()=>{if(innerWidth>900)return;const panel=$('.context-panel'),dock=$('#video-dock');panel.scrollTop+=dock.getBoundingClientRect().top-panel.getBoundingClientRect().top-105;});
 cctvPlay(video,c.url,(text,bad)=>{if (!video.isConnected || v2.watching!==c.id) return; $('#video-status').textContent=text==='即時'?'串流播放中 · 可能延遲':text; $('#video-status').classList.toggle('failure',!!bad);});
}
function focusPoint(p) {
 if (!position(p)) return;
 map.invalidateSize({pan:false}); map.setView([Number(p.lat),Number(p.lng)],17,{animate:false});

}
function beginSelection(kind,id) { closeCamera(); v2.selected={kind,id}; document.body.classList.add('has-selection'); map.invalidateSize({pan:false}); renderContext(); $('.context-panel').scrollTop=0; }
function selectVehicle(device) { const c=carBy(device); if (!c) return; beginSelection('vehicle',device); focusPoint(c.last); }
function selectStation(i) { const s=cfg.stations[i]; if (!s) return; beginSelection('station',i); focusPoint(s); }
function selectArea(i) { const a=cfg.areas[i]; if (!a) return; beginSelection('area',i); try { const bounds=L.geoJSON(a.geometry).getBounds(); if(bounds.isValid())map.fitBounds(bounds,{padding:[25,25],animate:false}); } catch(e) {} }
function selectCamera(id) { const c=v2.cameras.find(c=>String(c.id)===String(id)); if (!c) return; beginSelection('camera',c.id); focusPoint(c); watchCamera(c.id); }
function overview() { closeCamera(); v2.selected=null; document.body.classList.remove('has-selection'); map.invalidateSize({pan:false}); renderContext(); map.fitBounds(cfg.bounds,{animate:false}); }
function refreshSelection() {
 const visit = layer => {
  if (layer.eachLayer) { layer.eachLayer(visit); return; }
  const chosen=!!v2.selected && layer.options.entityKind===v2.selected.kind && String(layer.options.entityId)===String(v2.selected.id);
  layer.getElement?.()?.classList.toggle('chosen',chosen);
  if (layer.options.entityKind==='area') layer.setStyle?.({weight:chosen?5:2,fillOpacity:chosen ? .22 : .10});
 };
 for (const group of Object.values(groups)) group.eachLayer(visit);
 focusLayer.clearLayers();
 const s=v2.selected, p=s?.kind==='vehicle'?carBy(s.id)?.last:s?.kind==='station'?cfg.stations[s.id]:s?.kind==='camera'?v2.cameras.find(c=>c.id===s.id):null;
 if(position(p))L.circleMarker([Number(p.lat),Number(p.lng)],{radius:14,color:'#e3262b',weight:4,fillOpacity:0,interactive:false,className:'selection-ring'}).addTo(focusLayer);
}
function drawFleet() {
 $('#feed-status').textContent=feed.message(); $('#feed-status').classList.toggle('failure',feed.failed);
 const seen=new Set();
 for (const c of cars()) {
  if (!position(c.last)) continue;
  seen.add(c.device); const status=Fleet.positionStatus(c.last);
  const icon=L.divIcon({className:'',html:`<span class="car-pin ${status.state==='old'?'old':''} ${status.poor?'poor':''}">${esc(c.device)}${status.state==='old'?' · 舊位置':''}${status.poor?' · 精確度不佳':''}</span>`,iconAnchor:[14,14]});
  let layer=v2.vehicleLayers.get(c.device);
  if (!layer) {
   layer={marker:L.marker([c.last.lat,c.last.lng],{title:c.device,entityKind:'vehicle',entityId:c.device}).on('click',()=>selectVehicle(c.device)).addTo(groups.fleet),line:L.polyline([],{color:'#b5161b',weight:3,opacity:.45}).addTo(groups.fleet)};
   v2.vehicleLayers.set(c.device,layer);
  }
  layer.marker.setLatLng([c.last.lat,c.last.lng]).setIcon(icon);
  layer.line.setLatLngs(Fleet.trackSegments(c.track||[]).map(seg=>seg.map(p=>[p[0],p[1]])));
 }
 for (const [id,l] of v2.vehicleLayers) if(!seen.has(id)){groups.fleet.removeLayer(l.marker);groups.fleet.removeLayer(l.line);v2.vehicleLayers.delete(id);}
 renderContext();
}
function drawDeployment() {
 groups.areas.clearLayers(); groups.stations.clearLayers();
 cfg.areas.forEach((a,i)=>L.geoJSON(a.geometry,{style:{color:'#b5161b',weight:2,fillOpacity:.10},onEachFeature:(_,layer)=>{layer.options.entityKind='area';layer.options.entityId=i;layer.on('click',()=>selectArea(i));}}).addTo(groups.areas));
 cfg.stations.forEach((s,i)=>{if(position(s))L.marker([s.lat,s.lng],{title:s.name,entityKind:'station',entityId:i,icon:L.divIcon({className:'',html:`<span class="station-pin">${esc(s.name)}</span>`,iconAnchor:[14,14]})}).on('click',()=>selectStation(i)).addTo(groups.stations);});
}
function renderCatalog() {
 const q=$('#camera-search').value.trim().toLocaleLowerCase();
 const list=v2.cameras.filter(c=>(c.name+' '+c.id).toLocaleLowerCase().includes(q));
 $('#camera-count').textContent=v2.cameraState==='ready'?`${v2.cameras.length} 支`:v2.cameraState;
 $('#camera-list-status').textContent=v2.cameraState==='ready'?`顯示 ${list.length}／${v2.cameras.length} 支 · 不截斷清單`:`官方鏡頭清單${v2.cameraState}；可重新讀取。`;
 $('#camera-catalog').innerHTML=list.map(c=>`<button class="ghost entity-row" data-camera="${esc(c.id)}"><b>${esc(c.name)}</b><span class="note">鏡頭 ${esc(c.id)} · 點選觀看</span></button>`).join('');
}
async function loadCameras() {
 v2.cameraState='載入中'; renderCatalog();
 try {
  v2.cameras=Ops.cameras(await cctvLoad(),cfg.bounds); v2.cameraState='ready'; groups.cameras.clearLayers();
  for(const c of v2.cameras)L.marker([c.lat,c.lng],{title:c.name,entityKind:'camera',entityId:c.id,icon:L.divIcon({className:'',html:'<span class="camera-pin">▣</span>',iconAnchor:[14,14]})}).on('click',()=>selectCamera(c.id)).addTo(groups.cameras);
 } catch(e) {v2.cameraState='讀取失敗';}
 renderCatalog(); renderContext();
}
function loadFleet() {return feed.load(Number($('#minutes').value));}
document.addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b)return;
 if(b.hasAttribute('data-vehicle'))selectVehicle(b.dataset.vehicle);
 else if(b.hasAttribute('data-station'))selectStation(Number(b.dataset.station));
 else if(b.hasAttribute('data-area'))selectArea(Number(b.dataset.area));
 else if(b.hasAttribute('data-watch'))watchCamera(b.dataset.watch);
 else if(b.hasAttribute('data-camera'))selectCamera(b.dataset.camera);
});
$('#context-reset').onclick=overview;
$('#camera-close').onclick=closeCamera;
$('#camera-reconnect').onclick=()=>{if(v2.watching!==null)watchCamera(v2.watching);};
$('#camera-reload').onclick=loadCameras;
$('#camera-search').oninput=renderCatalog;
$('#minutes').onchange=loadFleet;
$('#layers').onchange=e=>{const group=groups[e.target.id.replace('layer-','')];if(!group)return;if(e.target.checked)group.addTo(map);else map.removeLayer(group);refreshSelection();};
new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('.map-cell'));
const fleetTimer=setInterval(loadFleet,15000), qualityTimer=setInterval(drawFleet,5000);
window.addEventListener('pagehide',()=>{closeCamera();clearInterval(fleetTimer);clearInterval(qualityTimer);});
drawDeployment();renderContext();loadFleet();loadCameras();
