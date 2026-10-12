// 115年火災傷亡案件精進作為 管制系統
const TOKEN_KEY = "fct_token";
let token = null, me = null, db = null, tab = null;
const filt = { stage: "", li: "", state: "", unit: "" };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const OPT = {
  plan: ["", "已備置", "不適用"],
  alarm: ["", "有裝・正常", "有裝・故障", "未裝", "拒訪", "不在家"],
  installed: ["", "已協助安裝", "已轉介申請", "住戶自行安裝", "不需要"],
  yesno: ["", "是", "否"],
  equip: ["", "已設置", "輔導中", "未設置"],
  fstatus: ["列管中", "已改善", "解除列管"],
  done2: ["", "已完成", "未完成"],
  kind: ["搶困演練", "轄區踏勘", "防火宣導", "其他"],
};

// Google 偶爾回 404、非 JSON，或把 POST 轉成 GET 而回 doGet 的內容（暫時性），自動重試
async function post(body) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (data.service && !("error" in data) && i < 2) throw new Error("got doGet response");
      return data;
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function api(payload) {
  const data = await post({ ...payload, token });
  if (!data.ok && data.error === "login required") { logout(token ? "登入逾時，請重新登入。" : ""); throw new Error("login"); }
  if (!data.ok) throw new Error(data.error || "error");
  return data;
}

// ---- 登入（Gmail） ----
let idToken = null;

function initGoogle(retries) {
  if (!(window.google && google.accounts && google.accounts.id)) {
    if (retries > 0) setTimeout(() => initGoogle(retries - 1), 150);
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
  google.accounts.id.renderButton($("#gbtn"), { theme: "outline", size: "large", text: "signin_with" });
}

async function onCredential(resp) {
  idToken = resp.credential;
  $("#loginErr").textContent = "驗證中…";
  try {
    handleLogin(await post({ action: "login", id_token: idToken }));
  } catch (e) {
    $("#loginErr").textContent = "連線失敗，請稍後再試。";
  }
}

async function handleLogin(r) {
  $("#register").hidden = true;
  if (r.ok) {
    token = r.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    $("#loginErr").textContent = "";
    await load();
    return;
  }
  if (r.state === "need_register") {
    $("#regEmail").textContent = r.email;
    $("#regName").value = r.person || "";
    $("#register").hidden = false;
    $("#loginErr").textContent = "";
  } else if (r.state === "pending") {
    $("#loginErr").textContent = `已送出申請${r.unit ? `（${r.unit}）` : ""}，請等管理者核准後再登入。`;
  } else if (r.state === "disabled") {
    $("#loginErr").textContent = "此帳號已停用，請洽管理者。";
  } else {
    $("#loginErr").textContent = r.error || "登入失敗";
  }
}

async function doRegister() {
  if (!$("#regUnit").value) { $("#loginErr").textContent = "請選擇單位"; return; }
  $("#regBtn").disabled = true;
  try {
    handleLogin(await post({ action: "register", id_token: idToken, unit: $("#regUnit").value, name: $("#regName").value }));
  } catch (e) {
    $("#loginErr").textContent = "連線失敗，請稍後再試。";
  } finally {
    $("#regBtn").disabled = false;
  }
}

function logout(msg) {
  if (token) fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "logout", token }) }).catch(() => {});
  $("#backAct").hidden = !(db && db._locked);   // 從免登入的活動勤務看板過來的，給一個回去的按鈕
  token = null; me = null; db = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  $("#app").hidden = true; $("#who").hidden = true; $("#loginWrap").hidden = false;
  $("#loginErr").textContent = msg || "";
}

async function load() {
  if (!isOpen(projectFromHash())) $("#status").textContent = "載入中…";
  db = await api({ action: "data" });
  me = db.me;
  $("#loginWrap").hidden = true; $("#app").hidden = false; $("#who").hidden = false;
  $("#whoName").textContent = isGuest() ? "訪客（僅供瀏覽）" : `${me.name}｜${me.person}`;
  $("#logout").textContent = isGuest() ? "登入" : "登出";
  $("#adminBtn").hidden = me.role !== "admin";
  $("#status").textContent = isAdmin() ? `更新時間 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}` : isGuest() ? "目前是免登入瀏覽，只能查看；要填報請按右上角「登入」。" : "";
  renderTabs();
}

// 依全站單位篩選後的資料（管理者用；一般單位本來就只拿得到自己的）
function scoped() {
  const f = (l) => (filt.unit ? l.filter((x) => x.unit === filt.unit) : l);
  return { stores: f(db.stores), visits: f(db.visits), events: f(db.events), factories: f(db.factories) };
}

// ---- 判斷完成 ----
const storeDone = (s) => s.plan_1f === "已備置" && ["已備置", "不適用"].includes(s.plan_mall) && ["已備置", "不適用"].includes(s.plan_park);
const visitDone = (v) => !!v.visit_date && !!v.alarm && !["拒訪", "不在家"].includes(v.alarm);
const alarmMissing = (v) => v.alarm === "未裝" || v.alarm === "有裝・故障";
const alarmFixed = (v) => alarmMissing(v) && ["已協助安裝", "已轉介申請", "住戶自行安裝"].includes(v.alarm_installed);

// ---- 甘特圖：各項目 × 單位，從開始日到期限；白色橫條＝辦理期間，裡面的填色＝完成比例（完成 0 就是空的），紅線＝今天 ----
const GANTT_START = "2026-09-21";  // 大隊長決行日
const GANTT_END = "2026-11-30";
const dayN = (d) => Math.round(Date.parse(d + "T00:00:00+08:00") / 86400000);

function gantt() {
  const db = scoped();
  const dl = deadlines();
  const s0 = dayN(GANTT_START), s1 = dayN(GANTT_END), span = s1 - s0;
  const pos = (d) => Math.max(0, Math.min(100, ((dayN(d) - s0) / span) * 100));
  const t = today();
  const rows = [];
  const push = (label, unit, done, total, due, tabKey) => {
    if (!total) return;
    const p = done / total;
    const expect = Math.max(0, Math.min(1, (dayN(t) - s0) / (dayN(due) - s0)));
    rows.push({ label, unit, done, total, due, p, behind: p < 1 && p + 1e-9 < expect, expect, tabKey });
  };
  Object.entries(groupBy(db.stores, "unit")).forEach(([u, l]) => push("百貨圖資", u, l.filter(storeDone).length, l.length, dl.stores, "stores"));
  ["1", "2"].forEach((st) => Object.entries(groupBy(db.visits.filter((v) => v.stage === st), "unit")).forEach(([u, l]) =>
    push(`第${st}階段訪視`, u, l.filter(visitDone).length, l.length, dl["stage" + st], "visits")));
  if (db.factories.length) push("研究院路專案", "南港中隊・舊莊分隊", db.factories.filter((f) => f.status !== "列管中").length, db.factories.length, dl.factories, "factories");
  if (!rows.length) return "";
  const marks = [["9/21", GANTT_START, "g-first"], ["10/1", "2026-10-01", "g-minor"], ["10/31", "2026-10-31", ""], ["11/30", GANTT_END, "g-last"]];   // g-minor：手機太窄會跟 9/21 疊在一起，不顯示
  return `<div class="card gantt"><h2>進度甘特圖</h2>
    <div class="g-head"><div></div><div class="g-track">${marks.map(([n, d, c]) => `<span class="${c}" style="left:${pos(d)}%">${n}</span>`).join("")}<div class="g-today" style="left:${pos(t)}%"></div></div><div></div></div>
    ${rows.map((r) => `<div class="g-row" data-gunit="${esc(r.unit)}" data-gtab="${r.tabKey}">
      <div class="g-label">${esc(r.label)}<br><b>${esc(r.unit)}</b></div>
      <div class="g-track">
        <div class="g-bar ${r.behind ? "behind" : ""}" style="left:0;width:${pos(r.due)}%"><i style="width:${Math.round(r.p * 100)}%"></i></div>
        <div class="g-expect" style="left:${pos(r.due) * r.expect}%" title="依進度應完成 ${Math.round(r.expect * 100)}%"></div>
        <div class="g-today" style="left:${pos(t)}%"></div>
      </div>
      <div class="g-num">${r.done}/${r.total}　${Math.round(r.p * 100)}%${r.behind ? `<span class="tag bad">落後</span>` : r.p >= 1 ? `<span class="tag ok">完成</span>` : ""}</div>
    </div>`).join("")}
    <p class="note">白色橫條是辦理期間，從 9/21（決行日）畫到各項期限；裡面有填色的部分才是已完成比例，還沒完成任何一筆就是空的。紅色直線是今天，黑色小三角是「平均推進的話，今天應完成到哪裡」。實際進度落在三角左邊就標「落後」。點任一列可以看該單位明細。</p></div>`;
}

// ---- 期限 ----
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const deadlines = () => (db.settings && db.settings.deadlines) || {};
const pastDue = (k) => !!deadlines()[k] && today() > deadlines()[k];
const visitOverdue = (v) => !visitDone(v) && pastDue("stage" + v.stage);
const storeOverdue = (s) => !storeDone(s) && pastDue("stores");
const factoryOverdue = (f) => f.status === "列管中" && pastDue("factories");
const DL_LABEL = { stores: "百貨商場救災圖資整備", factories: "研究院路廠住混合區專案", stage1: "第1階段訪視", stage2: "第2階段訪視" };
const FACTORY_UNITS = ["南港中隊", "舊莊分隊"];
const PROJ = { stores: "百貨商場救災圖資整備", factories: "研究院路廠住混合區專案", visits: "火災高風險地區避難弱者訪視及輔導安裝住警器" };
const overdueTag = (yes) => (yes ? ` <span class="tag bad">逾期</span>` : "");

// 專案（第一層）：網址 #casualty、#dome、#activity；管理（#admin）只給管理者
const TASK = { name: "115年火災傷亡案件精進作為" };
const PROJECTS = [
  { key: "casualty", icon: "🔥", name: "火災傷亡案件精進作為" },
  { key: "dome", icon: "🏟", name: "台北大巨蛋看板" },
  { key: "activity", icon: "🎆", name: "活動勤務看板" },
  { key: "watch", icon: "🦏", name: "犀牛巡邏隊" },
];
// 另外一個獨立網站的入口（不是這一頁裡的專案，點了會離開這一頁）
const EXTRA_LINK = { icon: "🚒", name: "犀牛出任務", url: "https://sorryxx18.github.io/z3d/" };
// 免登入就能看的專案（不用 Z-TEAM 後端的資料）
const OPEN = { activity: ["活動勤務看板", () => renderActivity()], watch: ["犀牛巡邏隊", () => renderWatch()] };
const isOpen = (k) => k in OPEN;
let openBack = "activity";   // 登入畫面的「回看板」按鈕要回哪一頁
const PROJ_KEY = "zteam_project";
let project = null;

