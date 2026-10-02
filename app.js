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

async function api(payload) {
  const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ ...payload, token }) });
  const data = await res.json();
  if (!data.ok && data.error === "login required") { logout("登入逾時，請重新登入。"); throw new Error("login"); }
  if (!data.ok) throw new Error(data.error || "error");
  return data;
}

// ---- 登入 ----
async function doLogin() {
  $("#loginErr").textContent = "";
  $("#loginBtn").disabled = true;
  try {
    const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "login", name: $("#acct").value, password: $("#pw").value }) }).then((x) => x.json());
    if (!r.ok) { $("#loginErr").textContent = r.error; return; }
    token = r.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    $("#pw").value = "";
    await load();
  } catch (e) {
    $("#loginErr").textContent = "連線失敗，請稍後再試。";
  } finally {
    $("#loginBtn").disabled = false;
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
  $("#whoName").textContent = me.name;
  $("#status").textContent = `更新時間 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
  renderTabs();
}

// ---- 判斷完成 ----
const storeDone = (s) => s.plan_1f === "已備置" && ["已備置", "不適用"].includes(s.plan_mall) && ["已備置", "不適用"].includes(s.plan_park);
const visitDone = (v) => !!v.visit_date && !!v.alarm && !["拒訪", "不在家"].includes(v.alarm);
const alarmMissing = (v) => v.alarm === "未裝" || v.alarm === "有裝・故障";
const alarmFixed = (v) => alarmMissing(v) && ["已協助安裝", "已轉介申請", "住戶自行安裝"].includes(v.alarm_installed);

function tabsFor(role) {
  const t = [["summary", "總覽"]];
  if (role !== "team") t.push(["stores", "百貨 A1 平面圖"]);
  if (role !== "squadron") t.push(["visits", "訪視・住警器"], ["factories", "廠住混合清查"]);
  t.push(["events", "演練・踏勘・宣導"]);
  return t;
}

function renderTabs() {
  const t = tabsFor(me.role);
  if (!tab || !t.some(([k]) => k === tab)) tab = t[0][0];
  $("#tabs").innerHTML = t.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("");
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.t; renderTabs(); }));
  ({ summary: renderSummary, stores: renderStores, visits: renderVisits, factories: renderFactories, events: renderEvents })[tab]();
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
  const rows = [];
  Object.entries(groupBy(db.stores, "unit")).forEach(([u, l]) => rows.push({ 項目: "百貨 A1 平面圖", 單位: u, 應辦: l.length, 已完成: l.filter(storeDone).length }));
  Object.entries(groupBy(db.visits, "unit")).forEach(([u, l]) => {
    rows.push({ 項目: "高風險住戶訪視", 單位: u, 應辦: l.length, 已完成: l.filter(visitDone).length });
    const miss = l.filter(alarmMissing);
    rows.push({ 項目: "住警器（未裝或故障）", 單位: u, 應辦: miss.length, 已完成: miss.filter(alarmFixed).length });
  });
  Object.entries(groupBy(db.events, "unit")).forEach(([u, l]) => {
    OPT.kind.forEach((k) => { const n = l.filter((e) => e.kind === k).length; if (n) rows.push({ 項目: k + "（場次）", 單位: u, 應辦: "", 已完成: n }); });
  });
  Object.entries(groupBy(db.factories, "unit")).forEach(([u, l]) => rows.push({ 項目: "廠住混合場所列管", 單位: u, 應辦: l.length, 已完成: l.filter((f) => f.status !== "列管中").length }));
  return rows.map((r) => ({ ...r, 完成率: r.應辦 === "" ? "" : pct(r.已完成, r.應辦) + "%" }));
}

function renderSummary() {
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
    <div class="tablewrap"><table><tr><th>項目</th><th>單位</th><th>應辦</th><th>已完成</th><th>完成率</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.項目)}</td><td>${esc(r.單位)}</td><td>${r.應辦}</td><td>${r.已完成}</td><td>${r.完成率}</td></tr>`).join("") || `<tr><td colspan="5" class="note">尚無資料</td></tr>`}
    </table></div>
    <p class="note">完成定義：百貨＝1樓圖已備置，且地下街、停車場各為「已備置」或「不適用」；訪視＝已填訪視日期與住警器狀況（拒訪、不在家不算完成）；住警器＝未裝或故障者已協助安裝、轉介或住戶自行安裝。</p>`;
}

const sel = (field, val, opts) => `<select data-f="${field}">${opts.map((o) => `<option ${o === (val || "") ? "selected" : ""}>${o}</option>`).join("")}</select>`;
const inp = (field, val, type = "text", w = "") => `<input data-f="${field}" type="${type}" value="${esc(val)}" ${w ? `style="width:${w}"` : ""}>`;

// 欄位變更立即存檔
function bindRows(table) {
  $("#view").querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", async () => {
      const id = tr.dataset.id;
      const fields = { [el.dataset.f]: el.value };
      tr.classList.add("saving");
      try {
        await api({ action: "update", table, id, fields });
        const rec = db[table].find((x) => x.id === id);
        Object.assign(rec, fields, { updated_by: me.name });
        tr.classList.remove("saving");
        $("#status").textContent = `已儲存 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
        if (table === "visits") tr.className = visitDone(rec) ? "done" : "todo";
        if (table === "stores") tr.className = storeDone(rec) ? "done" : "todo";
      } catch (e) {
        tr.classList.remove("saving");
        if (e.message !== "login") alert("儲存失敗：" + e.message);
      }
    }));
  });
}

