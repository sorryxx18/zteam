// ---- 道路即時影像：僅顯示已取得合法授權、可公開展示的交通攝影機 ----
// 攝影機清單由同源的 traffic-cctv.json 提供；不要在公開 GitHub 儲存 API Key、密碼或帶有密鑰的串流 URL。
const TRAFFIC_MANIFEST = "traffic-cctv.json";
const TRAFFIC_DISTRICTS = ["全部", "大安區", "信義區", "南港區"];
let trafficData = [];
let trafficLoaded = false;
let trafficLoading = false;
let trafficError = "";
let trafficDistrict = "全部";
let trafficSelected = "";

function trafficSafeUrl(raw) {
  try {
    const url = new URL(String(raw), location.href);
    return url.protocol === "https:" ? url.href : "";
  } catch (_) { return ""; }
}
function trafficSafeCamera(c) {
  if (!c || typeof c !== "object") return null;
  const url = trafficSafeUrl(c.url);
  if (!url || !["image", "video", "hls"].includes(c.type)) return null;
  const district = String(c.district || "").trim();
  if (!TRAFFIC_DISTRICTS.includes(district) || district === "全部") return null;
  return {
    id: String(c.id || c.name || url),
    name: String(c.name || "未命名攝影機"),
    district, type: c.type, url,
    note: String(c.note || "")
  };
}
async function trafficLoad() {
  if (trafficLoaded || trafficLoading) return;
  trafficLoading = true;
  try {
    const resp = await fetch(TRAFFIC_MANIFEST, { cache: "no-store" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (!Array.isArray(data.cameras)) throw new Error("影像清單格式錯誤");
    trafficData = data.cameras.map(trafficSafeCamera).filter(Boolean);
    trafficLoaded = true;
    trafficError = "";
  } catch (_) {
    trafficError = "無法讀取攝影機清單，請檢查設定檔或網路。";
  } finally {
    trafficLoading = false;
    if (typeof project !== "undefined" && project === "traffic" && document.querySelector("#tcBoard")) renderTraffic();
  }
}

function trafficPlayer(cam) {
  const box = document.querySelector("#tcPlayer");
  if (!box) return;
  if (!cam) {
    box.innerHTML = `<div class="tc-placeholder">請先選擇攝影機，才會載入影像。</div>`;
    return;
  }
  box.replaceChildren();
  const media = document.createElement(cam.type === "image" ? "img" : "video");
  media.className = "tc-media";
  media.setAttribute("aria-label", cam.name);
  const status = document.createElement("p");
  status.className = "note tc-media-status";
  status.textContent = "影像連線中…";
  if (cam.type === "image") {
    media.alt = cam.name;
    media.onload = () => { status.textContent = "影像已載入；更新頻率以資料提供機關為準。"; };
    media.onerror = () => { status.textContent = "影像無法顯示，可能已離線或來源禁止跨站使用。"; };
    media.src = cam.url;
  } else {
    media.controls = true;
    media.autoplay = true;
    media.muted = true;
    media.playsInline = true;
    media.addEventListener("playing", () => { status.textContent = "影像播放中"; });
    media.addEventListener("error", () => { status.textContent = "影片無法播放，請確認串流格式及跨站政策。"; });
    if (cam.type === "hls" && !media.canPlayType("application/vnd.apple.mpegurl")) {
      status.textContent = "此瀏覽器不支援原生 HLS；取得正式介接格式後，需再接入 HLS 播放器。";
    } else {
      media.src = cam.url;
    }
  }
  box.append(media, status);
}

function renderTraffic() {
  const cameras = trafficData.filter(c => trafficDistrict === "全部" || c.district === trafficDistrict);
  if (trafficSelected && !cameras.some(c => c.id === trafficSelected)) trafficSelected = "";
  const chosen = cameras.find(c => c.id === trafficSelected);
  const cardHtml = trafficLoading
    ? '<p class="note">攝影機清單載入中…</p>'
    : trafficError ? `<p class="err">${esc(trafficError)}</p>`
    : cameras.length === 0
      ? `<div class="tc-empty"><b>目前尚未完成正式影像授權介接</b><p>攝影機位置清冊與「可嵌入網站的即時影像」不同。臺北市交工處的 CCTV 影像需先提出授權申請，本站不會在未獲授權前轉載影像。</p></div>`
      : `<div class="tc-list">${cameras.map(c => `<button class="tc-item ${c.id === trafficSelected ? "active" : ""}" data-tcid="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(c.district)}</span></button>`).join("")}</div>`;
  document.querySelector("#view").innerHTML = `
    <section id="tcBoard" class="tc-board">
      <div class="tc-hero"><span class="tc-emoji" aria-hidden="true">🚦📹</span><div><h2>道路即時影像</h2><p>第二救災救護大隊｜大安・信義・南港路況</p></div></div>
      <div class="tc-info card">
        <b>影像資料來源：臺北市交通管制工程處（正式授權後啟用）</b>
        <p>本頁已預留攝影機清單與影像播放器；目前僅能前往官方交通路況網站查看，並非已完成即時串流介接。</p>
        <div class="tc-actions">
          <a href="https://its.taipei.gov.tw/" target="_blank" rel="noopener noreferrer">查看官方交通路況 ↗</a>
          <a href="https://bote.gov.taipei/cp.aspx?n=8B8FFEA8353857B5" target="_blank" rel="noopener noreferrer">辦理 CCTV 授權申請 ↗</a>
        </div>
      </div>
      <div class="tc-grid">
        <section class="card tc-picker" aria-label="攝影機清單">
          <h2>攝影機清單 <span class="tc-count">${cameras.length} 支</span></h2>
          <label for="tcDistrict">轄區</label>
          <select id="tcDistrict">${TRAFFIC_DISTRICTS.map(d => `<option value="${d}" ${d === trafficDistrict ? "selected" : ""}>${d}</option>`).join("")}</select>
          ${cardHtml}
        </section>
        <section class="card tc-screen" aria-label="即時影像播放區">
          <h2>${chosen ? esc(chosen.name) : "影像監看"}</h2>
          <div id="tcPlayer"></div>
          ${chosen && chosen.note ? `<p class="note">${esc(chosen.note)}</p>` : ""}
          <p class="note">僅供路況輔助判讀；影像可能延遲、離線或依授權限制無法顯示，請勿作為唯一勤務判斷依據。</p>
        </section>
      </div>
    </section>`;
  document.querySelector("#tcDistrict").addEventListener("change", e => {
    trafficDistrict = e.target.value;
    trafficSelected = "";
    renderTraffic();
  });
  document.querySelectorAll("[data-tcid]").forEach(btn => btn.addEventListener("click", () => {
    trafficSelected = btn.dataset.tcid;
    renderTraffic();
  }));
  trafficPlayer(chosen);
  if (!trafficLoaded && !trafficLoading) trafficLoad();
}
