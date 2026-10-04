// ---- 大巨蛋看板：台北大巨蛋消防安全管理（結報統計、大事記、新增結報、匯出 Word） ----
let dome = null;          // {events, log, canAdd, canExport}
const domeF = { year: "", cat: "", q: "", lcat: "" };
let domeCharts = [];
let domePreview = null;    // 新增結報預覽

const WORD = {"titlePPr": "<w:pPr><w:pStyle w:val=\"a3\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"33\"/></w:numPr><w:spacing w:line=\"400\" w:lineRule=\"exact\"/><w:ind w:leftChars=\"0\" w:hanging=\"1244\"/><w:rPr><w:rFonts w:ascii=\"標楷體\" w:eastAsia=\"標楷體\" w:hAnsi=\"標楷體\"/><w:sz w:val=\"32\"/><w:szCs w:val=\"24\"/></w:rPr></w:pPr>", "titleRPr": "<w:rPr><w:rFonts w:ascii=\"標楷體\" w:eastAsia=\"標楷體\" w:hAnsi=\"標楷體\"/><w:sz w:val=\"32\"/><w:szCs w:val=\"24\"/></w:rPr>", "bodyPPr": "<w:pPr><w:widowControl/><w:tabs><w:tab w:val=\"left\" w:pos=\"916\"/><w:tab w:val=\"left\" w:pos=\"1832\"/><w:tab w:val=\"left\" w:pos=\"2748\"/><w:tab w:val=\"left\" w:pos=\"3664\"/><w:tab w:val=\"left\" w:pos=\"4580\"/><w:tab w:val=\"left\" w:pos=\"5496\"/><w:tab w:val=\"left\" w:pos=\"6412\"/><w:tab w:val=\"left\" w:pos=\"7328\"/><w:tab w:val=\"left\" w:pos=\"8244\"/><w:tab w:val=\"left\" w:pos=\"9160\"/><w:tab w:val=\"left\" w:pos=\"10076\"/><w:tab w:val=\"left\" w:pos=\"10992\"/><w:tab w:val=\"left\" w:pos=\"11908\"/><w:tab w:val=\"left\" w:pos=\"12824\"/><w:tab w:val=\"left\" w:pos=\"13740\"/><w:tab w:val=\"left\" w:pos=\"14656\"/></w:tabs><w:rPr><w:rFonts w:ascii=\"細明體\" w:eastAsia=\"細明體\" w:hAnsi=\"細明體\" w:cs=\"細明體\"/><w:kern w:val=\"0\"/><w:szCs w:val=\"24\"/></w:rPr></w:pPr>", "bodyRPr": "<w:rPr><w:rFonts w:ascii=\"細明體\" w:eastAsia=\"細明體\" w:hAnsi=\"細明體\" w:cs=\"細明體\"/><w:kern w:val=\"0\"/><w:szCs w:val=\"24\"/></w:rPr>", "anchor": "B2安全防護班及防災中心共6位。"};  // 原 Word 的段落格式（標題列、內文列）與插入位置

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

const n0 = (v) => (v === "" || v == null ? 0 : Number(v));
const fmt = (v) => (v || v === 0 ? Number(v).toLocaleString("zh-TW") : "—");
const yes = (v) => v === true || v === "1" || v === "true";

