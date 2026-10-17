// ---- 活動看板：現場地圖（2026-10-17，跨年起用；活動資料加 map: {...} 就會出現） ----
// 圖層：🚒 車輛（Traccar Client 手機回報，後端 fleet_data）、📹 路口監視器（cctv.js）、🚧 管制區、📍 進駐點、📺 直播（YouTube）
// 管制區、進駐點、直播寫在 activity-data.js 的 map 裡；沒有資料的圖層不顯示按鈕
// 要排在 activity.js 後面、app.js 前面載入；Leaflet 用到才載
const AMAP_FLEET = "https://script.google.com/macros/s/AKfycbzSyTTFT7Vz1Z1Cr64hhixU7xvdJpgJ30BK14ZOhv2jh0LJX6REFSfh_-HL9D3hs2iN/exec";
const AMAP_LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
const AMAP_REFRESH = 15000;
const amaps = {};   // 活動 id → { map, layers, on, timer }
let amapJob = null;
function amapLoad() {
  if (window.L) return Promise.resolve();
  if (!amapJob) amapJob = new Promise((ok, fail) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = AMAP_LEAFLET + ".css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = AMAP_LEAFLET + ".js"; js.onload = ok; js.onerror = () => { amapJob = null; js.remove(); fail(new Error("leaflet")); }; document.head.appendChild(js);
  });
  return amapJob;
}
// YouTube 網址 → 影片 ID（youtu.be/ID、watch?v=ID、/live/ID、/embed/ID）
function amapYt(u) { const m = String(u || "").match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/)([\w-]{11})/); return m ? m[1] : ""; }
const amapAgo = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分鐘前` : `${Math.floor(s / 3600)} 小時前`; };

function amapHtml(a) {
  const m = a.map, has = { car: true, cam: true, zone: (m.zones || []).length, post: (m.posts || []).length, live: (m.lives || []).length };
  const btn = [["car", "🚒 車輛"], ["live", "📺 直播"], ["cam", "📹 監視器"], ["zone", "🚧 管制區"], ["post", "📍 進駐點"]].filter(([k]) => has[k]);
  return `<h3 class="chead">🗺 現場地圖<span>即時</span></h3>
    <div class="amapbar chips">${btn.map(([k, n]) => `<button class="ghost chip on" data-amap="${k}" aria-pressed="true">${n}</button>`).join("")}</div>
    <div class="amapwrap"><div class="amapmap" id="amapMap-${a.id}"></div><div class="amapside" id="amapSide-${a.id}"><p class="note">點地圖上的車輛、直播、監視器或進駐點，這裡會顯示資料或即時畫面。</p></div></div>`;
}

function amapSide(a, html) {
  const el = $("#amapSide-" + a.id); if (!el) return;
  cctvStopIn(el); el.innerHTML = html;
}

async function drawAmap(a) {
  const box = $("#actMap-" + a.id);
  if (!box || amaps[a.id]) return;
  amaps[a.id] = { pending: true };   // 載入 Leaflet 期間又被叫一次時不要建兩張
  box.innerHTML = amapHtml(a);
  try { await amapLoad(); } catch (e) { box.querySelector(".amapmap").innerHTML = `<p class="err" style="padding:12px">地圖元件載入失敗，請重新整理。</p>`; delete amaps[a.id]; return; }
  const m = a.map, map = L.map("amapMap-" + a.id, { scrollWheelZoom: false }).setView(m.center, m.zoom || 16);
  L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", { maxZoom: 19, attribution: "&copy; 內政部國土測繪中心" }).addTo(map);
  const G = {}; ["zone", "cam", "post", "live", "car"].forEach((k) => { G[k] = L.layerGroup().addTo(map); });
  const st = Object.assign(amaps[a.id] || {}, { map, G, timer: null, pending: false }); amaps[a.id] = st;
  const icon = (cls, txt) => L.divIcon({ className: "", html: `<span class="${cls}">${txt}</span>`, iconAnchor: [10, 10] });
  (m.zones || []).forEach((z) => L.polygon(z.points, { color: z.color || "#d6302b", weight: 3, fillColor: z.color || "#d6302b", fillOpacity: 0.12, dashArray: "6 6" })
    .bindTooltip(`🚧 ${esc(z.name)}`, { sticky: true }).on("click", () => amapSide(a, `<b>🚧 ${esc(z.name)}</b>${z.note ? `<p>${esc(z.note)}</p>` : ""}`)).addTo(G.zone));
  (m.posts || []).forEach((p) => L.marker([p.lat, p.lng], { icon: icon("amappost", `📍 ${esc(p.name)}`) })
    .on("click", () => amapSide(a, `<b>📍 ${esc(p.name)}</b>${[p.unit && `單位：${p.unit}`, p.car && `車輛：${p.car}`, p.people && `人力：${p.people}`, p.contact && `聯絡：${p.contact}`].filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}`)).addTo(G.post));
  (m.lives || []).forEach((v) => {
    const id = amapYt(v.url); if (!id) return;
    L.marker([v.lat, v.lng], { icon: icon("amaplive", `📺 ${esc(v.name)}`) }).on("click", () =>
      amapSide(a, `<b>📺 ${esc(v.name)}</b><div class="amapvid"><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(v.name)}"></iframe></div>`)).addTo(G.live);
  });
  // 監視器：地圖範圍內的路口攝影機（m.camBox：[[南, 西], [北, 東]]），點了在旁邊播
  cctvLoad().then(() => {
    const [[s, w], [n, e]] = m.camBox;
    cctvList.filter((c) => c.lat > s && c.lat < n && c.lng > w && c.lng < e).forEach((c) => L.marker([c.lat, c.lng], { icon: icon("amapcam", "📹") }).on("click", () => {
      amapSide(a, `<b>📹 ${esc(c.name)}</b><div class="cscreen amapvid"><video muted playsinline></video><span class="tag cstate">連線中…</span></div>`);
      const side = $("#amapSide-" + a.id), v = side.querySelector("video"), t = side.querySelector(".cstate");
      cctvPlay(v, c.url, (x) => { t.textContent = x; });
    }).addTo(G.cam));
  }).catch(() => {});
  // 車輛：最近 12 小時有回報的；超過 5 分鐘沒回報變灰
  async function cars() {
    try {
      const r = await (await fetch(AMAP_FLEET, { method: "POST", body: JSON.stringify({ action: "fleet_data", minutes: 720 }) })).json();
      if (!r.ok) return;
      G.car.clearLayers();
      r.cars.forEach((c) => {
        const old = Date.now() - c.last.t > 300000;
        L.marker([c.last.lat, c.last.lng], { icon: icon("amapcar" + (old ? " old" : ""), `🚒 ${esc(c.device)}`), zIndexOffset: 1000 })
          .on("click", () => amapSide(a, `<b>🚒 ${esc(c.device)}</b><p>最後回報：${amapAgo(c.last.t)}</p>${c.last.acc !== "" ? `<p>定位精確度：約 ${Math.round(c.last.acc)} 公尺</p>` : ""}${c.last.batt !== "" ? `<p>手機電量：${Math.round(c.last.batt)}%</p>` : ""}`)).addTo(G.car);
      });
    } catch (e) { /* 下一輪再試 */ }
  }
  cars(); st.timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(st.timer); delete amaps[a.id]; return; } cars(); }, AMAP_REFRESH);
  box.querySelector(".amapbar").addEventListener("click", (x) => {
    const b = x.target.closest("[data-amap]"); if (!b) return;
    const k = b.dataset.amap, on = !b.classList.contains("on");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    if (on) G[k].addTo(map); else map.removeLayer(G[k]);
  });
}
// 活動折起來：關掉旁邊正在播的影像；地圖保留
function amapPause(a) { const el = $("#amapSide-" + a.id); if (el) { cctvStopIn(el); el.querySelectorAll("iframe").forEach((f) => f.remove()); } }
