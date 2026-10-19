// ---- 指揮面板（#command，2026-10-18）：給應變中心大螢幕，各級指揮官一眼看完「整個場子好不好、哪裡要處理」 ----
// 跟活動看板分工：活動看板給現場同仁查勤，這裡給長官綜觀；兩邊共用 activity-data.js 跨年那一則
// 參考國外做法：雪梨跨年分觀賞點管、FEMA 紅黃綠燈與「現況／影響／下一步／缺什麼」、費城只放位置＋狀態＋高優先事件
// 目前是示意版（command-data.js 假資料），網址加 ?preview=1 才進得去；底圖、監視器共用 actmap.js、cctv.js
// 要排在 actmap.js 後面、app.js 前面載入
// 唯一資料入口：只共用活動識別與底圖視角，不合併示意數據。
function cmdData() {
  const demo = COMMAND.demo === true, data = (demo ? COMMAND : COMMAND.live) || {};
  const result = { demo, act: COMMAND.act, center: COMMAND.center, zoom: COMMAND.zoom,
    stats: data.stats || {}, weather: data.weather || {}, countdown: data.countdown || {} };
  for (const key of ["phases", "zones", "issues", "posts", "cars", "social"])
    result[key] = Array.isArray(data[key]) ? data[key].filter(x => x && typeof x === "object") : [];
  result.phases = result.phases.filter(p => typeof p.from === "string" && /^\d{2}:\d{2}$/.test(p.from));
  for (const key of ["posts", "cars"])
    result[key] = result[key].filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  result.zones = result.zones.filter(z => z && (demo || z.approved === true) &&
    Object.hasOwn(CMD_LIGHT, z.light) && Array.isArray(z.box) && z.box.length === 2 &&
    z.box.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
  return result;
}
const CMD_LIGHT = { red: ["紅燈", "需決策"], amber: ["黃燈", "注意"], green: ["綠燈", "正常"] };
const CMD_COLOR = { red: "#e3262b", amber: "#f0a020", green: "#1f9d55" };
const CMD_RANK = { red: 0, amber: 1, green: 2 };
let cmdSel = null, cmdMapObj = null, cmdTimer = null, cmdFeats = null;
let cmdGeneration = 0, cmdMapRequest = 0, cmdCamRequest = 0;

// 示意資料與真實時鐘分開；cmdnow 只覆寫演練時鐘，不改示意資料年齡。
const cmdT0 = Date.now();
const cmdStart = (() => {
  const q = COMMAND.now;
  const t = Date.parse(q + "+08:00"); return isNaN(t) ? Date.now() : t;
})();
const cmdNow = () => COMMAND.demo === true ? cmdStart + (Date.now() - cmdT0) : Date.now();
const cmdRealStart = (() => {
  const q = new URLSearchParams(location.search).get('cmdnow');
  return q ? Date.parse(q + (/Z$|[+-]\d{2}:?\d{2}$/.test(q) ? '' : '+08:00')) : NaN;
})();
const cmdReal = () => Number.isFinite(cmdRealStart) ? cmdRealStart + Date.now() - cmdT0 : Date.now();
const cmdAt = (s) => Date.parse(s + "+08:00");
const cmdHm = (t, sec) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: sec ? "2-digit" : undefined, hourCycle: "h23" }).format(t);
const cmdMins = (t) => Number.isFinite(t) ? Math.max(0, Math.round((cmdNow() - t) / 60000)) : "待提供";
const cmdZone = (id) => cmdData().zones.find((z) => z.id === id);
const cmdMid = (z) => [(z.box[0][0] + z.box[1][0]) / 2, (z.box[0][1] + z.box[1][1]) / 2];
const cmdBadge = (l) => Object.hasOwn(CMD_LIGHT, l) ? `<span class="cmdlight ${l}"><i></i>${CMD_LIGHT[l][0]}・${CMD_LIGHT[l][1]}</span>` : '<span class="cmdlight">待提供</span>';

// 階段：過了中午以前的時間算隔天（跨年）
function cmdPhase() {
  const C = cmdData();
  if (!Number.isFinite(cmdAt(C.countdown.at))) return -1;
  const next = C.countdown.at.slice(0, 10), base = new Date(Date.parse(next + 'T12:00:00+08:00') - 86400000).toISOString().slice(0, 10);
  const at = C.phases.map((p) => cmdAt((Number(p.from.slice(0, 2)) < 12 ? next : base) + "T" + p.from));
  let cur = -1; at.forEach((t, i) => { if (cmdReal() >= t) cur = i; });
  return cur;
}