function projectFromHash() {
  const h = location.hash.replace("#", "");
  if (h === "admin" && me && me.role === "admin") return "admin";
  if (PROJECTS.some((p) => p.key === h)) return h;
  try { const last = localStorage.getItem(PROJ_KEY); if (PROJECTS.some((p) => p.key === last)) return last; } catch (e) {}
  return "casualty";
}

function goProject(key) {
  if (hasDirty() && !confirm("還有資料沒有儲存（黃色標示的部分），離開就會不見。確定要離開？")) return;
  project = key; tab = null;
  if (key !== "admin") { try { localStorage.setItem(PROJ_KEY, key); } catch (e) {} }
  if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key);
  // 只開放活動勤務看板的訪客，要看其他專案先登入
  if (db._locked && !isOpen(key)) { logout("這個專案要登入才能看。"); return; }
  renderTabs();
}
window.addEventListener("hashchange", () => { if (me && db) { const k = projectFromHash(); if (k !== project) goProject(k); } });

// 各分頁上方的漫畫橫幅
const BANNERS = {
  summary: { img: "hero.webp", pos: "center 28%", title: "火災傷亡案件精進作為　進度總覽" },
  stores: { img: "skyline.webp", pos: "center 36%", title: "百貨商場救災圖資整備", due: "10/31" },
  factories: { img: "drill.webp", pos: "center 62%", title: "研究院路廠住混合區專案", due: "10/31" },
  visits: { img: "detector.webp", pos: "center 52%", title: "避難弱者訪視<br>輔導安裝住警器", due: "第1階段 10/31・第2階段 11/30" },
};

function tabsFor(role) {
  if (project === "dome") return [["dome", "大巨蛋看板"]];
  if (isOpen(project)) return [[project, OPEN[project][0]]];
  if (project === "admin") return [["users", "帳號管理"], ["log", "異動紀錄"]];
  const t = [["summary", "總覽"]];
  if (role !== "team") t.push(["stores", "百貨商場救災圖資整備"]);
  t.push(["visits", role === "squadron" ? "所屬分隊訪視（查看）" : "避難弱者訪視・住警器"]);
  if (seesAll() || FACTORY_UNITS.includes(me.name)) t.push(["factories", "研究院路廠住混合區專案"]);
  if (role === "admin") t.push(["import", "名單匯入"]);
  return t;
}

function renderTabs() {
  if (!project) project = projectFromHash();
  if (location.hash !== "#" + project) history.replaceState(null, "", "#" + project);
  const t = tabsFor(me.role);
  if (!tab || !t.some(([k]) => k === tab)) tab = t[0][0];
  // 第一層：專案切換卡片
  $("#taskbar").innerHTML = PROJECTS.map((p) => `<button class="pcard ${p.key === project ? "on" : ""}" data-p="${p.key}"><span class="picon">${p.icon}</span>${p.name}</button>`).join("")
    + `<button class="pcard" data-link="${EXTRA_LINK.url}"><span class="picon">${EXTRA_LINK.icon}</span>${EXTRA_LINK.name}</button>`
    + (project === "admin" ? `<span class="pcard on admin">⚙ 管理</span>` : "");
  $("#taskbar").querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => goProject(b.dataset.p)));
  $("#taskbar").querySelectorAll("[data-link]").forEach((b) => b.addEventListener("click", () => { location.href = b.dataset.link; }));
  // 匯出 Excel 只跟精進作為有關
  $("#export").hidden = project !== "casualty" || isGuest();
  $("#status").hidden = isOpen(project);   // 免登入的看板不用後端資料，不顯示載入與瀏覽提示
  if (isOpen(project)) openBack = project;
  const showTabs = t.length > 1 || project === "casualty";
  $("#tabs").hidden = !showTabs;
  $("#tabs").innerHTML = t.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("")
    + (seesAll() && project === "casualty" ? `<select id="gUnit" title="單位篩選"><option value="">全部單位</option>${UNITS.map((u) => `<option ${u === filt.unit ? "selected" : ""}>${u}</option>`).join("")}</select>` : "");
  const g = $("#gUnit");
  if (g) g.addEventListener("change", () => {
    if (hasDirty() && !confirm("還有資料沒有儲存（黃色標示的部分），切換就會不見。確定要切換？")) { g.value = filt.unit; return; }
    filt.unit = g.value; renderTabs();
  });
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (hasDirty() && !confirm("還有資料沒有儲存（黃色標示的部分），離開這一頁就會不見。確定要離開？")) return;
    tab = b.dataset.t; renderTabs();
  }));
  // 資料還沒回來：固定的畫面（卡片、分頁、橫幅）先畫，數字和清冊的位置顯示載入中
  if (isOpen(tab)) OPEN[tab][1]();   // 不用等後端資料
  else if (db._loading) {
    $("#view").innerHTML = (tab === "dome" ? `<div class="banner dbanner" style="background-image:url('img/dome-main.webp')"><div class="btitle">台北大巨蛋<br>消防安全管理看板</div></div>` : "")
      + `<p class="note" style="text-align:center;padding:32px 16px;font-size:1.1rem">數字與清冊載入中，請稍候…</p>`;
  } else
  ({ summary: renderSummary, stores: renderStores, visits: renderVisits, factories: renderFactories, events: renderEvents, users: renderUsers, log: renderLog, import: renderImport, dome: renderDome })[tab]();
  if (isGuest()) guestView();
  const bn = BANNERS[tab];
  if (bn) $("#view").insertAdjacentHTML("afterbegin",
    `<div class="banner" style="background-image:url('img/${bn.img}');background-position:${bn.pos}"><div class="btitle">${bn.title}</div>${bn.due ? `<div class="bdue">期限 ${bn.due}</div>` : ""}</div>`);
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const statCard = (title, a, b, extra = "") =>
  `<div class="card stat"><div class="sub">${title}</div><div class="num">${a} / ${b}</div><div class="bar"><i style="width:${pct(a, b)}%"></i></div><div class="note">${pct(a, b)}%${extra}</div></div>`;

function groupBy(list, key) {
  const m = {};
  list.forEach((x) => (m[x[key]] = m[x[key]] || []).push(x));
  return m;
}

function summaryRows() {
  const db = scoped();
  const rows = [];
  Object.entries(groupBy(db.stores, "unit")).forEach(([u, l]) => rows.push({ 項目: PROJ.stores, 單位: u, 應辦: l.length, 已完成: l.filter(storeDone).length, 逾期: l.filter(storeOverdue).length }));
  Object.entries(groupBy(db.visits, "unit")).forEach(([u, l]) => {
    rows.push({ 項目: "避難弱者訪視", 單位: u, 應辦: l.length, 已完成: l.filter(visitDone).length, 逾期: l.filter(visitOverdue).length });
    const miss = l.filter(alarmMissing);
    rows.push({ 項目: "住警器（未裝或故障）", 單位: u, 應辦: miss.length, 已完成: miss.filter(alarmFixed).length, 逾期: "" });
  });
  Object.entries(groupBy(db.factories, "unit")).forEach(([u, l]) => rows.push({ 項目: PROJ.factories + "（場所改善）", 單位: u, 應辦: l.length, 已完成: l.filter((f) => f.status !== "列管中").length, 逾期: l.filter(factoryOverdue).length }));
  return rows.map((r) => ({ ...r, 完成率: r.應辦 === "" ? "" : pct(r.已完成, r.應辦) + "%" }));
}

