// ---- 犀牛巡邏隊：新聞、Threads、Facebook 上跟消防、災害有關的公開內容（獨立後端定時抓，免登入可看） ----
// 要排在 app.js 前面載入（app.js 一啟動就會畫目前的專案）
const WATCH_API = "https://script.google.com/macros/s/AKfycbwFgbXawD8ZrHFvjVjbqjIZ1mGz8EOz9qmPCpUVYqFIIDYJWHvoCdMAxTUv-GAKkYq8jw/exec";
const WATCH_SRC = { news: ["新聞", "#d8ecff"], threads: ["Threads", "#e6dcff"], fb: ["Facebook", "#cfe0ff"] };
const WATCH_RANGE = [[1, "24 小時"], [3, "3 天"], [7, "7 天"], [30, "30 天"]];
// 分區：轄區重點、新聞快報、社群動態。img 有填就用橫幅圖，沒填用標題列
const WATCH_SEC = [
  { key: "local", name: "轄區重點", img: "watch-local.webp", pos: "center 25%", pick: (i) => i.l, empty: "這段時間沒有提到大安、信義、南港或轄內地標的內容。" },
  { key: "news", name: "新聞快報", img: "watch-news.webp", pos: "center 34%", pick: (i) => i.s === "news", empty: "這個條件下沒有新聞。" },
  { key: "social", name: "社群動態", img: "watch-social.webp", pos: "center 29%", pick: (i) => i.s !== "news", empty: "這個條件下沒有社群貼文。" },
];
const WATCH_PAGE = 10;       // 每一區先顯示幾則
const WATCH_REFRESH = 10 * 60000;   // 開著頁面時每 10 分鐘自動更新

// 置頂：新聞或 Threads 在這段時間內的火警、災害事件；臺北市排最前面
const PIN_HOURS = 4;
const PIN_HIT = /火警|火災|大火|惡火|起火|失火|火海|濃煙|冒煙|爆炸|氣爆|地震|強震|海嘯|淹水|土石流|坍塌|倒塌|崩塌|山難/;   // 車禍受困這類救助案件不算
const PIN_MAX = 8;           // 置頂先顯示幾則
const PIN_SKIP = /演練|演習|宣導|模擬|預演|體驗|判刑|交保|起訴|約談|索賠|求償|動土|捐贈|表揚|檢討|相關報導|標籤頁|後院失火/;   // 不是正在發生的事
const PIN_ABROAD = /日本|東京|大阪|美國|加州|中國大陸|大陸|香港|宏福苑|澳門|韓國|南韓|菲律賓|印尼|越南|土耳其|烏克蘭|俄羅斯|以色列|[係唔嘅咁喎冇]/;
const IN_TAIPEI = /台北|臺北|(?<!新)北市/;

let watch = null;            // 後端回來的資料 {items, lastFetch, now, days}
let watchState = "";         // "loading"｜"error"｜""
const watchF = { src: "", cat: "", q: "", days: "1" };
const watchShown = {};       // 各區目前顯示幾則

