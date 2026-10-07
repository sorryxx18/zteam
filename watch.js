// ---- 犀牛巡邏隊：新聞、Threads、Instagram、Facebook 上跟消防、災害有關的公開內容（獨立後端定時抓，免登入可看） ----
// 要排在 app.js 前面載入（app.js 一啟動就會畫目前的專案）
const WATCH_API = "https://script.google.com/macros/s/AKfycbwFgbXawD8ZrHFvjVjbqjIZ1mGz8EOz9qmPCpUVYqFIIDYJWHvoCdMAxTUv-GAKkYq8jw/exec";
const WATCH_SRC = { news: ["新聞", "#d8ecff"], threads: ["Threads", "#e6dcff"], ig: ["Instagram", "#ffd0e6"], fb: ["Facebook", "#cfe0ff"] };
const WATCH_RANGE = [[1, "24 小時"], [3, "3 天"], [7, "7 天"], [30, "30 天"]];
const WATCH_PAGE = 50;       // 一次顯示幾則
let watch = null;            // 後端回來的資料 {items, lastFetch, now, days}
let watchState = "";         // "loading"｜"error"｜""
const watchF = { src: "", cat: "", local: "", q: "", days: "1" };
let watchShown = WATCH_PAGE;

async function loadWatch(days) {
  watchState = "loading"; drawWatch();
  try {
    let data;
    for (let i = 0; ; i++) {   // Google 偶爾回 404 或非 JSON（暫時性），自動重試兩次
      try { data = await (await fetch(`${WATCH_API}?days=${days}`)).json(); if (!data.ok) throw new Error(data.error || "error"); break; }
      catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    data.items = data.items.filter((i) => i.s in WATCH_SRC);   // 已經不看的來源（例如 PTT）舊資料不顯示
    watch = data; watchState = "";
  } catch (e) { watchState = "error"; }
  drawWatch();
}

const watchTime = (t) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

function watchFiltered() {
  if (!watch) return [];
  const since = watch.now - Number(watchF.days) * 86400000, q = watchF.q.trim().toLowerCase();
  return watch.items.filter((i) => i.t >= since && (!watchF.src || i.s === watchF.src) && (!watchF.cat || (watchF.cat === "-" ? !i.c : i.c === watchF.cat))
    && (!watchF.local || i.l) && (!q || (i.x + " " + i.o).toLowerCase().includes(q)));
}

function renderWatch() {
  $("#view").innerHTML = `<div class="banner wbanner" style="background-image:url('img/skyline.webp');background-position:center 36%"><div class="btitle">犀牛巡邏隊</div></div>
    <p class="note">犀牛幫你巡新聞和社群：自動蒐集新聞、Threads、Instagram、Facebook 上跟消防、災害有關的公開內容。新聞每小時更新，社群每天早上更新。「轄區」＝內容提到大安、信義、南港或轄內地標。</p>
    <div class="wbox" id="wBox"></div>`;
  $("#wBox").addEventListener("click", (x) => {
    const b = x.target.closest("[data-k]");
    if (b) {
      watchF[b.dataset.k] = b.dataset.v; watchShown = WATCH_PAGE;
      if (b.dataset.k === "days" && watch && Number(b.dataset.v) > watch.days) loadWatch(Number(b.dataset.v)); else drawWatch();
      return;
    }
    if (x.target.closest("#wMore")) { watchShown += WATCH_PAGE; drawWatch(); return; }
    if (x.target.closest("#wReload")) { loadWatch(Math.max(7, Number(watchF.days))); return; }
    if (x.target.closest("#wCsv")) watchCsv();
  });
  $("#wBox").addEventListener("input", (x) => { if (x.target.id === "wQ") { watchF.q = x.target.value; watchShown = WATCH_PAGE; drawWatchList(); } });
  if (!watch && watchState !== "loading") loadWatch(7); else drawWatch();
}

function drawWatch() {
  const box = $("#wBox");
  if (!box) return;
  if (!watch) {
    box.innerHTML = watchState === "error"
      ? `<div class="card empty"><p class="err">巡邏資料讀不到。</p><p class="note">可能是後端還沒啟用，或網路暫時不通。</p><button id="wReload">再試一次</button></div>`
      : `<p class="note" style="text-align:center;padding:32px 16px;font-size:1.1rem">巡邏資料載入中，請稍候…</p>`;
    return;
  }
  const since = watch.now - Number(watchF.days) * 86400000, inRange = watch.items.filter((i) => i.t >= since);
  const cats = [...new Set(watch.items.map((i) => i.c).filter(Boolean))];
  const chip = (k, v, label) => `<button class="ghost chip${watchF[k] === v ? " on" : ""}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${watchF[k] === v}">${esc(label)}</button>`;
  box.innerHTML = `
    <div class="grid wstats">${Object.entries(WATCH_SRC).map(([k, [name, color]]) => `<div class="card stat" style="border-top:10px solid ${color}"><div class="sub">${name}</div><div class="num">${inRange.filter((i) => i.s === k).length}</div>
      <div class="note">${watch.lastFetch[k] ? "更新 " + watchTime(watch.lastFetch[k]) : "還沒有資料"}</div></div>`).join("")}
      <div class="card stat" style="border-top:10px solid var(--yellow)"><div class="sub">轄區相關</div><div class="num">${inRange.filter((i) => i.l).length}</div><div class="note">${WATCH_RANGE.find(([d]) => String(d) === watchF.days)[1]}內</div></div></div>
    <div class="filters dfilters">
      <div class="chips" role="group" aria-label="時間範圍">${WATCH_RANGE.map(([d, n]) => chip("days", String(d), n)).join("")}</div>
      <div class="chips" role="group" aria-label="來源">${chip("src", "", "全部來源")}${Object.entries(WATCH_SRC).map(([k, [n]]) => chip("src", k, n)).join("")}</div>
      <div class="chips" role="group" aria-label="分類">${chip("cat", "", "全部分類")}${cats.map((c) => chip("cat", c, c)).join("")}${chip("cat", "-", "未分類")}</div>
      <div class="chips" role="group" aria-label="轄區">${chip("local", "", "全部地區")}${chip("local", "1", "只看轄區")}</div>
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
  el.innerHTML = list.length ? list.slice(0, watchShown).map((i) => {
    const [name, color] = WATCH_SRC[i.s] || [i.s, "#fff"];
    return `<a class="witem${i.l ? " local" : ""}" href="${esc(i.u)}" target="_blank" rel="noopener noreferrer">
      <span class="wmeta"><span class="wtime">${watchTime(i.t)}</span><span class="tag" style="background:${color}">${name}</span>${i.l ? `<span class="tag sup">轄區</span>` : ""}${i.c ? `<span class="tag">${esc(i.c)}</span>` : ""}<span class="worigin">${esc(i.o)}</span></span>
      <span class="wtext">${esc(i.x)}</span></a>`;
  }).join("") + (list.length > watchShown ? `<p class="more"><button id="wMore" class="ghost">再顯示 ${Math.min(WATCH_PAGE, list.length - watchShown)} 則（還有 ${list.length - watchShown} 則）</button></p>` : "")
    : `<div class="card empty"><p>這個條件下沒有內容。</p><p class="note">可以把時間範圍拉長，或取消其他篩選。</p></div>`;
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
