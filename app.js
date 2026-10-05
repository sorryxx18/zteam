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
  token = null; me = null; db = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  $("#app").hidden = true; $("#who").hidden = true; $("#loginWrap").hidden = false;
  $("#loginErr").textContent = msg || "";
}

async function load() {
  $("#status").textContent = "載入中…";
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

// ---- 甘特圖：各項目 × 單位，從開始日到期限；填色＝完成比例，紅線＝今天 ----
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
  const marks = [["9/21", GANTT_START], ["10/1", "2026-10-01"], ["10/31", "2026-10-31"], ["11/30", GANTT_END]];
  return `<div class="card gantt"><h2>進度甘特圖</h2>
    <div class="g-head"><div></div><div class="g-track">${marks.map(([n, d]) => `<span style="left:${pos(d)}%">${n}</span>`).join("")}<div class="g-today" style="left:${pos(t)}%"></div></div><div></div></div>
    ${rows.map((r) => `<div class="g-row" data-gunit="${esc(r.unit)}" data-gtab="${r.tabKey}">
      <div class="g-label">${esc(r.label)}<br><b>${esc(r.unit)}</b></div>
      <div class="g-track">
        <div class="g-bar ${r.behind ? "behind" : ""}" style="left:0;width:${pos(r.due)}%"><i style="width:${Math.round(r.p * 100)}%"></i></div>
        <div class="g-expect" style="left:${pos(r.due) * r.expect}%" title="依進度應完成 ${Math.round(r.expect * 100)}%"></div>
        <div class="g-today" style="left:${pos(t)}%"></div>
      </div>
      <div class="g-num">${r.done}/${r.total}　${Math.round(r.p * 100)}%${r.behind ? `<span class="tag bad">落後</span>` : r.p >= 1 ? `<span class="tag ok">完成</span>` : ""}</div>
    </div>`).join("")}
    <p class="note">橫條從 9/21（決行日）畫到各項期限，填色是已完成比例。紅色直線是今天，黑色小三角是「平均推進的話，今天應完成到哪裡」。實際進度落在三角左邊就標「落後」。點任一列可以看該單位明細。</p></div>`;
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

// 專案（第一層）：網址 #casualty、#dome；管理（#admin）只給管理者
const TASK = { name: "115年火災傷亡案件精進作為" };
const PROJECTS = [
  { key: "casualty", icon: "🔥", name: "火災傷亡案件精進作為" },
  { key: "dome", icon: "🏟", name: "台北大巨蛋看板" },
];
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
  if (hasDirty() && !confirm("還有修改沒有按「儲存」，確定要離開？")) return;
  project = key; tab = null;
  if (key !== "admin") { try { localStorage.setItem(PROJ_KEY, key); } catch (e) {} }
  if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key);
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
    + (project === "admin" ? `<span class="pcard on admin">⚙ 管理</span>` : "");
  $("#taskbar").querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => goProject(b.dataset.p)));
  // 匯出 Excel 只跟精進作為有關
  $("#export").hidden = project !== "casualty" || isGuest();
  const showTabs = t.length > 1 || project === "casualty";
  $("#tabs").hidden = !showTabs;
  $("#tabs").innerHTML = t.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("")
    + (seesAll() && project === "casualty" ? `<select id="gUnit" title="單位篩選"><option value="">全部單位</option>${UNITS.map((u) => `<option ${u === filt.unit ? "selected" : ""}>${u}</option>`).join("")}</select>` : "");
  const g = $("#gUnit");
  if (g) g.addEventListener("change", () => {
    if (hasDirty() && !confirm("還有修改沒有按「儲存」，確定要切換？")) { g.value = filt.unit; return; }
    filt.unit = g.value; renderTabs();
  });
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (hasDirty() && !confirm("還有修改沒有按「儲存」，確定要離開這一頁？")) return;
    tab = b.dataset.t; renderTabs();
  }));
  // 資料還沒回來：固定的畫面（卡片、分頁、橫幅）先畫，數字和清冊的位置顯示載入中
  if (db._loading) {
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

function bindRows(table) {
  $("#view").querySelectorAll("[data-id]").forEach((row) => {
    const mark = () => { row.classList.add("dirty"); const b = row.querySelector("[data-save]"); if (b) b.textContent = "儲存 ●"; };
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
        btn.textContent = "儲存 ●";
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
  ${isMobile() ? list.map((s) => `<div class="mcard ${storeDone(s) ? "done" : "todo"}" data-id="${s.id}">
      <div class="mhead"><b>${s.id}</b> ${esc(s.unit)}${overdueTag(storeOverdue(s))}</div>
      <div>${esc(s.name)}</div><div class="note">${esc(s.address)}｜${esc(s.floors)}</div>
      <label>1樓 ${sel("plan_1f", s.plan_1f, OPT.plan)}</label><label>地下街 ${sel("plan_mall", s.plan_mall, OPT.plan)}</label><label>停車場 ${sel("plan_park", s.plan_park, OPT.plan)}</label>
      <label>備齊日期 ${inp("done_date", s.done_date, "date")}</label><label>備註 ${inp("note", s.note)}</label>
      <div class="mfoot">${saveBtn(s.id)} ${photoBtn(s)}<span class="note">${upd(s)}</span></div></div>`).join("")
  : `<div class="tablewrap"><table><tr><th>序號</th><th>中隊</th><th>場所名稱</th><th>地址</th><th>營業樓層</th><th>1樓</th><th>地下街</th><th>停車場</th><th>備齊日期</th><th>備註</th><th>儲存</th><th>照片</th>${updTh()}</tr>
  ${list.map((s) => `<tr data-id="${s.id}" class="${storeDone(s) ? "done" : "todo"}"><td>${s.id}${overdueTag(storeOverdue(s))}</td><td>${esc(s.unit)}</td><td class="wrap">${esc(s.name)}</td><td class="wrap">${esc(s.address)}</td><td>${esc(s.floors)}</td>
    <td>${sel("plan_1f", s.plan_1f, OPT.plan)}</td><td>${sel("plan_mall", s.plan_mall, OPT.plan)}</td><td>${sel("plan_park", s.plan_park, OPT.plan)}</td>
    <td>${inp("done_date", s.done_date, "date")}</td><td>${inp("note", s.note, "text", "160px")}</td><td>${saveBtn(s.id)}</td><td>${photoBtn(s)}</td>${updTd(s)}</tr>`).join("")}
  </table></div>`}`;
  bindRows("stores"); bindFilters(); bindPhotos("stores");
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
  <div class="tablewrap"><table><tr><th>Gmail</th><th>姓名</th><th>單位</th><th>狀態</th><th>申請時間</th><th>核准紀錄</th><th></th></tr>
  ${list.map((u) => `<tr data-email="${esc(u.email)}"><td>${esc(u.email)}</td><td>${esc(u.name)}</td>
    <td><select data-u="unit">${UNITS.map((x) => `<option ${x === u.unit ? "selected" : ""}>${x}</option>`).join("")}</select></td>
    <td><span class="tag ${u.status === "active" ? "ok" : u.status === "pending" ? "warn" : "bad"}">${STATUS[u.status] || esc(u.status)}</span></td>
    <td class="note">${esc(u.created_at)}</td><td class="note">${esc(u.approved_by)}</td>
    <td>${u.status !== "active" ? `<button data-s="active">核准</button>` : `<button class="ghost" data-s="disabled">停用</button>`} <button class="ghost" data-rm="1">刪除</button></td></tr>`).join("") || `<tr><td colspan="7" class="note">還沒有人申請</td></tr>`}
  </table></div>`;
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

function closeModal() { const m = $("#modal"); if (m) m.remove(); renderTabs(); }

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
    <div class="pgrid">${ids.map((f) => `<div class="pcell" data-file="${f}"><div class="note">載入中…</div>${ro ? "" : `<button class="ghost" data-pdel="${f}">刪除</button>`}</div>`).join("") || `<p class="note">還沒有照片</p>`}</div></div>`;
  $("#mClose").addEventListener("click", closeModal);
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  if (!ro) $("#mFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    for (let i = 0; i < files.length; i++) {
      $("#mMsg").textContent = `上傳中 ${i + 1}/${files.length}…`;
      try {
        const data = await shrink(files[i]);
        const r = await api({ action: "photo_add", table, id, data });
        rec.photos = photoIds(rec).concat([r.fileId]).join(",");
      } catch (err) {
        if (err.message !== "login") alert("上傳失敗：" + err.message);
      }
    }
    openPhotos(table, id);
  });
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
      if (cell) cell.outerHTML = `<a href="${r.data}" target="_blank" rel="noopener"><img src="${r.data}" alt="照片"></a>`;
    } catch (err) { /* 單張失敗不影響其他 */ }
  }
}

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
function exportXlsx() {
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
if (hadToken) document.body.appendChild(bootMsg);
else {
  me = { name: "訪客", role: "guest", email: "", person: "" };
  db = { _loading: true, stores: [], visits: [], events: [], factories: [], settings: {} };
  $("#app").hidden = false;
  renderTabs();
}
load().catch(() => (hadToken ? load() : Promise.reject())).catch(() => logout("")).finally(() => bootMsg.remove());