// ---- 解析貼上的結報（與 Mac 端 parse_dome.py 同一套規則） ----
const TITLES = "(?:幕僚隊員|中隊幕僚|幕僚|副中隊長|中隊長|副大隊長|大隊長|分隊長|小隊長|隊員|組長|技正|經理|科員|股長|主任秘書|所長|副局長|副秘書長|主秘|專員|議員|店長|副理|助理|中隊員|值日)";
const NAME = "(?:(?![隊員長率會同中分信義大組副幕僚聯抽進到於])[\\u4e00-\\u9fff]){2,3}";
const END = "(?=[、，,及與會率於共到在擔進聯抽從由抵前駐\\d\\s（(。：:]|$)";
function maskText(t) {
  t = t.replace(/\(?0\d{1,3}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}(#\d+)?|09\d{2}-?\d{3}-?\d{3}/g, "（電話略）");
  const re1 = new RegExp("(" + TITLES + ")(?:(?:、|及|與)?" + NAME + ")+" + END, "g");
  for (let i = 0; i < 3; i++) t = t.replace(re1, "$1");
  t = t.replace(new RegExp("(分隊|中隊)" + NAME + "(分隊長|中隊長)", "g"), "$1$2");
  t = t.replace(new RegExp("(班|中心)" + NAME + "(?=[、及共])", "g"), "$1");
  return t;
}

function parseReport(rid, kind, text) {
  if (rid.length === 6) rid = "1" + rid;
  const y = +rid.slice(0, 3), m = +rid.slice(3, 5), d = +rid.slice(5, 7);
  const g = (re) => { const x = text.match(re); return x ? x[1] : null; };
  const num = (s) => (s ? Number(s.replace(/,/g, "")) : "");
  const name = (g(/(?:賽事|活動)名稱[：:]\s*(.*?)。/) || "").trim();
  const sm = text.match(/其他\s*[（(]特殊事件回報[）)]\s*[：:]\s*([\s\S]*)/);
  let special = sm ? sm[1].trim() : "";
  const keep = [];
  special.split("\n").forEach((line, i) => { if (keep.length === i && (i === 0 || /^\s*([（(][一二三四五六七八九十]+[）)]|\d+、)/.test(line))) keep.push(line); });
  special = keep.join("\n");
  let cat = "其他活動";
  if (/演唱會/.test(kind) || /演唱會|巡迴|TOUR|Tour|CONCERT|Concert|LIVE|Live|音樂|演唱/.test(name)) cat = "演唱會";
  else if (/棒/.test(kind) || /棒|[Vv][Ss]\.?|經典賽|12強|中職|悍將|兄弟|獅|味全|樂天|台鋼/.test(name)) cat = "棒球";
  const sold = num(g(/售票狀況[：:]\s*([\d,]+)/)), entered = num(g(/進場人數[：:]\s*([\d,]+)/)), peak = num(g(/容留系統人數[：:]\s*([\d,]+)/));
  return {
    id: rid, date: `${y + 1911}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, roc: `${y}/${m}/${d}`, year: y, cat, name,
    est: num(g(/預估開放人數[：:]\s*([\d,]+)/)), peak, sold, entered, attend: entered || sold || peak, staff: num(g(/消防編組人數[：:]\s*([\d,]+)/)),
    stationed: /進駐.{0,12}防災中心|防災中心.{0,6}進駐/.test(special) ? "1" : "",
    checks: [...special.matchAll(/共(\d+)\s*[位人]/g)].reduce((a, x) => a + Number(x[1]), 0),
    defect: /缺失|舉發|違反|待加強|故障/.test(special) ? "1" : "",
    special: maskText(special).slice(0, 1500), raw: text.trim(),
  };
}

function parsePasted(text) {
  text = text.replace(/\r/g, "").replace(/^\s*<|>\s*$/g, "");
  const hits = [...text.matchAll(/(\d{6,7})大巨蛋(\S{0,6}?)\(結報\)/g)];
  return hits.map((m, i) => parseReport(m[1], m[2], text.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : text.length)));
}

// ---- 畫面 ----
const DOME_CATS = ["棒球", "演唱會", "其他活動"];
const LOG_CATS = ["演練・兵推", "會議・審查", "建議事項", "缺失・改善", "其他"];
const DOME_PAGE = 30;       // 手機卡片一次顯示幾筆
let domeShown = DOME_PAGE;
let domeDrawn = false;      // 圖表畫過一次後，換篩選不再重跑動畫

const domeSort = { k: "date", dir: -1 };   // 電腦版結報表的排序欄位與方向

// 失敗提示：留在畫面上直到按掉，寫明發生什麼事、接下來怎麼做
function domeFail(what, next, e) {
  if (e && e.message === "login") return;
  document.querySelectorAll(".fail").forEach((x) => x.remove());
  const el = document.createElement("div");
  el.className = "fail"; el.setAttribute("role", "alert");
  el.innerHTML = `<div><b>${esc(what)}</b><br>${esc(next)}${e && e.message ? `<br><span class="note">系統訊息：${esc(e.message)}</span>` : ""}</div><button class="ghost">知道了</button>`;
  el.querySelector("button").addEventListener("click", () => el.remove());
  document.body.appendChild(el);
  el.querySelector("button").focus();
}

// 手機轉向或視窗變寬窄時，結報清單在卡片和表格之間切換
window.matchMedia("(max-width: 760px)").addEventListener("change", () => { if (dome && $("#dList")) drawDomeList(); });

// 跳轉列標出目前捲到哪一區
let domeSpyQueued = false;
window.addEventListener("scroll", () => {
  if (domeSpyQueued) return;
  domeSpyQueued = true;
  requestAnimationFrame(() => {
    domeSpyQueued = false;
    const btns = document.querySelectorAll(".secnav [data-go]");
    if (!btns.length) return;
    let cur = btns[0].dataset.go;
    btns.forEach((b) => { const t = $("#" + b.dataset.go); if (t && t.getBoundingClientRect().top <= 140) cur = b.dataset.go; });
    btns.forEach((b) => (b.dataset.go === cur ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
  });
}, { passive: true });

// 年度、類型篩選：統計、圖表、結報清單共用
function domeFiltered() {
  return dome.events.filter((e) => (!domeF.year || String(e.year) === domeF.year) && (!domeF.cat || e.cat === domeF.cat));
}

// 下方三張橫幅等捲到附近才載入圖片
const banner = (img, title, id = "", lazy = false) =>
  `<div class="banner dbanner"${id ? ` id="${id}"` : ""} ${lazy ? `data-bg="img/${img}"` : `style="background-image:url('img/${img}')"`}><div class="btitle">${title}</div><div class="bdue" hidden></div></div>`;
const bsub = (id, text) => { const el = $(`#${id} .bdue`); el.textContent = text; el.hidden = !text; };

async function renderDome() {
  if (!dome) {
    $("#view").innerHTML = `<p class="note">載入中…</p>`;
    try {
      await Promise.all([loadScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"), (async () => { dome = await api({ action: "dome_data" }); })()]);
    } catch (e) {
      $("#view").innerHTML = `<div class="card empty"><p class="err">看板資料載入失敗：${esc(e.message)}</p><button id="domeRetry">再試一次</button></div>`;
      $("#domeRetry").addEventListener("click", () => { dome = null; renderDome(); });
      return;
    }
  }
  const years = [...new Set(dome.events.map((e) => String(e.year)))].sort();
  const chip = (k, v, label) => `<button class="ghost chip" data-k="${k}" data-v="${v}">${label}</button>`;
  $("#view").innerHTML = `
    ${banner("dome-main.webp", "台北大巨蛋<br>消防安全管理看板", "dSecTop")}
    <div class="secnav" role="navigation" aria-label="看板區塊">
      ${[["dSecStats", "統計"], ["dSecList", "結報"], ["dSecStation", "進駐"], ["dSecLog", "大事記"]].map(([id, n]) => `<button data-go="${id}">${n}</button>`).join("")}
    </div>
    <div class="filters dfilters" id="dSecStats">
      <div class="chips" role="group" aria-label="年度">${chip("year", "", "全部年度")}${years.map((y) => chip("year", y, y + " 年")).join("")}</div>
      <div class="chips" role="group" aria-label="活動類型">${chip("cat", "", "全部類型")}${DOME_CATS.map((c) => chip("cat", c, c)).join("")}</div>
      ${dome.canAdd || dome.canExport ? `<div class="actions">${dome.canAdd ? `<button id="domeAddBtn">＋ 新增結報</button>` : ""}${dome.canExport ? `<button id="domeWord" class="ghost">匯出最新版 Word</button>` : ""}</div>` : ""}
    </div>
    <div id="domeAdd"></div>
    <div id="dStats"></div>
    <div class="grid charts">
      <div class="card"><h2>每月場次</h2><div class="chartbox"><canvas id="cMonth" role="img"></canvas></div><p class="note" id="cMonthSum"></p></div>
      <div class="card"><h2>每月觀眾人次</h2><div class="chartbox"><canvas id="cAttend" role="img"></canvas></div><p class="note" id="cAttendSum"></p></div>
      <div class="card"><h2>活動類型</h2><div class="chartbox"><canvas id="cCat" role="img"></canvas></div><p class="note" id="cCatSum"></p></div>
      <div class="card"><h2>觀眾人數 vs 自衛消防編組</h2><div class="chartbox"><canvas id="cStaff" role="img"></canvas></div><p class="note" id="cStaffSum"></p></div>
    </div>
    ${banner("dome-crowd.webp", "賽事・活動結報", "dSecList", true)}
    <div class="filters"><input id="domeQ" type="search" placeholder="搜尋名稱、日期、內容" aria-label="搜尋結報" value="${esc(domeF.q)}"><span class="note" id="dListNote"></span></div>
    <div id="dList"></div>
    ${banner("dome-center.webp", "進駐防災中心", "dSecStation", true)}
    <div class="card"><div class="chartbox"><canvas id="cStation" role="img"></canvas></div><p class="note" id="cStationSum"></p><p class="note">原則：預估觀眾 2 萬人以上，進駐 B1 防災中心督導；未達 2 萬人，由幕僚聯繫防災中心掌握人流。</p></div>
    ${banner("dome-drill.webp", "大事記・演練・會議", "dSecLog", true)}
    <div class="filters"><div class="chips" role="group" aria-label="大事類別">${["", ...LOG_CATS].map((c) => chip("lcat", c, c || "全部")).join("")}</div></div>
    <p class="note" id="dLogNote"></p>
    <div class="timeline" id="dTimeline"></div>`;

  const view = $("#view");
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((x) => {
    if (x.isIntersecting) { x.target.style.backgroundImage = `url('${x.target.dataset.bg}')`; io.unobserve(x.target); }
  }), { rootMargin: "400px" }) : null;
  view.querySelectorAll("[data-bg]").forEach((b) => (io ? io.observe(b) : (b.style.backgroundImage = `url('${b.dataset.bg}')`)));
  view.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.go).scrollIntoView({ behavior: "smooth", block: "start" })));
  view.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    domeF[b.dataset.k] = b.dataset.v;
    if (b.dataset.k === "lcat") { syncDomeChips(); drawDomeLog(); } else { domeShown = DOME_PAGE; updateDome(); }
  }));
  const q = $("#domeQ");
  q.addEventListener("input", () => { domeF.q = q.value; domeShown = DOME_PAGE; drawDomeList(); });
  $("#dList").addEventListener("click", (x) => {
    const th = x.target.closest("[data-sort]");
    if (th) {
      const k = th.dataset.sort;
      if (domeSort.k === k) domeSort.dir = -domeSort.dir;
      else { domeSort.k = k; domeSort.dir = ["cat", "name"].includes(k) ? 1 : -1; }   // 文字欄先小到大，其餘先大到小
      drawDomeList();
      $(`#dList [data-sort="${k}"]`).focus();
      return;
    }
    if (x.target.closest("#dMore")) { domeShown += DOME_PAGE; drawDomeList(); return; }
    if (x.target.closest("#dClear")) { domeF.year = ""; domeF.cat = ""; domeF.q = ""; q.value = ""; updateDome(); return; }
    const r = x.target.closest("[data-id]");
    if (r) openDomeEvent(r.dataset.id, r);
  });
  $("#dList").addEventListener("keydown", (x) => {
    const r = x.target.closest("tr[data-id]");
    if (r && (x.key === "Enter" || x.key === " ")) { x.preventDefault(); openDomeEvent(r.dataset.id, r); }
  });
  $("#dTimeline").addEventListener("click", async (x) => {
    const more = x.target.closest("[data-more]");
    if (more) { const open = more.previousElementSibling.classList.toggle("clamp") === false; more.textContent = open ? "收合" : "展開全文"; return; }
    const rm = x.target.closest("[data-rmlog]");
    if (!rm || !confirm("刪除這則大事？")) return;
    try { await api({ action: "dome_remove", kind: "log", id: rm.dataset.rmlog }); dome = null; renderDome(); } catch (e) { domeFail("這則大事沒有刪掉。", "請再按一次刪除；還是不行，重新整理頁面後再試。", e); }
  });
  if (dome.canAdd) $("#domeAddBtn").addEventListener("click", openDomeAdd);
  if (dome.canExport) $("#domeWord").addEventListener("click", exportDomeWord);
  updateDome();
  window.dispatchEvent(new Event("scroll"));   // 一進來就標出目前區塊
}