function renderSummary() {
  const db = scoped();
  const s = db.stores, v = db.visits, miss = v.filter(alarmMissing);
  let cards = "";
  if (me.role !== "team") cards += statCard(PROJ.stores + "（期限 10/31）", s.filter(storeDone).length, s.length);
  if (seesAll() || FACTORY_UNITS.includes(me.name)) cards += `<div class="card stat"><div class="sub">${PROJ.factories}（期限 10/31）</div><div class="num">${db.factories.length} 處</div><div class="note">已改善 ${db.factories.filter((f) => f.status !== "列管中").length}　逾期 ${db.factories.filter(factoryOverdue).length}</div></div>`;
  {
    cards += statCard("第1階段訪視（期限 10/31）", v.filter((x) => x.stage === "1" && visitDone(x)).length, v.filter((x) => x.stage === "1").length);
    cards += statCard("第2階段訪視（期限 11/30）", v.filter((x) => x.stage === "2" && visitDone(x)).length, v.filter((x) => x.stage === "2").length);
    cards += statCard("住警器未裝或故障，已輔導處理", miss.filter(alarmFixed).length, miss.length);
  }
  if (me.role === "admin" && db.visits.some((v) => v.transfer_to)) cards += `<div class="card stat"><div class="sub">轉辦申請待核准</div><div class="num">${db.visits.filter((v) => v.transfer_to).length}</div><div class="note">到「訪視・住警器」篩選「轉辦申請中」處理</div></div>`;
  const rows = summaryRows();
  setTimeout(() => document.querySelectorAll(".g-row").forEach((r) => r.addEventListener("click", () => {
    if (seesAll() && !r.dataset.gunit.includes("・")) filt.unit = r.dataset.gunit;
    tab = r.dataset.gtab; renderTabs();
  })), 0);
  $("#view").innerHTML = `<div class="grid">${cards}</div>
    ${gantt()}
    ${deadlineBox()}
    <div class="tablewrap"><table><tr><th>項目</th><th>單位</th><th>應辦</th><th>已完成</th><th>完成率</th><th>逾期</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.項目)}</td><td>${esc(r.單位)}</td><td>${r.應辦}</td><td>${r.已完成}</td><td>${r.完成率}</td><td>${r.逾期 ? `<span class="tag bad">${r.逾期}</span>` : r.逾期 === 0 ? "0" : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="note">尚無資料</td></tr>`}
    </table></div>
    <p class="note">逾期＝今天已超過期限且尚未完成。完成定義：百貨＝1樓圖已備置，且地下街、停車場各為「已備置」或「不適用」；訪視＝已填訪視日期與住警器狀況（拒訪、不在家不算完成）；住警器＝未裝或故障者已協助安裝、轉介或住戶自行安裝。</p>`;
}

function deadlineBox() {
  const dl = deadlines();
  return `<p class="note">期限（依大隊公文）：${Object.entries(DL_LABEL).map(([k, n]) => `${n} ${dl[k] || "未定"}`).join("　｜　")}</p>`;
}

const sel = (field, val, opts) => `<select data-f="${field}">${opts.map((o) => `<option ${o === (val || "") ? "selected" : ""}>${o}</option>`).join("")}</select>`;
const inp = (field, val, type = "text", w = "") => `<input data-f="${field}" type="${type}" value="${esc(val)}" ${w ? `style="width:${w}"` : ""}>`;

// 欄位變更立即存檔
const isAdmin = () => me && me.role === "admin";
// 訪客＝免登入瀏覽（後端 PUBLIC_VIEW 開著時），看得到全部單位但不能改
const isGuest = () => me && me.role === "guest";
const seesAll = () => isAdmin() || isGuest();
// 最後更新（誰、何時）只有管理者看得到
const upd = (r) => (isAdmin() ? `${esc(r.updated_by)} ${esc(r.updated_at)}` : "");
const updTh = () => (isAdmin() ? "<th>最後更新</th>" : "");
const updTd = (r) => (isAdmin() ? `<td class="note">${upd(r)}</td>` : "");

const isMobile = () => window.matchMedia("(max-width: 760px)").matches;

// 改了欄位先標成「未儲存」（黃色），按該筆的「儲存」才送出
const saveBtn = (id) => `<button class="save" data-save="${id}">儲存</button>`;
const hasDirty = () => !!document.querySelector("#view .dirty");

// 畫面下方固定的提醒列：有幾筆改了還沒儲存、新增表單填了還沒按新增，都會一直顯示到處理完為止
function updateDirtyBar() {
  const rows = [...document.querySelectorAll("#view [data-id].dirty")], adding = !!document.querySelector("#view #addForm.dirty");
  let bar = $("#dirtybar");
  if (!rows.length && !adding) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement("div"); bar.id = "dirtybar"; bar.setAttribute("role", "alert"); document.body.appendChild(bar);
    bar.addEventListener("click", async (e) => {
      const act = e.target.dataset.act;
      if (act === "goto") { const t = document.querySelector("#view [data-id].dirty") || $("#addForm"); if (t) t.scrollIntoView({ block: "center", behavior: "smooth" }); }
      if (act === "all") {
        e.target.disabled = true;
        for (const row of [...document.querySelectorAll("#view [data-id].dirty")]) {
          const b = row.querySelector("[data-save]"); if (!b) continue;
          b.click();
          for (let i = 0; i < 200 && b.disabled; i++) await new Promise((r) => setTimeout(r, 100));   // 等這一筆存完再存下一筆
        }
        updateDirtyBar();
      }
    });
  }
  const parts = [];
  if (rows.length) parts.push(`有 ${rows.length} 筆修改還沒儲存`);
  if (adding) parts.push("上面的新增表單填了還沒按「新增」");
  const sig = parts.join("；");
  if (bar.dataset.sig === sig) return;          // 內容沒變就不重畫
  bar.dataset.sig = sig;
  bar.innerHTML = `<b>⚠ ${sig}</b>${rows.length ? `<button data-act="all">全部儲存</button>` : ""}<button class="ghost" data-act="goto">帶我去看</button>`;
}
new MutationObserver(updateDirtyBar).observe($("#view"), { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });   // 提醒列放在 #view 外面，不會觸發自己

function bindRows(table) {
  $("#view").querySelectorAll("[data-id]").forEach((row) => {
    const mark = () => { row.classList.add("dirty"); const b = row.querySelector("[data-save]"); if (b) b.textContent = "尚未儲存，按這裡"; };
    row.querySelectorAll("[data-f]").forEach((el) => { el.addEventListener("input", mark); el.addEventListener("change", mark); });
    const btn = row.querySelector("[data-save]");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const id = row.dataset.id;
      const rec = db[table].find((x) => x.id === id);
      const fields = {};
      row.querySelectorAll("[data-f]").forEach((el) => { if ((rec[el.dataset.f] || "") !== el.value) fields[el.dataset.f] = el.value; });
      if (!Object.keys(fields).length) { row.classList.remove("dirty"); btn.textContent = "儲存"; return; }
      btn.disabled = true; btn.textContent = "儲存中…";
      try {
        await api({ action: "update", table, id, fields });
        const at = new Date().toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });
        Object.assign(rec, fields, { updated_by: me.name + " " + me.person });
        row.classList.remove("dirty");
        btn.textContent = isAdmin() ? "已儲存 " + at : "已儲存 ✔";
        if (isAdmin()) $("#status").textContent = `已儲存 ${at}`;
        const done = table === "visits" ? visitDone(rec) : table === "stores" ? storeDone(rec) : null;
        if (done !== null) { row.classList.toggle("done", done); row.classList.toggle("todo", !done); }
      } catch (e) {
        btn.textContent = "尚未儲存，按這裡";
        if (e.message !== "login") alert("儲存失敗：" + e.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

window.addEventListener("beforeunload", (e) => { if (hasDirty()) { e.preventDefault(); e.returnValue = ""; } });

function unitFilter(list) {
  return "";  // 改用上方全站共用的單位篩選
  if (me.role !== "admin") return "";
  const units = [...new Set(list.map((x) => x.unit))];
  return `<select id="fUnit"><option value="">全部單位</option>${units.map((u) => `<option ${u === filt.unit ? "selected" : ""}>${u}</option>`).join("")}</select>`;
}

function bindFilters() {
  [["#fUnit", "unit"], ["#fStage", "stage"], ["#fLi", "li"], ["#fState", "state"]].forEach(([s, k]) => {
    const el = $(s); if (el) el.addEventListener("change", () => { filt[k] = el.value; renderTabs(); });
  });
}

function renderStores() {
  const list = db.stores.filter((s) => !filt.unit || s.unit === filt.unit);
  $("#view").innerHTML = `<div class="filters">${unitFilter(db.stores)}<span class="note">共 ${list.length} 家，已備齊 ${list.filter(storeDone).length} 家。輔導場所備置 A1 尺寸主要樓層救災平面圖，標示主要出入口、安全梯及室內消防栓等救災資訊；1樓、地下街商場、停車場至少各 1 張，沒有地下街或停車場的選「不適用」。期限 10/31。改完請按該列的「儲存」。</span></div>
  ${canStores() ? storeTools() : ""}
  ${isMobile() ? list.map((s) => `<div class="mcard ${storeDone(s) ? "done" : "todo"}" data-id="${s.id}">
      <div class="mhead"><b>${s.id}</b> ${esc(s.unit)}${overdueTag(storeOverdue(s))}</div>
      <div>${esc(s.name)}</div><div class="note">${esc(s.address)}｜${esc(s.floors)}</div>
      <label>1樓 ${sel("plan_1f", s.plan_1f, OPT.plan)}</label><label>地下街 ${sel("plan_mall", s.plan_mall, OPT.plan)}</label><label>停車場 ${sel("plan_park", s.plan_park, OPT.plan)}</label>
      <label>備齊日期 ${inp("done_date", s.done_date, "date")}</label><label>備註 ${inp("note", s.note)}</label>
      <div class="mfoot">${saveBtn(s.id)} ${photoBtn(s)} ${storeDelBtn(s)}<span class="note">${upd(s)}</span></div></div>`).join("")
  : `<div class="tablewrap"><table><tr><th>序號</th><th>中隊</th><th>場所名稱</th><th>地址</th><th>營業樓層</th><th>1樓</th><th>地下街</th><th>停車場</th><th>備齊日期</th><th>備註</th><th>儲存</th><th>照片</th>${updTh()}${canStores() ? "<th>刪除</th>" : ""}</tr>
  ${list.map((s) => `<tr data-id="${s.id}" class="${storeDone(s) ? "done" : "todo"}"><td>${s.id}${overdueTag(storeOverdue(s))}</td><td>${esc(s.unit)}</td><td class="wrap">${esc(s.name)}</td><td class="wrap">${esc(s.address)}</td><td>${esc(s.floors)}</td>
    <td>${sel("plan_1f", s.plan_1f, OPT.plan)}</td><td>${sel("plan_mall", s.plan_mall, OPT.plan)}</td><td>${sel("plan_park", s.plan_park, OPT.plan)}</td>
    <td>${inp("done_date", s.done_date, "date")}</td><td>${inp("note", s.note, "text", "160px")}</td><td>${saveBtn(s.id)}</td><td>${photoBtn(s)}</td>${updTd(s)}${canStores() ? `<td>${storeDelBtn(s)}</td>` : ""}</tr>`).join("")}
  </table></div>`}`;
  bindRows("stores"); bindFilters(); bindPhotos("stores");
  if (canStores()) bindStoreTools();
}

// ---- 百貨清冊：Excel 填寫表、匯入、新增、刪除（中隊管自己的場所，管理者管全部） ----
const SQUADRONS = ["大安中隊", "信義中隊", "南港中隊"];
const canStores = () => isAdmin() || (me && me.role === "squadron");
const ST_HEAD = ["序號", "中隊", "場所名稱", "地址", "營業樓層", "1樓", "地下街", "停車場", "備齊日期", "備註"];
const ST_PLAN = { plan_1f: "1樓", plan_mall: "地下街", plan_park: "停車場" };
const ST_LABEL = { ...ST_PLAN, done_date: "備齊日期", note: "備註" };
const storeDelBtn = (s) => (canStores() ? `<button class="ghost" data-sdel="${s.id}">刪除</button>` : "");
const storeKey = (v) => String(v ?? "").replace(/[\s\u3000]/g, "").replace(/（/g, "(").replace(/）/g, ")").toLowerCase();

function storeTools() {
  return `<div class="card" id="storeTools"><h2>用 Excel 填寫</h2>
    <p class="note">下載填寫表，用 Excel 填好再匯入。空白的格子不會動到網頁上原本的內容；要新增場所就加在表的最下面、序號留空白。匯入前會先列出這次要改的內容，確認後才寫入。</p>
    <div class="form"><button id="stTpl">下載 Excel 填寫表</button><button id="stImp">匯入填好的 Excel</button><input id="stFile" type="file" accept=".xlsx,.xls" hidden>
      <button class="ghost" id="stAddOpen">新增一家場所</button></div>
    <div class="form" id="stAdd" hidden style="margin-top:12px">${isAdmin() ? `<label>中隊<select id="stAddUnit">${SQUADRONS.map((u) => `<option ${u === filt.unit ? "selected" : ""}>${u}</option>`).join("")}</select></label>` : ""}
      <label>場所名稱<input id="stAddName" style="width:240px"></label><label>地址<input id="stAddAddr" style="width:240px"></label><label>營業樓層<input id="stAddFloors" style="width:110px" placeholder="例如 B2-8F"></label>
      <button id="stAddBtn">新增</button></div>
    <div id="stPreview"></div></div>`;
}

// 1樓、地下街、停車場的寫法：回傳 { v } 要寫入的值、{ skip } 空白不動、{ err } 看不懂
function stPlanCell(v) {
  const t = String(v ?? "").trim();
  if (!t) return { skip: true };
  const k = t.replace(/\s/g, "").toLowerCase();
  if (["已備置", "已備", "已備妥", "已備齊", "已完成", "完成", "ok", "v", "✓", "✔"].includes(k)) return { v: "已備置" };
  if (["不適用", "na", "n/a", "無地下街", "無停車場", "無此樓層"].includes(k)) return { v: "不適用" };
  if (["未備置", "尚未備置", "未備", "未完成", "尚未"].includes(k)) return { v: "" };
  return { err: `「${t}」看不懂，請寫已備置、不適用或未備置` };
}

// 備齊日期：Excel 日期格、2026-10-20、2026/10/20、115/10/20、1151020、10/20 都收
function stDateCell(v) {
  if (v === "" || v == null) return { skip: true };
  let y, m, d;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    y = p.y; m = p.m; d = p.d;
  } else {
    const t = String(v).trim().replace(/[年月]/g, "/").replace(/日/g, "").replace(/\s/g, "");
    if (!t) return { skip: true };
    let r;
    if ((r = /^(\d{2,4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{3,4})(\d{2})(\d{2})$/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})[-/.](\d{1,2})$/.exec(t))) { y = new Date().getFullYear(); m = +r[1]; d = +r[2]; }
    else return { err: `備齊日期「${t}」看不懂，請寫成 115/10/20` };
    if (y < 1000) y += 1911;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 2020 || y > 2100 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { err: `備齊日期「${v}」不是正確的日期` };
  return { v: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

// 把 Excel 的列對到清冊，分成：新增、更新、沒變、有問題
function storePlan(raw) {
  const byId = {}, byName = {};
  db.stores.forEach((s) => { byId[s.id] = s; byName[storeKey(s.name)] = s; });
  const out = { add: [], upd: [], same: 0, bad: [] };
  const seen = {};
  raw.forEach((r0, i) => {
    const r = {};
    Object.keys(r0).forEach((k) => (r[String(k).trim()] = r0[k]));
    const txt = (k) => String(r[k] ?? "").trim();
    const id = txt("序號").toUpperCase(), name = txt("場所名稱");
    if (!id && !name) { if (ST_HEAD.some((k) => txt(k))) out.bad.push({ line: i + 2, name: "", reason: "沒有序號也沒有場所名稱" }); return; }
    const bad = (reason) => out.bad.push({ line: i + 2, name: (id ? id + " " : "") + name, reason });
    const cur = id ? byId[id] : byName[storeKey(name)];
    if (id && !cur) return bad(`清冊裡找不到序號 ${id}（新場所請把序號留空白）`);
    const f = {};
    let err = "";
    Object.entries(ST_PLAN).forEach(([k, label]) => { const c = stPlanCell(r[label]); if (c.err) err = err || `${label}：${c.err}`; else if (!c.skip) f[k] = c.v; });
    const dc = stDateCell(r["備齊日期"]);
    if (dc.err) err = err || dc.err; else if (!dc.skip) f.done_date = dc.v;
    if (txt("備註")) f.note = txt("備註");
    if (err) return bad(err);
    if (cur) {
      if (seen[cur.id]) return bad("這家場所在檔案裡出現兩次");
      seen[cur.id] = true;
      const diff = Object.keys(f).filter((k) => f[k] !== (cur[k] || ""));
      if (!diff.length) { out.same++; return; }
      const send = { id: cur.id };
      diff.forEach((k) => (send[k] = f[k]));
      out.upd.push({ id: cur.id, name: cur.name, changes: diff.map((k) => [ST_LABEL[k], cur[k] || "", f[k]]), send });
      return;
    }
    if (seen["n:" + storeKey(name)]) return bad("這家新場所在檔案裡出現兩次");
    const unit = isAdmin() ? txt("中隊") : me.name;
    if (!SQUADRONS.includes(unit)) return bad(`新場所要填中隊（${SQUADRONS.join("、")}）`);
    seen["n:" + storeKey(name)] = true;
    out.add.push({ name, unit, address: txt("地址"), floors: txt("營業樓層"), f, send: { name, unit, address: txt("地址"), floors: txt("營業樓層"), ...f } });
  });
  return out;
}

async function storeTemplate() {
  try { await loadXlsx(); } catch (e) { flash("Excel 元件載入失敗，請檢查網路後再試一次"); return; }
  const list = db.stores.filter((s) => !filt.unit || s.unit === filt.unit);
  const wb = XLSX.utils.book_new();
  const widths = [6, 10, 44, 34, 14, 9, 9, 9, 12, 30].map((w) => ({ wch: w }));
  const ws = XLSX.utils.aoa_to_sheet([ST_HEAD, ...list.map((s) => [s.id, s.unit, s.name, s.address, s.floors, s.plan_1f, s.plan_mall, s.plan_park, s.done_date, s.note])]);
  ws["!cols"] = widths;
  XLSX.utils.book_append_sheet(wb, ws, "填寫表");
  const u = list[0] ? list[0].unit : "大安中隊";
  const ex = XLSX.utils.aoa_to_sheet([
    ["怎麼填"],
    ["1. 「填寫表」那一頁已經帶好場所，只要填後面五欄：1樓、地下街、停車場、備齊日期、備註。"],
    ["2. 1樓、地下街、停車場：圖已經備好填「已備置」；沒有地下街或停車場填「不適用」；還沒備好就留空白。"],
    ["3. 備齊日期：三張圖都備齊的那一天，寫 115/10/20 或 2026-10-20 都可以。"],
    ["4. 空白的格子不會動到網頁上原本的內容。已經填「已備置」想改回還沒備好，請填「未備置」。備齊日期、備註要清掉請到網頁上改。"],
    ["5. 要新增場所：加在「填寫表」最下面，序號留空白，填場所名稱、地址、營業樓層" + (isAdmin() ? "，中隊也要填。" : "（中隊不用填）。")],
    ["6. 序號和場所名稱請不要改。要刪除場所請到網頁上按「刪除」，從表裡刪掉那一列不會刪除。"],
    ["7. 填好存檔，回到網頁按「匯入填好的 Excel」，看過確認畫面再按確認。照片要在網頁上傳。"],
    [],
    ["範例（這一頁只是示範，不會被匯入）"],
    ST_HEAD,
    ["S01", u, "○○百貨股份有限公司", "○○區○○路1號", "B2-8F", "已備置", "已備置", "已備置", "115/10/15", "三張圖都已張貼"],
    ["S02", u, "○○購物中心", "○○區○○路2號", "1-4F", "已備置", "不適用", "不適用", "115/10/20", "沒有地下街和停車場"],
    ["S03", u, "○○商場", "○○區○○路3號", "B1-6F", "已備置", "", "已備置", "", "地下街的圖還在製作，先留空白"],
    ["", isAdmin() ? u : "", "新開幕的○○廣場", "○○區○○路4號", "B3-10F", "", "", "", "", "新增場所：序號留空白"],
  ]);
  ex["!cols"] = widths;
  XLSX.utils.book_append_sheet(wb, ex, "填寫範例");
  XLSX.writeFile(wb, `百貨救災圖資填寫表_${filt.unit || me.name}.xlsx`);
}

let storeImp = null;
async function storeFile(file) {
  const box = $("#stPreview");
  try { await loadXlsx(); } catch (e) { flash("Excel 元件載入失敗，請檢查網路後再試一次"); return; }
  let raw;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets["填寫表"] || wb.Sheets["百貨商場救災圖資整備"] || wb.Sheets[wb.SheetNames[0]];
    raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch (e) { box.innerHTML = `<p class="err">這個檔案讀不出來，請確認是 Excel 檔（.xlsx）。</p>`; return; }
  const keys = raw[0] ? Object.keys(raw[0]).map((k) => String(k).trim()) : [];
  const miss = ["序號", "場所名稱"].filter((k) => !keys.includes(k));
  if (miss.length) { box.innerHTML = `<p class="err">找不到欄位：${miss.join("、")}。請用「下載 Excel 填寫表」的檔案來填，第一列的欄位名稱不要改。</p>`; return; }
  storeImp = storePlan(raw);
  drawStoreImp(file.name);
}

function drawStoreImp(fname) {
  const p = storeImp, box = $("#stPreview");
  const show = (v) => (v ? esc(v) : "（空白）");
  const n = p.add.length + p.upd.length;
  box.innerHTML = `<h2 style="margin-top:16px">匯入預覽：${esc(fname)}</h2>
    <p><b>新增 ${p.add.length} 家、更新 ${p.upd.length} 家</b>，沒有變動 ${p.same} 家${p.bad.length ? `，<span class="err">有問題不匯入 ${p.bad.length} 列</span>` : ""}。現在還沒寫入。</p>
    ${p.bad.length ? `<p class="err">有問題的列（改好再匯入一次就可以，其他列不受影響）：</p><div class="tablewrap" style="max-height:220px"><table><tr><th>Excel 第幾列</th><th>場所</th><th>問題</th></tr>
      ${p.bad.map((b) => `<tr><td>${b.line}</td><td class="wrap">${esc(b.name)}</td><td class="wrap">${esc(b.reason)}</td></tr>`).join("")}</table></div>` : ""}
    ${p.add.length ? `<p><b>會新增進清冊：</b></p><div class="tablewrap" style="max-height:220px"><table><tr><th>中隊</th><th>場所名稱</th><th>地址</th><th>營業樓層</th><th>已填內容</th></tr>
      ${p.add.map((a) => `<tr><td>${esc(a.unit)}</td><td class="wrap">${esc(a.name)}</td><td class="wrap">${esc(a.address)}</td><td>${esc(a.floors)}</td><td class="wrap">${Object.keys(a.f).filter((k) => a.f[k]).map((k) => `${ST_LABEL[k]}：${esc(a.f[k])}`).join("、")}</td></tr>`).join("")}</table></div>` : ""}
    ${p.upd.length ? `<p><b>會更新：</b></p><div class="tablewrap" style="max-height:320px"><table><tr><th>序號</th><th>場所名稱</th><th>改什麼</th></tr>
      ${p.upd.map((x) => `<tr><td>${x.id}</td><td class="wrap">${esc(x.name)}</td><td class="wrap">${x.changes.map(([l, a, b]) => `${l}：${show(a)} → <b>${show(b)}</b>`).join("<br>")}</td></tr>`).join("")}</table></div>` : ""}
    <p>${n ? `<button id="stGo">確認匯入（新增 ${p.add.length} 家、更新 ${p.upd.length} 家）</button> ` : `<span class="note">沒有需要寫入的內容。</span> `}<button class="ghost" id="stCancel">${n ? "取消" : "關閉"}</button></p>`;
  box.scrollIntoView({ block: "nearest" });
  $("#stCancel").addEventListener("click", () => { storeImp = null; box.innerHTML = ""; });
  const go = $("#stGo");
  if (go) go.addEventListener("click", async () => {
    if (hasDirty() && !confirm("畫面上還有沒儲存的修改（黃色標示），匯入後會重新載入、那些修改會不見。確定要匯入？")) return;
    go.disabled = true; go.textContent = "匯入中…";
    try {
      const r = await api({ action: "stores_import", rows: [...p.upd.map((x) => x.send), ...p.add.map((x) => x.send)] });
      storeImp = null;
      await load();
      flash(`匯入完成：新增 ${r.added.length} 家、更新 ${r.updated} 家`);
      if (r.rejected.length) alert(`有 ${r.rejected.length} 列沒有匯入：\n` + r.rejected.map((x) => `${x.id || x.name}：${x.reason}`).join("\n"));
      r.added.forEach((a) => { const row = document.querySelector(`#view [data-id="${a.id}"]`); if (row) row.classList.add("justadded"); });
    } catch (e) {
      if (e.message !== "login") alert("匯入失敗：" + e.message);
      go.disabled = false; go.textContent = "再試一次";
    }
  });
}

