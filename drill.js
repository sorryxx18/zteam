// ---- 犀牛辦業務：公安動態演練（自治條例第5條） ----
// 中隊的事（2026-10-15 使用者定）：只有中隊帳號、管理者看得到；各中隊填自己的場所，這裡自動彙整成二大的數字和月報。
// 第一階段：上半年大型空間（6 月底前）；第二階段：下半年避難弱者＋下半年大型空間（11 月底前）。停業、歇業的不算進應執行。
// 要排在 app.js 前面載入
let drill = null;          // 後端回來的 {rows, unit, canImport}
let drillOpen = null;      // 目前展開的名單 {unit, phase}
let drillView = "todo";    // 名單：todo＝還沒執行、all＝全部
let drillPending = null;   // 管理者匯入前的預覽
const DRILL_PHASES = [
  { key: "first", name: "第一階段", lists: ["first_large"], due: "06-30", dueText: "6 月底前" },
  { key: "second", name: "第二階段", lists: ["second_weak", "second_large"], due: "11-30", dueText: "11 月底前" },
];
const DRILL_LIST_NAME = { first_large: "上半年大型空間", second_weak: "下半年避難弱者", second_large: "下半年大型空間" };
const DRILL_STATUS = ["已執行", "辦理中(已函文建管)", "尚未辦理", "停業歇業"];
const DRILL_UNITS = ["大安中隊", "信義中隊", "南港中隊"];

// 預定演練時間的寫法各中隊不一樣（5/29 0900、115/05/21 09:00、115.05.22 09：30、開業前115.02.06）：抓出日期，過了還沒執行就提醒
function drillDate(s) {
  const t = String(s || ""), y = new Date().getFullYear();
  let m = t.match(/(1\d\d)[./年-](\d{1,2})[./月-](\d{1,2})/);
  if (m) return new Date(Number(m[1]) + 1911, m[2] - 1, m[3]);
  m = t.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?!\d)/);
  return m ? new Date(y, m[1] - 1, m[2]) : null;
}
// 名單上顯示的狀態：官方月報只有已執行／辦理中／尚未辦理三種，尚未辦理再分有沒有排日期
function drillState(r) {
  if (r.status === "停業歇業") return ["closed", "停業／歇業"];
  if (r.status === "已執行") return ["done", r._auto ? "已執行（依預定日）" : "已執行"];
  if (r.status === "辦理中(已函文建管)") return ["doing", "辦理中（已函文建管）"];
  const d = drillDate(r.planned);
  return d ? ["plan", "已排定"] : ["none", "未排定"];
}
// 預定日過了就算已執行，實際演練時間＝預定那天（2026-10-15 使用者定）。只算在畫面、比率和匯出，資料本身不改；要改成沒做，就到「更多」改預定日期
function drillEff(r) {
  if (r.status !== "尚未辦理") return r;
  const d = drillDate(r.planned);
  return d && d < new Date(new Date().toDateString()) ? { ...r, status: "已執行", actual: r.actual || r.planned, _auto: 1 } : r;
}
const drRows = () => drill.rows.map(drillEff);
function drillCount(rows) {
  const act = rows.filter((r) => r.status !== "停業歇業");
  const n = (s) => act.filter((r) => r.status === s).length;
  return { need: act.length, done: n("已執行"), doing: n("辦理中(已函文建管)"), todo: n("尚未辦理"), closed: rows.length - act.length };
}

