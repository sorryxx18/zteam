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

// 示意畫面的時鐘：從 COMMAND.now（或網址 ?cmdnow=）開始照真實速度走
const cmdT0 = Date.now();
const cmdStart = (() => {
  const q = new URLSearchParams(location.search).get("cmdnow") || COMMAND.now;
  const t = Date.parse(q + "+08:00"); return isNaN(t) ? Date.now() : t;
})();
const cmdNow = () => COMMAND.demo === true ? cmdStart + (Date.now() - cmdT0) : Date.now();
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
  const base = C.countdown.at.slice(0, 10), next = new Date(Date.parse(base + "T12:00:00+08:00") + 86400000).toISOString().slice(0, 10);
  const at = C.phases.map((p) => cmdAt((Number(p.from.slice(0, 2)) < 12 ? next : base) + "T" + p.from));
  let cur = -1; at.forEach((t, i) => { if (cmdNow() >= t) cur = i; });
  return cur;
}

function renderCommand() {
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
    </div>
    <div class="cmdnums" id="cmdNums"></div>
    <div class="cmdmain">
      <div class="cmdmap" id="cmdMap"><div class="amaploading">地圖載入中…</div></div>
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
  clearInterval(cmdTimer);
  cmdTimer = setInterval(() => {
    if (!$("#cmd")) { clearInterval(cmdTimer); cmdMapObj = null; return; }
    cmdTick();
    if (new Date().getSeconds() === 0) { cmdSideDraw(); cmdSocialDraw(); }   // 「已持續幾分鐘」每分鐘更新
  }, 1000);
}

function cmdTick() {
  const C = cmdData(), cur = cmdPhase();
  $("#cmdClock").textContent = cmdHm(cmdNow(), true);
  const left = Math.round((cmdAt(C.countdown.at) - cmdNow()) / 1000);
  $("#cmdCount").textContent = !Number.isFinite(left) ? "待提供" : left > 0 ? `距 ${C.countdown.name || "待提供"} ${Math.floor(left / 3600) ? Math.floor(left / 3600) + ":" : ""}${String(Math.floor(left / 60) % 60).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}` : `${C.countdown.name || "待提供"}已結束`;
  const html = C.phases.map((p, i) => `<li class="${i < cur ? "done" : i === cur ? "on" : ""}"><b>${esc(p.name)}</b><span>${esc(p.from)}</span></li>`).join("") || '<li>待提供</li>';
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
    <div class="cmdnum"><span>天氣</span><b>${value(C.weather.temp, "°C")}</b><small>${value(C.weather.sky)}・降雨 ${value(C.weather.rain, "%")}・${value(C.weather.wind)}</small></div>`;
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