function syncDomeChips() {
  $("#view").querySelectorAll(".chip").forEach((b) => {
    const on = domeF[b.dataset.k] === b.dataset.v;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  });
}

// 換篩選只更新數字、圖表、清單，不重建整個畫面（開著的「新增結報」不會被清掉）
function updateDome() {
  syncDomeChips();
  const ev = domeFiltered();
  const latest = dome.events.reduce((a, e) => (e.date > a.date ? e : a), dome.events[0] || { roc: "" });
  const total = ev.reduce((a, e) => a + n0(e.attend), 0);
  const top = ev.reduce((a, e) => (n0(e.attend) > n0(a.attend) ? e : a), ev[0] || {});
  const avgStaff = ev.length ? Math.round(ev.reduce((a, e) => a + n0(e.staff), 0) / ev.length) : 0;
  const stationed = ev.filter((e) => yes(e.stationed)).length;
  const count = (c) => ev.filter((e) => e.cat === c).length;
  const tile = (label, val, sub = "") => `<div class="card stat"><div class="sub">${label}</div><div class="num">${val}</div>${sub ? `<div class="note">${sub}</div>` : ""}</div>`;
  $("#dStats").innerHTML = `<div class="grid four">
      ${tile("活動場次", fmt(ev.length), `棒球 ${count("棒球")}・演唱會 ${count("演唱會")}・其他 ${count("其他活動")}`)}
      ${tile("累計觀眾（人次）", fmt(total), "優先採體育局進場數，其次售票、容留高峰")}
      ${tile("進駐防災中心", fmt(stationed) + " 場")}
      ${tile("缺失・舉發", fmt(ev.filter((e) => yes(e.defect)).length) + " 場")}
    </div>
    <p class="statline">${ev.length ? `<span>單場最多 <b>${fmt(top.attend)}</b> 人（${esc(`${top.roc || ""} ${top.name || ""}`)}）</span>
      <span>平均自衛消防編組 <b>${fmt(avgStaff)}</b> 人</span>
      <span>抽查編組 <b>${fmt(ev.reduce((a, e) => a + n0(e.checks), 0))}</b> 人次</span>` : `<span>這個年度、類型沒有活動，換個篩選看看。</span>`}</p>`;
  bsub("dSecTop", `統計到 ${latest.roc || ""}`);
  bsub("dSecStation", `${fmt(stationed)} 場`);
  drawDomeCharts(ev);
  drawDomeList();
  drawDomeLog();
}