async function loadWatch(days) {
  watchState = "loading"; drawWatch();
  try {
    let data;
    for (let i = 0; ; i++) {   // Google 偶爾回 404 或非 JSON（暫時性），自動重試兩次
      try { data = await (await fetch(`${WATCH_API}?days=${days}`)).json(); if (!data.ok) throw new Error(data.error || "error"); break; }
      catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    data.items = data.items.filter((i) => i.s in WATCH_SRC);   // 已經不看的來源（PTT、Instagram）舊資料不顯示
    watch = data; watch.at = Date.now(); watchState = "";
  } catch (e) { watchState = "error"; }
  drawWatch();
}

const watchTime = (t) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const watchAgo = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時 ${m % 60} 分前`; };

function watchFiltered() {
  if (!watch) return [];
  const since = Date.now() - Number(watchF.days) * 86400000, q = watchF.q.trim().toLowerCase();
  return watch.items.filter((i) => i.t >= since && (!watchF.src || i.s === watchF.src) && (!watchF.cat || (watchF.cat === "-" ? !i.c : i.c === watchF.cat))
    && (!q || (i.x + " " + i.o).toLowerCase().includes(q)));
}

// 置頂清單：同一件事多家報導只留最新一則，並記下還有幾則
function watchPinned() {
  if (!watch) return [];
  const since = Date.now() - PIN_HOURS * 3600000;
  const grams = (s) => { const t = s.replace(/[^一-鿿0-9a-z]/gi, ""), g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
  const kept = [];
  watch.items.filter((i) => (i.s === "news" || i.s === "threads") && i.t >= since && PIN_HIT.test(i.x) && !PIN_SKIP.test(i.x) && !PIN_ABROAD.test(i.x)).forEach((i) => {
    const g = grams(i.x.slice(0, 60));
    const same = kept.find((k) => { let n = 0; g.forEach((x) => { if (k.g.has(x)) n++; }); return n / Math.min(g.size, k.g.size || 1) >= 0.3; });   // 兩個標題有三成以上的字詞重疊就當成同一件事（各家寫法不同，抓不到全部）
    if (same) same.more++; else kept.push({ i, g, more: 0, taipei: i.l || IN_TAIPEI.test(i.x) });
  });
  return kept.sort((a, b) => (b.taipei - a.taipei) || (b.i.t - a.i.t));
}

function renderWatch() {
  $("#view").innerHTML = `<div class="banner wbanner" style="background-image:url('img/skyline.webp');background-position:center 36%"><div class="btitle">犀牛巡邏隊</div></div>
    <p class="note">犀牛幫你巡新聞和社群：自動蒐集新聞、Threads、Facebook 上跟消防、災害有關的公開內容。新聞每小時更新，Facebook 早晚各一次，Threads 每天早上。</p>
    <div class="wbox" id="wBox"></div>`;
  $("#wBox").addEventListener("click", (x) => {
    const b = x.target.closest("[data-k]");
    if (b) {
      watchF[b.dataset.k] = b.dataset.v;
      Object.keys(watchShown).forEach((k) => delete watchShown[k]);
      if (b.dataset.k === "days" && watch && Number(b.dataset.v) > watch.days) loadWatch(Number(b.dataset.v)); else drawWatch();
      return;
    }
    const more = x.target.closest("[data-more]");
    if (more) { const k = more.dataset.more; watchShown[k] = (watchShown[k] || (k === "pin" ? PIN_MAX : WATCH_PAGE)) + 20; drawWatch(); return; }
    if (x.target.closest("#wReload")) { loadWatch(Math.max(7, Number(watchF.days))); return; }
    if (x.target.closest("#wCsv")) watchCsv();
  });
  $("#wBox").addEventListener("input", (x) => { if (x.target.id === "wQ") { watchF.q = x.target.value; drawWatchList(); } });
  if (!watch && watchState !== "loading") loadWatch(7); else drawWatch();
}

const watchItem = (i, extra = "") => {
  const [name, color] = WATCH_SRC[i.s] || [i.s, "#fff"];
  return `<a class="witem${i.l ? " local" : ""}" href="${esc(i.u)}" target="_blank" rel="noopener noreferrer">
    <span class="wmeta"><span class="wtime">${watchTime(i.t)}</span><span class="tag" style="background:${color}">${name}</span>${extra}${i.l ? `<span class="tag sup">轄區</span>` : ""}${i.c ? `<span class="tag">${esc(i.c)}</span>` : ""}<span class="worigin">${esc(i.o)}</span></span>
    <span class="wtext">${esc(i.x)}</span></a>`;
};

function drawWatch() {
  const box = $("#wBox");
  if (!box) return;
  if (!watch) {
    box.innerHTML = watchState === "error"
      ? `<div class="card empty"><p class="err">巡邏資料讀不到。</p><p class="note">可能是後端暫時沒有回應，或網路不通。</p><button id="wReload">再試一次</button></div>`
      : `<p class="note" style="text-align:center;padding:32px 16px;font-size:1.1rem">巡邏資料載入中，請稍候…</p>`;
    return;
  }
  const since = Date.now() - Number(watchF.days) * 86400000, inRange = watch.items.filter((i) => i.t >= since);
  const cats = [...new Set(watch.items.map((i) => i.c).filter(Boolean))];
  const chip = (k, v, label) => `<button class="ghost chip${watchF[k] === v ? " on" : ""}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${watchF[k] === v}">${esc(label)}</button>`;
  const pins = watchPinned();
  box.innerHTML = `
    <div class="wpin${pins.length ? "" : " none"}"><h2>🚨 置頂｜${PIN_HOURS} 小時內的火警、災害</h2>
      ${pins.length ? pins.slice(0, watchShown.pin || PIN_MAX).map((p) => `<a class="witem pin${p.taipei ? " taipei" : ""}" href="${esc(p.i.u)}" target="_blank" rel="noopener noreferrer">
        <span class="wmeta"><span class="wtime">${watchAgo(p.i.t)}</span>${p.taipei ? `<span class="tag bad">臺北市</span>` : ""}<span class="tag" style="background:${WATCH_SRC[p.i.s][1]}">${WATCH_SRC[p.i.s][0]}</span>${p.more ? `<span class="tag">另有 ${p.more} 則相同報導</span>` : ""}<span class="worigin">${esc(p.i.o)}</span></span>
        <span class="wtext">${esc(p.i.x)}</span></a>`).join("") + (pins.length > (watchShown.pin || PIN_MAX) ? `<p class="more"><button data-more="pin" class="ghost">再顯示（還有 ${pins.length - (watchShown.pin || PIN_MAX)} 則）</button></p>` : "") : `<p class="note">過去 ${PIN_HOURS} 小時，新聞和 Threads 沒有台灣的火警或災害消息。</p>`}</div>
    <div class="grid wstats">${Object.entries(WATCH_SRC).map(([k, [name, color]]) => `<div class="card stat" style="border-top:10px solid ${color}"><div class="sub">${name}</div><div class="num">${inRange.filter((i) => i.s === k).length}</div>
      <div class="note">${watch.lastFetch[k] ? "更新 " + watchTime(watch.lastFetch[k]) : "還沒有資料"}</div></div>`).join("")}
      <div class="card stat" style="border-top:10px solid var(--yellow)"><div class="sub">轄區相關</div><div class="num">${inRange.filter((i) => i.l).length}</div><div class="note">${WATCH_RANGE.find(([d]) => String(d) === watchF.days)[1]}內</div></div></div>
    <div class="filters dfilters">
      <div class="chips" role="group" aria-label="時間範圍">${WATCH_RANGE.map(([d, n]) => chip("days", String(d), n)).join("")}</div>
      <div class="chips" role="group" aria-label="來源">${chip("src", "", "全部來源")}${Object.entries(WATCH_SRC).map(([k, [n]]) => chip("src", k, n)).join("")}</div>
      <div class="chips" role="group" aria-label="分類">${chip("cat", "", "全部分類")}${cats.map((c) => chip("cat", c, c)).join("")}${chip("cat", "-", "未分類")}</div>
    </div>
    <div class="filters"><input id="wQ" type="search" placeholder="搜尋內容、媒體、帳號" aria-label="搜尋" value="${esc(watchF.q)}"><span class="note" id="wNote"></span>
      <div class="actions"><button class="ghost" id="wReload"${watchState === "loading" ? " disabled" : ""}>${watchState === "loading" ? "更新中…" : "重新整理"}</button><button class="ghost" id="wCsv">匯出 CSV</button></div></div>
    ${watchState === "error" ? `<p class="err">剛才更新失敗，下面是上一次讀到的資料。</p>` : ""}
    <div id="wList"></div>`;
  drawWatchList();
}

function drawWatchList() {
  const el = $("#wList");
  if (!el) return;
  const list = watchFiltered();
  $("#wNote").textContent = `符合 ${list.length} 則`;
  el.innerHTML = WATCH_SEC.filter((s) => !(watchF.src && ((s.key === "news") !== (watchF.src === "news")) && s.key !== "local")).map((s) => {
    const own = list.filter(s.pick), n = watchShown[s.key] || WATCH_PAGE;
    const head = s.img ? `<div class="banner wsec" style="background-image:url('img/${s.img}');background-position:${s.pos}"><div class="btitle">${s.name}</div><div class="bdue">${own.length} 則</div></div>`
      : `<h2 class="wsechead">${s.name}<span>${own.length} 則</span></h2>`;
    return head + (own.length ? own.slice(0, n).map((i) => watchItem(i)).join("")
      + (own.length > n ? `<p class="more"><button data-more="${s.key}" class="ghost">再顯示 ${Math.min(20, own.length - n)} 則（還有 ${own.length - n} 則）</button></p>` : "")
      : `<p class="note wnone">${s.empty}</p>`);
  }).join("");
}

// 匯出目前篩選結果（加 BOM，Excel 開中文才不會亂碼）
function watchCsv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["時間", "來源", "媒體／帳號", "分類", "轄區", "內容", "連結"]].concat(watchFiltered().map((i) => [watchTime(i.t), (WATCH_SRC[i.s] || [i.s])[0], i.o, i.c, i.l ? "是" : "", i.x, i.u]));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }));
  a.download = `犀牛巡邏隊_${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replace(/-/g, "")}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

// 開著這一頁時定時更新；沒有新資料也每分鐘重畫一次，置頂的「幾分鐘前」和 4 小時範圍才會跟著時間走
setInterval(() => {
  if (!$("#wBox") || !watch || watchState === "loading" || document.hidden) return;
  if (Date.now() - watch.at >= WATCH_REFRESH) loadWatch(Math.max(7, Number(watchF.days)));
  else if (document.activeElement && document.activeElement.id !== "wQ") drawWatch();
}, 60000);