function renderDrill() {
  if (!me || !(me.role === "admin" || me.role === "squadron")) {
    $("#view").innerHTML = `<div class="card empty"><p>公安動態演練是中隊的業務，要用中隊帳號登入才能看。</p><button id="drLogin">登入</button></div>`;
    $("#drLogin").addEventListener("click", () => { openBack = "biz"; logout(""); });
    return;
  }
  $("#view").innerHTML = `<div id="drBox"><p class="note">公安動態演練資料載入中…</p></div>`;
  $("#drBox").addEventListener("click", drillClick);
  $("#drBox").addEventListener("change", (x) => { if (x.target.id === "drFile") drillFile(x.target.files[0]); });
  loadDrill();
}
async function loadDrill() {
  try { drill = await api({ action: "drill_data" }); } catch (e) {
    if ($("#drBox")) $("#drBox").innerHTML = `<div class="card empty"><p class="err">公安動態演練資料讀不到：${esc(e.message)}</p><button id="drRetry">再試一次</button></div>`;
    return;
  }
  if (!drillOpen && drill.unit) drillOpen = { unit: drill.unit, phase: new Date().getMonth() >= 6 ? "second" : "first" };   // 中隊帳號一進來就看自己的名單
  drawDrill();
}

function drawDrill() {
  const box = $("#drBox"); if (!box || !drill) return;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0) + "%";
  const bar = (a, b) => `<div class="vbar"><i style="width:${b ? Math.min(100, (a / b) * 100) : 0}%"></i></div>`;
  const y = new Date().getFullYear();
  const phase = (p) => {
    const rows = drRows().filter((r) => p.lists.includes(r.list)), c = drillCount(rows);
    const left = Math.ceil((new Date(`${y}-${p.due}T23:59:59+08:00`) - Date.now()) / 86400000);
    return `<div class="card vsec drphase"><h2>${p.name}<span class="note">${p.lists.map((l) => DRILL_LIST_NAME[l]).join("＋")}｜${p.dueText}${left >= 0 ? `，還有 ${left} 天` : "，已截止"}</span></h2>
      <div class="vtop"><div class="vbig">${pct(c.done, c.need)}</div><div class="vtxt"><span>二大已執行 <b>${c.done}</b>／${c.need} 處${c.need - c.done ? `，還有 <b>${c.need - c.done}</b> 處` : "，全部完成 🎉"}</span>
        <span class="note">辦理中（已函文建管）${c.doing}｜尚未辦理 ${c.todo}${c.closed ? `｜停業、歇業 ${c.closed} 處不算` : ""}</span></div></div>${bar(c.done, c.need)}
      <div class="grid vunits">${DRILL_UNITS.map((u) => {
        const k = drillCount(rows.filter((r) => r.unit === u)), on = drillOpen && drillOpen.unit === u && drillOpen.phase === p.key, st = k.done === k.need ? "ok" : k.need - k.done <= 3 ? "near" : "far";
        return `<div class="card vunit ${st}${on ? " on" : ""}" data-dunit="${u}" data-dphase="${p.key}" role="button" tabindex="0" title="看${u}${p.name}名單">
          <div class="vname">${u.replace(/中隊$/, "")}${k.done === k.need ? `<span class="tag ok">完成</span>` : ""}</div><div class="vrate">${pct(k.done, k.need)}</div>${bar(k.done, k.need)}
          <div class="note">已執行 ${k.done}／${k.need}${k.need - k.done ? `｜<b class="vgap">還有 ${k.need - k.done} 處</b>` : ""}</div>
          <div class="vmore">${on ? "收起名單 ▴" : "看名單 ▸"}</div></div>`;
      }).join("")}</div>${drillOpen && drillOpen.phase === p.key ? `<div id="drList">${drillListHtml()}</div>` : ""}</div>`;
  };
  box.innerHTML = `<div class="card vsec"><h2>🚒 公安動態演練｜自治條例第 5 條<button class="ghost" id="drXlsx">匯出月報 Excel</button></h2>
    <p class="note">各中隊填自己的場所，這裡自動彙整二大的數字；預定日過了就算已執行（實際演練時間＝預定日）；匯出的 Excel 跟月報同格式（二大彙總＋三張名冊）。停業、歇業的場所不算進應執行。${drill.unit ? `你是${esc(drill.unit)}，只能改自己隊的場所。` : ""}</p></div>`
    + DRILL_PHASES.map(phase).join("") + drillImportBox();
}