function drawDomeList() {
  const q = domeF.q.trim();
  const sv = (e) => ({ date: e.date, cat: e.cat, name: e.name, stationed: yes(e.stationed) ? 1 : 0, defect: yes(e.defect) ? 1 : 0 }[domeSort.k] ?? n0(e[domeSort.k]));
  const byDate = (a, b) => b.date.localeCompare(a.date);
  const list = domeFiltered().filter((e) => !q || (e.name + e.special + e.roc).includes(q)).sort(isMobile() ? byDate : (a, b) => {
    const x = sv(a), y = sv(b);
    const c = typeof x === "string" ? x.localeCompare(y, "zh-Hant") : x - y;
    return c ? c * domeSort.dir : byDate(a, b);
  });
  const cond = [domeF.year && domeF.year + " 年", domeF.cat, q && `含「${q}」`].filter(Boolean);
  bsub("dSecList", `${fmt(list.length)} 場`);
  $("#dListNote").textContent = `${cond.length ? cond.join("・") + "，" : ""}共 ${fmt(list.length)} 場。點一筆看結報重點（人名已遮罩）。`;
  if (!list.length) {
    $("#dList").innerHTML = `<div class="card empty"><p>沒有符合的結報。</p><button class="ghost" id="dClear">清除篩選</button></div>`;
    return;
  }
  const tags = (e) => `${e.added_at ? '<span class="tag ok">新增</span> ' : ""}${yes(e.stationed) ? '<span class="tag">進駐</span> ' : ""}${yes(e.defect) ? '<span class="tag bad">缺失</span>' : ""}`;
  if (isMobile()) {
    $("#dList").innerHTML = list.slice(0, domeShown).map((e) => `<button class="mcard dcard" data-id="${e.id}">
        <span class="mhead"><b>${esc(e.name) || "（未命名）"}</b></span>
        <span class="dmeta">${esc(e.roc)}・${esc(e.cat)}・觀眾 ${fmt(e.attend)}・編組 ${fmt(e.staff)}</span>
        <span class="dtags">${tags(e)}</span></button>`).join("")
      + (list.length > domeShown ? `<p class="more"><button class="ghost" id="dMore">再顯示 ${Math.min(DOME_PAGE, list.length - domeShown)} 場（還有 ${list.length - domeShown} 場）</button></p>` : "");
    return;
  }
  $("#dList").innerHTML = `<div class="tablewrap tall"><table><thead><tr>${[["date", "日期"], ["cat", "類型"], ["name", "名稱"], ["attend", "觀眾"], ["peak", "容留高峰"], ["staff", "編組"], ["stationed", "進駐"], ["checks", "抽查"], ["defect", "缺失"]].map(([k, n]) =>
      `<th aria-sort="${domeSort.k === k ? (domeSort.dir > 0 ? "ascending" : "descending") : "none"}"><button class="thsort" data-sort="${k}" title="按這裡排序">${n}</button></th>`).join("")}</tr></thead>
    <tbody>${list.map((e) => `<tr class="drow" data-id="${e.id}" tabindex="0"><td>${esc(e.roc)}${e.added_at ? ' <span class="tag ok">新增</span>' : ""}</td><td>${esc(e.cat)}</td><td class="wrap">${esc(e.name)}</td>
      <td>${fmt(e.attend)}</td><td>${fmt(e.peak)}</td><td>${fmt(e.staff)}</td><td>${yes(e.stationed) ? '<span class="tag">進駐</span>' : ""}</td><td>${n0(e.checks) || ""}</td><td>${yes(e.defect) ? '<span class="tag bad">有</span>' : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

function drawDomeLog() {
  const list = dome.log.filter((l) => (!domeF.lcat || l.cat === domeF.lcat) && (!domeF.year || String(l.year) === domeF.year)).sort((a, b) => b.date.localeCompare(a.date));
  bsub("dSecLog", `${fmt(list.length)} 則`);
  $("#dLogNote").textContent = domeF.year ? `只顯示 ${domeF.year} 年的大事（跟最上面的年度篩選連動）。` : "";
  $("#dTimeline").innerHTML = list.map((l) => {
    const long = l.text.length > 220 || l.text.split("\n").length > 5;
    return `<div class="tl"><div class="tdate">${esc(l.roc)}</div><div class="card tbody"><span class="tag">${esc(l.cat)}</span>${l.added_at && dome.canAdd ? ` <button class="ghost" data-rmlog="${l.id}">刪除</button>` : ""}
      <div class="ttext${long ? " clamp" : ""}">${esc(l.text).replace(/\n/g, "<br>")}</div>${long ? `<button class="ghost" data-more>展開全文</button>` : ""}</div></div>`;
  }).join("") || `<p class="note">沒有符合的大事。</p>`;
}

function drawDomeCharts(ev) {
  domeCharts.forEach((c) => c.destroy()); domeCharts = [];
  if (!window.Chart) return;
  Chart.defaults.font.family = '"Huninn", sans-serif';
  Chart.defaults.color = "#141414";
  // 年度顏色固定跟著年度走（不隨篩選換色）；第三個年度用深藍，黃色畫在白底上看不清楚
  const allYears = [...new Set(dome.events.map((e) => String(e.year)))].sort();
  const years = allYears.filter((y) => ev.some((e) => String(e.year) === y));
  const colors = ["#1d7fe0", "#e3262b", "#14254a", "#1f9d55"];
  const months = Array.from({ length: 12 }, (_, i) => i + 1 + "月");
  const by = (fn) => years.map((y) => ({
    label: y + " 年", backgroundColor: colors[allYears.indexOf(y) % 4], borderColor: "#141414", borderWidth: 2,
    data: months.map((_, m) => fn(ev.filter((e) => String(e.year) === y && +e.date.slice(5, 7) === m + 1))),
  }));
  const still = domeDrawn || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 每張圖各用一份新的設定（Chart.js 會改寫傳入的設定物件，共用會互相干擾）
  const mk = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, ...(still ? { animation: false } : {}), plugins: { legend: { labels: { boxWidth: 14 } } }, ...extra });
  domeCharts.push(new Chart($("#cMonth"), { type: "bar", data: { labels: months, datasets: by((l) => l.length) }, options: mk() }));
  domeCharts.push(new Chart($("#cAttend"), { type: "line", data: { labels: months, datasets: by((l) => l.reduce((a, e) => a + n0(e.attend), 0)).map((d) => ({ ...d, borderColor: d.backgroundColor, borderWidth: 3, tension: .25 })) }, options: mk() }));
  domeCharts.push(new Chart($("#cCat"), { type: "doughnut", data: { labels: DOME_CATS, datasets: [{ data: DOME_CATS.map((c) => ev.filter((e) => e.cat === c).length), backgroundColor: ["#1d7fe0", "#e3262b", "#ffd60a"], borderColor: "#141414", borderWidth: 2 }] }, options: mk() }));
  domeCharts.push(new Chart($("#cStaff"), { type: "scatter", data: { datasets: DOME_CATS.map((c, i) => ({ label: c, backgroundColor: ["#1d7fe0", "#e3262b", "#ffb703"][i], borderColor: "#141414",
    data: ev.filter((e) => e.cat === c && n0(e.attend) && n0(e.staff)).map((e) => ({ x: n0(e.attend), y: n0(e.staff) })) })) },
    options: mk({ scales: { x: { title: { display: true, text: "觀眾人數" } }, y: { title: { display: true, text: "編組人數" } } } }) }));
  domeCharts.push(new Chart($("#cStation"), { type: "bar", data: { labels: months, datasets: by((l) => l.filter((e) => yes(e.stationed)).length) }, options: mk({ plugins: { legend: { labels: { boxWidth: 14 } }, title: { display: true, text: "每月進駐防災中心場次" } } }) }));
  domeDrawn = true;
  // 每張圖配一句文字摘要：畫面上看得到，報讀軟體也讀得到
  const peak = (fn, unit) => {
    const v = months.map((_, m) => fn(ev.filter((e) => +e.date.slice(5, 7) === m + 1)));
    const max = Math.max(...v);
    return max > 0 ? `${months[v.indexOf(max)]}最多，${fmt(max)} ${unit}。` : "沒有資料。";
  };
  const pairs = ev.filter((e) => n0(e.attend) && n0(e.staff)).length;
  const sum = {
    cMonth: ["每月場次", peak((l) => l.length, "場")],
    cAttend: ["每月觀眾人次", peak((l) => l.reduce((a, e) => a + n0(e.attend), 0), "人次")],
    cCat: ["活動類型", ev.length ? DOME_CATS.map((c) => `${c} ${ev.filter((e) => e.cat === c).length} 場`).join("、") + "。" : "沒有資料。"],
    cStaff: ["觀眾人數 vs 自衛消防編組", pairs ? `每個點是一場活動，共 ${fmt(pairs)} 場；越往右上，人越多、編組也越多。` : "沒有資料。"],
    cStation: ["每月進駐防災中心場次", peak((l) => l.filter((e) => yes(e.stationed)).length, "場")],
  };
  Object.entries(sum).forEach(([id, [title, text]]) => { $(`#${id}Sum`).textContent = text; $("#" + id).setAttribute("aria-label", `${title}：${text}`); });
}