function renderCommand() {
  const reuse119 = cmd119Session && cmd119Current(cmd119Session) ? cmd119Session : null;
  if (!reuse119) cmd119Stop();
  else cmd119DetachMap(reuse119);
  cmdWeatherStop();
  cmdGeneration++;
  const C = cmdData(), act = (typeof ACTIVITIES !== "undefined" && ACTIVITIES.find((a) => a.id === C.act)) || { title: "跨年" };
  clearInterval(cmdCarTimer); cmdCarMarks = [];
  if (cmdMapObj) cmdMapObj.remove();
  cmdMapObj = null; cmdFeats = null;
  if ($("#cmdCams")) cctvStopIn($("#cmdCams"));
  cmdSel = ([...C.issues].sort((a, b) => CMD_RANK[a.level] - CMD_RANK[b.level]).map(x => x.zone).find(id => C.zones.some(z => z.id === id))) || C.zones[0]?.id || null;
  $("#view").innerHTML = `<div class="cmd" id="cmd">
    <div class="cmdtop">
      <div class="cmdtitle"><b>🎆 ${esc(act.title)}</b><span>指揮面板</span>${C.demo ? `<span class="tag warn cmddemo">示意</span>` : ""}</div>
      <ol class="cmdphase" id="cmdPhase"></ol>
      <div class="cmdclock"><b id="cmdClock">--:--:--</b><span id="cmdCount"></span></div>
      <button class="ghost cmdfull" id="cmdFull" title="整個面板放到全螢幕（大螢幕投影用）">⛶ 全螢幕</button>
      <div id="cmdWeatherWarning" class="cmdweather-warning" role="status" hidden></div>
    </div>
    <div class="cmdnums" id="cmdNums"></div>
    <section class="cmd119-bar" id="cmd119Bar" aria-label="119 即時案件"><div class="cmd119" id="cmd119" aria-live="polite"></div></section>
    <div class="cmdmain">
      <div class="cmdmapwrap"><div class="cmdmap" id="cmdMap"><div class="amaploading">地圖載入中…</div></div><button type="button" class="ghost cmd119-scope" id="cmd119Scope" aria-label="119 案件範圍：二大三區或全市" aria-pressed="false">二大三區</button></div>
      <aside class="cmdside" id="cmdSide" aria-live="polite"></aside>
    </div>
    <div class="cmdbottom">
      <section class="cmdbox"><h3 id="cmdCamHead">📹 路口影像</h3><div class="cmdcams"><figure class="cmdlive" id="cmdLive" hidden></figure><div id="cmdCams"></div></div></section>
      <section class="cmdbox"><h3>🦏 輿情警示<span>犀牛巡邏隊</span></h3><div id="cmdSocial"></div></section>
    </div>
  </div>`;
  $("#cmdFull").addEventListener("click", () => { const el = $("#cmd"); document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen && el.requestFullscreen().then(() => cmdMapObj && setTimeout(() => cmdMapObj.resize(), 200)).catch(() => {}); });
  $("#cmd").addEventListener("click", (e) => { const z = e.target.closest("[data-cmdzone]"); if (z) cmdPick(z.dataset.cmdzone, true); });
  $("#cmdLive").addEventListener("click", (e) => { const b = e.target.closest("[data-cmdlive]"); if (b) cmdLiveDraw(Number(b.dataset.cmdlive)); });
  cmdTick(); cmdNumsDraw(); cmdSideDraw(); cmdSocialDraw(); cmdMapDraw(); cmdLiveDraw(0); cmdCamsDraw();
  cmdWeatherStart();
  cmd119Start(reuse119);
  clearInterval(cmdTimer);
  cmdTimer = setInterval(() => {
    if (!$("#cmd")) { clearInterval(cmdTimer); cmdMapObj = null; return; }
    cmdTick();
    if (new Date().getSeconds() === 0) { cmdSideDraw(); cmdSocialDraw(); }   // 「已持續幾分鐘」每分鐘更新
  }, 1000);
}

function cmdTick() {
  const C = cmdData(), cur = cmdPhase();
  $("#cmdClock").textContent = cmdHm(cmdReal(), true);
  const left = Math.ceil((cmdAt(C.countdown.at) - cmdReal()) / 1000), count = $('#cmdCount');
  const pad = n => String(n).padStart(2, '0');
  count.textContent = !Number.isFinite(left) ? '待提供' : left <= -3600 ? '跨年已結束' : left <= 0 ? '🎆 新年快樂' : `距跨年 ${left >= 86400 ? Math.floor(left / 86400) + ' 天 ' : ''}${pad(Math.floor(left / 3600) % 24)}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)}`;
  if (left > 0 && left <= 60) count.innerHTML = count.textContent.replace(/(\d{2})$/, '<strong class="cmdcount-seconds">$1</strong>');
  const html = C.phases.map((p, i) => `<li class="${i < cur ? "done" : i === cur ? "on" : ""}"><b>${esc(p.name)}</b><span>${esc(p.from)}${cur < 0 ? '・未開始' : ''}</span></li>`).join("") || '<li>待提供</li>';
  if ($("#cmdPhase").innerHTML !== html) $("#cmdPhase").innerHTML = html;
}

function cmdNumsDraw() {
  const C = cmdData(), s = C.stats, n = { red: 0, amber: 0, green: 0 };
  const value = (v, unit = "") => v === null || v === undefined || v === "" ? "待提供" : esc(v) + unit;
  C.zones.forEach((z) => n[z.light]++);
  $("#cmdNums").innerHTML = `
    <div class="cmdnum lights${C.zones.length ? "" : " pending"}"><span>分區燈號</span><b><em class="red">${C.zones.length ? n.red : "待提供"}</em><em class="amber">${C.zones.length ? n.amber : "待提供"}</em><em class="green">${C.zones.length ? n.green : "待提供"}</em></b><small>紅・黃・綠</small></div>
    <div class="cmdnum"><span>救護出勤</span><b>${value(s.ems)}</b><small>送醫 ${value(s.hosp)}・現場處置 ${value(s.onsite)}</small></div>
    <div class="cmdnum"><span>救護車輛</span><b>${value(s.ambAll)}</b><small>位置・最後回報</small></div>
    <div class="cmdnum"><span>人力在崗</span><b>${value(s.staffOn)}<i>/${value(s.staffAll)}</i></b><small>在崗／總人力</small></div>
    <div class="cmdnum cmdweather pending" id="cmdWeather"><span>天氣</span><b>—</b><small>天氣載入中…</small></div>`;
}