function bindStoreTools() {
  $("#stTpl").addEventListener("click", storeTemplate);
  $("#stImp").addEventListener("click", () => $("#stFile").click());
  $("#stFile").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) storeFile(f); });
  $("#stAddOpen").addEventListener("click", () => { $("#stAdd").hidden = !$("#stAdd").hidden; if (!$("#stAdd").hidden) $("#stAddName").focus(); });
  $("#stAddBtn").addEventListener("click", async () => {
    const name = $("#stAddName").value.trim();
    if (!name) { alert("請填場所名稱"); return; }
    if (hasDirty() && !confirm("畫面上還有沒儲存的修改（黃色標示），新增後會重新載入、那些修改會不見。確定要新增？")) return;
    const b = $("#stAddBtn");
    b.disabled = true; b.textContent = "新增中…";
    try {
      const r = await api({ action: "stores_import", add_only: true, rows: [{ name, address: $("#stAddAddr").value.trim(), floors: $("#stAddFloors").value.trim(), unit: isAdmin() ? $("#stAddUnit").value : "" }] });
      if (r.rejected.length) { alert("沒有新增：" + r.rejected[0].reason); b.disabled = false; b.textContent = "新增"; return; }
      await load();
      const row = document.querySelector(`#view [data-id="${r.added[0].id}"]`);
      if (row) { row.classList.add("justadded"); row.scrollIntoView({ block: "center" }); }
      flash(`已新增「${name}」（${r.added[0].id}）`);
    } catch (e) {
      if (e.message !== "login") alert("新增失敗：" + e.message);
      b.disabled = false; b.textContent = "新增";
    }
  });
  $("#view").querySelectorAll("button[data-sdel]").forEach((b) => b.addEventListener("click", async () => {
    const s = db.stores.find((x) => x.id === b.dataset.sdel);
    const reason = prompt(`要刪除「${s.name}」（${s.id}）。\n${isAdmin() ? "刪除原因（可不填）：" : "請填刪除原因（例如：已歇業、重複建檔、不在本轄）："}`, "");
    if (reason === null) return;
    if (!isAdmin() && !reason.trim()) { alert("沒有填原因，所以沒有刪除。"); return; }
    const ph = photoIds(s).length;
    if (!confirm(`確定刪除「${s.name}」？\n刪除後這家不再列入進度統計${ph ? `，已上傳的 ${ph} 張照片也不會再顯示` : ""}。`)) return;
    if (hasDirty() && !confirm("畫面上還有沒儲存的修改（黃色標示），刪除後會重新載入、那些修改會不見。確定要繼續？")) return;
    b.disabled = true; b.textContent = "刪除中…";
    try {
      await api({ action: "store_remove", id: s.id, reason: reason.trim() });
      await load();
      flash(`已刪除「${s.name}」`);
    } catch (e) {
      if (e.message !== "login") alert("刪除失敗：" + e.message);
      b.disabled = false; b.textContent = "刪除";
    }
  }));
}