function openDomeEvent(id, opener) {
  const e = dome.events.find((x) => x.id === id);
  let m = $("#modal");
  if (!m) { m = document.createElement("div"); m.id = "modal"; document.body.appendChild(m); }
  const row = (k, v) => `<tr><th>${k}</th><td class="wrap">${v}</td></tr>`;
  m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-labelledby="mTitle"><div class="mtop"><b id="mTitle">${esc(e.roc)}　${esc(e.name)}</b><button class="ghost" id="mClose">關閉</button></div>
    <div class="tablewrap"><table class="kv">${row("類型", esc(e.cat))}${row("預估開放", fmt(e.est))}${row("容留高峰", fmt(e.peak))}${row("售票", fmt(e.sold))}${row("體育局進場", fmt(e.entered))}
    ${row("自衛消防編組", fmt(e.staff) + " 人")}${row("進駐防災中心", yes(e.stationed) ? "是" : "否")}${row("抽查編組", (n0(e.checks) || 0) + " 人次")}
    ${row("特殊事件（人名已遮罩）", esc(e.special).replace(/\n/g, "<br>") || "—")}</table></div>
    ${e.added_at && dome.canAdd ? `<p><button class="ghost" id="mDel">刪除這份新增的結報</button></p>` : ""}</div>`;
  const onKey = (x) => {
    if (x.key === "Escape") { close(); return; }
    if (x.key !== "Tab") return;
    const f = [...m.querySelectorAll("button")];   // 焦點留在視窗裡，不跑到背後的頁面
    const i = f.indexOf(document.activeElement);
    x.preventDefault();
    f[(i + (x.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  };
  const close = () => { m.remove(); document.removeEventListener("keydown", onKey); if (opener && opener.isConnected) opener.focus(); };
  document.addEventListener("keydown", onKey);
  $("#mClose").addEventListener("click", close);
  $("#mClose").focus();
  m.addEventListener("click", (x) => { if (x.target === m) close(); });
  const del = $("#mDel");
  if (del) del.addEventListener("click", async () => {
    if (!confirm("刪除這份結報？")) return;
    try { await api({ action: "dome_remove", kind: "events", id }); close(); dome = null; renderDome(); } catch (err) { close(); domeFail("這份結報沒有刪掉。", "請再點開這一筆按一次刪除；還是不行，重新整理頁面後再試。", err); }
  });
}

// ---- 新增結報 / 大事（只有承辦人） ----
function openDomeAdd() {
  const box = $("#domeAdd");
  if (box.innerHTML) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="card"><h2>新增結報</h2>
    <p class="note">整段貼上 LINE 的結報（可以一次貼好幾份），系統會自動拆欄位，確認後存檔。同一個編號（例如 1150925）再貼一次會覆蓋。</p>
    <textarea id="domeText" rows="10" placeholder="1150925大巨蛋棒球賽事(結報)&#10;一、活動日期、時間：…"></textarea>
    <p><button id="domeParse">解析</button></p><div id="domePrev"></div>
    <h2 class="next">新增大事（會議、演練等）</h2>
    <div class="form"><label>日期<input type="date" id="lgDate"></label>
      <label>類別<select id="lgCat">${["演練・兵推", "會議・審查", "建議事項", "缺失・改善", "其他"].map((c) => `<option>${c}</option>`).join("")}</select></label></div>
    <textarea id="lgText" rows="4" placeholder="內容（照原文貼上，人名在看板上會自動遮罩，匯出 Word 保留原文）"></textarea>
    <p><button id="lgSave">存檔</button></p></div>`;
  $("#domeParse").addEventListener("click", () => {
    domePreview = parsePasted($("#domeText").value);
    if (!domePreview.length) { $("#domePrev").innerHTML = `<p class="err">找不到「XXXXXXX大巨蛋…(結報)」開頭的結報，請確認格式。</p>`; return; }
    const exist = new Set(dome.events.map((e) => e.id));
    $("#domePrev").innerHTML = `<div class="tablewrap"><table><tr><th>編號</th><th>類型</th><th>名稱</th><th>觀眾</th><th>容留高峰</th><th>編組</th><th>進駐</th><th>抽查</th><th>缺失</th><th></th></tr>
      ${domePreview.map((e) => `<tr><td>${e.id}</td><td>${e.cat}</td><td class="wrap">${esc(e.name) || '<span class="err">沒抓到名稱</span>'}</td><td>${fmt(e.attend)}</td><td>${fmt(e.peak)}</td><td>${fmt(e.staff)}</td>
        <td>${e.stationed ? "✔" : ""}</td><td>${e.checks || ""}</td><td>${e.defect ? "有" : ""}</td><td>${exist.has(e.id) ? '<span class="tag warn">會覆蓋</span>' : '<span class="tag ok">新</span>'}</td></tr>`).join("")}</table></div>
      <p class="note">看板顯示的特殊事件（已遮罩）：${esc(domePreview[0].special).slice(0, 200)}…</p>
      <p><button id="domeSave">確認存檔 ${domePreview.length} 份</button></p>`;
    $("#domeSave").addEventListener("click", async () => {
      $("#domeSave").disabled = true; $("#domeSave").textContent = "存檔中…";
      try {
        const r = await api({ action: "dome_add", events: domePreview });
        flash(`已新增 ${r.events.length} 份結報`);
        dome = null; renderDome();
      } catch (e) { domeFail("結報沒有存進去。", "貼上的內容還在，請再按一次「確認存檔」。", e); $("#domeSave").disabled = false; $("#domeSave").textContent = `確認存檔 ${domePreview.length} 份`; }
    });
  });
  $("#lgSave").addEventListener("click", async () => {
    const date = $("#lgDate").value, raw = $("#lgText").value.trim();
    if (!date || !raw) { domeFail("大事還沒填完。", "日期和內容都要填，填好再按存檔。"); return; }
    const [y, m, d] = date.split("-").map(Number);
    const rec = { id: `L${date}-${Date.now() % 100000}`, date, roc: `${y - 1911}年${m}月${d}日`, year: String(y - 1911), cat: $("#lgCat").value, text: maskText(raw), raw };
    try { await api({ action: "dome_add", log: [rec] }); flash("已新增大事"); dome = null; renderDome(); } catch (e) { domeFail("這則大事沒有存進去。", "填的內容還在，請再按一次存檔。", e); }
  });
}

