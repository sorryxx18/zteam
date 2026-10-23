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
  cmdZoomed = null; if (typeof document !== "undefined" && document.body && document.body.classList) document.body.classList.remove("cmdzooming");
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
      <button class="ghost cmdcleanbtn" id="cmdClean" aria-pressed="false" title="收起網站導覽、統計和輿情，只留地圖、119、需處置和影像">🧹 簡潔模式</button>
      <button class="ghost cmdfull" id="cmdFull" title="整個面板放到全螢幕（大螢幕投影用）">⛶ 全螢幕</button>
      <div id="cmdWeatherWarning" class="cmdweather-warning" role="status" hidden></div>
    </div>
    <div class="cmdnums" id="cmdNums"></div>
    <section class="cmd119-bar" id="cmd119Bar" aria-label="119 即時案件"><div class="cmd119" id="cmd119" aria-live="polite"></div>${cmdZoomBtn("c119")}</section>
    <div class="cmdmain">
      <div class="cmdleft">
        <div class="cmdmapwrap">${C.demo ? '<span class="cmdmapdemo">分區燈號為示意勤務・119、車輛為即時</span>' : ""}<div class="cmdmap" id="cmdMap"><div class="amaploading">地圖載入中…</div></div><button type="button" class="ghost cmdhome" id="cmdHome" title="回到跨年活動的地圖範圍，並取消選取的 119 案件">⌂ 回到活動範圍</button><button type="button" class="ghost cmd119-scope" id="cmd119Scope" aria-label="119 案件範圍：切換全市或只看轄區（大安、信義、南港）" aria-pressed="false">只看轄區</button>${cmdZoomBtn("map")}</div>
        <section class="cmdbox cmdcambox">${cmdZoomBtn("cams")}<h3 id="cmdCamHead">📹 路口影像</h3><div class="cmdcams"><figure class="cmdlive" id="cmdLive" hidden></figure><div id="cmdCams"></div></div></section>
      </div>
      <div class="cmdright">
        <aside class="cmdside" id="cmdSide" aria-live="polite"></aside>
      </div>
    </div>
    <section class="cmdbox cmdsocbox">${cmdZoomBtn("social")}<h3>🦏 輿情警示<span>犀牛巡邏隊・每 5 分鐘更新</span></h3><div id="cmdSocial"></div></section>
    ${cmdExtraLiveHtml()}
  </div>`;
  $("#cmdHome")?.addEventListener("click", cmdGoHome);
  $("#cmdClean")?.addEventListener("click", () => cmdCleanSet(!$("#cmd")?.classList?.contains("clean")));
  cmdCleanSet(cmdCleanSaved());
  $("#cmdFull").addEventListener("click", () => { const el = $("#cmd"); document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen && el.requestFullscreen().then(() => cmdMapObj && setTimeout(() => cmdMapObj.resize(), 200)).catch(() => {}); });
  $("#cmd").addEventListener("click", (e) => { const zb = e.target.closest("[data-cmdzoom]"); if (zb) { e.stopPropagation(); cmdZoom(zb.dataset.cmdzoom); return; } const z = e.target.closest("[data-cmdzone]"); if (z) cmdPick(z.dataset.cmdzone, true); });
  $("#cmdLive").addEventListener("click", (e) => { const b = e.target.closest("[data-cmdlive]"); if (b) cmdLiveDraw(Number(b.dataset.cmdlive)); });
  cmdTick(); cmdNumsDraw(); cmdSideDraw(); cmdSocialDraw(); cmdMapDraw(); cmdLiveDraw(0); cmdCamsDraw();
  // 大螢幕：面板剛好一個畫面高，進來時捲到面板頂端（網站標題捲到上面去）
  if (typeof matchMedia === "function" && matchMedia("(min-width: 1101px)").matches) requestAnimationFrame(() => $("#cmd")?.scrollIntoView({ block: "start" }));
  cmdWeatherStart();
  cmdSocialStart();
  cmd119Start(reuse119);
  cmdSatStart();
  clearInterval(cmdTimer);
  cmdTimer = setInterval(() => {
    if (!$("#cmd")) { clearInterval(cmdTimer); cmdMapObj = null; return; }
    cmdTick();
    if (new Date().getSeconds() === 0) { cmdSideDraw(); cmdSocialDraw(); }   // 「已持續幾分鐘」每分鐘更新
  }, 1000);
}

// 第二批（2026-10-23 戰情室評估）：
// 回到活動範圍：看完全市或某件 119 案件後，一鍵飛回跨年活動的分區範圍，並取消選取的案件
let cmdFitAll = null;
function cmdGoHome() {
  if (typeof cmd119Clear === "function") cmd119Clear();
  if (cmdMapObj && cmdFitAll) cmdFitAll(800);
  const box = $("#cmdMap"), rect = box?.getBoundingClientRect();
  if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) box.scrollIntoView({ block: "center", behavior: "smooth" });
}
// 簡潔觀看模式：收起網站標題列、分頁、統計數字、階段、輿情與額外直播，畫面留給地圖、119、需處置、影像；記在這台裝置
function cmdCleanSaved() { try { return localStorage.getItem("zteam_cmdclean") === "1"; } catch (e) { return false; } }
function cmdCleanSet(on) {
  const el = $("#cmd"), b = $("#cmdClean"); if (!el || !b || !el.classList || !b.setAttribute) return;
  el.classList.toggle("clean", on); b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "↩ 完整模式" : "🧹 簡潔模式";
  try { localStorage.setItem("zteam_cmdclean", on ? "1" : "0"); } catch (e) {}
  if (cmdMapObj) setTimeout(() => cmdMapObj && cmdMapObj.resize(), 50);
}
function cmdTick() {
  const C = cmdData(), cur = cmdPhase();
  $("#cmdClock").textContent = cmdHm(cmdReal(), true);
  const left = Math.ceil((cmdAt(C.countdown.at) - cmdReal()) / 1000), count = $('#cmdCount');
  const pad = n => String(n).padStart(2, '0');
  count.textContent = !Number.isFinite(left) ? '待提供' : left <= -3600 ? '跨年已結束' : left <= 0 ? '🎆 新年快樂' : `距跨年 ${left >= 86400 ? Math.floor(left / 86400) + ' 天 ' : ''}${pad(Math.floor(left / 3600) % 24)}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)}`;
  if (left > 0 && left <= 60) count.innerHTML = count.textContent.replace(/(\d{2})$/, '<strong class="cmdcount-seconds">$1</strong>');
  const html = C.phases.map((p, i) => `<li class="${i < cur ? "done" : i === cur ? "on" : cur < 0 ? "wait" : ""}"${cur < 0 ? ' title="未開始"' : ''}><b>${esc(p.name)}</b><span>${esc(p.from)}${cur < 0 ? '<i class="cmdsr">・未開始</i>' : ''}</span></li>`).join("") || '<li>待提供</li>';
  if ($("#cmdPhase").innerHTML !== html) $("#cmdPhase").innerHTML = html;
}

// 示意勤務標籤（2026-10-23 戰情室評估）：示意模式下，假資料的每一塊都各自標「示意勤務」，不只靠頁首一個小標籤
const cmdDemoTag = () => (COMMAND.demo === true ? '<span class="tag warn cmddemo-tag">示意勤務</span>' : "");
function cmdNumsDraw() {
  const C = cmdData(), s = C.stats, n = { red: 0, amber: 0, green: 0 }, dt = cmdDemoTag();
  const value = (v, unit = "") => v === null || v === undefined || v === "" ? "待提供" : esc(v) + unit;
  C.zones.forEach((z) => n[z.light]++);
  $("#cmdNums").innerHTML = `
    <div class="cmdnum lights${C.zones.length ? "" : " pending"}"><span>分區燈號${dt}</span><b><em class="red">${C.zones.length ? n.red : "待提供"}</em><em class="amber">${C.zones.length ? n.amber : "待提供"}</em><em class="green">${C.zones.length ? n.green : "待提供"}</em></b><small>紅・黃・綠</small></div>
    <div class="cmdnum"><span>救護出勤${dt}</span><b>${value(s.ems)}</b><small>送醫 ${value(s.hosp)}・現場處置 ${value(s.onsite)}</small></div>
    <div class="cmdnum"><span>救護車輛${dt}</span><b>${value(s.ambAll)}</b><small>位置・最後回報</small></div>
    <div class="cmdnum"><span>人力在崗${dt}</span><b>${value(s.staffOn)}<i>/${value(s.staffAll)}</i></b><small>在崗／總人力</small></div>
    <div class="cmdnum cmdweather pending" id="cmdWeather"><span>天氣</span><b>—</b><small>天氣載入中…</small></div>`;
}

// 右側：需處置（紅燈排最上面）＋全部分區燈號
function cmdSideDraw() {
  const C = cmdData(), list = [...C.issues].sort((a, b) => CMD_RANK[a.level] - CMD_RANK[b.level] || cmdAt(a.at) - cmdAt(b.at));
  const row = (k, v) => `<div><dt>${k}</dt><dd>${esc(v || "待提供")}</dd></div>`;
  $("#cmdSide").innerHTML = `${cmdZoomBtn("side")}<h3>⚠ 需處置${cmdDemoTag()}<span>${list.length ? list.length + " 件" : "待提供"}</span></h3>
    ${list.length ? list.map((x) => { const z = cmdZone(x.zone); return `<article class="cmdissue ${esc(x.level || "")}${x.zone === cmdSel ? " sel" : ""}" data-cmdzone="${esc(x.zone || "")}" tabindex="0">
      <div class="cmdih">${cmdBadge(x.level)}<span class="cmdago">${Number.isFinite(cmdAt(x.at)) ? `已 ${cmdMins(cmdAt(x.at))} 分鐘` : "待提供"}</span></div>
      <b>${esc(z ? z.name : "")}｜${esc(x.title)}</b>
      <dl>${row("現況", x.what)}${row("影響", x.sowhat)}${row("下一步", x.nowwhat)}${row("缺什麼", x.gap)}</dl>
      ${x.ask ? `<p class="cmdask">👉 ${esc(x.ask)}</p>` : ""}</article>`; }).join("") : `<p class="note">待提供</p>`}

    <h3 class="cmdzh">分區燈號${cmdDemoTag()}</h3>
    <ul class="cmdzones">${[...C.zones].sort((a, b) => CMD_RANK[a.light] - CMD_RANK[b.light]).map((z) => `<li><button class="ghost${z.id === cmdSel ? " on" : ""}" data-cmdzone="${esc(z.id)}"><i class="dot ${esc(z.light)}"></i><b>${esc(z.name)}</b><span>${esc(z.crowd || "待提供")}</span></button></li>`).join("") || '<li>待提供</li>'}</ul>`;
}

// 輿情：犀牛巡邏隊真實資料（watch.js 同一套分級＋跨平台同事件合併），只取轄區、臺北市事件，最近 24 小時，每 5 分鐘更新。
// 示意模式也用真資料（跟車輛、119 一樣）；沒載入 watch.js 或抓不到時顯示待提供／暫時無法取得
let cmdSoc = null, cmdSocTimer = null, cmdSocReq = 0;
const CMD_SOC_REFRESH = 300000, CMD_SOC_MAX = 12;
async function cmdSocialLoad() {
  if (typeof WATCH_API === "undefined" || typeof wTier !== "function" || typeof fetch !== "function") return;
  const req = ++cmdSocReq, gen = cmdGeneration;
  try {
    const r = typeof watchFetch === "function" ? await watchFetch(1, 30000) : await (await fetch(`${WATCH_API}?days=1`, typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(30000) } : {})).json();
    if (!r || !r.ok || !Array.isArray(r.items)) throw 0;
    if (req !== cmdSocReq || gen !== cmdGeneration) return;
    const items = r.items.filter((i) => i && i.s in WATCH_SRC).map((i) => wTier({ ...i, t: Number(i.t) }));
    if (typeof wPeerFix === "function") wPeerFix(items);
    const since = Date.now() - 86400000;   // 後端是依抓取時間給，貼文本身可能是好幾天前的，這裡依貼文時間只留 24 小時內
    const ev = wEvents(items.filter((i) => (i._g === "local" || i._g === "taipei") && i.t >= since), true).filter((e) => (e.g === "local" || e.g === "taipei") && cmdSocKeep(e));
    ev.sort((x, y) => (x.g === "local" ? 0 : 1) - (y.g === "local" ? 0 : 1) || y.t - x.t);
    cmdSoc = { at: Date.now(), events: ev, total: ev.length, err: false };
  } catch (e) {
    if (req !== cmdSocReq || gen !== cmdGeneration) return;
    cmdSoc = cmdSoc && !cmdSoc.err ? { ...cmdSoc, stale: true } : { err: true };
  }
  if ($("#cmdSocial")) cmdSocialDraw();
}
// 戰情室比巡邏隊更嚴（2026-10-23 戰情室評估）：只留看得出「哪裡＋發生什麼」的事件，巡邏隊本身照舊全收
// ① 只有一則、又沒有新聞或官方佐證的社群貼文（閒聊、「高下立判」這種）不進戰情室；有兩則以上互相佐證才進
//    例外：轄區內、本文直接寫火警／受困這類消防事件的（「象山登山口附近差點發生火警」）照樣進
// ② 臺北市事件要寫到臺北的區名或地名（大安區、內湖、西門町…），或開頭 30 字內就講臺北（「【快訊／北市大樹倒塌】」）；
//    後面才順帶提到臺北的不算（小琉球溺水那則，開頭講的是小琉球）
const CMD_TPE_HEAD = /台北|臺北|(?<![新竹])北市/;
const CMD_FIRE_WORD = /火警|火災|起火|失火|冒煙|濃煙|受困|氣爆|爆炸|倒塌/;
function cmdSocKeep(e) {
  if (e.unv && !e.rel.length && !(e.g === "local" && CMD_FIRE_WORD.test(e.main.x || "") && wLocal(e.main.x || ""))) return false;
  if (e.g === "taipei" && ![e.main, ...e.rel].some((i) => W_TPE_AREA.test(i.x || "") || CMD_TPE_HEAD.test((i.x || "").slice(0, 30)))) return false;
  return true;
}
function cmdSocialStart() {
  clearInterval(cmdSocTimer);
  if (typeof WATCH_API === "undefined") return;
  cmdSocialLoad();
  cmdSocTimer = setInterval(() => { if (!$("#cmdSocial")) { clearInterval(cmdSocTimer); return; } cmdSocialLoad(); }, CMD_SOC_REFRESH);
}
function cmdSocialDraw() {
  const box = $("#cmdSocial");
  if (!box) return;
  if (typeof WATCH_API === "undefined") { box.innerHTML = '<ul class="cmdsocial"><li>待提供</li></ul>'; return; }
  if (!cmdSoc) { box.innerHTML = '<p class="note">輿情載入中…</p>'; return; }
  if (cmdSoc.err) { box.innerHTML = '<p class="note">輿情暫時無法取得，5 分鐘後自動再試。</p>'; return; }
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時前`; };
  const head = `<p class="cmdsoc-meta">最近 24 小時・轄區＋臺北市、有佐證的事件 ${cmdSoc.total} 件${cmdSoc.stale ? "・資料可能延遲" : ""}・<a href="#watch">看全部</a></p>`;
  const list = (cmdZoomed === "social" ? cmdSoc.events : cmdSoc.events.slice(0, CMD_SOC_MAX)).map((e) => {
    const i = e.main, text = wShow(i), src = (WATCH_SRC[i.s] || ["其他"])[0];
    return `<li class="${e.g === "local" ? "local" : ""}"><a href="${esc(i.u)}" target="_blank" rel="noopener noreferrer">
      <span class="tag${e.g === "local" ? " sup" : ""}">${e.g === "local" ? "轄區" : "臺北市"}</span><span class="tag">${esc(src)}</span>${e.unv ? '<span class="tag warn">未證實</span>' : ""}${e.hot ? '<span class="tag hot">🔥 熱議</span>' : ""}
      <p>${esc(text.slice(0, 90))}${text.length > 90 ? "…" : ""}</p>
      <small>${ago(e.t)}${e.rel.length ? `・共 ${e.rel.length + 1} 則` : ""}</small></a></li>`;
  }).join("");
  box.innerHTML = head + (list ? `<ul class="cmdsocial">${list}</ul>` : '<p class="note">這 24 小時轄區和臺北市沒有事件消息。</p>');
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
  cmdFitAll = (ms = 0) => all.length ? map.fitBounds([[Math.min(...all.map((p) => p[1])), Math.min(...all.map((p) => p[0]))], [Math.max(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0]))]], { padding: 24, duration: ms, pitch: 20, bearing: -15 }) : map.flyTo({ center: [C.center[1], C.center[0]], zoom: C.zoom, pitch: 30, bearing: -15, duration: ms });
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
// 影像區說清楚在看哪裡（2026-10-23 戰情室評估）：選了 119 案件時，提醒影像仍是分區附近，不是那件案件的現場
function cmdCamNoteDraw() {
  const el = $("#cmdCamNote"), s = cmd119Session, z = cmdZone(cmdSel);
  if (!el) return;
  const c = s && s.selected && s.model ? s.model.cases.find((x) => cmd119Key(x) === s.selected) : null;
  el.hidden = !c || !z;
  el.textContent = c && z ? `目前選取 119：${c.place}；影像仍是 ${z.name} 附近，不是案件現場` : "";
}
function cmdCamsDraw() {
  const z = cmdZone(cmdSel), box = $("#cmdCams"), generation = cmdGeneration, request = ++cmdCamRequest, demo = COMMAND.demo === true;
  const current = () => generation === cmdGeneration && request === cmdCamRequest && demo === (COMMAND.demo === true) && cmdSel === z?.id && box?.isConnected;
  if (!box) return;
  cctvStopIn(box);
  box.innerHTML = '<p class="note">待提供</p>';
  const live = cmdLives().length ? "📺 直播＋" : "";
  $("#cmdCamHead").textContent = live + "📹 路口影像";
  if (!z) return;
  $("#cmdCamHead").innerHTML = `${live}📹 ${esc(z.name)} 附近路口影像<span>即時</span><small class="cmdcamnote" id="cmdCamNote" hidden></small>`;
  cmdCamNoteDraw();
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
  cmd119Draw(); cmdCamNoteDraw();
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
  cmd119Draw(); cmdCamNoteDraw();
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
  box.innerHTML = `<div class="cmd119-summary${totals.fire ? ' has-fire' : ''}"><b>🚒 119 ${s.city ? '全市' : '大安・信義・南港'}</b><span>火災 ${totals.fire}・救護 ${totals.ems}・其他 ${totals.other}</span><a class="cmd119-source" href="https://service119.119.gov.taipei/service119/accCase" target="_blank" rel="noopener noreferrer">${model ? `更新 ${Number.isFinite(model.fetchedAt) ? cmdHm(model.fetchedAt) : '時間待提供'}・` : ''}資料來源：臺北市消防局</a></div>
    <ul aria-label="119 案件列">${list.map((c,i) => `<li><button type="button" class="cmd119-row ${cmd119Type(c)}${cmd119Key(c) === s.selected ? ' selected' : ''}" aria-pressed="${cmd119Key(c) === s.selected}" data-cmd119="${i}" ${c.lat === null || c.lng === null ? 'disabled' : ''} title="${esc(cmd119Label(c))}" aria-label="${esc(cmd119Label(c))}"><b>${c.t === null ? '--:--' : cmdHm(c.t)} ${c.kind === '火災' ? '🔥' : c.kind === '救護' ? '🚑' : '⚠'} ${esc(c.kind || '其他')}</b><span>${esc(c.place.replace(/^(?:臺北市|台北市)[\u4e00-\u9fff]{2,3}區/, ''))}</span><small>${esc(c.status || '待提供')}${c.lat === null || c.lng === null ? '・無定位' : ''}</small></button></li>`).join('')}${!model || !list.length ? `<li class="cmd119-status" role="status">${!model ? (s.loading ? '119 資料載入中…' : '119 資料暫時無法取得') : '目前無案件'}</li>` : ''}</ul>${delayed ? '<span class="cmd119-delay">資料可能延遲</span>' : ''}`;
  const toggle = $('#cmd119Scope');
  const strip = box.querySelector?.('ul'); if (strip) strip.scrollLeft = scroll;
  if (toggle) {toggle.textContent = s.city ? '只看轄區' : '看全市'; toggle.setAttribute('aria-pressed', String(!s.city));}
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
  const s = cmd119Session = reuse || {model:null, city:true, marks:[]}   // 2026-10-21 使用者定：預設全市，要過濾再按「只看轄區」;
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
const CMD_WEATHER_METEO = 'https://api.open-meteo.com/v1/forecast?latitude=25.0340&longitude=121.5645&timezone=Asia%2FTaipei&wind_speed_unit=ms&forecast_hours=12&hourly=precipitation_probability,wind_speed_10m&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m';
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
function cmdWeatherModel(gas, meteo, now, eventDay) {
  const fresh = t => Number.isFinite(t) && now - t <= 90 * 60000 && t - now <= 5 * 60000;
  const obs = gas?.ok === true ? gas.obs : null, ot = cmdWeatherTime(obs?.time);
  const current = meteo?.current, mt = cmdWeatherTime(current?.time);
  let observation = null;
  if (obs && fresh(ot) && cmdWeatherNumber(obs.temp) !== null) {
    observation = {temp:obs.temp, feels:cmdWeatherNumber(obs.feels), sky:typeof obs.weather === 'string' ? obs.weather : '待提供', wind:cmdWeatherNumber(obs.wind),
      windLevel:cmdWeatherNumber(obs.windLevel), windFrom:typeof obs.windFrom === 'string' ? obs.windFrom : null, smokeTo:typeof obs.smokeTo === 'string' ? obs.smokeTo : null,
      rain:cmdWeatherNumber(obs.rainToday), time:ot, source:`氣象署${typeof obs.station === 'string' ? obs.station : ''}站`};
  } else if (current && fresh(mt) && cmdWeatherNumber(current.temperature_2m) !== null) {
    observation = {temp:current.temperature_2m, feels:cmdWeatherNumber(current.apparent_temperature), sky:cmdWeatherSky(current.weather_code), wind:cmdWeatherNumber(current.wind_speed_10m),
      windLevel:null, windFrom:null, smokeTo:null, rain:null, time:mt, source:'備援：Open-Meteo'};
  }
  const officialKnown = gas?.ok === true && fresh(cmdWeatherTime(gas.at ?? obs?.time)) && Array.isArray(gas.warnings);
  const warnings = officialKnown ? gas.warnings.filter(w => w && typeof w.name === 'string' && cmdWeatherTime(w.start) <= now && cmdWeatherTime(w.end) > now).map(w => ({name:w.name,end:cmdWeatherTime(w.end)})) : [];
  // 逐時降雨：氣象署信義區預報優先，沒有才用 Open-Meteo。平常看接下來 4 個 2 小時；活動當天固定看 16 時～02 時
  const official = officialKnown && Array.isArray(gas.forecast) ? gas.forecast.map(p => ({at:cmdWeatherTime(p.at), rain:cmdWeatherNumber(p.rain)})).filter(p => Number.isFinite(p.at)) : [];
  const hourly = meteo?.hourly;
  const backup = Array.isArray(hourly?.time) ? hourly.time.map((t,i) => ({at:cmdWeatherTime(t), rain:cmdWeatherNumber(hourly.precipitation_probability?.[i])})).filter(p => Number.isFinite(p.at)) : [];
  const hour = 3600000, top = Math.ceil(now / hour) * hour;
  const want = Number.isFinite(eventDay) && now < eventDay + 26 * hour && now > eventDay - 12 * hour
    ? [16, 18, 20, 22, 24, 26].map(h => eventDay + h * hour).filter(t => t > now - hour)
    : [0, 2, 4, 6].map(h => top + h * hour);
  const pick = t => { const hit = official.find(p => p.at === t && p.rain !== null) || backup.find(p => p.at === t && p.rain !== null); return hit ? hit.rain : null; };
  const forecast = want.slice(0, 6).map(t => ({at:t, time:cmdHm(t), rain:pick(t)}));
  const lightOk = officialKnown && gas.light && ['green','amber','red'].includes(gas.light.level);
  const light = lightOk ? {level:gas.light.level, why:(gas.light.reasons || []).filter(r => r && r.level === gas.light.level).map(r => String(r.why)).join('、')} : null;
  return {current:observation,forecast,warnings,officialKnown,light};
}
const CMD_WX_LIGHT = {green:['🟢','正常'], amber:['🟡','注意'], red:['🔴','警戒']};
function cmdWeatherDraw(model) {
  const card = $('#cmdWeather'), bar = $('#cmdWeatherWarning');
  if (!card || !bar) return;
  const c = model.current, warnings = model.warnings, L = model.light;
  card.classList.toggle('cmdweather-warn',warnings.length > 0 || L?.level === 'amber');
  card.classList.toggle('cmdweather-red',L?.level === 'red');
  card.classList.toggle('pending',!c);
  const lamp = L ? `<em class="cmdwx-light ${L.level}">${CMD_WX_LIGHT[L.level][0]} ${esc(L.why || CMD_WX_LIGHT[L.level][1])}</em>` : '';
  const wind = !c ? '' : c.windFrom === '無風' ? '💨 無風' : `💨 ${c.windFrom ? esc(c.windFrom) + '風 ' : ''}${c.windLevel !== null ? esc(c.windLevel) + ' 級' : c.wind !== null ? c.wind.toFixed(1) + ' m/s' : '—'}${c.smokeTo ? `・煙往${esc(c.smokeTo)}飄` : ''}`;
  const rain = model.forecast.some(p => p.rain !== null) ? '☔ ' + model.forecast.map(p => `<span class="cmdwx-slot${p.rain !== null && p.rain >= 60 ? ' wet' : ''}">${p.time.slice(0, 2)}時 ${p.rain === null ? '—' : esc(p.rain) + '%'}</span>`).join('') : '☔ 預報待提供';
  card.innerHTML = c ? `<span>天氣${lamp}${cmdZoomBtn('weather')}</span>
    <div class="cmdwx-now"><b>${esc(c.temp)}°C</b><span>${esc(c.sky)}${c.feels !== null ? `<br>體感 ${esc(Math.round(c.feels))}°C` : ''}</span></div>
    <small>${wind}</small><small class="cmdforecast">${rain}</small>
    <i class="cmdweather-source">${esc(c.source)} ${cmdHm(c.time)}${model.officialKnown ? '' : '・特報待確認'}</i>${cmdZoomed === 'weather' ? cmdWeatherTable() : ''}` : '<span>天氣</span><b>—</b><small>天氣暫時無法取得</small>';
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
  timer = setTimeout(cancel,20000);
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
  cmdWxLast = {gas, meteo};
  cmdWeatherRedraw();
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

// ---- 每一塊都能放大（2026-10-19 使用者要）：右上角 ⛶，放大後蓋滿畫面，✕ 或 Esc 關閉 ----
let cmdZoomed = null, cmdWxLast = null;
// 臨時直播（COMMAND.extraLive）：用真實時間判斷過期，不跟示意時鐘走
// 2026-10-21 使用者：颱風直播旁邊加氣象署衛星雲圖循環播放（東亞紅外線，最近 2 小時）
const cmdXliveOn = () => { const x = COMMAND.extraLive; return !!(x && x.id && Date.now() < Date.parse(x.until)); };
function cmdExtraLiveHtml() {
  const x = COMMAND.extraLive;
  if (!cmdXliveOn()) return "";
  const sat = x.sat ? `<figure class="cmdxsat" id="cmdXsat">${cmdZoomBtn("xsat")}<img id="cmdXsatImg" alt="氣象署衛星雲圖" decoding="async"><figcaption id="cmdXsatCap">雲圖載入中…</figcaption><a class="cmdxsrc" href="https://www.cwa.gov.tw/V8/C/W/OBS_Sat.html" target="_blank" rel="noopener noreferrer">資料來源：中央氣象署</a></figure>` : "";
  return `<section class="cmdbox cmdxlive">${cmdZoomBtn("xlive")}<h3>${esc(x.name)}<span>${esc(x.note || "")}</span></h3>
    <div class="cmdxgrid${sat ? " two" : ""}"><div class="cmdxframe"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(x.id)}?autoplay=1&mute=1&playsinline=1&rel=0" title="${esc(x.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${sat}</div></section>`;
}
// 雲圖檔名：<產品>/<產品>-YYYY-MM-DD-HH-MM.jpg（臺灣時間，每 10 分鐘一張，網站約晚 20 分鐘才有）
function cmdSatFrames(now = Date.now()) {
  const x = COMMAND.extraLive.sat, step = 600000, n = Math.max(2, Math.round((x.hours || 2) * 6));
  const last = Math.floor((now - (x.lagMin || 20) * 60000) / step) * step, out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(last - i * step + 8 * 3600000), p = (v) => String(v).padStart(2, "0");
    const stamp = `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}-${p(t.getUTCHours())}-${p(t.getUTCMinutes())}`;
    out.push({ url: `https://www.cwa.gov.tw/Data/satellite/${x.product}/${x.product}-${stamp}.jpg`, label: `${stamp.slice(5, 7)}/${stamp.slice(8, 10)} ${stamp.slice(11, 13)}:${stamp.slice(14)}` });
  }
  return out;
}
let cmdSatTimer = null, cmdSatList = [], cmdSatAt = 0, cmdSatBuilt = 0;
function cmdSatStart() {
  if (cmdSatTimer) clearTimeout(cmdSatTimer);
  cmdSatTimer = null;
  if (typeof Image === "undefined" || typeof setTimeout === "undefined" || !cmdXliveOn() || !COMMAND.extraLive.sat || !$("#cmdXsatImg")) return;
  const load = () => {   // 先預載，載不到的（還沒出圖）直接略過
    cmdSatBuilt = Date.now();
    const frames = cmdSatFrames(), got = [];
    let left = frames.length;
    frames.forEach((f, i) => { const im = new Image(); im.onload = () => { got[i] = f; if (--left === 0) done(); }; im.onerror = () => { if (--left === 0) done(); }; im.src = f.url; });
    const done = () => { const list = got.filter(Boolean); if (list.length) { cmdSatList = list; cmdSatAt = 0; } else if (!cmdSatList.length) { const c = $("#cmdXsatCap"); if (c) c.textContent = "雲圖暫時抓不到"; } };
  };
  const tick = () => {
    const img = $("#cmdXsatImg");
    if (!img || !cmdXliveOn()) return;   // 離開戰情室或過期就停
    if (Date.now() - cmdSatBuilt > 600000) load();
    let wait = 500;
    if (cmdSatList.length) {
      const f = cmdSatList[cmdSatAt % cmdSatList.length], latest = cmdSatAt % cmdSatList.length === cmdSatList.length - 1;
      img.src = f.url; $("#cmdXsatCap").textContent = `${f.label}${latest ? "（最新）" : ""}`;
      if (latest) wait = 2000;
      cmdSatAt++;
    }
    cmdSatTimer = setTimeout(tick, wait);
  };
  load(); tick();
}
const CMD_ZOOM_EL = { map: ".cmdmapwrap", cams: ".cmdcambox", side: "#cmdSide", c119: "#cmd119Bar", social: ".cmdsocbox", weather: "#cmdWeather", xlive: ".cmdxlive", xsat: "#cmdXsat" };
const cmdZoomBtn = (k) => `<button type="button" class="cmdzbtn" data-cmdzoom="${k}" aria-label="${cmdZoomed === k ? "關閉放大" : "放大這一塊"}" title="${cmdZoomed === k ? "關閉放大（Esc）" : "放大這一塊"}">${cmdZoomed === k ? "✕ 關閉" : "⛶"}</button>`;
function cmdZoom(k) {
  const prev = cmdZoomed;
  cmdZoomed = prev === k || !CMD_ZOOM_EL[k] ? null : k;
  document.querySelectorAll(".cmdzoomed").forEach((e) => e.classList.remove("cmdzoomed"));
  document.body.classList.toggle("cmdzooming", !!cmdZoomed);
  if (cmdZoomed) { const el = $(CMD_ZOOM_EL[cmdZoomed]); if (el) { el.classList.add("cmdzoomed"); el.scrollTop = 0; } }
  document.querySelectorAll("[data-cmdzoom]").forEach((b) => { const on = b.dataset.cmdzoom === cmdZoomed; b.textContent = on ? "✕ 關閉" : "⛶"; b.setAttribute("aria-label", on ? "關閉放大" : "放大這一塊"); b.title = on ? "關閉放大（Esc）" : "放大這一塊"; });
  if (k === "weather" || prev === "weather") cmdWeatherRedraw();
  if (k === "social" || prev === "social") cmdSocialDraw();
  setTimeout(() => { if (cmdMapObj) cmdMapObj.resize(); }, 60);
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("keydown", (e) => { if (e.key === "Escape" && cmdZoomed && $("#cmd")) cmdZoom(cmdZoomed); });
function cmdWeatherRedraw() {
  if (!cmdWxLast) return;
  const end = cmdAt(cmdData().countdown?.at || '');
  cmdWeatherDraw(cmdWeatherModel(cmdWxLast.gas, cmdWxLast.meteo, cmdReal(), Number.isFinite(end) ? end - 24 * 3600000 : NaN));
}
// 放大的天氣卡：逐時表。活動當天看 16 時～02 時，平常看接下來 24 小時；氣象署信義區預報為主
function cmdWeatherTable() {
  const g = cmdWxLast?.gas, rows = (g?.ok === true && Array.isArray(g.forecast) ? g.forecast : []).map((p) => ({ ...p, at: cmdWeatherTime(p.at) })).filter((p) => Number.isFinite(p.at));
  const now = cmdReal(), end = cmdAt(cmdData().countdown?.at || ''), day = Number.isFinite(end) ? end - 24 * 3600000 : NaN, hour = 3600000;
  const onDay = Number.isFinite(day) && now > day - 12 * hour && now < day + 26 * hour;
  const pick = rows.filter((p) => onDay ? p.at >= day + 16 * hour && p.at <= day + 26 * hour : p.at >= now - hour && p.at <= now + 24 * hour);
  if (!pick.length) return `<p class="note cmdwx-tnote">${onDay ? "活動時段的逐時預報還沒發布（氣象署約前 3 天才有）" : "逐時預報暫時無法取得"}</p>`;
  const v = (x, u) => x === null || x === undefined ? "—" : esc(x) + u;
  return `<table class="cmdwx-table"><caption>${onDay ? "活動時段逐時預報（信義區）" : "接下來 24 小時逐時預報（信義區）"}</caption>
    <thead><tr><th>時間</th><th>天氣</th><th>氣溫</th><th>體感</th><th>降雨</th><th>風</th></tr></thead><tbody>${pick.map((p) => `<tr${p.rain !== null && p.rain >= 60 ? ' class="wet"' : ""}><td>${cmdHm(p.at)}</td><td>${esc(p.weather || "—")}</td><td>${v(p.temp, "°")}</td><td>${v(p.feels, "°")}</td><td>${v(p.rain, "%")}</td><td>${p.windFrom ? esc(p.windFrom) + " " : ""}${p.windLevel !== null && p.windLevel !== undefined ? esc(p.windLevel) + " 級" : "—"}</td></tr>`).join("")}</tbody></table>
    <p class="note cmdwx-tnote">資料來源：中央氣象署鄉鎮預報（每 3 小時更新）</p>`;
}

// 2026-10-21 使用者：常常要整頁重整 → 戰情室切到背景再回來時自己補資料
// 離開超過 1 分鐘：119、天氣、輿情馬上重抓；超過 10 分鐘：整個面板重畫（不跳頁、不用重新登入）
let cmdHiddenAt = 0;
if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cmdHiddenAt = Date.now(); return; }
  const away = cmdHiddenAt ? Date.now() - cmdHiddenAt : 0;
  cmdHiddenAt = 0;
  if (!$("#cmd") || away < 60000) return;
  if (away >= 600000 && typeof renderCommand === "function" && !cmdZoomed) { renderCommand(); return; }
  if (typeof cmd119Update === "function") cmd119Update();
  if (typeof cmdWeatherUpdate === "function") cmdWeatherUpdate();
  if (typeof cmdSocialLoad === "function") cmdSocialLoad();
});