function renderVisits() {
  const lis = [...new Set(db.visits.map((v) => v.li))];
  const list = db.visits.filter((v) => (!filt.unit || v.unit === filt.unit) && (!filt.stage || v.stage === filt.stage) && (!filt.li || v.li === filt.li)
    && (!filt.state || (filt.state === "todo" ? !visitDone(v) : filt.state === "done" ? visitDone(v) : filt.state === "transfer" ? !!v.transfer_to : filt.state === "overdue" ? visitOverdue(v) : alarmMissing(v) && !alarmFixed(v))));
  const pending = scoped().visits.filter((v) => v.transfer_to).length;
  $("#view").innerHTML = `<div class="filters">${unitFilter(db.visits)}
    <select id="fStage"><option value="">全部階段</option>${[...new Set(db.visits.map((v) => v.stage))].sort().map((st) => `<option value="${st}" ${filt.stage === st ? "selected" : ""}>第${st}階段</option>`).join("")}</select>
    <select id="fLi"><option value="">全部里別</option>${lis.map((l) => `<option ${l === filt.li ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select id="fState"><option value="">全部狀態</option><option value="todo" ${filt.state === "todo" ? "selected" : ""}>未完成</option><option value="done" ${filt.state === "done" ? "selected" : ""}>已完成</option><option value="alarm" ${filt.state === "alarm" ? "selected" : ""}>住警器待處理</option><option value="transfer" ${filt.state === "transfer" ? "selected" : ""}>轉辦申請中</option><option value="overdue" ${filt.state === "overdue" ? "selected" : ""}>逾期未完成</option></select>
    <span class="note">顯示 ${list.length} 筆。姓名、門牌已遮罩，請以「階段＋序號」對照局內完整名單。改完請按該筆的「儲存」。地址不屬於本分隊轄區時，按「轉辦」提出，由管理者核准。期限：第1階段 10/31、第2階段 11/30。</span>
    ${pending ? `<span class="tag warn">轉辦申請中 ${pending} 筆</span>` : ""}</div>
  ${isMobile() ? list.map((v) => `<div class="mcard ${visitDone(v) ? "done" : "todo"}" data-id="${v.id}">
      <div class="mhead"><b>${v.stage}-${v.seq}</b> ${esc(v.name_m)}　<span class="note">${esc(v.type)}｜${esc(v.unit)}</span>${overdueTag(visitOverdue(v))}</div>
      <div class="note">${esc(v.addr_m)}｜${esc(v.li)}｜${esc(v.case_no)}</div>
      <label>訪視日期 ${inp("visit_date", v.visit_date, "date")}</label><label>住警器狀況 ${sel("alarm", v.alarm, OPT.alarm)}</label>
      <label>住警器處理 ${sel("alarm_installed", v.alarm_installed, OPT.installed)}</label><label>宣導 ${sel("outreach", v.outreach, OPT.yesno)}</label>
      <label>備註 ${inp("note", v.note)}</label>
      <div class="mfoot">${saveBtn(v.id)} ${photoBtn(v)} ${transferCell(v)}<span class="note">${upd(v)}</span></div></div>`).join("")
  : `<div class="tablewrap"><table><tr><th>階段-序號</th><th>分隊</th><th>姓名</th><th>地址</th><th>里別</th><th>類型</th><th>案件</th><th>訪視日期</th><th>住警器狀況</th><th>住警器處理</th><th>宣導</th><th>備註</th><th>儲存</th><th>照片</th>${updTh()}<th>轉辦</th></tr>
  ${list.map((v) => `<tr data-id="${v.id}" class="${visitDone(v) ? "done" : "todo"}"><td>${v.stage}-${v.seq}${overdueTag(visitOverdue(v))}</td><td>${esc(v.unit)}</td><td>${esc(v.name_m)}</td><td>${esc(v.addr_m)}</td><td>${esc(v.li)}</td><td>${esc(v.type)}</td><td>${esc(v.case_no)}</td>
    <td>${inp("visit_date", v.visit_date, "date")}</td><td>${sel("alarm", v.alarm, OPT.alarm)}</td><td>${sel("alarm_installed", v.alarm_installed, OPT.installed)}</td><td>${sel("outreach", v.outreach, OPT.yesno)}</td>
    <td>${inp("note", v.note, "text", "160px")}</td><td>${saveBtn(v.id)}</td><td>${photoBtn(v)}</td>${updTd(v)}<td>${transferCell(v)}</td></tr>`).join("")}
  </table></div>`}`;
  bindRows("visits"); bindFilters(); bindTransfers(); bindPhotos("visits");
  if (me.role === "squadron") readOnly();
}

const TEAMS = ["金華分隊", "莊敬分隊", "安和分隊", "舊莊分隊"];

function transferCell(v) {
  if (v.transfer_to) {
    const info = `<span class="tag warn" title="${esc(v.transfer_reason)}">申請轉給 ${esc(v.transfer_to)}</span><div class="note">${esc(v.transfer_by)}：${esc(v.transfer_reason)}</div>`;
    if (me.role === "admin") return info + `<button data-ok="${v.id}">核准</button> <button class="ghost" data-no="${v.id}">退回</button>`;
    return info + `<button class="ghost" data-cancel="${v.id}">撤回</button>`;
  }
  return `<button class="ghost" data-tr="${v.id}">轉辦</button>`;
}

function bindTransfers() {
  const run = async (payload) => {
    try { await api(payload); await load(); } catch (e) { if (e.message !== "login") alert("操作失敗：" + e.message); }
  };
  $("#view").querySelectorAll("button[data-tr]").forEach((b) => b.addEventListener("click", () => {
    const v = db.visits.find((x) => x.id === b.dataset.tr);
    const others = TEAMS.filter((t) => t !== v.unit);
    const pick = prompt(`第${v.stage}階段 ${v.seq} 號 ${v.addr_m}\n要改由哪個分隊負責？請輸入：${others.join("、")}`, others[0]);
    if (!pick) return;
    if (!others.includes(pick.trim())) { alert("分隊名稱不正確"); return; }
    const reason = prompt("原因（例如：門牌實際位於 XX 分隊轄區）", "");
    if (reason === null) return;
    run({ action: "transfer", id: v.id, to: pick.trim(), reason });
  }));
  $("#view").querySelectorAll("button[data-cancel]").forEach((b) => b.addEventListener("click", () => run({ action: "transfer", id: b.dataset.cancel, to: "" })));
  $("#view").querySelectorAll("button[data-ok]").forEach((b) => b.addEventListener("click", () => run({ action: "transfer_decide", id: b.dataset.ok, approve: true })));
  $("#view").querySelectorAll("button[data-no]").forEach((b) => b.addEventListener("click", () => run({ action: "transfer_decide", id: b.dataset.no, approve: false })));
}

// 中隊查看所屬分隊：欄位唯讀，不顯示儲存、轉辦按鈕
function readOnly() {
  $("#view").querySelectorAll("[data-f]").forEach((el) => { el.disabled = true; });
  $("#view").querySelectorAll("[data-save],[data-tr],[data-cancel]").forEach((el) => el.remove());
  const n = $("#view .filters .note");
  if (n) n.textContent = "所屬分隊的訪視進度（只能查看，由各分隊填報）。";
}

// 訪客：全部唯讀，不顯示儲存、新增、刪除、轉辦、照片
function guestView() {
  const v = $("#view");
  v.querySelectorAll("[data-f]").forEach((el) => { el.disabled = true; });
  v.querySelectorAll("[data-save],[data-tr],[data-cancel],[data-del],[data-ph]").forEach((el) => el.remove());
  const f = $("#addForm"); if (f) f.closest(".card").remove();
}

// 畫面上方跳出的短暫提示
function flash(msg) {
  const el = document.createElement("div");
  el.className = "flash";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function addForm(table, fields) {
  return `<div class="card"><h2>新增</h2><div class="form" id="addForm">${fields.join("")}<button id="addBtn">新增</button></div></div>`;
}

function bindAdd(table) {
  const form = $("#addForm");
  form.addEventListener("input", () => form.classList.toggle("dirty", [...form.querySelectorAll("input[data-f]")].some((el) => el.value.trim())));
  $("#addBtn").addEventListener("click", async () => {
    const fields = {};
    $("#addForm").querySelectorAll("[data-f]").forEach((el) => (fields[el.dataset.f] = el.value));
    if (table === "factories" && !String(fields.name || "").trim()) { alert("請填場所名稱"); return; }
    $("#addBtn").disabled = true;
    $("#addBtn").textContent = "新增中…";
    try {
      const r = await api({ action: "add", table, fields });
      await load();
      const row = document.querySelector(`#view [data-id="${r.id}"]`);
      if (row) { row.classList.add("justadded"); row.scrollIntoView({ block: "center" }); }
      flash(`已新增「${fields.name || ""}」`);
    } catch (e) {
      if (e.message !== "login") alert("新增失敗：" + e.message);
      const b = $("#addBtn"); if (b) { b.disabled = false; b.textContent = "新增"; }
    }
  });
  $("#view").querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("確定刪除這筆？")) return;
    try { await api({ action: "remove", table, id: b.dataset.del }); await load(); } catch (e) { if (e.message !== "login") alert("刪除失敗：" + e.message); }
  }));
}