// ---- 匯出最新版 Word：原 Word 當底稿，在 1150918 結報後面接上新增的結報與大事 ----
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wPara = (ppr, rpr, text) => `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`;

async function exportDomeWord() {
  const b = $("#domeWord");
  b.disabled = true; b.textContent = "產生中…（約 10 秒）";
  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
    const r = await api({ action: "dome_export" });
    const zip = await JSZip.loadAsync(r.template, { base64: true });
    let xml = await zip.file("word/document.xml").async("string");
    const items = [
      ...r.events.map((e) => ({ date: e.date, lines: e.raw.split("\n").map((s) => s.trim()).filter(Boolean), report: true })),
      ...r.log.map((l) => ({ date: l.date, lines: [l.roc, ...l.raw.split("\n").map((s) => s.trim()).filter(Boolean)], report: false })),
    ].sort((a, b2) => a.date.localeCompare(b2.date));
    const add = items.map((it) => it.lines.map((line, i) => (i === 0 ? wPara(WORD.titlePPr, WORD.titleRPr, line) : wPara(WORD.bodyPPr, WORD.bodyRPr, line))).join("")).join("");
    const a = xml.lastIndexOf(WORD.anchor);
    if (a < 0) throw new Error("底稿格式不符，找不到插入位置");
    const at = xml.indexOf("</w:p>", a) + 6;
    xml = xml.slice(0, at) + add + xml.slice(at);
    zip.file("word/document.xml", xml);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const last = [...dome.events].sort((x, y) => y.date.localeCompare(x.date))[0];
    const stamp = last ? last.id : "";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `115年度_台北大巨蛋消防安全管理暨消防搶救大事記_統計到${stamp}.docx`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    flash(`已匯出（新增 ${items.length} 筆）`);
  } catch (e) {
    domeFail("Word 檔沒有產生。", "請再按一次匯出。如果系統訊息寫「底稿格式不符」，代表底稿被換過，請找管理者。", e);
  } finally {
    b.disabled = false; b.textContent = "匯出最新版 Word";
  }
}