// 民國日期：2026-11-05＋14:00 → 115/11/05 14:00；名單上的預定日期 → 日期欄的預設值
const drRoc = (d, t) => (d ? `${Number(d.slice(0, 4)) - 1911}/${d.slice(5, 7)}/${d.slice(8, 10)}${t ? " " + t : ""}` : "");
const drIso = (dt) => (dt ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}` : "");
const drToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
let drillAsk = null;      // 這一行正在問日期 {id, kind:"done"|"plan"}
let drillMore = "";       // 這一行打開「更多」
let drillPick = new Set(); // 批次勾選
let drillBatchOn = false; // 批次補登的日期清單打開
let drillUndo = null;     // 上一個動作，可以復原 {id, name, prev}
let drillMailOn = false;  // 「寄給承辦人」清單打開
let drillMailOff = new Set(); // 清單裡取消勾選的

// 排了預定日期、還沒通知承辦人發函的（預定時間改了也算，信裡標改期）；預定日已過的不用再發函
function drillMailRows(unit) {
  const today = new Date(new Date().toDateString());
  return drill.rows.filter((r) => r.unit === unit && r.status === "尚未辦理" && r.planned && r.planned !== r.notified && drillDate(r.planned) >= today)
    .sort((a, b) => drillDate(a.planned) - drillDate(b.planned));
}
function drillMailHtml(unit) {
  const rows = drillMailRows(unit);
  if (!rows.length) return "";
  if (!drillMailOn) return `<div class="drmail"><span>📮 已排日期、還沒通知承辦人發函：<b>${rows.length}</b> 家</span><button data-dmail="1">寄給承辦人</button></div>`;
  const n = rows.filter((r) => !drillMailOff.has(r.id)).length;
  return `<div class="card drbatchbox drmailbox"><b>寄給承辦人發函</b><p class="note">勾的場所合成一封信寄給承辦人，副本寄${esc(unit)}信箱。之前已經發過函的，取消勾選，或勾起來按「不用寄」。</p>
    ${rows.map((r) => `<label class="drbline"><span><input type="checkbox" data-dmpick="${esc(r.id)}"${drillMailOff.has(r.id) ? "" : " checked"}> ${esc(r.name)}</span><span class="note">${esc(r.planned)}${r.notified ? `（改期，原 ${esc(r.notified)}）` : ""}</span></label>`).join("")}
    <div class="drbtns"><button data-dmgo="send"${n ? "" : " disabled"}>寄出（${n} 家）</button><button class="ghost" data-dmgo="skip"${n ? "" : " disabled"}>勾的已發過函，不用寄</button><button class="ghost" data-dmno="1">取消</button></div></div>`;
}

function drillListHtml() {
  const { unit, phase } = drillOpen, p = DRILL_PHASES.find((x) => x.key === phase);
  const all = drRows().filter((r) => r.unit === unit && p.lists.includes(r.list))
    .sort((a, b) => p.lists.indexOf(a.list) - p.lists.indexOf(b.list) || (Number(a.seq) || 999) - (Number(b.seq) || 999));
  const todo = all.filter((r) => r.status !== "已執行" && r.status !== "停業歇業"), list = drillView === "all" ? all : todo;
  const mine = me.role === "admin" || drill.unit === unit, multi = p.lists.length > 1;
  const tab = (k, label) => `<button class="ghost chip${drillView === k ? " on" : ""}" data-dview="${k}">${label}</button>`;
  const picked = [...drillPick].filter((id) => todo.some((r) => r.id === id));
  const row = (r) => {
    const [cls, label] = drillState(r), open = r.status !== "已執行" && r.status !== "停業歇業";
    const ask = drillAsk && drillAsk.id === r.id ? drillAsk.kind : "";
    const btns = !mine ? "" : ask === "done" ? `<div class="drask">實際演練日期 <input type="date" data-dd="date" value="${drIso(drillDate(r.planned) && drillDate(r.planned) <= new Date() ? drillDate(r.planned) : null) || drToday()}" max="${drToday()}"><button data-dgo="done">確定已執行</button><button class="ghost" data-dno="1">取消</button></div>`
      : ask === "plan" ? `<div class="drask">預定 <input type="date" data-dd="date" value="${drIso(drillDate(r.planned))}"><input type="time" data-dd="time" value="${(String(r.planned).match(/(\d{1,2})[:：](\d{2})/) || [])[0]?.replace("：", ":").padStart(5, "0") || ""}"><button data-dgo="plan">排定</button><button class="ghost" data-dno="1">取消</button></div>`
      : `<div class="drbtnrow">${open ? `<button data-dact="done">✅ 已執行</button><button class="ghost" data-dact="plan">📅 排日期</button>${r.status !== "辦理中(已函文建管)" ? `<button class="ghost" data-dact="letter">📮 已函文建管</button>` : ""}` : ""}<button class="ghost" data-dact="more">${drillMore === r.id ? "收起 ▴" : "更多 ▾"}</button></div>`;
    return `<tr class="drrow" data-did="${esc(r.id)}">${mine ? `<td class="drck">${open ? `<input type="checkbox" data-dpick="${esc(r.id)}"${drillPick.has(r.id) ? " checked" : ""} aria-label="勾選${esc(r.name)}">` : ""}</td>` : ""}
      ${multi ? `<td>${DRILL_LIST_NAME[r.list].slice(3)}</td>` : ""}<td><b>${esc(r.name)}</b><div class="note">${esc(r.address)}</div>${btns}</td>
      <td>${r.planned ? `<span class="drk">預定 </span>${esc(r.planned)}${r.notified && r.notified === r.planned && r.status === "尚未辦理" ? `<div class="note">📮 已通知承辦人</div>` : ""}` : ""}</td><td>${r.actual ? `<span class="drk">實際 </span>${esc(r.actual)}` : ""}</td><td><span class="drst ${cls}">${label}</span></td><td>${esc([r.qualified, r.progress, r.note].filter(Boolean).join("｜"))}</td></tr>`
      + (drillMore === r.id ? `<tr class="dredit"><td colspan="${(mine ? 1 : 0) + (multi ? 6 : 5)}">${drillFormHtml(r)}</td></tr>` : "");
  };
  return `<div class="drlist"><h3>${esc(unit)}｜${p.name}名單<button class="ghost" data-dclose="1">收起來</button></h3>
    <div class="chips">${tab("todo", `還沒執行 ${todo.length} 處`)}${tab("all", `全部 ${all.length} 處`)}</div>
    ${drillUndo ? `<div class="drundo">已更新「${esc(drillUndo.name)}」<button class="ghost" data-dundo="1">復原</button></div>` : ""}
    ${mine ? drillMailHtml(unit) : ""}
    ${mine && todo.length ? `<div class="drbatch"><span class="note">${picked.length ? `已勾 ${picked.length} 家` : "要補登好幾家：勾左邊的框，再按批次已執行。"}</span>${picked.length ? `<button data-dbatch="1">批次已執行（${picked.length}）</button><button class="ghost" data-dclear="1">取消勾選</button>` : ""}</div>` : ""}
    ${drillBatchOn && picked.length ? drillBatchHtml(picked) : ""}
    ${list.length ? `<div class="tablewrap"><table class="vtable drtable"><tr>${mine ? "<th></th>" : ""}${multi ? "<th>名冊</th>" : ""}<th>場所</th><th>預定演練</th><th>實際演練</th><th>狀態</th><th>合格／成果／備註</th></tr>${list.map(row).join("")}</table></div>`
      : `<p class="note">這個階段的場所都執行完了 🎉</p>`}</div>`;
}

// 批次補登：每家各自一個日期，有預定日就先帶預定日，沒有就要自己選
function drillBatchHtml(ids) {
  const rows = ids.map((id) => drill.rows.find((r) => r.id === id)).filter(Boolean);
  return `<div class="card drbatchbox"><b>批次已執行：每家選實際演練日期</b>
    <div class="drask">全部同一天 <input type="date" id="drAll" max="${drToday()}"><button class="ghost" data-dsame="1">套用到每一家</button></div>
    ${rows.map((r) => { const d = drillDate(r.planned); return `<div class="drbline"><span>${esc(r.name)}</span><input type="date" data-dbid="${esc(r.id)}" max="${drToday()}" value="${d && d <= new Date() ? drIso(d) : ""}"></div>`; }).join("")}
    <div class="drbtns"><button data-dbgo="1">全部存成已執行</button><button class="ghost" data-dbno="1">取消</button><span class="note" id="drBMsg"></span></div></div>`;
}

function drillFormHtml(r) {
  const f = (k, label, ph) => `<label>${label}<input data-df="${k}" value="${esc(r[k])}" placeholder="${ph || ""}"></label>`;
  const mine = me.role === "admin" || drill.unit === r.unit;
  if (!mine) return `<p class="note">${esc([r.qualified && "是否合格：" + r.qualified, r.progress && "進度成果：" + r.progress, r.note && "備註：" + r.note].filter(Boolean).join("｜") || "沒有其他資料")}</p>`;
  return `<div class="drform">
    <label>辦理情形<select data-df="status">${DRILL_STATUS.map((s) => `<option${s === r.status ? " selected" : ""}>${s}</option>`).join("")}</select></label>
    ${f("planned", "預定演練時間", "例：115/11/05 14:00")}${f("actual", "實際演練時間", "")}${f("qualified", "是否合格", "例：合格")}
    ${f("progress", "進度成果", "例：有提報表、有紙本成果")}${f("note", "備註", "")}
    <div class="drbtns"><button data-dsave="${esc(r.id)}">儲存</button><button class="ghost" data-dcancel="1">取消</button>
    <span class="note">${r.updated_at ? `最後更新 ${esc(String(r.updated_at).slice(0, 16))}（${esc(r.updated_by)}）` : ""}</span></div></div>`;
}

const drRedraw = () => { if ($("#drList")) $("#drList").innerHTML = drillListHtml(); };
// 存一家：成功就換掉畫面上的資料、記下可以復原的舊值，再重畫（比率會跟著變）
async function drillSave(id, fields, btn) {
  const old = drill.rows.find((r) => r.id === id); if (!old) return;
  if (btn) { btn.disabled = true; btn.textContent = "儲存中…"; }
  try {
    const r = await api({ action: "drill_update", id, ...fields }), i = drill.rows.findIndex((x) => x.id === id);
    if (i >= 0 && r.row) drill.rows[i] = r.row;
    drillUndo = { id, name: old.name, prev: Object.fromEntries(["status", "planned", "actual", "qualified", "progress", "note"].map((k) => [k, old[k] || ""])) };
    drillAsk = null; drillMore = ""; drillPick.delete(id); drawDrill();
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = "再試一次"; } flash("儲存失敗：" + e.message); }
}

function drillImportBox() {
  if (!drill.canImport) return "";
  return `<details class="card vsec vup"${drillPending ? " open" : ""}><summary><h2>⬆️ 管理者：匯入名冊</h2></summary>
    <p class="note">選中隊填回來的「自治條例月報－動態（表1）」Excel。檔案裡有哪個中隊，就換掉那個中隊的名冊（含已填的進度）；其他中隊不動。辦理情形依檔案判斷：有實際演練時間或是否合格寫「○／已完成」算已執行，寫停業、歇業的不算。</p>
    <input type="file" id="drFile" accept=".xlsx,.xls"><div id="drPrev">${drillPending ? drillPrevHtml() : ""}</div></details>`;
}

async function drillFile(file) {
  if (!file) return;
  try {
    await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }), rows = [];
    const pick = (re) => wb.SheetNames.find((n) => re.test(n.replace(/\s/g, "")));
    [["first_large", /上半年大型/], ["second_weak", /避難弱者/], ["second_large", /下半年大型/]].forEach(([list, re]) => {
      const name = pick(re); if (!name) return;
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
      const h = (grid[0] || []).map((x) => String(x).replace(/\s/g, "")), col = (k) => h.indexOf(k);
      const s = (r, k) => (col(k) < 0 ? "" : String(r[col(k)] ?? "").replace(/\s+/g, " ").trim());
      grid.slice(1).forEach((r) => {
        const unit = s(r, "中隊名稱"), id = s(r, "場所編號");
        if (!DRILL_UNITS.includes(unit) || !/^\d+$/.test(id)) return;
        const o = { list, unit, seq: s(r, "項次"), site_id: id, name: s(r, "場所名稱"), address: s(r, "場所地址"), use: s(r, "場所用途"), area: s(r, "場所面積"), kind: s(r, "類別"),
          planned: s(r, "預定演練時間"), actual: s(r, "實際演練時間"), qualified: s(r, "是否合格"), progress: s(r, "進度成果") || s(r, "成果紙本"), note: s(r, "備註"), resp: s(r, "責任區") };
        const blob = [o.name, o.planned, o.actual, o.qualified, o.progress].join(" ");
        o.status = /停業|歇業/.test(blob) ? "停業歇業" : o.actual || /○|已完成|^合格/.test(o.qualified) ? "已執行" : "尚未辦理";
        rows.push(o);
      });
    });
    drillPending = { name: file.name, rows };
  } catch (e) { drillPending = { name: file.name, rows: [], err: e.message }; }
  drawDrill();
}
function drillPrevHtml() {
  const p = drillPending;
  if (!p.rows.length) return `<p class="err">${esc(p.name)} 讀不到名冊${p.err ? `（${esc(p.err)}）` : ""}：要有「上半年大型空間」「下半年避難弱者」「下半年大型空間」三張表，欄位有中隊名稱、場所編號。</p>`;
  const units = DRILL_UNITS.filter((u) => p.rows.some((r) => r.unit === u));
  return `<div class="vprev"><p>${esc(p.name)}：${units.map((u) => {
    const a = p.rows.filter((r) => r.unit === u), b = drill.rows.filter((r) => r.unit === u), ca = drillCount(a);
    return `<br>・${u}：${a.length} 處（現在 ${b.length} 處），已執行 ${ca.done}、尚未辦理 ${ca.todo}、停業歇業 ${ca.closed}`;
  }).join("")}</p><p class="note">確認後會換掉${units.join("、")}的名冊，網站上這幾隊已填的內容會被檔案取代。</p>
    <button id="drSend">確認匯入</button> <button class="ghost" data-dpcancel="1">取消</button></div>`;
}

async function drillClick(x) {
  const t = x.target;
  if (t.closest("#drRetry")) { loadDrill(); return; }
  if (t.closest("#drXlsx")) { drillXlsx(); return; }
  if (t.closest("[data-dpcancel]")) { drillPending = null; drawDrill(); return; }
  const send = t.closest("#drSend");
  if (send && drillPending) {
    send.disabled = true; send.textContent = "匯入中…";
    try { const r = await api({ action: "drill_import", rows: drillPending.rows }); flash(`已匯入 ${r.units.join("、")}：${r.count} 處`); drillPending = null; await loadDrill(); }
    catch (e) { send.disabled = false; send.textContent = "再試一次"; flash("匯入失敗：" + e.message); }
    return;
  }
  const tr = t.closest(".drrow"), id = tr && tr.dataset.did;
  const act = t.closest("[data-dact]");
  if (act && id) {
    const k = act.dataset.dact;
    if (k === "letter") { drillSave(id, { status: "辦理中(已函文建管)" }, act); return; }
    if (k === "more") { drillMore = drillMore === id ? "" : id; drillAsk = null; drRedraw(); return; }
    drillAsk = { id, kind: k }; drillMore = ""; drRedraw(); return;
  }
  if (t.closest("[data-dno]")) { drillAsk = null; drRedraw(); return; }
  const go = t.closest("[data-dgo]");
  if (go && id) {
    const d = tr.querySelector("[data-dd=date]").value, tm = (tr.querySelector("[data-dd=time]") || {}).value || "";
    if (!d) { flash("請先選日期"); return; }
    if (go.dataset.dgo === "done") drillSave(id, { status: "已執行", actual: drRoc(d) }, go);
    else drillSave(id, { status: "尚未辦理", planned: drRoc(d, tm) }, go);
    return;
  }
  if (t.closest("[data-dundo]") && drillUndo) {
    const u = drillUndo; drillUndo = null; await drillSave(u.id, u.prev, null); drillUndo = null; drRedraw(); flash("已復原"); return;
  }
  if (t.closest("[data-dmail]")) { drillMailOn = true; drillMailOff.clear(); drRedraw(); return; }
  if (t.closest("[data-dmno]")) { drillMailOn = false; drRedraw(); return; }
  const mp = t.closest("[data-dmpick]");
  if (mp) { if (mp.checked) drillMailOff.delete(mp.dataset.dmpick); else drillMailOff.add(mp.dataset.dmpick); drRedraw(); return; }
  const mgo = t.closest("[data-dmgo]");
  if (mgo) {
    const ids = drillMailRows(drillOpen.unit).filter((r) => !drillMailOff.has(r.id)).map((r) => r.id), skip = mgo.dataset.dmgo === "skip";
    if (!ids.length) return;
    if (skip && !confirm(`這 ${ids.length} 家記成「已通知」，不寄信？`)) return;
    mgo.disabled = true; mgo.textContent = skip ? "記錄中…" : "寄送中…";
    try {
      const r = await api({ action: "drill_notify", ids, mode: skip ? "skip" : "send" });
      r.rows.forEach((row) => { const i = drill.rows.findIndex((x) => x.id === row.id); if (i >= 0) drill.rows[i] = row; });
      drillMailOn = false; drillMailOff.clear(); drRedraw();
      flash(skip ? `已記錄 ${ids.length} 家不用寄` : `已寄給承辦人：${ids.length} 家`);
    } catch (e) { mgo.disabled = false; mgo.textContent = "再試一次"; flash((skip ? "記錄" : "寄送") + "失敗：" + e.message); }
    return;
  }
  const pick = t.closest("[data-dpick]");
  if (pick) { if (pick.checked) drillPick.add(pick.dataset.dpick); else drillPick.delete(pick.dataset.dpick); drRedraw(); return; }
  if (t.closest("[data-dclear]")) { drillPick.clear(); drillBatchOn = false; drRedraw(); return; }
  if (t.closest("[data-dbatch]")) { drillBatchOn = true; drRedraw(); return; }
  if (t.closest("[data-dbno]")) { drillBatchOn = false; drRedraw(); return; }
  if (t.closest("[data-dsame]")) { const v = $("#drAll").value; if (!v) { flash("先選日期"); return; } $("#drList").querySelectorAll("[data-dbid]").forEach((el) => { el.value = v; }); return; }
  const bgo = t.closest("[data-dbgo]");
  if (bgo) {
    const els = [...$("#drList").querySelectorAll("[data-dbid]")], miss = els.filter((el) => !el.value);
    if (miss.length) { $("#drBMsg").textContent = `還有 ${miss.length} 家沒選日期`; miss[0].focus(); return; }
    bgo.disabled = true; bgo.textContent = "儲存中…";
    try {
      const r = await api({ action: "drill_batch", items: els.map((el) => ({ id: el.dataset.dbid, status: "已執行", actual: drRoc(el.value) })) });
      r.rows.forEach((row) => { const i = drill.rows.findIndex((x) => x.id === row.id); if (i >= 0) drill.rows[i] = row; });
      drillPick.clear(); drillBatchOn = false; drillUndo = null; drawDrill();
      flash(`已存 ${r.rows.length} 家${r.errors.length ? `，${r.errors.length} 家失敗：${r.errors.join("；")}` : ""}`);
    } catch (e) { bgo.disabled = false; bgo.textContent = "再試一次"; flash("儲存失敗：" + e.message); }
    return;
  }
  const save = t.closest("[data-dsave]");
  if (save) {
    const f = {}; $("#drList").querySelectorAll("[data-df]").forEach((el) => { f[el.dataset.df] = el.value; });
    drillSave(save.dataset.dsave, f, save); return;
  }
  if (t.closest("[data-dcancel]")) { drillMore = ""; drRedraw(); return; }
  if (t.closest(".dredit, .drbatchbox, .drask, input, select")) return;
  if (t.closest("[data-dclose]")) { drillOpen = null; drillAsk = null; drillMore = ""; drawDrill(); return; }
  const vv = t.closest("[data-dview]");
  if (vv) { drillView = vv.dataset.dview; drillAsk = null; drillMore = ""; drRedraw(); return; }
  const card = t.closest("[data-dunit]");
  if (card) {
    const k = { unit: card.dataset.dunit, phase: card.dataset.dphase };
    drillOpen = drillOpen && drillOpen.unit === k.unit && drillOpen.phase === k.phase ? null : k;
    drillAsk = null; drillMore = ""; drillPick.clear(); drillBatchOn = false; drillUndo = null; drillMailOn = false; drawDrill();
    if (drillOpen && $("#drList")) $("#drList").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// 匯出月報：二大彙總（跟月報「二大」那張同樣的列）＋三張名冊
async function drillXlsx() {
  try { await loadXlsx(); } catch (e) { flash("Excel 元件載入失敗，請再按一次"); return; }
  const sum = [["公安動態演練(第5條)", "", ...DRILL_UNITS, "合計"]];
  DRILL_PHASES.forEach((p) => {
    const cs = DRILL_UNITS.map((u) => drillCount(drRows().filter((r) => r.unit === u && p.lists.includes(r.list))));
    const line = (label, k) => ["", label, ...cs.map((c) => c[k]), cs.reduce((s, c) => s + c[k], 0)];
    sum.push([`${p.name}(${p.dueText}應執行完成)`, ...line("應執行", "need").slice(1)], line("已執行", "done"), line("辦理中(已函文建管)", "doing"), line("尚未辦理", "todo"), line("停業歇業（不列入）", "closed"));
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "二大");
  const head = ["項次", "場所編號", "場所名稱", "場所地址", "場所用途", "場所面積", "中隊名稱", "類別", "預定演練時間", "實際演練時間", "是否合格", "進度成果", "備註", "責任區", "辦理情形"];
  Object.entries(DRILL_LIST_NAME).forEach(([list, name]) => {
    const rows = drRows().filter((r) => r.list === list).sort((a, b) => DRILL_UNITS.indexOf(a.unit) - DRILL_UNITS.indexOf(b.unit) || (Number(a.seq) || 999) - (Number(b.seq) || 999));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows.map((r) => [r.seq, r.site_id, r.name, r.address, r.use, r.area, r.unit, r.kind, r.planned, r.actual, r.qualified, r.progress, r.note, r.resp, r.status])]), name + "(第5條)");
  });
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replace(/-/g, "");
  XLSX.writeFile(wb, `公安動態演練_二大_${d}.xlsx`);
}