const unitPicker = () => me.role === "admin"
  ? `<label>單位<select data-f="unit">${["金華分隊", "莊敬分隊", "安和分隊", "舊莊分隊", "大安中隊", "信義中隊", "南港中隊"].map((u) => `<option>${u}</option>`).join("")}</select></label>` : "";

function renderFactories() {
  const list = db.factories.filter((f) => !filt.unit || f.unit === filt.unit);
  const yn = (k, label) => `<label>${label}<select data-f="${k}">${OPT.done2.map((o) => `<option>${o}</option>`)}</select></label>`;
  const eq = (k, label) => `<label>${label}<select data-f="${k}">${OPT.equip.map((o) => `<option>${o}</option>`)}</select></label>`;
  $("#view").innerHTML = `<p class="note">${PROJ.factories}：由南港中隊及舊莊分隊完成場所清查、系統建冊列管，並輔導設置火警自動警報設備、緊急廣播設備及住宅用火災警報器，加強推廣使用偵煙式探測器。期限 10/31。</p>`
  + addForm("factories", [
    me.role === "admin" ? `<label>單位<select data-f="unit">${FACTORY_UNITS.map((u) => `<option>${u}</option>`).join("")}</select></label>` : "",
    `<label>場所名稱<input data-f="name"></label>`, `<label>地址<input data-f="address"></label>`,
    yn("surveyed", "場所清查"), yn("registered", "系統建冊列管"),
    eq("fire_alarm", "火警自動警報設備"), eq("broadcast", "緊急廣播設備"), eq("home_alarm", "住宅用火災警報器"),
    `<label>偵煙式探測器推廣<select data-f="smoke_detector">${OPT.yesno.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>狀態<select data-f="status">${OPT.fstatus.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>備註<input data-f="note"></label>`])
  + (isMobile() ? list.map((f) => `<div class="mcard" data-id="${f.id}"><div class="mhead"><b>${esc(f.name) || "（未命名）"}</b> <span class="note">${esc(f.unit)}</span>${overdueTag(factoryOverdue(f))}</div>
      <label>場所名稱 ${inp("name", f.name)}</label><label>地址 ${inp("address", f.address)}</label>
      <label>場所清查 ${sel("surveyed", f.surveyed, OPT.done2)}</label><label>系統建冊列管 ${sel("registered", f.registered, OPT.done2)}</label>
      <label>火警自動警報 ${sel("fire_alarm", f.fire_alarm, OPT.equip)}</label><label>緊急廣播 ${sel("broadcast", f.broadcast, OPT.equip)}</label>
      <label>住警器 ${sel("home_alarm", f.home_alarm, OPT.equip)}</label><label>偵煙式探測器推廣 ${sel("smoke_detector", f.smoke_detector, OPT.yesno)}</label>
      <label>狀態 ${sel("status", f.status, OPT.fstatus)}</label><label>備註 ${inp("note", f.note)}</label>
      <div class="mfoot">${saveBtn(f.id)} <button class="ghost" data-del="${f.id}">刪除</button><span class="note">${upd(f)}</span></div></div>`).join("") || `<p class="note">尚未建立清冊</p>`
  : `<div class="tablewrap"><table><tr><th>單位</th><th>場所名稱</th><th>地址</th><th>場所清查</th><th>建冊列管</th><th>火警自動警報</th><th>緊急廣播</th><th>住警器</th><th>偵煙式推廣</th><th>狀態</th><th>備註</th><th>儲存</th>${updTh()}<th></th></tr>
  ${list.map((f) => `<tr data-id="${f.id}"><td>${esc(f.unit)}${overdueTag(factoryOverdue(f))}</td><td>${inp("name", f.name)}</td><td>${inp("address", f.address)}</td>
    <td>${sel("surveyed", f.surveyed, OPT.done2)}</td><td>${sel("registered", f.registered, OPT.done2)}</td>
    <td>${sel("fire_alarm", f.fire_alarm, OPT.equip)}</td><td>${sel("broadcast", f.broadcast, OPT.equip)}</td><td>${sel("home_alarm", f.home_alarm, OPT.equip)}</td>
    <td>${sel("smoke_detector", f.smoke_detector, OPT.yesno)}</td><td>${sel("status", f.status, OPT.fstatus)}</td><td>${inp("note", f.note, "text", "160px")}</td>
    <td>${saveBtn(f.id)}</td>${updTd(f)}<td><button class="ghost" data-del="${f.id}">刪除</button></td></tr>`).join("") || `<tr><td colspan="14" class="note">尚未建立清冊</td></tr>`}
  </table></div>`);
  bindRows("factories"); bindAdd("factories"); bindFilters();
}

function renderEvents() {
  const list = db.events.filter((e) => !filt.unit || e.unit === filt.unit).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  $("#view").innerHTML = addForm("events", [unitPicker(),
    `<label>類別<select data-f="kind">${OPT.kind.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>日期<input data-f="date" type="date"></label>`, `<label>地點<input data-f="place"></label>`,
    `<label>人數<input data-f="people" type="number" min="0" style="width:80px"></label>`, `<label>備註<input data-f="note"></label>`]) +
  `<div class="filters">${unitFilter(db.events)}<span class="note">第1階段地區：大安區基隆路3段155巷（學府里）、信義區和平東路3段531巷（黎安里）、南港區研究院路3段（九如里）。</span></div>
  <div class="tablewrap"><table><tr><th>單位</th><th>類別</th><th>日期</th><th>地點</th><th>人數</th><th>備註</th><th>最後更新</th><th></th></tr>
  ${list.map((e) => `<tr data-id="${e.id}"><td>${esc(e.unit)}</td><td>${sel("kind", e.kind, OPT.kind)}</td><td>${inp("date", e.date, "date")}</td><td>${inp("place", e.place)}</td>
    <td>${inp("people", e.people, "number", "70px")}</td><td>${inp("note", e.note, "text", "160px")}</td><td class="note">${esc(e.updated_by)} ${esc(e.updated_at)}</td>
    <td><button class="ghost" data-del="${e.id}">刪除</button></td></tr>`).join("") || `<tr><td colspan="8" class="note">尚無紀錄</td></tr>`}
  </table></div>`;
  bindRows("events"); bindAdd("events"); bindFilters();
}

// ---- 帳號管理（管理者） ----
const UNITS = ["大安中隊", "信義中隊", "南港中隊", "金華分隊", "莊敬分隊", "安和分隊", "舊莊分隊"];
const STATUS = { pending: "待核准", active: "使用中", disabled: "停用" };

