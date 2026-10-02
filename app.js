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
  if (!data.ok && data.error === "login required") { logout("登入逾時，請重新登入。"); throw new Error("login"); }
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
  $("#app").hidden = true; $("#who").hidden = true; $("#login").hidden = false;
  $("#loginErr").textContent = msg || "";
}

async function load() {
  $("#status").textContent = "載入中…";
  db = await api({ action: "data" });
  me = db.me;
  $("#login").hidden = true; $("#app").hidden = false; $("#who").hidden = false;
  $("#whoName").textContent = `${me.name}｜${me.person}`;
  $("#status").textContent = `更新時間 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
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
const DL_LABEL = { stage1: "第1階段訪視", stage2: "第2階段訪視", stores: "百貨 A1 平面圖", factories: "廠住混合改善" };
const overdueTag = (yes) => (yes ? ` <span class="tag bad">逾期</span>` : "");

function tabsFor(role) {
  const t = [["summary", "總覽"]];
  if (role !== "team") t.push(["stores", "百貨 A1 平面圖"]);
  if (role !== "squadron") t.push(["visits", "訪視・住警器"], ["factories", "廠住混合清查"]);
  t.push(["events", "演練・踏勘・宣導"]);
  if (role === "admin") t.push(["users", "帳號管理"], ["log", "異動紀錄"], ["import", "名單匯入"]);
  return t;
}

function renderTabs() {
  const t = tabsFor(me.role);
  if (!tab || !t.some(([k]) => k === tab)) tab = t[0][0];
  $("#tabs").innerHTML = t.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("")
    + (me.role === "admin" ? `<select id="gUnit" title="單位篩選"><option value="">全部單位</option>${UNITS.map((u) => `<option ${u === filt.unit ? "selected" : ""}>${u}</option>`).join("")}</select>` : "");
  const g = $("#gUnit");
  if (g) g.addEventListener("change", () => { filt.unit = g.value; renderTabs(); });
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.t; renderTabs(); }));
  ({ summary: renderSummary, stores: renderStores, visits: renderVisits, factories: renderFactories, events: renderEvents, users: renderUsers, log: renderLog, import: renderImport })[tab]();
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
  Object.entries(groupBy(db.stores, "unit")).forEach(([u, l]) => rows.push({ 項目: "百貨 A1 平面圖", 單位: u, 應辦: l.length, 已完成: l.filter(storeDone).length, 逾期: l.filter(storeOverdue).length }));
  Object.entries(groupBy(db.visits, "unit")).forEach(([u, l]) => {
    rows.push({ 項目: "高風險住戶訪視", 單位: u, 應辦: l.length, 已完成: l.filter(visitDone).length, 逾期: l.filter(visitOverdue).length });
    const miss = l.filter(alarmMissing);
    rows.push({ 項目: "住警器（未裝或故障）", 單位: u, 應辦: miss.length, 已完成: miss.filter(alarmFixed).length, 逾期: "" });
  });
  Object.entries(groupBy(db.events, "unit")).forEach(([u, l]) => {
    OPT.kind.forEach((k) => { const n = l.filter((e) => e.kind === k).length; if (n) rows.push({ 項目: k + "（場次）", 單位: u, 應辦: "", 已完成: n, 逾期: "" }); });
  });
  Object.entries(groupBy(db.factories, "unit")).forEach(([u, l]) => rows.push({ 項目: "廠住混合場所列管", 單位: u, 應辦: l.length, 已完成: l.filter((f) => f.status !== "列管中").length, 逾期: l.filter(factoryOverdue).length }));
  return rows.map((r) => ({ ...r, 完成率: r.應辦 === "" ? "" : pct(r.已完成, r.應辦) + "%" }));
}

function renderSummary() {
  const db = scoped();
  const s = db.stores, v = db.visits, miss = v.filter(alarmMissing);
  let cards = "";
  if (me.role !== "team") cards += statCard("百貨 A1 平面圖備齊", s.filter(storeDone).length, s.length);
  if (me.role !== "squadron") {
    cards += statCard("高風險住戶訪視完成", v.filter(visitDone).length, v.length, `｜第1階段 ${v.filter((x) => x.stage === "1" && visitDone(x)).length}/${v.filter((x) => x.stage === "1").length}`);
    cards += statCard("住警器未裝或故障，已處理", miss.filter(alarmFixed).length, miss.length);
    cards += `<div class="card stat"><div class="sub">廠住混合場所列管</div><div class="num">${db.factories.length}</div><div class="note">已改善 ${db.factories.filter((f) => f.status !== "列管中").length}</div></div>`;
  }
  if (me.role === "admin" && db.visits.some((v) => v.transfer_to)) cards += `<div class="card stat"><div class="sub">轉辦申請待核准</div><div class="num">${db.visits.filter((v) => v.transfer_to).length}</div><div class="note">到「訪視・住警器」篩選「轉辦申請中」處理</div></div>`;
  cards += `<div class="card stat"><div class="sub">演練・踏勘・宣導</div><div class="num">${db.events.length} 場</div><div class="note">${OPT.kind.map((k) => `${k} ${db.events.filter((e) => e.kind === k).length}`).join("　")}</div></div>`;
  const rows = summaryRows();
  $("#view").innerHTML = `<div class="grid">${cards}</div>
    ${deadlineBox()}
    <div class="tablewrap"><table><tr><th>項目</th><th>單位</th><th>應辦</th><th>已完成</th><th>完成率</th><th>逾期</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.項目)}</td><td>${esc(r.單位)}</td><td>${r.應辦}</td><td>${r.已完成}</td><td>${r.完成率}</td><td>${r.逾期 ? `<span class="tag bad">${r.逾期}</span>` : r.逾期 === 0 ? "0" : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="note">尚無資料</td></tr>`}
    </table></div>
    <p class="note">逾期＝今天已超過期限且尚未完成。完成定義：百貨＝1樓圖已備置，且地下街、停車場各為「已備置」或「不適用」；訪視＝已填訪視日期與住警器狀況（拒訪、不在家不算完成）；住警器＝未裝或故障者已協助安裝、轉介或住戶自行安裝。</p>`;
  const b = $("#dlSave");
  if (b) b.addEventListener("click", async () => {
    const dl = {};
    document.querySelectorAll("[data-dl]").forEach((el) => (dl[el.dataset.dl] = el.value));
    b.disabled = true;
    try { await api({ action: "settings_set", deadlines: dl }); await load(); } catch (e) { if (e.message !== "login") alert("儲存失敗：" + e.message); b.disabled = false; }
  });
}