// 右側：需處置（紅燈排最上面）＋全部分區燈號
function cmdSideDraw() {
  const C = cmdData(), list = [...C.issues].sort((a, b) => CMD_RANK[a.level] - CMD_RANK[b.level] || cmdAt(a.at) - cmdAt(b.at));
  const row = (k, v) => `<div><dt>${k}</dt><dd>${esc(v || "待提供")}</dd></div>`;
  $("#cmdSide").innerHTML = `<h3>⚠ 需處置<span>${list.length ? list.length + " 件" : "待提供"}</span></h3>
    ${list.length ? list.map((x) => { const z = cmdZone(x.zone); return `<article class="cmdissue ${esc(x.level || "")}${x.zone === cmdSel ? " sel" : ""}" data-cmdzone="${esc(x.zone || "")}" tabindex="0">
      <div class="cmdih">${cmdBadge(x.level)}<span class="cmdago">${Number.isFinite(cmdAt(x.at)) ? `已 ${cmdMins(cmdAt(x.at))} 分鐘` : "待提供"}</span></div>
      <b>${esc(z ? z.name : "")}｜${esc(x.title)}</b>
      <dl>${row("現況", x.what)}${row("影響", x.sowhat)}${row("下一步", x.nowwhat)}${row("缺什麼", x.gap)}</dl>
      ${x.ask ? `<p class="cmdask">👉 ${esc(x.ask)}</p>` : ""}</article>`; }).join("") : `<p class="note">待提供</p>`}

    <h3 class="cmdzh">分區燈號</h3>
    <ul class="cmdzones">${[...C.zones].sort((a, b) => CMD_RANK[a.light] - CMD_RANK[b.light]).map((z) => `<li><button class="ghost${z.id === cmdSel ? " on" : ""}" data-cmdzone="${esc(z.id)}"><i class="dot ${esc(z.light)}"></i><b>${esc(z.name)}</b><span>${esc(z.crowd || "待提供")}</span></button></li>`).join("") || '<li>待提供</li>'}</ul>`;
}

function cmdSocialDraw() {
  $("#cmdSocial").innerHTML = `<ul class="cmdsocial">${cmdData().social.map((s) => { const z = cmdZone(s.zone); return `<li data-cmdzone="${esc(s.zone || "")}"><span class="tag">${esc(s.src || "待提供")}</span><p>${esc(s.text || "待提供")}</p><small>${Number.isFinite(cmdAt(s.at)) ? `${cmdMins(cmdAt(s.at))} 分鐘前` : "待提供"}${z ? `・${esc(z.name)}` : ""}</small></li>`; }).join("") || '<li>待提供</li>'}</ul>`;
}

// 地圖：共用現場地圖的底圖；分區塗燈號色，點分區＝選這一區
async function cmdMapDraw() {
  const C = cmdData(), generation = cmdGeneration, request = ++cmdMapRequest, box = $("#cmdMap");
  const current = () => generation === cmdGeneration && request === cmdMapRequest && C.demo === (COMMAND.demo === true) && box === $("#cmdMap") && box?.isConnected;
  let style;
  try { await amapLoad(); style = await amapStyle(); } catch (e) {
    if (!current()) return;
    if ($("#cmdMap")) $("#cmdMap").innerHTML = `<div class="amaperr"><b>地圖載入失敗</b><p>其他資料不受影響。</p><button class="ghost" id="cmdMapRetry">🔄 重試</button></div>`;
    const b = $("#cmdMapRetry"); if (b) b.addEventListener("click", cmdMapDraw, { once: true });
    return;
  }
  if (!current()) return;
  const map = (cmdMapObj = new maplibregl.Map({ container: "cmdMap", style, center: [C.center[1], C.center[0]], zoom: C.zoom, pitch: 30, bearing: -15,
    localIdeographFontFamily: '"Noto Sans TC", sans-serif', attributionControl: { compact: true } }));
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
  // 一開就把所有分區框進畫面（象山、國父紀念館比較遠）
  const all = C.zones.flatMap((z) => z.box);
  const fit = () => map.fitBounds([[Math.min(...all.map((p) => p[1])), Math.min(...all.map((p) => p[0]))], [Math.max(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0]))]], { padding: 24, duration: 0, pitch: 20, bearing: -15 });
  map.once("load", () => {
    if (!current() || map !== cmdMapObj) return;
    $("#cmdMap .amaploading")?.remove();
    map.resize(); if (all.length) fit();
    const feats = C.zones.map((z, i) => { const [[s, w], [n, e]] = z.box; return { type: "Feature", id: i, properties: { id: z.id, color: CMD_COLOR[z.light], sel: z.id === cmdSel ? 1 : 0 }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }; });
    cmdFeats = { type: "FeatureCollection", features: feats };
    if (feats.length) {
    map.addSource("cmdzones", { type: "geojson", data: cmdFeats });
    map.addLayer({ id: "cmdzone-fill", type: "fill", source: "cmdzones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.32 } });
    map.addLayer({ id: "cmdzone-line", type: "line", source: "cmdzones", paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "sel"], 1], 5, 2] } });
    map.on("click", "cmdzone-fill", (e) => cmdPick(e.features[0].properties.id, false));
    map.on("mouseenter", "cmdzone-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "cmdzone-fill", () => { map.getCanvas().style.cursor = ""; });
    }
    const pin = (cls, txt, lat, lng, label, zone) => {
      const el = document.createElement("button"); el.type = "button"; el.className = "amappin " + cls; el.textContent = txt;
      if (zone) el.addEventListener("click", (x) => { x.stopPropagation(); cmdPick(zone, false); });
      new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map); el.setAttribute("aria-label", label || txt); el.title = label || txt;
    };
    const hasIssue = new Set(C.issues.map((x) => x.zone));
    // 地圖字要少：只有紅黃燈的分區掛名牌，綠燈只塗色（點了一樣會選）；救護站、車輛只放圖示，名稱滑過才出現
    C.zones.filter((z) => z.light !== "green").forEach((z) => { const [la, ln] = cmdMid(z); pin("cmdzlabel " + z.light, `${hasIssue.has(z.id) ? "⚠ " : ""}${z.name}`, la, ln, `${z.name}：${CMD_LIGHT[z.light].join("、")}`, z.id); });
    C.posts.forEach((p) => pin("post", "🏥", p.lat, p.lng, p.name));
    cmd119MapReady(map);
    if (typeof AMAP_FLEET !== "undefined") { cmdCarsLoad(map); clearInterval(cmdCarTimer); cmdCarTimer = setInterval(() => cmdCarsLoad(map), AMAP_REFRESH); }
  });
}