async function renderUsers() {
  $("#view").innerHTML = `<p class="note">載入中…</p>`;
  let r;
  try { r = await api({ action: "users" }); } catch (e) { $("#view").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const list = r.users.filter((u) => !filt.unit || u.unit === filt.unit).sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0));
  const pending = list.filter((u) => u.status === "pending").length;
  $("#view").innerHTML = `<div class="filters"><span class="note">管理者：${r.admins.map(esc).join("、")}（固定，不需核准）</span>${pending ? `<span class="tag warn">待核准 ${pending} 人</span>` : ""}</div>
  <div class="card"><h2>直接新增帳號</h2><div class="form" id="userAdd"><label>Gmail<input id="uaEmail" type="email" placeholder="例如 tfd0000@gmail.com" style="width:240px"></label>
    <label>單位<select id="uaUnit">${UNITS.map((x) => `<option>${x}</option>`).join("")}</select></label><button id="uaBtn">新增</button>
    <span class="note">建好就是「使用中」，對方用這個 Gmail 登入會直接進所屬單位，不用再申請和核准。</span></div></div>
  <div class="tablewrap"><table><tr><th>Gmail</th><th>姓名</th><th>單位</th><th>狀態</th><th>申請時間</th><th>核准紀錄</th><th></th></tr>
  ${list.map((u) => `<tr data-email="${esc(u.email)}"><td>${esc(u.email)}</td><td>${esc(u.name)}</td>
    <td><select data-u="unit">${UNITS.map((x) => `<option ${x === u.unit ? "selected" : ""}>${x}</option>`).join("")}</select></td>
    <td><span class="tag ${u.status === "active" ? "ok" : u.status === "pending" ? "warn" : "bad"}">${STATUS[u.status] || esc(u.status)}</span></td>
    <td class="note">${esc(u.created_at)}</td><td class="note">${esc(u.approved_by)}</td>
    <td>${u.status !== "active" ? `<button data-s="active">核准</button>` : `<button class="ghost" data-s="disabled">停用</button>`} <button class="ghost" data-rm="1">刪除</button></td></tr>`).join("") || `<tr><td colspan="7" class="note">還沒有人申請</td></tr>`}
  </table></div>`;
  $("#uaBtn").addEventListener("click", async () => {
    const email = $("#uaEmail").value.trim().toLowerCase(), unit = $("#uaUnit").value;
    if (!email) { alert("請填 Gmail"); return; }
    $("#uaBtn").disabled = true; $("#uaBtn").textContent = "新增中…";
    try { await api({ action: "user_add", email, unit }); flash(`已新增 ${email}（${unit}）`); renderUsers(); }
    catch (e) { if (e.message !== "login") alert("新增失敗：" + e.message); const b = $("#uaBtn"); if (b) { b.disabled = false; b.textContent = "新增"; } }
  });
  $("#view").querySelectorAll("tr[data-email]").forEach((tr) => {
    const email = tr.dataset.email;
    const run = async (payload) => { try { await api({ action: "user_set", email, ...payload }); renderUsers(); } catch (e) { if (e.message !== "login") alert("操作失敗：" + e.message); } };
    tr.querySelector("[data-u]").addEventListener("change", (e) => run({ unit: e.target.value }));
    tr.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => run({ status: b.dataset.s })));
    tr.querySelector("[data-rm]").addEventListener("click", () => { if (confirm(`刪除 ${email}？`)) run({ remove: true }); });
  });
}

// ---- 照片 ----
const photoIds = (rec) => (rec.photos ? rec.photos.split(",").filter(Boolean) : []);
const photoBtn = (rec) => `<button class="ghost" data-ph="${rec.id}">照片${photoIds(rec).length ? `（${photoIds(rec).length}）` : ""}</button>`;

function bindPhotos(table) {
  $("#view").querySelectorAll("button[data-ph]").forEach((b) => b.addEventListener("click", () => openPhotos(table, b.dataset.ph)));
}

// 上傳前在瀏覽器壓縮：長邊 1280px、JPEG 品質 0.75
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

let photoPend = [];   // 選好、還沒按確認上傳的照片
function closeModal() {
  if (photoPend.length && !confirm(`還有 ${photoPend.length} 張照片選了但還沒上傳，關閉就不會上傳。確定關閉？`)) return;
  photoPend = [];
  const m = $("#modal"); if (m) m.remove(); renderTabs();
}

// 放大檢視：蓋在照片視窗上面，按鈕或左右鍵切換，Esc 或點旁邊關閉
function viewPhoto(list, i) {
  const old = $("#pview"); if (old) old.remove();
  const v = document.createElement("div");
  v.id = "pview";
  v.innerHTML = `<button class="ghost" data-pv="x">關閉</button>${list.length > 1 ? `<button class="ghost" data-pv="-1" aria-label="上一張">‹</button><button class="ghost" data-pv="1" aria-label="下一張">›</button>` : ""}<img alt="照片"><div class="pvn"></div>`;
  document.body.appendChild(v);
  const show = () => { v.querySelector("img").src = list[i]; v.querySelector(".pvn").textContent = `${i + 1} / ${list.length}`; };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { i = (i + (e.key === "ArrowLeft" ? -1 : 1) + list.length) % list.length; show(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const close = () => { removeEventListener("keydown", onKey, true); v.remove(); };
  addEventListener("keydown", onKey, true);
  v.addEventListener("click", (e) => {
    const k = e.target.dataset && e.target.dataset.pv;
    if (k === "1" || k === "-1") { i = (i + Number(k) + list.length) % list.length; show(); }
    else if (k === "x" || e.target === v) close();
  });
  show();
}

async function openPhotos(table, id) {
  const rec = db[table].find((x) => x.id === id);
  const title = table === "visits" ? `第${rec.stage}階段 ${rec.seq} 號 ${rec.name_m}` : `${rec.id} ${rec.name}`;
  let m = $("#modal");
  if (!m) { m = document.createElement("div"); m.id = "modal"; document.body.appendChild(m); }
  const ids = photoIds(rec);
  const ro = table === "visits" && me.role === "squadron";
  m.innerHTML = `<div class="mbox"><div class="mtop"><b>照片｜${esc(title)}</b><button class="ghost" id="mClose">關閉</button></div>
    <p class="note">照片可能拍到住戶家中，請只拍設備本身（住警器、平面圖），避免拍到人臉、證件和門牌。</p>
    ${ro ? "" : `<label class="upl">上傳照片 <input type="file" id="mFile" accept="image/*" multiple></label>`}<span id="mMsg" class="note"></span>
    <div id="mPend"></div>
    <div class="pgrid" id="mGrid">${ids.map((f) => `<div class="pcell" data-file="${f}"><div class="note">載入中…</div>${ro ? "" : `<button class="ghost" data-pdel="${f}">刪除</button>`}</div>`).join("") || `<p class="note">還沒有照片</p>`}</div></div>`;
  $("#mClose").addEventListener("click", closeModal);
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  // 選了檔案先預覽，按確認才上傳
  const drawPend = () => {
    const box = $("#mPend");
    if (!box) return;
    box.innerHTML = photoPend.length ? `<div class="pend"><b>準備上傳 ${photoPend.length} 張（還沒上傳）</b>
      <div class="pgrid">${photoPend.map((p, i) => `<div class="pcell"><img src="${p}" alt="預覽" data-pi="${i}"><button class="ghost" data-prm="${i}">不要這張</button></div>`).join("")}</div>
      <p><button id="mUp">確認上傳 ${photoPend.length} 張</button> <button class="ghost" id="mUpNo">全部取消</button></p></div>` : "";
    box.querySelectorAll("img[data-pi]").forEach((im) => im.addEventListener("click", () => viewPhoto(photoPend, Number(im.dataset.pi))));
    box.querySelectorAll("button[data-prm]").forEach((b) => b.addEventListener("click", () => { photoPend.splice(Number(b.dataset.prm), 1); drawPend(); }));
    const no = $("#mUpNo"); if (no) no.addEventListener("click", () => { photoPend = []; drawPend(); });
    const up = $("#mUp"); if (up) up.addEventListener("click", async () => {
      const list = photoPend.slice();
      box.querySelectorAll("button").forEach((b) => (b.disabled = true));
      let done = 0;
      for (let i = 0; i < list.length; i++) {
        $("#mMsg").textContent = `上傳中 ${i + 1}/${list.length}…`;
        try {
          const r = await api({ action: "photo_add", table, id, data: list[i] });
          rec.photos = photoIds(rec).concat([r.fileId]).join(",");
          photoPend = photoPend.filter((p) => p !== list[i]);
          done++;
        } catch (err) {
          if (err.message === "login") return;
          alert(`第 ${i + 1} 張上傳失敗：${err.message}`);
        }
      }
      if (done) flash(`已上傳 ${done} 張`);
      openPhotos(table, id);
    });
  };
  if (!ro) {
    drawPend();
    $("#mFile").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      let bad = 0;
      for (let i = 0; i < files.length; i++) {
        $("#mMsg").textContent = `讀取中 ${i + 1}/${files.length}…`;
        try { photoPend.push(await shrink(files[i])); } catch (err) { bad++; }
      }
      $("#mMsg").textContent = bad ? `有 ${bad} 個檔案讀不出來（不是照片，或格式這個瀏覽器不支援）` : "";
      drawPend();
    });
  }
  m.querySelectorAll("button[data-pdel]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("刪除這張照片？")) return;
    try {
      await api({ action: "photo_del", table, id, fileId: b.dataset.pdel });
      rec.photos = photoIds(rec).filter((x) => x !== b.dataset.pdel).join(",");
      openPhotos(table, id);
    } catch (err) { if (err.message !== "login") alert("刪除失敗：" + err.message); }
  }));
  for (const f of ids) {
    try {
      const r = await api({ action: "photo_get", table, id, fileId: f });
      const cell = m.querySelector(`[data-file="${f}"] .note`);
      if (cell) cell.outerHTML = `<img src="${r.data}" alt="照片" title="點一下放大">`;
    } catch (err) { /* 單張失敗不影響其他 */ }
  }
}
// 點縮圖放大（已載入的那幾張可以左右切換）
document.addEventListener("click", (e) => {
  const im = e.target.closest && e.target.closest("#mGrid img");
  if (!im) return;
  const all = [...document.querySelectorAll("#mGrid img")];
  viewPhoto(all.map((x) => x.src), all.indexOf(im));
});