function deadlineBox() {
  const dl = deadlines();
  if (me.role !== "admin") {
    const set = Object.keys(DL_LABEL).filter((k) => dl[k]);
    return set.length ? `<p class="note">期限：${set.map((k) => `${DL_LABEL[k]} ${dl[k]}`).join("　")}</p>` : "";
  }
  return `<div class="card"><h2>期限設定</h2><div class="form">${Object.entries(DL_LABEL).map(([k, n]) =>
    `<label>${n}<input type="date" data-dl="${k}" value="${esc(dl[k] || "")}"></label>`).join("")}<button id="dlSave">儲存期限</button></div></div>`;
}

const sel = (field, val, opts) => `<select data-f="${field}">${opts.map((o) => `<option ${o === (val || "") ? "selected" : ""}>${o}</option>`).join("")}</select>`;
const inp = (field, val, type = "text", w = "") => `<input data-f="${field}" type="${type}" value="${esc(val)}" ${w ? `style="width:${w}"` : ""}>`;

// 欄位變更立即存檔
const isMobile = () => window.matchMedia("(max-width: 760px)").matches;

function bindRows(table) {
  $("#view").querySelectorAll("[data-id]").forEach((tr) => {
    tr.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", async () => {
      const id = tr.dataset.id;
      const fields = { [el.dataset.f]: el.value };
      tr.classList.add("saving");
      try {
        await api({ action: "update", table, id, fields });
        const rec = db[table].find((x) => x.id === id);
        Object.assign(rec, fields, { updated_by: me.name + " " + me.person });
        tr.classList.remove("saving");
        $("#status").textContent = `已儲存 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
        const done = table === "visits" ? visitDone(rec) : table === "stores" ? storeDone(rec) : null;
        if (done !== null) { tr.classList.toggle("done", done); tr.classList.toggle("todo", !done); }
      } catch (e) {
        tr.classList.remove("saving");
        if (e.message !== "login") alert("儲存失敗：" + e.message);
      }
    }));
  });
}

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
  $("#view").innerHTML = `<div class="filters">${unitFilter(db.stores)}<span class="note">共 ${list.length} 家，已備齊 ${list.filter(storeDone).length} 家。每家至少 1 樓 1 張；沒有地下街或停車場的選「不適用」。</span></div>
  ${isMobile() ? list.map((s) => `<div class="mcard ${storeDone(s) ? "done" : "todo"}" data-id="${s.id}">
      <div class="mhead"><b>${s.id}</b> ${esc(s.unit)}${overdueTag(storeOverdue(s))}</div>
      <div>${esc(s.name)}</div><div class="note">${esc(s.address)}｜${esc(s.floors)}</div>
      <label>1樓 ${sel("plan_1f", s.plan_1f, OPT.plan)}</label><label>地下街 ${sel("plan_mall", s.plan_mall, OPT.plan)}</label><label>停車場 ${sel("plan_park", s.plan_park, OPT.plan)}</label>
      <label>備齊日期 ${inp("done_date", s.done_date, "date")}</label><label>備註 ${inp("note", s.note)}</label>
      <div class="mfoot">${photoBtn(s)}<span class="note">${esc(s.updated_by)} ${esc(s.updated_at)}</span></div></div>`).join("")
  : `<div class="tablewrap"><table><tr><th>序號</th><th>中隊</th><th>場所名稱</th><th>地址</th><th>營業樓層</th><th>1樓</th><th>地下街</th><th>停車場</th><th>備齊日期</th><th>備註</th><th>照片</th><th>最後更新</th></tr>
  ${list.map((s) => `<tr data-id="${s.id}" class="${storeDone(s) ? "done" : "todo"}"><td>${s.id}${overdueTag(storeOverdue(s))}</td><td>${esc(s.unit)}</td><td class="wrap">${esc(s.name)}</td><td class="wrap">${esc(s.address)}</td><td>${esc(s.floors)}</td>
    <td>${sel("plan_1f", s.plan_1f, OPT.plan)}</td><td>${sel("plan_mall", s.plan_mall, OPT.plan)}</td><td>${sel("plan_park", s.plan_park, OPT.plan)}</td>
    <td>${inp("done_date", s.done_date, "date")}</td><td>${inp("note", s.note, "text", "160px")}</td><td>${photoBtn(s)}</td><td class="note">${esc(s.updated_by)} ${esc(s.updated_at)}</td></tr>`).join("")}
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
    <span class="note">顯示 ${list.length} 筆。姓名、門牌已遮罩，請以「階段＋序號」對照局內完整名單。地址不屬於本分隊轄區時，按「轉辦」提出，由管理者核准。</span>
    ${pending ? `<span class="tag warn">轉辦申請中 ${pending} 筆</span>` : ""}</div>
  ${isMobile() ? list.map((v) => `<div class="mcard ${visitDone(v) ? "done" : "todo"}" data-id="${v.id}">
      <div class="mhead"><b>${v.stage}-${v.seq}</b> ${esc(v.name_m)}　<span class="note">${esc(v.type)}｜${esc(v.unit)}</span>${overdueTag(visitOverdue(v))}</div>
      <div class="note">${esc(v.addr_m)}｜${esc(v.li)}｜${esc(v.case_no)}</div>
      <label>訪視日期 ${inp("visit_date", v.visit_date, "date")}</label><label>住警器狀況 ${sel("alarm", v.alarm, OPT.alarm)}</label>
      <label>住警器處理 ${sel("alarm_installed", v.alarm_installed, OPT.installed)}</label><label>宣導 ${sel("outreach", v.outreach, OPT.yesno)}</label>
      <label>備註 ${inp("note", v.note)}</label>
      <div class="mfoot">${photoBtn(v)} ${transferCell(v)}<span class="note">${esc(v.updated_by)} ${esc(v.updated_at)}</span></div></div>`).join("")
  : `<div class="tablewrap"><table><tr><th>階段-序號</th><th>分隊</th><th>姓名</th><th>地址</th><th>里別</th><th>類型</th><th>案件</th><th>訪視日期</th><th>住警器狀況</th><th>住警器處理</th><th>宣導</th><th>備註</th><th>照片</th><th>最後更新</th><th>轉辦</th></tr>
  ${list.map((v) => `<tr data-id="${v.id}" class="${visitDone(v) ? "done" : "todo"}"><td>${v.stage}-${v.seq}${overdueTag(visitOverdue(v))}</td><td>${esc(v.unit)}</td><td>${esc(v.name_m)}</td><td>${esc(v.addr_m)}</td><td>${esc(v.li)}</td><td>${esc(v.type)}</td><td>${esc(v.case_no)}</td>
    <td>${inp("visit_date", v.visit_date, "date")}</td><td>${sel("alarm", v.alarm, OPT.alarm)}</td><td>${sel("alarm_installed", v.alarm_installed, OPT.installed)}</td><td>${sel("outreach", v.outreach, OPT.yesno)}</td>
    <td>${inp("note", v.note, "text", "160px")}</td><td>${photoBtn(v)}</td><td class="note">${esc(v.updated_by)} ${esc(v.updated_at)}</td><td>${transferCell(v)}</td></tr>`).join("")}
  </table></div>`}`;
  bindRows("visits"); bindFilters(); bindTransfers(); bindPhotos("visits");
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

function addForm(table, fields) {
  return `<div class="card"><h2>新增</h2><div class="form" id="addForm">${fields.join("")}<button id="addBtn">新增</button></div></div>`;
}

function bindAdd(table) {
  $("#addBtn").addEventListener("click", async () => {
    const fields = {};
    $("#addForm").querySelectorAll("[data-f]").forEach((el) => (fields[el.dataset.f] = el.value));
    $("#addBtn").disabled = true;
    try {
      await api({ action: "add", table, fields });
      await load();
    } catch (e) {
      if (e.message !== "login") alert("新增失敗：" + e.message);
    } finally {
      const b = $("#addBtn"); if (b) b.disabled = false;
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
  $("#view").innerHTML = addForm("factories", [unitPicker(),
    `<label>場所名稱<input data-f="name"></label>`, `<label>地址<input data-f="address"></label>`,
    `<label>火警自動警報<select data-f="fire_alarm">${OPT.equip.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>緊急廣播<select data-f="broadcast">${OPT.equip.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>住警器<select data-f="home_alarm">${OPT.equip.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>狀態<select data-f="status">${OPT.fstatus.map((o) => `<option>${o}</option>`)}</select></label>`,
    `<label>備註<input data-f="note"></label>`]) +
  `<div class="filters">${unitFilter(db.factories)}<span class="note">研究院路廠住混合區專案清查：建立清冊並列管，輔導設置火警自動警報、緊急廣播、住宅用火災警報器。</span></div>
  <div class="tablewrap"><table><tr><th>單位</th><th>場所名稱</th><th>地址</th><th>火警自動警報</th><th>緊急廣播</th><th>住警器</th><th>狀態</th><th>備註</th><th>最後更新</th><th></th></tr>
  ${list.map((f) => `<tr data-id="${f.id}"><td>${esc(f.unit)}${overdueTag(factoryOverdue(f))}</td><td>${inp("name", f.name)}</td><td>${inp("address", f.address)}</td>
    <td>${sel("fire_alarm", f.fire_alarm, OPT.equip)}</td><td>${sel("broadcast", f.broadcast, OPT.equip)}</td><td>${sel("home_alarm", f.home_alarm, OPT.equip)}</td>
    <td>${sel("status", f.status, OPT.fstatus)}</td><td>${inp("note", f.note, "text", "160px")}</td><td class="note">${esc(f.updated_by)} ${esc(f.updated_at)}</td>
    <td><button class="ghost" data-del="${f.id}">刪除</button></td></tr>`).join("") || `<tr><td colspan="10" class="note">尚未建立清冊</td></tr>`}
  </table></div>`;
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
  m.innerHTML = `<div class="mbox"><div class="mtop"><b>照片｜${esc(title)}</b><button class="ghost" id="mClose">關閉</button></div>
    <p class="note">照片可能拍到住戶家中，請只拍設備本身（住警器、平面圖），避免拍到人臉、證件和門牌。</p>
    <label class="upl">上傳照片 <input type="file" id="mFile" accept="image/*" multiple></label><span id="mMsg" class="note"></span>
    <div class="pgrid">${ids.map((f) => `<div class="pcell" data-file="${f}"><div class="note">載入中…</div><button class="ghost" data-pdel="${f}">刪除</button></div>`).join("") || `<p class="note">還沒有照片</p>`}</div></div>`;
  $("#mClose").addEventListener("click", closeModal);
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  $("#mFile").addEventListener("change", async (e) => {
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
async function renderLog() {
  $("#view").innerHTML = `<p class="note">載入中…</p>`;
  let r;
  try { r = await api({ action: "log" }); } catch (e) { $("#view").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const draw = () => {
    const q = logQuery.trim();
    const list = r.log.filter((x) => (!filt.unit || x.unit === filt.unit) && (!q || Object.values(x).join(" ").includes(q)));
    $("#logBody").innerHTML = list.slice(0, 500).map((x) => `<tr><td>${esc(x.time)}</td><td class="wrap">${esc(x.who)}</td><td>${esc(x.table)}</td><td>${esc(x.id)}</td><td>${esc(x.unit)}</td><td>${esc(x.field)}</td><td class="wrap">${esc(x.old)}</td><td class="wrap">${esc(x.new)}</td></tr>`).join("") || `<tr><td colspan="8" class="note">沒有紀錄</td></tr>`;
    $("#logCount").textContent = `共 ${list.length} 筆${list.length > 500 ? "（只顯示最新 500 筆）" : ""}`;
  };
  $("#view").innerHTML = `<div class="filters"><input id="logQ" placeholder="搜尋（序號、人名、欄位…）" value="${esc(logQuery)}"><span id="logCount" class="note"></span><span class="note">保留最新 1000 筆。</span></div>
    <div class="tablewrap"><table><thead><tr><th>時間</th><th>誰</th><th>資料表</th><th>編號</th><th>單位</th><th>欄位</th><th>原本</th><th>改成</th></tr></thead><tbody id="logBody"></tbody></table></div>`;
  $("#logQ").addEventListener("input", (e) => { logQuery = e.target.value; draw(); });
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
  const add = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name); };
  add("總覽", summaryRows());
  add("百貨A1平面圖", db.stores.map((s) => ({ 序號: s.id, 中隊: s.unit, 場所名稱: s.name, 地址: s.address, 營業樓層: s.floors, "1樓": s.plan_1f, 地下街: s.plan_mall, 停車場: s.plan_park, 備齊日期: s.done_date, 完成: storeDone(s) ? "是" : "否", 逾期: storeOverdue(s) ? "是" : "", 備註: s.note, 更新者: s.updated_by, 更新時間: s.updated_at })));
  add("訪視住警器", db.visits.map((v) => ({ 階段: v.stage, 序號: Number(v.seq), 分隊: v.unit, "姓名(遮罩)": v.name_m, "地址(遮罩)": v.addr_m, 里別: v.li, 類型: v.type, 關聯案件: v.case_no, 訪視日期: v.visit_date, 住警器狀況: v.alarm, 住警器處理: v.alarm_installed, 宣導: v.outreach, 完成: visitDone(v) ? "是" : "否", 逾期: visitOverdue(v) ? "是" : "", 備註: v.note, 更新者: v.updated_by, 更新時間: v.updated_at })));
  add("廠住混合清查", db.factories.map((f) => ({ 單位: f.unit, 場所名稱: f.name, 地址: f.address, 火警自動警報: f.fire_alarm, 緊急廣播: f.broadcast, 住警器: f.home_alarm, 狀態: f.status, 備註: f.note, 更新時間: f.updated_at })));
  add("演練踏勘宣導", db.events.map((e) => ({ 單位: e.unit, 類別: e.kind, 日期: e.date, 地點: e.place, 人數: e.people, 備註: e.note, 更新時間: e.updated_at })));
  const d = new Date();
  const stamp = `${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `火災傷亡精進作為管制_${filt.unit || me.name}_${stamp}.xlsx`);
}

// ---- 啟動 ----
let wasMobile = isMobile();
window.addEventListener("resize", () => { if (isMobile() !== wasMobile && db && !$("#modal")) { wasMobile = isMobile(); renderTabs(); } });
$("#regBtn").addEventListener("click", doRegister);
initGoogle(40);
$("#logout").addEventListener("click", () => logout(""));
$("#export").addEventListener("click", exportXlsx);
try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
if (token) load().catch(() => logout("")); else $("#login").hidden = false;
