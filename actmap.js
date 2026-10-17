// ---- 活動看板：現場地圖（2026-10-17，跨年起用；活動資料加 map: {...} 就會出現） ----
// 圖層：🚒 車輛（Traccar Client 手機回報，後端 fleet_data）、📺 直播（YouTube）、📹 路口監視器（cctv.js）、🚧 管制區、📍 進駐點
// 管制區、進駐點、直播寫在 activity-data.js 的 map 裡；沒有資料的圖層不顯示按鈕
// 底圖（使用者定）：Mini Motorways 卡通極簡風。柔和底色、白色圓角道路、無黑邊、建築是柔和色積木、預設傾斜 40°（可切平面）
// 字體統一思源黑體 Noto Sans TC：路名 Medium 14–16px（手機 13–14）、地標 Medium 13–15、行政區 Bold 16–18、深藍灰；字少、自動避開重疊
// 數字英文用 fonts/ 裡自製的字型檔（fontnik 從 Noto Sans TC 500／700 產生，只放非中文區段），中文交給瀏覽器用同一套網頁字型畫
// 要排在 activity.js 後面、app.js 前面載入；MapLibre 用到才載
const AMAP_FLEET = "https://script.google.com/macros/s/AKfycbzSyTTFT7Vz1Z1Cr64hhixU7xvdJpgJ30BK14ZOhv2jh0LJX6REFSfh_-HL9D3hs2iN/exec";
const AMAP_LIB = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
const AMAP_FONT_CSS = "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@500;700&display=swap";
const AMAP_REFRESH = 15000;
const AMAP_BASE = new URL(".", document.currentScript ? document.currentScript.src : location.href).href;   // 網站根目錄（大螢幕頁在 fleet-test/ 底下也要找得到字型檔）
const AMAP_PITCH = 40;
const amaps = {};
// 雙螢幕（2026-10-17 使用者：當天可能開兩個畫面）：網頁地圖點了什麼，同一台電腦上開著的大螢幕視窗（fleet-test/3d.html）跟著飛過去打開
const amapBus = "BroadcastChannel" in window ? new BroadcastChannel("zteam-amap") : null;   // 活動 id → { map, marks: {car:[], ...}, on, timer }
let amapJob = null, amapStyleJob = null;
function amapLoad() {
  if (!amapJob) amapJob = new Promise((ok, fail) => {
    [AMAP_LIB + ".css", AMAP_FONT_CSS].forEach((h) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = h; document.head.appendChild(l); });
    if (window.maplibregl) return ok();
    const js = document.createElement("script"); js.src = AMAP_LIB + ".js"; js.onload = ok; js.onerror = () => { amapJob = null; js.remove(); fail(new Error("maplibre")); }; document.head.appendChild(js);
  }).then(() => Promise.all([document.fonts.load('500 16px "Noto Sans TC"', "臺北市信義路"), document.fonts.load('700 16px "Noto Sans TC"', "信義區")]).catch(() => {}));
  return amapJob;
}
// 底圖樣式：拿 OpenFreeMap liberty（免金鑰）只留需要的圖層、全部重新配色
function amapStyle() {
  if (amapStyleJob) return amapStyleJob;
  return (amapStyleJob = fetch("https://tiles.openfreemap.org/styles/liberty").then((r) => r.json()).then((st) => {
    const BG = "#f3f0e8", PARK = "#d5e4c8", WATER = "#bcd8e8", ROAD = "#ffffff", TEXT = "#3e4a5c";
    const small = window.innerWidth < 760, s = (a, b) => (small ? a : b);
    const name = ["coalesce", ["get", "name:zh-Hant"], ["get", "name:zh"], ["get", "name"]];
    const W = (pts) => ["interpolate", ["exponential", 1.6], ["zoom"], ...pts];
    const road = (a) => ({ w: W(a) }), minor = [13, 0.8, 16, 6, 18, 14], sec = [12, 1, 16, 9, 18, 18], pri = [10, 1.5, 16, 12, 18, 22], mot = [9, 2, 16, 14, 18, 26], lnk = [12, 1, 16, 6, 18, 12];
    // 柔和積木色（低飽和），依建物 id 輪流
    const blocks = ["#e8a7a1", "#ecc196", "#ecd99b", "#a9d2cf", "#b0b8dc", "#c9b3d6", "#b8d4ae"];
    const keep = {
      background: { paint: { "background-color": BG } },
      park: { paint: { "fill-color": PARK, "fill-opacity": 1 } }, landcover_wood: { paint: { "fill-color": PARK, "fill-opacity": 1 } }, landcover_grass: { paint: { "fill-color": PARK, "fill-opacity": 1 } },
      water: { paint: { "fill-color": WATER } }, waterway_river: { paint: { "line-color": WATER } },
      road_minor: road(minor), road_secondary_tertiary: road(sec), road_trunk_primary: road(pri), road_motorway: road(mot), road_motorway_link: road(lnk), road_link: road(lnk),
      bridge_street: road(minor), bridge_secondary_tertiary: road(sec), bridge_trunk_primary: road(pri), bridge_motorway: road(mot),
      road_major_rail: { paint: { "line-color": "#d9d2c3", "line-width": W([12, 1, 18, 3]) } },
      "building-3d": { paint: {
        "fill-extrusion-color": ["match", ["%", ["to-number", ["coalesce", ["id"], 0]], 7], ...blocks.slice(0, 6).flatMap((c, i) => [i, c]), blocks[6]],
        "fill-extrusion-height": ["min", 40, ["*", 0.35, ["coalesce", ["get", "render_height"], 10]]], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 } },
      label_city: { font: "Bold", size: s(16, 18), min: 0 }, label_town: { font: "Bold", size: s(16, 17), min: 12 }, label_village: { font: "Bold", size: s(15, 16), min: 14 },
      "highway-name-major": { font: "Medium", size: W([14, s(13, 14), 17, s(14, 16)]), min: 15, line: true },
      poi_r1: { font: "Medium", size: s(13, 14), min: 16, poi: true },
    };
    st.layers = st.layers.filter((l) => keep[l.id]).map((l) => {
      const k = keep[l.id], p = (l.paint = Object.assign(l.paint || {}, k.paint || {})), lay = (l.layout = l.layout || {});
      if (k.w) { p["line-color"] = ROAD; p["line-width"] = k.w; p["line-opacity"] = 1; delete p["line-dasharray"]; lay["line-cap"] = "round"; lay["line-join"] = "round"; }
      if (k.font) {
        lay["text-field"] = name; lay["text-font"] = ["Noto Sans TC " + k.font]; lay["text-size"] = k.size;
        lay["text-padding"] = 12; lay["text-letter-spacing"] = 0.04; lay["text-max-width"] = 8; delete lay["icon-image"];
        if (k.line) lay["symbol-spacing"] = 400;   // 同一條路的名字不要一直重複
        p["text-color"] = TEXT; p["text-halo-color"] = "rgba(255,255,255,.9)"; p["text-halo-width"] = 1.6; p["text-halo-blur"] = 0.4;
        l.minzoom = Math.max(l.minzoom || 0, k.min || 0);
        if (k.poi) l.filter = ["all", ["has", "name"], ["<=", ["get", "rank"], 2]];   // 只留最重要的地標
      }
      return l;
    });
    st.glyphs = AMAP_BASE + "fonts/{fontstack}/{range}.pbf";
    return st;
  }).catch((e) => { amapStyleJob = null; throw e; }));
}
// YouTube 網址 → 影片 ID（youtu.be/ID、watch?v=ID、/live/ID、/embed/ID）
function amapYt(u) { const m = String(u || "").match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/)([\w-]{11})/); return m ? m[1] : ""; }
const amapAgo = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分鐘前` : `${Math.floor(s / 3600)} 小時前`; };

// ---- 2026-10-17 impeccable 評分後改版（使用者：都做）----
// 1 監視器縮小時合併成「📹N」泡泡；2 有現場地圖時不再另外列「附近即時影像」，地點按鈕改成讓地圖飛過去；
// 3 手機點了東西從下面滑出浮層；4 角落顯示資料更新時間與圖例、大螢幕標連動燈；5 側欄預設「現在概況」、內容有「×」關閉；
// 大螢幕「指揮模式」：左上固定概況數字，沒人操作時右側輪播各地點最近的鏡頭
const AMAP_CLUSTER_PX = 46;     // 監視器在畫面上距離小於這個就合併
const AMAP_ROTATE = 20000;      // 指揮模式輪播間隔
const AMAP_IDLE = 60000;        // 有人點過以後，停多久才恢復輪播
function amapHtml(a, big) {
  const m = a.map, has = { car: true, cam: true, zone: (m.zones || []).length, post: (m.posts || []).length, live: (m.lives || []).length };
  const btn = [["car", "🚒 車輛"], ["live", "📺 直播"], ["cam", "📹 監視器"], ["zone", "🚧 管制區"], ["post", "📍 進駐點"]].filter(([k]) => has[k]);
  const spots = (a.spots || []).map((p, i) => `<button class="ghost chip amapgo" data-amapgo="${i}" title="地圖移到${esc(p.name)}">📌 ${esc(p.name)}</button>`).join("");
  return `<h3 class="chead">🗺 現場地圖<span>即時</span></h3>
    <div class="amapbar chips">${btn.map(([k, n]) => `<button class="ghost chip on" data-amap="${k}" aria-pressed="true">${n}</button>`).join("")}<span class="amapsp"></span><button class="ghost chip" data-amap3d="1">平面</button>${big ? "" : `<button class="ghost chip" data-amapbig="1" title="開一個全螢幕地圖視窗，拖到第二個螢幕；這裡點什麼，那邊跟著動">🖥 大螢幕</button>`}</div>
    ${spots ? `<div class="amapbar amapspots chips">${spots}</div>` : ""}
    <div class="amapwrap"><div class="amapmap" id="amapMap-${a.id}"><div class="amapstat" id="amapStat-${a.id}"></div>${big ? `<div class="amapcmd" id="amapCmd-${a.id}"></div>` : ""}</div><aside class="amapside" id="amapSide-${a.id}" aria-live="polite"></aside></div>`;
}

async function drawAmap(a) {
  const box = $("#actMap-" + a.id);
  if (!box || amaps[a.id]) return;
  amaps[a.id] = { pending: true };   // 載入期間又被叫一次時不要建兩張
  const big = box.classList.contains("amapbig");
  box.innerHTML = amapHtml(a, big);
  let style;
  try { await amapLoad(); style = await amapStyle(); } catch (e) {
    box.querySelector(".amapmap").innerHTML = `<div class="amaperr"><b>地圖載入失敗</b><p>可能是網路不通或地圖服務暫時連不上，其他資料不受影響。</p><button class="ghost" data-amapretry="1">🔄 重試</button></div>`;
    delete amaps[a.id];
    box.querySelector("[data-amapretry]").addEventListener("click", () => drawAmap(a), { once: true });
    return;
  }
  const m = a.map, map = new maplibregl.Map({ container: "amapMap-" + a.id, style, center: [m.center[1], m.center[0]], zoom: m.zoom || 16, pitch: AMAP_PITCH, bearing: -15,
    localIdeographFontFamily: '"Noto Sans TC", sans-serif', attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
  map.scrollZoom.disable();
  const st = Object.assign(amaps[a.id] || {}, { map, marks: { car: [], cam: [], post: [], live: [] }, on: { car: true, cam: true, zone: true, post: true, live: true },
    timer: null, pending: false, carErr: false, keys: {}, cams: [], cars: [], carAt: 0, linkAt: 0, idleAt: 0, rot: 0, big });
  amaps[a.id] = st;
  const side = $("#amapSide-" + a.id), stat = $("#amapStat-" + a.id);

  // 側欄：預設「現在概況」，點了東西換成內容＋「×」
  const overview = () => {
    const on = st.cars.filter((c) => Date.now() - c.last.t <= 300000).length;
    return `<div class="amaphead"><b>現在概況</b></div>
      <div class="amapnums"><div><b>${on}</b><span>車輛在線</span></div><div><b>${st.cars.length - on}</b><span>超過 5 分鐘未回報</span></div>
      <div><b>${(m.lives || []).length}</b><span>直播</span></div><div><b>${st.cams.length}</b><span>路口監視器</span></div>
      ${(m.zones || []).length ? `<div><b>${m.zones.length}</b><span>管制區</span></div>` : ""}${(m.posts || []).length ? `<div><b>${m.posts.length}</b><span>進駐點</span></div>` : ""}</div>
      <p class="note">點地圖上的車輛、直播、監視器或進駐點看詳細；監視器點了會直接播放。</p>`;
  };
  // 看內容時，下方仍保留概況數字（手機浮層、大螢幕不顯示）
  const showSide = (html, sel) => { cctvStopIn(side); side.querySelectorAll("iframe").forEach((f) => f.remove()); side.classList.toggle("sel", !!sel); side.innerHTML = sel ? `<button class="amapx" data-amapx="1" aria-label="關閉，回到概況">×</button>${html}<div class="amapsub">${overview()}</div>` : html; };
  const cmd = big && $("#amapCmd-" + a.id);
  st.home = () => { showSide(overview(), false); if (cmd) cmd.innerHTML = overview(); };
  st.show = (html) => showSide(html, true);
  side.addEventListener("click", (x) => { if (x.target.closest("[data-amapx]")) { st.home(); st.idleAt = Date.now(); } });
  st.home();

  // 角落狀態：資料時間＋圖例；大螢幕另標連動燈
  const drawStat = () => {
    const t = st.carAt ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(st.carAt) : "--:--";
    const link = big ? (Date.now() - st.linkAt < 25000 ? `<span class="amaplink on">● 已和網頁連動</span>` : `<span class="amaplink">○ 未連動（網頁開「🖥 大螢幕」即可）</span>`) : "";
    stat.innerHTML = `${link}<span>車輛資料 ${t} 更新</span>${st.carErr ? `<span class="amapwarn">⚠ 車輛資料暫時連不上，15 秒後自動重試</span>` : ""}<span class="amaplg"><i class="car"></i>回報中 <i class="old"></i>5 分鐘沒回報 <i class="cam"></i>監視器${(m.lives || []).length ? ` <i class="live"></i>直播` : ""}${(m.posts || []).length ? ` <i class="post"></i>進駐` : ""}</span>`;
  };
  setInterval(() => document.body.contains(box) && drawStat(), 5000);

  const keyOf = (k, txt, lat, lng) => (k === "car" ? `car|${txt}` : `${k}|${txt}|${Number(lat).toFixed(5)}|${Number(lng).toFixed(5)}`);   // 車會動，用車號當鑰匙
  const pin = (k, cls, txt, lat, lng, click, label) => {
    const key = keyOf(k, txt, lat, lng);
    st.keys[key] = { lat, lng, click };
    const el = document.createElement("button"); el.type = "button"; el.className = "amappin " + cls; el.textContent = txt; el.setAttribute("aria-label", label || txt);
    el.addEventListener("click", (x) => { x.stopPropagation(); st.idleAt = Date.now(); click(); if (amapBus && !big) amapBus.postMessage({ act: a.id, key }); });
    const mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]);
    if (st.on[k]) mk.addTo(map);
    el.setAttribute("aria-label", label || txt); el.title = label || txt;   // MapLibre 會改成「Map marker」，加到地圖後再設回來
    st.marks[k].push(mk); return mk;
  };
  map.on("load", () => {
    const at = box.querySelector(".maplibregl-ctrl-attrib"); if (at) at.classList.remove("maplibregl-compact-show");   // 地圖來源說明預設收成小 i
    const zones = (m.zones || []).map((z, i) => ({ type: "Feature", id: i, properties: { name: z.name, color: z.color || "#e2554a" }, geometry: { type: "Polygon", coordinates: [z.points.map(([la, ln]) => [ln, la]).concat([[z.points[0][1], z.points[0][0]]])] } }));
    map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: zones } });
    map.addLayer({ id: "zone-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } });
    map.addLayer({ id: "zone-line", type: "line", source: "zones", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    map.on("click", "zone-fill", (e) => { const z = (m.zones || [])[e.features[0].id]; if (z) { st.idleAt = Date.now(); st.show(`<b>🚧 ${esc(z.name)}</b>${z.note ? `<p>${esc(z.note)}</p>` : ""}`); } });
  });
  (m.posts || []).forEach((p) => pin("post", "post", `📍 ${p.name}`, p.lat, p.lng, () => st.show(`<b>📍 ${esc(p.name)}</b>${[p.unit && `單位：${p.unit}`, p.car && `車輛：${p.car}`, p.people && `人力：${p.people}`, p.contact && `聯絡：${p.contact}`].filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}`)));
  const liveShow = (v, id) => st.show(`<b>📺 ${esc(v.name)}</b><div class="amapvid"><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(v.name)}"></iframe></div>`);
  (m.lives || []).forEach((v) => { const id = amapYt(v.url); if (id) pin("live", "live", `📺 ${v.name}`, v.lat, v.lng, () => liveShow(v, id)); });

  // 監視器：camBox 範圍內全部；畫面上靠太近的合併成「📹N」，點泡泡放大
  const camShow = (c) => {
    st.show(`<b>📹 ${esc(c.name)}</b><div class="cscreen amapvid"><video muted playsinline></video><span class="tag cstate">連線中…</span></div>`);
    const v = side.querySelector("video"), t = side.querySelector(".cstate");
    cctvPlay(v, c.url, (x) => { t.textContent = x; });
  };
  const drawCams = () => {
    st.marks.cam.forEach((mk) => mk.remove()); st.marks.cam = [];
    if (!st.on.cam || !st.cams.length) return;
    const groups = [];
    st.cams.forEach((c) => {
      const pt = map.project([c.lng, c.lat]), g = groups.find((x) => Math.hypot(x.x - pt.x, x.y - pt.y) < AMAP_CLUSTER_PX);
      if (g) g.list.push(c); else groups.push({ x: pt.x, y: pt.y, list: [c] });
    });
    groups.forEach((g) => {
      if (g.list.length === 1) { const c = g.list[0]; pin("cam", "cam", "📹", c.lat, c.lng, () => camShow(c), `監視器：${c.name}`); return; }
      const lat = g.list.reduce((s, c) => s + c.lat, 0) / g.list.length, lng = g.list.reduce((s, c) => s + c.lng, 0) / g.list.length;
      const el = document.createElement("button"); el.type = "button"; el.className = "amappin cam many"; el.textContent = `📹${g.list.length}`; el.setAttribute("aria-label", `這裡有 ${g.list.length} 支監視器，點了放大`);
      el.addEventListener("click", (x) => { x.stopPropagation(); map.easeTo({ center: [lng, lat], zoom: Math.min(19, map.getZoom() + 2), duration: 600 }); });
      st.marks.cam.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)); el.setAttribute("aria-label", `這裡有 ${g.list.length} 支監視器，點了放大`);
    });
    // 合併的監視器也要能被網頁那邊點到後在大螢幕打開
    st.cams.forEach((c) => { st.keys[keyOf("cam", "📹", c.lat, c.lng)] = { lat: c.lat, lng: c.lng, click: () => camShow(c) }; });
  };
  map.on("moveend", drawCams);
  cctvLoad().then(() => {
    const [[s, w], [n, e]] = m.camBox;
    st.cams = cctvList.filter((c) => c.lat > s && c.lat < n && c.lng > w && c.lng < e);
    if (map.loaded()) drawCams(); else map.once("load", drawCams);
    if (!side.classList.contains("sel")) st.home();
  }).catch(() => {});

  // 車輛：最近 12 小時有回報的；超過 5 分鐘沒回報變灰
  async function cars() {
    try {
      const r = await (await fetch(AMAP_FLEET, { method: "POST", body: JSON.stringify({ action: "fleet_data", minutes: 720 }) })).json();
      if (!r.ok) throw new Error(r.error || "fleet");
      st.carErr = false;
      st.marks.car.forEach((mk) => mk.remove()); st.marks.car = []; st.cars = r.cars; st.carAt = Date.now();
      r.cars.forEach((c) => {
        const old = Date.now() - c.last.t > 300000;
        pin("car", "car" + (old ? " old" : ""), `🚒 ${c.device}`, c.last.lat, c.last.lng, () => st.show(`<b>🚒 ${esc(c.device)}</b><p>最後回報：${amapAgo(c.last.t)}${old ? "（超過 5 分鐘沒回報）" : ""}</p>${c.last.acc !== "" ? `<p>定位精確度：約 ${Math.round(c.last.acc)} 公尺</p>` : ""}${c.last.batt !== "" ? `<p>手機電量：${Math.round(c.last.batt)}%</p>` : ""}`), `車輛 ${c.device}${old ? "，超過 5 分鐘沒回報" : ""}`);
      });
      if (!side.classList.contains("sel")) st.home(); else { if (cmd) cmd.innerHTML = overview(); const sub = side.querySelector(".amapsub"); if (sub) sub.innerHTML = overview(); }
      drawStat();
    } catch (e) { st.carErr = true; drawStat(); }   // 下一輪（15 秒後）自動再試
  }
  cars(); drawStat();
  st.timer = setInterval(() => {
    if (!document.body.contains(box)) { clearInterval(st.timer); delete amaps[a.id]; return; }
    cars();
    if (amapBus && !big) amapBus.postMessage({ act: a.id, hello: 1 });   // 讓大螢幕知道網頁還開著
  }, AMAP_REFRESH);
  if (amapBus && !big) amapBus.postMessage({ act: a.id, hello: 1 });

  if (big && amapBus) amapBus.addEventListener("message", (e) => {   // 大螢幕：網頁那邊點了，這裡飛過去並打開
    const d = e.data || {};
    if (d.act !== a.id) return;
    st.linkAt = Date.now(); drawStat();
    const hit = d.key && st.keys[d.key];
    if (!hit) return;
    st.idleAt = Date.now();
    map.flyTo({ center: [hit.lng, hit.lat], zoom: Math.max(map.getZoom(), 17.3), duration: 1500 }); hit.click();
  });
  // 大螢幕指揮模式：沒人操作時，輪播每個地點最近的一支監視器（有直播優先）
  if (big) setInterval(() => {
    if (!document.body.contains(box) || Date.now() - st.idleAt < AMAP_IDLE) return;
    const picks = [];
    (m.lives || []).forEach((v) => { const id = amapYt(v.url); if (id) picks.push({ lat: v.lat, lng: v.lng, go: () => liveShow(v, id) }); });
    (a.spots || []).forEach((p) => { const c = st.cams.map((c) => ({ c, d: Math.hypot(c.lat - p.lat, c.lng - p.lng) })).sort((x, y) => x.d - y.d)[0]; if (c) picks.push({ lat: c.c.lat, lng: c.c.lng, go: () => camShow(c.c) }); });
    if (!picks.length) return;
    const p = picks[st.rot++ % picks.length];
    map.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: 2000 }); p.go();
  }, AMAP_ROTATE);

  box.addEventListener("click", (x) => {
    if (x.target.closest("[data-amapbig]")) { window.open(AMAP_BASE + "fleet-test/3d.html?act=" + encodeURIComponent(a.id), "zteam-amap-big", "popup,width=1600,height=900"); return; }
    const go = x.target.closest("[data-amapgo]");
    if (go) { const p = a.spots[Number(go.dataset.amapgo)]; st.idleAt = Date.now(); map.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: 1200 }); return; }
    const d3 = x.target.closest("[data-amap3d]");
    if (d3) { const flat = map.getPitch() > 5; map.easeTo({ pitch: flat ? 0 : AMAP_PITCH, bearing: flat ? 0 : -15, duration: 600 }); d3.textContent = flat ? "立體" : "平面"; return; }
    const b = x.target.closest("[data-amap]"); if (!b) return;
    const k = b.dataset.amap, on = !b.classList.contains("on");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); st.on[k] = on;
    if (k === "zone") { ["zone-fill", "zone-line"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none")); return; }
    if (k === "cam") { drawCams(); return; }
    st.marks[k].forEach((mk) => (on ? mk.addTo(map) : mk.remove()));
  });
}
// 活動折起來：關掉旁邊正在播的影像；地圖保留
function amapPause(a) { if (amaps[a.id] && amaps[a.id].home) amaps[a.id].home(); }
function amapResize(a) { if (amaps[a.id] && amaps[a.id].map) amaps[a.id].map.resize(); }