// ---- 異動紀錄（管理者） ----
let logQuery = "";
let logProj = "";
async function renderLog() {
  $("#view").innerHTML = `<p class="note">載入中…</p>`;
  let r;
  try { r = await api({ action: "log" }); } catch (e) { $("#view").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const draw = () => {
    const q = logQuery.trim();
    const projOf = (t) => (t === "dome" ? "大巨蛋" : t === "users" || t === "settings" ? "系統" : "精進作為");
    const list = r.log.filter((x) => (!logProj || projOf(x.table) === logProj) && (!q || Object.values(x).join(" ").includes(q)));
    $("#logBody").innerHTML = list.slice(0, 500).map((x) => `<tr><td>${esc(x.time)}</td><td class="wrap">${esc(x.who)}</td><td>${esc(x.table)}</td><td>${esc(x.id)}</td><td>${esc(x.unit)}</td><td>${esc(x.field)}</td><td class="wrap">${esc(x.old)}</td><td class="wrap">${esc(x.new)}</td></tr>`).join("") || `<tr><td colspan="8" class="note">沒有紀錄</td></tr>`;
    $("#logCount").textContent = `共 ${list.length} 筆${list.length > 500 ? "（只顯示最新 500 筆）" : ""}`;
  };
  $("#view").innerHTML = `<div class="filters"><select id="logP">${["", "精進作為", "大巨蛋", "系統"].map((p) => `<option value="${p}" ${p === logProj ? "selected" : ""}>${p || "全部專案"}</option>`).join("")}</select><input id="logQ" placeholder="搜尋（序號、人名、欄位…）" value="${esc(logQuery)}"><span id="logCount" class="note"></span><span class="note">保留最新 1000 筆。</span></div>
    <div class="tablewrap"><table><thead><tr><th>時間</th><th>誰</th><th>資料表</th><th>編號</th><th>單位</th><th>欄位</th><th>原本</th><th>改成</th></tr></thead><tbody id="logBody"></tbody></table></div>`;
  $("#logQ").addEventListener("input", (e) => { logQuery = e.target.value; draw(); });
  $("#logP").addEventListener("change", (e) => { logProj = e.target.value; draw(); });
  draw();
}

// ---- 名單匯入（管理者）：在瀏覽器先遮罩，完整個資不會送出 ----
const maskName = (n) => (n.length <= 2 ? n[0] + "○" : n[0] + "○".repeat(n.length - 2) + n[n.length - 1]);
function maskAddr(dist, addr) {
  let a = String(addr || "").replace(/^臺北市|^台北市/, "");
  if (dist && !a.startsWith(dist)) a = dist + a;
  let i = Math.max(a.lastIndexOf("巷"), a.lastIndexOf("弄"));
  if (i < 0) i = a.lastIndexOf("段");
  if (i < 0) i = a.search(/\d/) - 1;
  return a.slice(0, i + 1) + "○號";
}
let importRows = null;

function renderImport() {
  const liMap = (db.settings && db.settings.li_map) || {};
  const nextStage = Math.max(0, ...db.visits.map((v) => Number(v.stage) || 0)) + 1;
  $("#view").innerHTML = `<div class="card"><h2>匯入新的訪視名單</h2>
    <p class="note">Excel 第一列要是欄位名稱，需包含：序號、姓名、行政區、地址、里別、類型、關聯案件（欄位順序不限）。
    檔案只在你的瀏覽器讀取，姓名和門牌遮罩後才送出，完整名單不會上傳。已存在的「階段＋序號」會略過。</p>
    <div class="form"><label>階段<input id="imStage" type="number" min="1" value="${nextStage}" style="width:80px"></label>
    <label>Excel 檔<input id="imFile" type="file" accept=".xlsx,.xls,.csv"></label></div>
    <div id="imPreview"></div></div>
    <div class="card"><h2>里別對應分隊</h2><p class="note">匯入時依這張表自動分配分隊。</p>
    <div class="tablewrap"><table><tr><th>里別</th><th>分隊</th></tr>${Object.entries(liMap).map(([l, t]) => `<tr><td>${esc(l)}</td><td>${esc(t)}</td></tr>`).join("")}</table></div></div>`;
  $("#imFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { await loadXlsx(); } catch (err) { flash("Excel 元件載入失敗，請檢查網路後再試一次"); return; }
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    const need = ["序號", "姓名", "行政區", "地址", "里別"];
    const miss = need.filter((k) => !(raw[0] && k in raw[0]));
    if (miss.length) { $("#imPreview").innerHTML = `<p class="err">找不到欄位：${miss.join("、")}</p>`; return; }
    importRows = raw.filter((r) => String(r["姓名"]).trim()).map((r) => ({
      seq: String(r["序號"]).trim(), name_m: maskName(String(r["姓名"]).trim()), addr_m: maskAddr(String(r["行政區"]).trim(), r["地址"]),
      li: String(r["里別"]).trim(), type: String(r["類型"] || "").trim(), case_no: String(r["關聯案件"] || "").trim(),
    }));
    drawImport();
  });
}

function drawImport() {
  const liMap = (db.settings && db.settings.li_map) || {};
  const unknown = [...new Set(importRows.map((r) => r.li).filter((l) => !liMap[l]))];
  const counts = groupBy(importRows.map((r) => ({ ...r, unit: liMap[r.li] || "（待指定）" })), "unit");
  $("#imPreview").innerHTML = `<p>讀到 ${importRows.length} 筆：${Object.entries(counts).map(([u, l]) => `${esc(u)} ${l.length}`).join("、")}</p>
    ${unknown.length ? `<p class="err">以下里別還沒有對應分隊，請指定（會一併存進對應表）：</p>
      <div class="form">${unknown.map((l) => `<label>${esc(l)}<select data-li="${esc(l)}"><option value="">請選擇</option>${TEAMS.map((t) => `<option>${t}</option>`).join("")}</select></label>`).join("")}</div>` : ""}
    <div class="tablewrap" style="max-height:260px"><table><tr><th>序號</th><th>姓名（遮罩後）</th><th>地址（遮罩後）</th><th>里別</th><th>類型</th><th>案件</th></tr>
    ${importRows.slice(0, 50).map((r) => `<tr><td>${esc(r.seq)}</td><td>${esc(r.name_m)}</td><td>${esc(r.addr_m)}</td><td>${esc(r.li)}</td><td>${esc(r.type)}</td><td>${esc(r.case_no)}</td></tr>`).join("")}</table></div>
    ${importRows.length > 50 ? `<p class="note">只預覽前 50 筆</p>` : ""}
    <p><button id="imGo">確認匯入第 ${esc($("#imStage").value)} 階段 ${importRows.length} 筆</button></p>`;
  $("#imGo").addEventListener("click", async () => {
    const map = { ...liMap };
    let ok = true;
    document.querySelectorAll("[data-li]").forEach((el) => { if (!el.value) ok = false; map[el.dataset.li] = el.value; });
    if (!ok) { alert("請先指定所有里別的分隊"); return; }
    $("#imGo").disabled = true;
    try {
      if (unknown.length) await api({ action: "settings_set", li_map: map });
      const r = await api({ action: "import_visits", stage: $("#imStage").value, rows: importRows.map((x) => ({ ...x, unit: map[x.li] })) });
      alert(`匯入完成：新增 ${r.added} 筆，略過 ${r.skipped} 筆（已存在或資料不完整）`);
      importRows = null;
      await load();
    } catch (e) {
      if (e.message !== "login") alert("匯入失敗：" + e.message);
      $("#imGo").disabled = false;
    }
  });
}

// ---- 匯出 Excel ----
// Excel 外掛約 900KB，用到（匯入、匯出）才載入，不拖慢開網頁
const XLSX_SRC = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxLoading) xlsxLoading = new Promise((ok, fail) => {
    const el = document.createElement("script");
    el.src = XLSX_SRC;
    el.onload = ok;
    el.onerror = () => { xlsxLoading = null; el.remove(); fail(new Error("xlsx")); };
    document.head.appendChild(el);
  });
  return xlsxLoading;
}

async function exportXlsx() {
  try { await loadXlsx(); } catch (e) { flash("Excel 元件載入失敗，請檢查網路後再試一次"); return; }
  const db = scoped();
  const wb = XLSX.utils.book_new();
  const strip = (rows) => (isAdmin() ? rows : rows.map(({ 更新者, 更新時間, ...r }) => r));
  const add = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(strip(rows)), name); };
  add("總覽", summaryRows());
  add("百貨商場救災圖資整備", db.stores.map((s) => ({ 序號: s.id, 中隊: s.unit, 場所名稱: s.name, 地址: s.address, 營業樓層: s.floors, "1樓": s.plan_1f, 地下街: s.plan_mall, 停車場: s.plan_park, 備齊日期: s.done_date, 完成: storeDone(s) ? "是" : "否", 逾期: storeOverdue(s) ? "是" : "", 備註: s.note, 更新者: s.updated_by, 更新時間: s.updated_at })));
  add("避難弱者訪視住警器", db.visits.map((v) => ({ 階段: v.stage, 序號: Number(v.seq), 分隊: v.unit, "姓名(遮罩)": v.name_m, "地址(遮罩)": v.addr_m, 里別: v.li, 類型: v.type, 關聯案件: v.case_no, 訪視日期: v.visit_date, 住警器狀況: v.alarm, 住警器處理: v.alarm_installed, 宣導: v.outreach, 完成: visitDone(v) ? "是" : "否", 逾期: visitOverdue(v) ? "是" : "", 備註: v.note, 更新者: v.updated_by, 更新時間: v.updated_at })));
  add("研究院路廠住混合區專案", db.factories.map((f) => ({ 單位: f.unit, 場所名稱: f.name, 地址: f.address, 場所清查: f.surveyed, 系統建冊列管: f.registered, 火警自動警報設備: f.fire_alarm, 緊急廣播設備: f.broadcast, 住宅用火災警報器: f.home_alarm, 偵煙式探測器推廣: f.smoke_detector, 狀態: f.status, 逾期: factoryOverdue(f) ? "是" : "", 備註: f.note, 更新者: f.updated_by, 更新時間: f.updated_at })));
  const d = new Date();
  const stamp = `${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `ZTEAM防火任務板_${TASK.name}_${filt.unit || me.name}_${stamp}.xlsx`);
}

// ---- 啟動 ----
let wasMobile = isMobile();
window.addEventListener("resize", () => { if (isMobile() !== wasMobile && db && !$("#modal")) { wasMobile = isMobile(); renderTabs(); } });
$("#regBtn").addEventListener("click", doRegister);
initGoogle(40);
$("#logout").addEventListener("click", () => logout(""));
$("#export").addEventListener("click", exportXlsx);
$("#adminBtn").addEventListener("click", () => goProject(project === "admin" ? (localStorage.getItem(PROJ_KEY) || "casualty") : "admin"));
try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
// 沒登入也先試著載入：後端開放免登入瀏覽時會回訪客資料，沒開放就顯示登入畫面
const hadToken = !!token;
// 沒登入：固定的畫面先畫出來，不用等資料；有登入紀錄的先顯示載入中（要等後端回覆身分）
const bootMsg = document.createElement("p");
bootMsg.className = "note"; bootMsg.style.cssText = "text-align:center;padding:48px 16px;font-size:1.1rem";
bootMsg.textContent = "資料載入中，請稍候…";
// 活動勤務看板不用等後端：有登入紀錄也先畫出來，身分等後端回覆再補上
if (hadToken && !isOpen(projectFromHash())) document.body.appendChild(bootMsg);
else {
  me = { name: "訪客", role: "guest", email: "", person: "" };
  db = { _loading: true, stores: [], visits: [], events: [], factories: [], settings: {} };
  $("#app").hidden = false;
  renderTabs();
}
// 後端沒開放免登入瀏覽時，活動勤務看板照樣給看（它不用後端資料），其他專案顯示登入畫面
function activityOnly() {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  me = { name: "訪客", role: "guest", email: "", person: "" };
  db = { _locked: true, stores: [], visits: [], events: [], factories: [], settings: {} };
  $("#loginWrap").hidden = true; $("#app").hidden = false; $("#who").hidden = false;
  $("#whoName").textContent = "訪客（僅供瀏覽）";
  $("#logout").textContent = "登入";
  $("#adminBtn").hidden = true;
  $("#status").textContent = "";
  renderTabs();
}
$("#backAct").addEventListener("click", () => { project = openBack; tab = null; activityOnly(); });
load().catch(() => (hadToken ? load() : Promise.reject())).catch(() => (isOpen(projectFromHash()) ? activityOnly() : logout(""))).finally(() => bootMsg.remove());