function unitFilter(list) {
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
  <div class="tablewrap"><table><tr><th>序號</th><th>中隊</th><th>場所名稱</th><th>地址</th><th>營業樓層</th><th>1樓</th><th>地下街</th><th>停車場</th><th>備齊日期</th><th>備註</th><th>最後更新</th></tr>
  ${list.map((s) => `<tr data-id="${s.id}" class="${storeDone(s) ? "done" : "todo"}"><td>${s.id}</td><td>${esc(s.unit)}</td><td class="wrap">${esc(s.name)}</td><td class="wrap">${esc(s.address)}</td><td>${esc(s.floors)}</td>
    <td>${sel("plan_1f", s.plan_1f, OPT.plan)}</td><td>${sel("plan_mall", s.plan_mall, OPT.plan)}</td><td>${sel("plan_park", s.plan_park, OPT.plan)}</td>
    <td>${inp("done_date", s.done_date, "date")}</td><td>${inp("note", s.note, "text", "160px")}</td><td class="note">${esc(s.updated_by)} ${esc(s.updated_at)}</td></tr>`).join("")}
  </table></div>`;
  bindRows("stores"); bindFilters();
}

function renderVisits() {
  const lis = [...new Set(db.visits.map((v) => v.li))];
  const list = db.visits.filter((v) => (!filt.unit || v.unit === filt.unit) && (!filt.stage || v.stage === filt.stage) && (!filt.li || v.li === filt.li)
    && (!filt.state || (filt.state === "todo" ? !visitDone(v) : filt.state === "done" ? visitDone(v) : filt.state === "transfer" ? !!v.transfer_to : alarmMissing(v) && !alarmFixed(v))));
  const pending = db.visits.filter((v) => v.transfer_to).length;
  $("#view").innerHTML = `<div class="filters">${unitFilter(db.visits)}
    <select id="fStage"><option value="">全部階段</option><option value="1" ${filt.stage === "1" ? "selected" : ""}>第1階段</option><option value="2" ${filt.stage === "2" ? "selected" : ""}>第2階段</option></select>
    <select id="fLi"><option value="">全部里別</option>${lis.map((l) => `<option ${l === filt.li ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select id="fState"><option value="">全部狀態</option><option value="todo" ${filt.state === "todo" ? "selected" : ""}>未完成</option><option value="done" ${filt.state === "done" ? "selected" : ""}>已完成</option><option value="alarm" ${filt.state === "alarm" ? "selected" : ""}>住警器待處理</option><option value="transfer" ${filt.state === "transfer" ? "selected" : ""}>轉辦申請中</option></select>
    <span class="note">顯示 ${list.length} 筆。姓名、門牌已遮罩，請以「階段＋序號」對照局內完整名單。地址不屬於本分隊轄區時，按「轉辦」提出，由管理者核准。</span>
    ${pending ? `<span class="tag warn">轉辦申請中 ${pending} 筆</span>` : ""}</div>
  <div class="tablewrap"><table><tr><th>階段-序號</th><th>分隊</th><th>姓名</th><th>地址</th><th>里別</th><th>類型</th><th>案件</th><th>訪視日期</th><th>住警器狀況</th><th>住警器處理</th><th>宣導</th><th>備註</th><th>最後更新</th><th>轉辦</th></tr>
  ${list.map((v) => `<tr data-id="${v.id}" class="${visitDone(v) ? "done" : "todo"}"><td>${v.stage}-${v.seq}</td><td>${esc(v.unit)}</td><td>${esc(v.name_m)}</td><td>${esc(v.addr_m)}</td><td>${esc(v.li)}</td><td>${esc(v.type)}</td><td>${esc(v.case_no)}</td>
    <td>${inp("visit_date", v.visit_date, "date")}</td><td>${sel("alarm", v.alarm, OPT.alarm)}</td><td>${sel("alarm_installed", v.alarm_installed, OPT.installed)}</td><td>${sel("outreach", v.outreach, OPT.yesno)}</td>
    <td>${inp("note", v.note, "text", "160px")}</td><td class="note">${esc(v.updated_by)} ${esc(v.updated_at)}</td><td>${transferCell(v)}</td></tr>`).join("")}
  </table></div>`;
  bindRows("visits"); bindFilters(); bindTransfers();
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
  ${list.map((f) => `<tr data-id="${f.id}"><td>${esc(f.unit)}</td><td>${inp("name", f.name)}</td><td>${inp("address", f.address)}</td>
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

// ---- 匯出 Excel ----
function exportXlsx() {
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name); };
  add("總覽", summaryRows());
  add("百貨A1平面圖", db.stores.map((s) => ({ 序號: s.id, 中隊: s.unit, 場所名稱: s.name, 地址: s.address, 營業樓層: s.floors, "1樓": s.plan_1f, 地下街: s.plan_mall, 停車場: s.plan_park, 備齊日期: s.done_date, 完成: storeDone(s) ? "是" : "否", 備註: s.note, 更新者: s.updated_by, 更新時間: s.updated_at })));
  add("訪視住警器", db.visits.map((v) => ({ 階段: v.stage, 序號: Number(v.seq), 分隊: v.unit, "姓名(遮罩)": v.name_m, "地址(遮罩)": v.addr_m, 里別: v.li, 類型: v.type, 關聯案件: v.case_no, 訪視日期: v.visit_date, 住警器狀況: v.alarm, 住警器處理: v.alarm_installed, 宣導: v.outreach, 完成: visitDone(v) ? "是" : "否", 備註: v.note, 更新者: v.updated_by, 更新時間: v.updated_at })));
  add("廠住混合清查", db.factories.map((f) => ({ 單位: f.unit, 場所名稱: f.name, 地址: f.address, 火警自動警報: f.fire_alarm, 緊急廣播: f.broadcast, 住警器: f.home_alarm, 狀態: f.status, 備註: f.note, 更新時間: f.updated_at })));
  add("演練踏勘宣導", db.events.map((e) => ({ 單位: e.unit, 類別: e.kind, 日期: e.date, 地點: e.place, 人數: e.people, 備註: e.note, 更新時間: e.updated_at })));
  const d = new Date();
  const stamp = `${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `火災傷亡精進作為管制_${me.name}_${stamp}.xlsx`);
}

// ---- 啟動 ----
$("#loginBtn").addEventListener("click", doLogin);
$("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("#logout").addEventListener("click", () => logout(""));
$("#export").addEventListener("click", exportXlsx);
try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
if (token) load().catch(() => logout("")); else $("#login").hidden = false;
