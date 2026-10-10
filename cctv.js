// ---- 路口即時影像：臺北市即時交通資訊網（交通管制工程處）公開的路口攝影機，免登入、不經後端 ----
// 清單和影像都直接向官方主機要；這不是公告的開放資料介面，官方改版時這裡要跟著改。
// 要排在 activity.js 前面載入。
const CCTV_API = "https://itsapi.taipei.gov.tw/TPTS_API/roadInformation/CCTVByLBS";
const CCTV_SITE = "https://its.taipei.gov.tw/";
const CCTV_HLS = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js";   // Chrome、Edge 要靠它才能播；Safari 內建
const CCTV_RADIUS = 700;     // 地點周圍幾公尺內的攝影機才算「附近」
const CCTV_TIMEOUT = 20000;

let cctvList = null;         // [{id, name, lat, lng, flat, url}]
let cctvJob = null;          // 載入清單的 Promise（同時只跑一次）
let cctvHlsJob = null;
const cctvPlayers = new Map();   // <video> → Hls 物件（Safari 內建播放時是 null）

// 攝影機清單：整個臺北市一次拿回來，之後都用這一份
function cctvLoad() {
  if (cctvList) return Promise.resolve(cctvList);
  if (!cctvJob) {
    cctvJob = fetch(CCTV_API, { method: "POST", body: new URLSearchParams({ distance: "10000000", lng: "121.460477", lat: "25.019086", language: "ZH" }), signal: AbortSignal.timeout(CCTV_TIMEOUT) })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d) => {
        if (!d || !Array.isArray(d.locations)) throw new Error("format");
        // 只留臺北市自己的串流（清單裡還混著新北市和國道的，格式不一樣）
        cctvList = d.locations.filter((c) => c.cctvName && /^https:\/\/[a-z0-9]+\.gov\.taipei\/.+\.m3u8$/.test(c.videoStreamURL || "") && isFinite(c.lat) && isFinite(c.lng))
          .map((c) => ({ id: String(c.cctvId), name: String(c.cctvName).replace(/^\d+\s*-?\s*/, ""), lat: Number(c.lat), lng: Number(c.lng), flat: c.roadType === "平面道路", url: c.videoStreamURL }));
        return cctvList;
      })
      .finally(() => { cctvJob = null; });
  }
  return cctvJob;
}

const cctvDist = (lat1, lng1, lat2, lng2) => Math.round(Math.hypot((lat2 - lat1) * 111320, (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180)));

// 某個地點附近的攝影機，由近到遠；平面道路排前面（高架、地下道的車道鏡頭對活動現場沒幫助）
function cctvNear(lat, lng, n) {
  if (!cctvList) return [];
  const near = cctvList.map((c) => ({ ...c, m: cctvDist(lat, lng, c.lat, c.lng) })).filter((c) => c.m <= CCTV_RADIUS).sort((a, b) => a.m - b.m);
  return near.filter((c) => c.flat).concat(near.filter((c) => !c.flat)).slice(0, n);
}

function cctvHls() {
  if (window.Hls) return Promise.resolve();
  if (!cctvHlsJob) {
    cctvHlsJob = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = CCTV_HLS; s.onload = ok; s.onerror = () => { cctvHlsJob = null; s.remove(); fail(new Error("hls")); };
      document.head.appendChild(s);
    });
  }
  return cctvHlsJob;
}

// 在 <video> 上播一支攝影機；say(文字, 是否為錯誤) 用來更新那一格的狀態
async function cctvPlay(video, url, say) {
  cctvStop(video);
  video.muted = true; video.playsInline = true; video.autoplay = true;
  video.onplaying = () => say("即時", false);
  say("連線中…", false);
  const native = video.canPlayType("application/vnd.apple.mpegurl");
  try { if (!native || window.Hls) await cctvHls(); } catch (e) { if (!native) { say("播放元件載入失敗", true); return; } }
  if (!video.isConnected) return;   // 等播放元件的時候，這一格已經被關掉
  if (window.Hls && Hls.isSupported()) {
    const h = new Hls({ maxBufferLength: 8, backBufferLength: 10, manifestLoadingTimeOut: 15000 });
    let fixed = 0;
    h.on(Hls.Events.ERROR, (_, x) => {
      if (!x.fatal) return;
      if (x.type === Hls.ErrorTypes.MEDIA_ERROR && fixed++ < 2) { h.recoverMediaError(); return; }
      if (x.type === Hls.ErrorTypes.NETWORK_ERROR && fixed++ < 2) { say("重新連線…", false); setTimeout(() => { if (cctvPlayers.get(video) === h) h.loadSource(url); }, 3000); return; }
      say("這支攝影機目前沒有畫面", true); cctvStop(video);
    });
    h.loadSource(url); h.attachMedia(video);
    cctvPlayers.set(video, h);
  } else if (native) {
    video.onerror = () => say("這支攝影機目前沒有畫面", true);
    video.src = url; cctvPlayers.set(video, null);
  } else say("這個瀏覽器不能播放", true);
  video.play().catch(() => {});
}

function cctvStop(video) {
  if (!cctvPlayers.has(video)) return;
  const h = cctvPlayers.get(video);
  if (h) h.destroy(); else { video.removeAttribute("src"); video.load(); }
  cctvPlayers.delete(video);
}
// 停掉某個區塊裡（不給就是全部）的影像
function cctvStopIn(root) { [...cctvPlayers.keys()].forEach((v) => { if (!root || root.contains(v)) cctvStop(v); }); }

// 畫面被換掉（切到別的專案、整頁重畫）之後，影像元素已經不在頁面上，連線要收掉，不然會一直在背景抓
setInterval(() => { cctvPlayers.forEach((h, v) => { if (!v.isConnected) cctvStop(v); }); }, 2000);
// 分頁切到背景時暫停抓影像，切回來再接著播
document.addEventListener("visibilitychange", () => {
  cctvPlayers.forEach((h, v) => {
    if (document.hidden) { if (h) h.stopLoad(); v.pause(); }
    else { if (h) h.startLoad(-1); v.play().catch(() => {}); }
  });
});