function cmdPick(id, fly) {
  if (!cmdZone(id)) return;
  cmdSel = id; cmdSideDraw(); cmdCamsDraw();
  if (!cmdMapObj || !cmdMapObj.getSource("cmdzones")) return;
  cmdFeats.features.forEach((f) => { f.properties.sel = f.properties.id === id ? 1 : 0; });
  cmdMapObj.getSource("cmdzones").setData(cmdFeats);
  if (fly) { const [la, ln] = cmdMid(cmdZone(id)); cmdMapObj.easeTo({ center: [ln, la], zoom: Math.max(cmdMapObj.getZoom(), 16), duration: 800 }); }
}

// 車輛：跟現場地圖同一個定位來源（actmap.js 的 AMAP_FLEET，手機 Traccar 回報），示意模式也用真車，不放假車。
// 只顯示位置＋最後回報；5 分鐘沒回報變灰、定位誤差太大標 ⚠，不推論「送醫中／待命」
let cmdCarMarks = [], cmdCarTimer = null;
async function cmdCarsLoad(map) {
  if (map !== cmdMapObj || !$("#cmdMap")) { if (map !== cmdMapObj) return; clearInterval(cmdCarTimer); return; }
  try {
    const r = await (await fetch(AMAP_FLEET, { method: "POST", body: JSON.stringify({ action: "fleet_data", minutes: 720 }) })).json();
    if (map !== cmdMapObj || !r.ok) throw 0;
    cmdCarMarks.forEach((m) => m.remove());
    cmdCarMarks = (r.cars || []).filter((c) => c.last && Number.isFinite(+c.last.lat) && Number.isFinite(+c.last.lng)).map((c) => {
      const old = Date.now() - c.last.t > 300000, far = c.last.acc !== "" && Number(c.last.acc) > AMAP_ACC_BAD;
      const el = document.createElement("button"); el.type = "button"; el.className = "amappin car" + (old ? " old" : ""); el.textContent = "🚒" + (far ? "⚠" : "");
      const mk = new maplibregl.Marker({ element: el }).setLngLat([+c.last.lng, +c.last.lat]).addTo(map);
      const label = `${c.device}｜${amapAgo(c.last.t)}回報${old ? "（超過 5 分鐘，位置可能過期）" : ""}${far ? `｜位置不準，誤差約 ${Math.round(c.last.acc)} 公尺` : ""}`;
      el.title = label; el.setAttribute("aria-label", label);
      return mk;
    });
  } catch (e) { /* 連不上就保留上一輪的車，下一輪再試 */ }
}

