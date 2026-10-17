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
const AMAP_PITCH = 40;
const amaps = {};   // 活動 id → { map, marks: {car:[], ...}, on, timer }
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
    st.glyphs = new URL("fonts/{fontstack}/{range}.pbf", location.href).href.replace("%7Bfontstack%7D", "{fontstack}").replace("%7Brange%7D", "{range}");
    return st;
  }).catch((e) => { amapStyleJob = null; throw e; }));
}
// YouTube 網址 → 影片 ID（youtu.be/ID、watch?v=ID、/live/ID、/embed/ID）
function amapYt(u) { const m = String(u || "").match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/)([\w-]{11})/); return m ? m[1] : ""; }
const amapAgo = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分鐘前` : `${Math.floor(s / 3600)} 小時前`; };

function amapHtml(a) {
  const m = a.map, has = { car: true, cam: true, zone: (m.zones || []).length, post: (m.posts || []).length, live: (m.lives || []).length };
  const btn = [["car", "🚒 車輛"], ["live", "📺 直播"], ["cam", "📹 監視器"], ["zone", "🚧 管制區"], ["post", "📍 進駐點"]].filter(([k]) => has[k]);
  return `<h3 class="chead">🗺 現場地圖<span>即時</span></h3>
    <div class="amapbar chips">${btn.map(([k, n]) => `<button class="ghost chip on" data-amap="${k}" aria-pressed="true">${n}</button>`).join("")}<button class="ghost chip amap3d" data-amap3d="1">平面</button></div>
    <div class="amapwrap"><div class="amapmap" id="amapMap-${a.id}"></div><div class="amapside" id="amapSide-${a.id}"><p class="note">點地圖上的車輛、直播、監視器或進駐點，這裡會顯示資料或即時畫面。</p></div></div>`;
}
function amapSide(a, html) { const el = $("#amapSide-" + a.id); if (!el) return; cctvStopIn(el); el.innerHTML = html; }

async function drawAmap(a) {
  const box = $("#actMap-" + a.id);
  if (!box || amaps[a.id]) return;
  amaps[a.id] = { pending: true };   // 載入期間又被叫一次時不要建兩張
  box.innerHTML = amapHtml(a);
  let style;
  try { await amapLoad(); style = await amapStyle(); } catch (e) { box.querySelector(".amapmap").innerHTML = `<p class="err" style="padding:12px">地圖載入失敗，請重新整理。</p>`; delete amaps[a.id]; return; }
  const m = a.map, map = new maplibregl.Map({ container: "amapMap-" + a.id, style, center: [m.center[1], m.center[0]], zoom: m.zoom || 16, pitch: AMAP_PITCH, bearing: -15,
    localIdeographFontFamily: '"Noto Sans TC", sans-serif', attributionControl: { compact: true }, cooperativeGestures: false });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
  map.scrollZoom.disable();
  const st = Object.assign(amaps[a.id] || {}, { map, marks: { car: [], cam: [], post: [], live: [] }, on: { car: true, cam: true, zone: true, post: true, live: true }, timer: null, pending: false });
  amaps[a.id] = st;
  const pin = (k, cls, txt, lat, lng, click) => {
    const el = document.createElement("button"); el.type = "button"; el.className = "amappin " + cls; el.textContent = txt; el.addEventListener("click", (x) => { x.stopPropagation(); click(); });
    const mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]);
    if (st.on[k]) mk.addTo(map);
    st.marks[k].push(mk); return mk;
  };
  map.on("load", () => {
    const at = box.querySelector(".maplibregl-ctrl-attrib"); if (at) at.classList.remove("maplibregl-compact-show");   // 地圖來源說明預設收成小 i
    const zones = (m.zones || []).map((z, i) => ({ type: "Feature", id: i, properties: { name: z.name, color: z.color || "#e2554a" }, geometry: { type: "Polygon", coordinates: [z.points.map(([la, ln]) => [ln, la]).concat([[z.points[0][1], z.points[0][0]]])] } }));
    map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: zones } });
    map.addLayer({ id: "zone-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } });
    map.addLayer({ id: "zone-line", type: "line", source: "zones", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    map.on("click", "zone-fill", (e) => { const z = (m.zones || [])[e.features[0].id]; if (z) amapSide(a, `<b>🚧 ${esc(z.name)}</b>${z.note ? `<p>${esc(z.note)}</p>` : ""}`); });
  });
  (m.posts || []).forEach((p) => pin("post", "post", `📍 ${p.name}`, p.lat, p.lng, () => amapSide(a, `<b>📍 ${esc(p.name)}</b>${[p.unit && `單位：${p.unit}`, p.car && `車輛：${p.car}`, p.people && `人力：${p.people}`, p.contact && `聯絡：${p.contact}`].filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}`)));
  (m.lives || []).forEach((v) => { const id = amapYt(v.url); if (id) pin("live", "live", `📺 ${v.name}`, v.lat, v.lng, () => amapSide(a, `<b>📺 ${esc(v.name)}</b><div class="amapvid"><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(v.name)}"></iframe></div>`)); });
  // 監視器：m.camBox（[[南, 西], [北, 東]]）範圍內的路口攝影機，點了在旁邊播
  cctvLoad().then(() => {
    const [[s, w], [n, e]] = m.camBox;
    cctvList.filter((c) => c.lat > s && c.lat < n && c.lng > w && c.lng < e).forEach((c) => pin("cam", "cam", "📹", c.lat, c.lng, () => {
      amapSide(a, `<b>📹 ${esc(c.name)}</b><div class="cscreen amapvid"><video muted playsinline></video><span class="tag cstate">連線中…</span></div>`);
      const side = $("#amapSide-" + a.id), v = side.querySelector("video"), t = side.querySelector(".cstate");
      cctvPlay(v, c.url, (x) => { t.textContent = x; });
    }));
  }).catch(() => {});
  // 車輛：最近 12 小時有回報的；超過 5 分鐘沒回報變灰
  async function cars() {
    try {
      const r = await (await fetch(AMAP_FLEET, { method: "POST", body: JSON.stringify({ action: "fleet_data", minutes: 720 }) })).json();
      if (!r.ok) return;
      st.marks.car.forEach((mk) => mk.remove()); st.marks.car = [];
      r.cars.forEach((c) => {
        const old = Date.now() - c.last.t > 300000;
        pin("car", "car" + (old ? " old" : ""), `🚒 ${c.device}`, c.last.lat, c.last.lng, () => amapSide(a, `<b>🚒 ${esc(c.device)}</b><p>最後回報：${amapAgo(c.last.t)}</p>${c.last.acc !== "" ? `<p>定位精確度：約 ${Math.round(c.last.acc)} 公尺</p>` : ""}${c.last.batt !== "" ? `<p>手機電量：${Math.round(c.last.batt)}%</p>` : ""}`));
      });
    } catch (e) { /* 下一輪再試 */ }
  }
  cars(); st.timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(st.timer); delete amaps[a.id]; return; } cars(); }, AMAP_REFRESH);
  box.querySelector(".amapbar").addEventListener("click", (x) => {
    const d3 = x.target.closest("[data-amap3d]");
    if (d3) { const flat = map.getPitch() > 5; map.easeTo({ pitch: flat ? 0 : AMAP_PITCH, bearing: flat ? 0 : -15, duration: 600 }); d3.textContent = flat ? "立體" : "平面"; return; }
    const b = x.target.closest("[data-amap]"); if (!b) return;
    const k = b.dataset.amap, on = !b.classList.contains("on");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); st.on[k] = on;
    if (k === "zone") { ["zone-fill", "zone-line"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none")); return; }
    st.marks[k].forEach((mk) => (on ? mk.addTo(map) : mk.remove()));
  });
}
// 活動折起來：關掉旁邊正在播的影像；地圖保留
function amapPause(a) { const el = $("#amapSide-" + a.id); if (el) { cctvStopIn(el); el.querySelectorAll("iframe").forEach((f) => f.remove()); } }
function amapResize(a) { if (amaps[a.id] && amaps[a.id].map) amaps[a.id].map.resize(); }