// 下方第一格：活動直播（activity-data.js 跨年那則的 map.lives，例如象山看台北），預設播第一支；
// 不跟著選分區重載，多支時下面列出來可切換（之後分隊回傳的直播也加在 lives）
const cmdLives = () => {
  const a = typeof ACTIVITIES !== "undefined" && ACTIVITIES.find((x) => x.id === COMMAND.act);
  return ((a && a.map && a.map.lives) || []).map((v) => ({ v, id: typeof amapYt === "function" ? amapYt(v.url) : "" })).filter((x) => x.id);
};
function cmdLiveDraw(i) {
  const box = $("#cmdLive"), lives = cmdLives(), l = lives[i];
  if (!box) return;
  box.hidden = !l;
  if (!l) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="amapvid"><iframe src="https://www.youtube.com/embed/${l.id}?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(l.v.name)}"></iframe><span class="tag cstate">📺 直播</span></div>
    <figcaption>${lives.length > 1 ? lives.map((x, j) => `<button class="ghost chip${j === i ? " on" : ""}" data-cmdlive="${j}">${esc(x.v.name)}</button>`).join("") : esc(l.v.name)}</figcaption>`;
}

// 下方：選定分區附近的路口影像（真的公開攝影機，不是假資料）；有直播時直播占第一格，監視器少放一支
function cmdCamsDraw() {
  const z = cmdZone(cmdSel), box = $("#cmdCams"), generation = cmdGeneration, request = ++cmdCamRequest, demo = COMMAND.demo === true;
  const current = () => generation === cmdGeneration && request === cmdCamRequest && demo === (COMMAND.demo === true) && cmdSel === z?.id && box?.isConnected;
  if (!box) return;
  cctvStopIn(box);
  box.innerHTML = '<p class="note">待提供</p>';
  const live = cmdLives().length ? "📺 直播＋" : "";
  $("#cmdCamHead").textContent = live + "📹 路口影像";
  if (!z) return;
  $("#cmdCamHead").innerHTML = `${live}📹 ${esc(z.name)} 附近路口影像<span>即時</span>`;
  cctvStopIn(box);
  box.innerHTML = `<p class="note">攝影機清單載入中…</p>`;
  cctvLoad().then(() => {
    if (!current()) return;
    const [la, ln] = cmdMid(z), cams = cctvNear(la, ln, cmdLives().length ? 2 : 3);
    if (!cams.length) { box.innerHTML = `<p class="note">這一區附近 700 公尺內沒有公開的路口攝影機。</p>`; return; }
    box.innerHTML = cams.map((c, i) => `<figure><div class="amapvid"><video muted playsinline></video><span class="tag cstate" id="cmdCs${i}">連線中…</span></div><figcaption>${esc(c.name)}</figcaption></figure>`).join("");
    box.querySelectorAll("video").forEach((v, i) => cctvPlay(v, cams[i].url, (t) => { if (!current()) return; const s = $("#cmdCs" + i); if (s) s.textContent = t; }));
  }).catch(() => { if (!current()) return; box.innerHTML = `<p class="note">攝影機清單載入失敗。<button class="ghost chip" id="cmdCamRetry">重試</button></p>`; $("#cmdCamRetry").addEventListener("click", cmdCamsDraw, { once: true }); });
}

// 119 僅接受轉接站白名單；不複製原物件，路名再降階，絕不讀取官網精確欄位。
function cmd119Model(payload) {
  if (payload?.ok !== true || !Array.isArray(payload.cases)) return null;
  const text = v => typeof v === 'string' ? v.slice(0, 120) : '';
  const cases = payload.cases.filter(c => c && typeof c === 'object').map(c => {
    const candidate = text(c.place).match(/^(?:臺北市|台北市)([\u4e00-\u9fff]{2,3}區)([\u4e00-\u9fff0-9]{1,30}?(?:大道|路|街))(?:([一二三四五六七八九十0-9]+段))?/);
    const match = candidate && !/[號楼樓室巷弄]/.test(candidate[2]) ? candidate : null;
    const valid = Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat >= 24.9 && c.lat <= 25.3 && c.lng >= 121.4 && c.lng <= 121.7;
    const t = typeof c.t === 'number' ? c.t : typeof c.t === 'string' ? Date.parse(c.t.replace(/\//g, '-').replace(' ', 'T') + (/Z$|[+-]\d{2}:?\d{2}$/.test(c.t) ? '' : '+08:00')) : NaN;
    const district = text(c.place).match(/^(?:臺北市|台北市)(中正區|大同區|中山區|松山區|大安區|萬華區|信義區|士林區|北投區|內湖區|南港區|文山區)/)?.[1];
    return {t:Number.isFinite(t) ? t : null, kind:text(c.kind), code:text(c.code), status:text(c.status),
      place:match ? match[0] : '位置待提供', district:district === c.district ? district : '', lat:valid ? c.lat : null, lng:valid ? c.lng : null};
  });
  return {cases, fetchedAt:cmdWeatherTime(payload.fetchedAt), stale:payload.stale === true};
}

let cmd119Session = null;
const cmd119Type = c => c.kind === '火災' ? 'fire' : c.kind === '救護' ? 'ems' : 'other';
const cmd119Label = c => `${c.t === null ? '--:--' : cmdHm(c.t)} ${c.kind || '其他'}｜${c.place}｜${c.status || '待提供'}`;
const cmd119Key = c => JSON.stringify([c.t, c.kind, c.place]);
function cmd119Clear() {
  const s = cmd119Session;
  if (!s) return;
  s.selected = null;
  const popup = s.popup; s.popup = null; popup?.remove();
  cmd119Draw();
}
function cmd119DetachMap(s) {
  s.map?.off?.('click', s.mapClick);
  const popup = s.popup; s.popup = null; popup?.remove();
  s.marks.forEach(m => m.remove()); s.marks = []; s.map = null;
}
function cmd119Popup(s, c) {
  if (!s.map || s.map !== cmdMapObj) return;
  if (!s.popup) {
    const popup = s.popup = new maplibregl.Popup({closeOnClick:false, maxWidth:'320px'});
    popup.setLngLat([c.lng,c.lat]).setText(cmd119Label(c)).addTo(s.map);
    popup.on('close', () => {if (s === cmd119Session && s.popup === popup) cmd119Clear();});
  } else s.popup.setLngLat([c.lng,c.lat]).setText(cmd119Label(c));
}
function cmd119Select(c) {
  const s = cmd119Session;
  if (!s || !cmd119Current(s) || !c || c.lat === null || c.lng === null || !s.map || s.map !== cmdMapObj) return;
  const popup = s.popup; s.popup = null; popup?.remove();
  s.selected = cmd119Key(c); s.pulse = true;
  cmd119Draw();
  const box = $('#cmdMap'), rect = box?.getBoundingClientRect();
  if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) box.scrollIntoView({block:'center',behavior:'smooth'});
  s.map.flyTo({center:[c.lng,c.lat],zoom:18,duration:800});
  const list = cmd119Visible(s.model,s.city);
  $('#cmd119')?.querySelectorAll('[data-cmd119]').forEach(row => {
    if (cmd119Key(list[Number(row.dataset.cmd119)]) === s.selected) row.scrollIntoView({inline:'nearest',block:'nearest',behavior:'smooth'});
  });
}
function cmd119Draw() {
  const s = cmd119Session, box = $('#cmd119');
  if (!s || !box) return;
  const list = cmd119Visible(s.model, s.city), model = s.model;
  const selected = list.find(c => cmd119Key(c) === s.selected && c.lat !== null && c.lng !== null);
  if (!selected) {s.selected = null; const popup = s.popup; s.popup = null; popup?.remove();}
  const scroll = box.querySelector?.('ul')?.scrollLeft || 0;
  const delayed = model && (model.stale || !Number.isFinite(model.fetchedAt) || Date.now() - model.fetchedAt > 120000 || model.fetchedAt > Date.now() + 300000);
  const totals = {fire:0, ems:0, other:0}; list.forEach(c => totals[cmd119Type(c)]++);
  const bar = $('#cmd119Bar');
  if (bar) bar.className = 'cmd119-bar' + (totals.fire ? ' has-fire' : '');
  box.innerHTML = `<div class="cmd119-summary${totals.fire ? ' has-fire' : ''}"><b>🚒 119 ${s.city ? '全市' : '二大三區'}</b><span>火災 ${totals.fire}・救護 ${totals.ems}・其他 ${totals.other}</span><a class="cmd119-source" href="https://service119.119.gov.taipei/service119/accCase" target="_blank" rel="noopener noreferrer">${model ? `更新 ${Number.isFinite(model.fetchedAt) ? cmdHm(model.fetchedAt) : '時間待提供'}・` : ''}資料來源：臺北市消防局</a></div>
    <ul aria-label="119 案件列">${list.map((c,i) => `<li><button type="button" class="cmd119-row ${cmd119Type(c)}${cmd119Key(c) === s.selected ? ' selected' : ''}" aria-pressed="${cmd119Key(c) === s.selected}" data-cmd119="${i}" ${c.lat === null || c.lng === null ? 'disabled' : ''} title="${esc(cmd119Label(c))}" aria-label="${esc(cmd119Label(c))}"><b>${c.t === null ? '--:--' : cmdHm(c.t)} ${c.kind === '火災' ? '🔥' : c.kind === '救護' ? '🚑' : '⚠'} ${esc(c.kind || '其他')}</b><span>${esc(c.place.replace(/^(?:臺北市|台北市)[\u4e00-\u9fff]{2,3}區/, ''))}</span><small>${esc(c.status || '待提供')}${c.lat === null || c.lng === null ? '・無定位' : ''}</small></button></li>`).join('')}${!model || !list.length ? `<li class="cmd119-status" role="status">${!model ? (s.loading ? '119 資料載入中…' : '119 資料暫時無法取得') : '目前無案件'}</li>` : ''}</ul>${delayed ? '<span class="cmd119-delay">資料可能延遲</span>' : ''}`;
  const toggle = $('#cmd119Scope');
  const strip = box.querySelector?.('ul'); if (strip) strip.scrollLeft = scroll;
  if (toggle) {toggle.textContent = s.city ? '全市' : '二大三區'; toggle.setAttribute('aria-pressed', String(s.city));}
  cmd119Markers();
  if (selected) cmd119Popup(s,selected);
}
function cmd119MapReady(map) {
  const s = cmd119Session;
  if (!s || !cmd119Current(s) || map !== cmdMapObj) return;
  if (s.map !== map) {
    cmd119DetachMap(s); s.map = map;
    s.mapClick = e => {
      if (cmd119Current(s) && !e.originalEvent?.target?.closest?.('.c119, .maplibregl-popup')) cmd119Clear();
    };
    map.on?.('click', s.mapClick);
  }
  cmd119Draw();
}
function cmd119Markers() {
  const s = cmd119Session;
  if (!s) return;
  s.marks.forEach(m => m.remove()); s.marks = [];
  if (!s.map || s.map !== cmdMapObj || !cmd119Current(s)) return;
  cmd119Visible(s.model, s.city).filter(c => c.lat !== null && c.lng !== null).forEach(c => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'amappin c119 ' + cmd119Type(c);
    const selected = cmd119Key(c) === s.selected;
    el.classList.toggle('selected',selected);
    el.classList.toggle('pulse',selected && s.pulse === true);
    el.innerHTML = `<span aria-hidden="true">${c.kind === '火災' ? '🔥' : c.kind === '救護' ? '🚑' : '⚠'}</span><small aria-hidden="true">119</small>`;
    el.addEventListener('click', e => {e.stopPropagation();cmd119Select(c);});
    el.title = cmd119Label(c); el.setAttribute('aria-label', el.title);
    s.marks.push(new maplibregl.Marker({element:el}).setLngLat([c.lng,c.lat]).addTo(s.map));
    el.setAttribute('aria-label', el.title);
  });
  s.pulse = false;
}
function cmd119Stop() {
  const s = cmd119Session; cmd119Session = null;
  if (!s) return;
  clearInterval(s.timer); s.abort?.abort(); s.life?.abort(); s.observer?.disconnect();
  cmd119DetachMap(s); s.selected = null;
}
function cmd119Current(s) {
  return s === cmd119Session && s.generation === cmdGeneration && s.root.isConnected && s.root === $('#cmd');
}
async function cmd119Update() {
  const s = cmd119Session;
  if (!s) return;
  if (!cmd119Current(s)) {cmd119Stop(); return;}
  s.abort?.abort();
  const controller = s.abort = new AbortController();
  const payload = await cmdWeatherJSON(COMMAND.c119.url, controller.signal);
  if (!cmd119Current(s) || s.abort !== controller || controller.signal.aborted) return;
  s.loading = false; s.model = cmd119Model(payload); cmd119Draw();
}
function cmd119Start(reuse) {
  if (!reuse || reuse !== cmd119Session) {cmd119Stop(); reuse = null;}
  const root = $('#cmd');
  if (!root) return;
  const s = cmd119Session = reuse || {model:null, city:false, marks:[]};
  s.life?.abort(); s.observer?.disconnect();
  s.marks.forEach(m => m.remove()); s.marks = [];
  if (reuse) s.map = null;
  s.root = root; s.generation = cmdGeneration;
  s.life = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (!s.life) {cmd119Draw(); return;}
  root.addEventListener('click', e => {
    if (!cmd119Current(s)) return;
    const row = e.target.closest('[data-cmd119]');
    if (!row) return;
    const c = cmd119Visible(s.model, s.city)[Number(row.dataset.cmd119)];
    cmd119Select(c);
  }, {signal:s.life.signal});
  $('#cmd119Scope')?.addEventListener('click', () => {
    if (!cmd119Current(s)) return;
    s.city = !s.city; cmd119Draw();
  }, {signal:s.life.signal});
  if (typeof MutationObserver !== 'undefined') {
    s.observer = new MutationObserver(() => {if (s === cmd119Session && !cmd119Current(s)) cmd119Stop();});
    s.observer.observe($('#view'), {childList:true});
  }
  const url = COMMAND.c119?.url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) {cmd119Draw(); return;}
  if (reuse) {cmd119Draw(); return;}
  s.loading = true; cmd119Draw();
  s.timer = setInterval(cmd119Update, Math.max(60000, Number(COMMAND.c119.refresh) || 60000));
  return cmd119Update();
}
if (typeof window !== 'undefined') window.addEventListener('pagehide',cmd119Stop);

function cmd119Visible(model, city) {
  const districts = COMMAND.c119?.districts || [];
  return (model?.cases || []).filter(c => city || districts.includes(c.district))
    .sort((a,b) => Number(b.kind === '火災') - Number(a.kind === '火災') || (b.t ?? -Infinity) - (a.t ?? -Infinity));
}

// 天氣獨立更新：不重建地圖、直播或其他數字卡。
const CMD_WEATHER_GAS = 'https://script.google.com/macros/s/AKfycbxaRInBXGJKDL0NWFtVubK-1FRanX-vojUSUTlOB80sh7VrNdYUSJvtx3G5CLG14gI-LA/exec';
const CMD_WEATHER_METEO = 'https://api.open-meteo.com/v1/forecast?latitude=25.0340&longitude=121.5645&timezone=Asia%2FTaipei&wind_speed_unit=ms&forecast_hours=4&hourly=precipitation_probability,wind_speed_10m&current=temperature_2m,weather_code,wind_speed_10m';
let cmdWeatherSession = null;
function cmdWeatherTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !value.trim()) return NaN;
  return Date.parse(value + (/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? '' : '+08:00'));
}
function cmdWeatherNumber(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function cmdWeatherSky(code) {
  const labels = {0:'晴',1:'晴時多雲',2:'多雲',3:'陰',45:'霧',48:'霧',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',56:'凍毛毛雨',57:'凍毛毛雨',61:'小雨',63:'雨',65:'大雨',66:'凍雨',67:'凍雨',71:'小雪',73:'雪',75:'大雪',77:'雪粒',80:'陣雨',81:'陣雨',82:'強陣雨',85:'陣雪',86:'強陣雪',95:'雷雨',96:'雷雨伴冰雹',99:'雷雨伴冰雹'};
  return labels[code] || '待提供';
}
function cmdWeatherModel(gas, meteo, now) {
  const fresh = t => Number.isFinite(t) && now - t <= 90 * 60000 && t - now <= 5 * 60000;
  const obs = gas?.ok === true ? gas.obs : null, ot = cmdWeatherTime(obs?.time);
  const current = meteo?.current, mt = cmdWeatherTime(current?.time);
  let observation = null;
  if (obs && fresh(ot) && cmdWeatherNumber(obs.temp) !== null) {
    observation = {temp:obs.temp, sky:typeof obs.weather === 'string' ? obs.weather : '待提供', wind:cmdWeatherNumber(obs.wind), rain:cmdWeatherNumber(obs.rainToday), time:ot, source:`氣象署${typeof obs.station === 'string' ? obs.station : ''}站`};
  } else if (current && fresh(mt) && cmdWeatherNumber(current.temperature_2m) !== null) {
    observation = {temp:current.temperature_2m, sky:cmdWeatherSky(current.weather_code), wind:cmdWeatherNumber(current.wind_speed_10m), rain:null, time:mt, source:'備援：Open-Meteo'};
  }
  const officialKnown = gas?.ok === true && fresh(cmdWeatherTime(gas.at ?? obs?.time)) && Array.isArray(gas.warnings);
  const warnings = officialKnown ? gas.warnings.filter(w => w && typeof w.name === 'string' && cmdWeatherTime(w.start) <= now && cmdWeatherTime(w.end) > now).map(w => ({name:w.name,end:cmdWeatherTime(w.end)})) : [];
  const hourly = meteo?.hourly;
  const forecast = Array.isArray(hourly?.time) ? hourly.time.map((t,i) => ({at:cmdWeatherTime(t), rain:cmdWeatherNumber(hourly.precipitation_probability?.[i]), wind:cmdWeatherNumber(hourly.wind_speed_10m?.[i])})).filter(p => p.at > now && p.at <= now + 3 * 3600000).sort((a,b) => a.at-b.at).slice(0,3).map(p => ({...p,time:cmdHm(p.at)})) : [];
  return {current:observation,forecast,warnings,officialKnown};
}
function cmdWeatherDraw(model) {
  const card = $('#cmdWeather'), bar = $('#cmdWeatherWarning');
  if (!card || !bar) return;
  const c = model.current, warnings = model.warnings;
  card.classList.toggle('cmdweather-warn',warnings.length > 0);
  card.classList.toggle('pending',!c);
  const value = (v,unit) => v === null ? '—' : esc(v) + unit;
  // 卡片維持跟其他數字卡同高：來源放標題列，預報濃縮成一行降雨機率；未來 3 小時風速 ≥10 m/s 才另外提醒
  const strong = Math.max(...model.forecast.map(p => p.wind ?? 0), 0);
  const fc = model.forecast.length ? '預報 ' + model.forecast.map(p => `${p.time.slice(0, 2)}時 ${value(p.rain, '%')}`).join('・') + (strong >= 10 ? `・<em>強風 ${strong.toFixed(1)} m/s</em>` : '') : '預報待提供';
  card.innerHTML = c ? `<span>天氣<i class="cmdweather-source">${esc(c.source)} ${cmdHm(c.time)}${model.officialKnown ? '' : '・特報待確認'}</i></span><b>${esc(c.temp)}°C</b><small>${esc(c.sky)}・風 ${c.wind === null ? '—' : c.wind.toFixed(1) + ' m/s'}・今日雨量 ${value(c.rain, ' mm')}</small><small class="cmdforecast">${fc}</small>` : '<span>天氣</span><b>—</b><small>天氣暫時無法取得</small>';
  bar.hidden = warnings.length === 0;
  bar.textContent = warnings.map(w => `${w.name} 至 ${cmdHm(w.end)}`).join('；');
}
function cmdWeatherStop() {
  const s = cmdWeatherSession;
  cmdWeatherSession = null;
  if (!s) return;
  clearInterval(s.timer); s.abort?.abort(); s.observer?.disconnect();
}
async function cmdWeatherJSON(url, parentSignal) {
  const controller = new AbortController();
  let timer, finish;
  const cancelled = new Promise(resolve => {finish = resolve;});
  const cancel = () => {controller.abort(); finish(null);};
  parentSignal.addEventListener('abort',cancel,{once:true});
  if (parentSignal.aborted) cancel();
  timer = setTimeout(cancel,10000);
  try {
    return await Promise.race([cancelled, (async () => {
      try {const r = await fetch(url,{signal:controller.signal}); return r.ok ? await r.json() : null;} catch (_) {return null;}
    })()]);
  } finally {clearTimeout(timer); parentSignal.removeEventListener('abort',cancel);}
}
async function cmdWeatherUpdate() {
  const s = cmdWeatherSession;
  if (!s || !s.root.isConnected || s.root !== $('#cmd')) {cmdWeatherStop(); return;}
  s.abort?.abort();
  const controller = new AbortController(); s.abort = controller;
  const [gas,meteo] = await Promise.all([cmdWeatherJSON(CMD_WEATHER_GAS,controller.signal),cmdWeatherJSON(CMD_WEATHER_METEO,controller.signal)]);
  if (s !== cmdWeatherSession || s.abort !== controller || controller.signal.aborted || !s.root.isConnected) return;
  cmdWeatherDraw(cmdWeatherModel(gas,meteo,Date.now()));
}
function cmdWeatherStart() {
  cmdWeatherStop();
  const root = $('#cmd');
  if (!root || typeof fetch !== 'function' || typeof AbortController === 'undefined') return;
  const s = cmdWeatherSession = {root};
  if (typeof MutationObserver !== 'undefined') {
    s.observer = new MutationObserver(() => {if (s === cmdWeatherSession && (!root.isConnected || root !== $('#cmd'))) cmdWeatherStop();});
    s.observer.observe($('#view'),{childList:true});
  }
  s.timer = setInterval(cmdWeatherUpdate,600000);
  return cmdWeatherUpdate();
}
if (typeof window !== 'undefined') window.addEventListener('pagehide',cmdWeatherStop);
