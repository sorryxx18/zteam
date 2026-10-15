// ---- 犀牛辦業務：防火管理到場指導（2026-10-15） ----
// 分母＝防管清冊扣掉共同防火、免列管；分子＝今年安檢紀錄（防火管理）綜合意見有寫「到場」的場所，一年一次就算。
// 整頁要分隊、中隊帳號或管理者登入。應到場清冊（分母）平常固定，只有管理者能更新（防管清冊＋共同防火一起選）。資料在後端 visit_* 三張表。
let visit = null;          // 後端回來的 {units, snaps, until, sites?, canList, canUpload, canSites}
let visitUnit = "";        // 目前展開名單的分隊
let visitPending = null;   // 上傳前的預覽 {kind, rows, ...}
let visitView = "todo";    // 名單：todo＝尚未到場、all＝應到場清冊

// CSV：欄位裡可能有引號包起來的換行（安檢項目「防火管理\n」）
function csvParse(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, "").trim());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, k) => [h, (r[k] || "").trim()])));
}
// 安管系統匯出的是 Big5；存成 UTF-8 的也能讀
function csvDecode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("big5").decode(buf); }
}
// 認檔：有「綜合意見」＝安檢紀錄；有「管理項目」＝清冊。防管清冊和共同防火欄位一模一樣、檔名也不一定有「共同」，
// 所以兩個清冊一起選時，筆數少的當共同防火（共同防火是防管清冊裡的一小部分）
function visitKind(name, rows) {
  const h = rows[0] || {};
  if ("綜合意見" in h && "場所編號" in h) return "records";
  if ("管理項目" in h && "場所編號" in h) return "list";
  return "";
}
const visitRecRows = (rows) => rows.filter((r) => /^\d+$/.test(r["場所編號"]) && (!("安檢項目" in r) || /防火管理/.test(r["安檢項目"])))
  .map((r) => ({ id: r["場所編號"], date: r["檢查日期"], unit: r["分隊名稱"], result: r["檢查結果"], opinion: r["綜合意見"] }));

function visitSiteRows(roster, common) {
  const skip = new Set(common.map((r) => r["場所編號"]));
  return roster.filter((r) => /^\d+$/.test(r["場所編號"]) && r["分隊名稱"] && !skip.has(r["場所編號"]) && r["列管狀況"] !== "免列管")
    .map((r) => ({ id: r["場所編號"], name: r["場所名稱"], address: r["場所地址"], status: r["列管狀況"], unit: r["分隊名稱"], area: r["責任區"], use: r["用途名稱"], contact: r["聯絡人"], mobile: r["手機"] }));
}

const vShort = (u) => String(u || "").replace(/分隊$/, "");
const vDate = (d) => String(d || "").slice(5, 10);
const vRoc = (d) => (/^\d{4}\/\d{2}\/\d{2}/.test(d || "") ? `${Number(d.slice(0, 4)) - 1911}/${d.slice(5, 10)}` : "");   // 2026/06/12 → 115/06/12
function visitCalc() {
  const goal = visit.goal || 0.5;
  const prev = visit.snaps.length > 1 ? Object.fromEntries(visit.snaps[visit.snaps.length - 2].data.map(([u, , a]) => [u, a])) : null;
  const units = visit.units.filter((u) => u.unit).map((u) => {
    const need = Math.ceil(goal * u.total), gap = Math.max(0, need - u.arrived), rate = u.total ? u.arrived / u.total : 0;
    return { ...u, need, gap, rate, delta: prev && u.unit in prev ? u.arrived - prev[u.unit] : null, st: gap === 0 ? "ok" : gap <= 10 ? "near" : "far" };
  }).sort((a, b) => b.gap - a.gap || a.rate - b.rate);
  const T = units.reduce((s, u) => s + u.total, 0), A = units.reduce((s, u) => s + u.arrived, 0);
  const end = new Date(`${visit.year}-12-31T23:59:59+08:00`), days = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  const unitGap = units.reduce((s, u) => s + u.gap, 0);
  return { goal, units, T, A, rate: T ? A / T : 0, gap: Math.max(0, Math.ceil(goal * T) - A), unitGap, days, pace: Math.ceil(unitGap / Math.max(1, days / 7)) };
}

function renderBiz() {
  if (!me || !["admin", "squadron", "team"].includes(me.role)) {   // 整頁要登入（分隊、中隊共用帳號或管理者）
    $("#view").innerHTML = `<div class="card empty"><p>犀牛辦業務是內部業務資料，要用分隊、中隊共用帳號登入才能看。</p><button id="bizLogin">登入</button></div>`;
    $("#bizLogin").addEventListener("click", () => { openBack = "biz"; logout(""); });
    return;
  }
  $("#view").innerHTML = `<div id="vBox"><p class="note">到場指導資料載入中…</p></div>`;
  $("#vBox").addEventListener("click", visitClick);
  $("#vBox").addEventListener("change", (x) => { if (x.target.id === "vFile") visitFiles(x.target.files); });
  loadVisit();
}
async function loadVisit() {
  try { visit = await api({ action: "visit_data" }); } catch (e) {
    if ($("#vBox")) $("#vBox").innerHTML = `<div class="card empty"><p class="err">到場指導資料讀不到：${esc(e.message)}</p><button id="vRetry">再試一次</button></div>`;
    return;
  }
  drawVisit();
}

function drawVisit() {
  const box = $("#vBox"); if (!box || !visit) return;
  const c = visit.units.length ? visitCalc() : null;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const bar = (rate, goal) => `<div class="vbar"><i style="width:${Math.min(100, rate * 100)}%"></i><b style="left:${goal * 100}%" title="目標 ${goal * 100}%"></b></div>`;
  const head = `<div class="card vsec"><h2>🏢 防火管理到場指導｜${visit.year - 1911} 年</h2>
    <p class="note">目標：年底前各分隊到場比率達 ${(c ? c.goal : 0.5) * 100}%。分母是防管清冊扣掉共同防火、免列管；安檢紀錄的綜合意見有寫「到場」才算，一年一次就算。${visit.until ? `資料到 ${visit.until.slice(0, 10)}。` : ""}</p>`;
  if (!c) { box.innerHTML = head + `<p class="note">還沒有資料。</p></div>` + visitUploadBox(); return; }
  box.innerHTML = head + `<div class="vtop"><div class="vbig">${pct(c.rate)}</div><div class="vtxt">
      <span>大隊已到場 <b>${c.A.toLocaleString()}</b>／${c.T.toLocaleString()} 處${c.gap ? `，還差 <b>${c.gap}</b> 處達 ${c.goal * 100}%` : "，已達標"}</span>
      <span class="note">${c.unitGap ? `未達標分隊合計還差 ${c.unitGap} 處｜距年底 ${c.days} 天，每週要到場約 ${c.pace} 處` : "各分隊都達標了 🎉"}</span></div></div>
    ${bar(c.rate, c.goal)}</div>
    <div class="grid vunits">${c.units.map((u) => `<div class="card vunit ${u.st}${visitUnit === u.unit ? " on" : ""}" data-vunit="${esc(u.unit)}"${visit.canList ? ` role="button" tabindex="0" title="看${esc(u.unit)}名單"` : ""}>
      <div class="vname">${esc(vShort(u.unit))}${u.st === "ok" ? `<span class="tag ok">達標</span>` : ""}</div>
      <div class="vrate">${pct(u.rate)}</div>${bar(u.rate, c.goal)}
      <div class="note">已到 ${u.arrived}／應到 ${u.total}${u.gap ? `｜<b class="vgap">還差 ${u.gap} 處</b>` : ""}</div>
      ${u.delta != null ? `<div class="note">比上次 ${u.delta > 0 ? "+" + u.delta : u.delta === 0 ? "持平" : u.delta}</div>` : ""}
      ${visit.canList ? `<div class="vmore">${visitUnit === u.unit ? "收起名單 ▴" : "看名單 ▸"}</div>` : ""}
</div>`).join("")}</div>
    ${visit.canList ? `<div id="vList">${visitUnit ? visitListHtml(visitUnit) : ""}</div>` : ""}`
    + visitUploadBox();
}

function visitListHtml(unit) {
  const all = (visit.sites || []).filter((s) => s.unit === unit).sort((a, b) => (a.area > b.area ? 1 : a.area < b.area ? -1 : a.name > b.name ? 1 : -1));
  const todo = all.filter((s) => !s.n), list = visitView === "all" ? all : todo;
  const tab = (k, label) => `<button class="ghost chip${visitView === k ? " on" : ""}" data-vview="${k}">${label}</button>`;
  return `<div class="card vsec"><h2>${esc(unit)}<button class="ghost" data-vcsv="${esc(unit)}">匯出 Excel</button><button class="ghost" data-vclose="1">收起來</button></h2>
    <div class="chips">${tab("todo", `尚未到場 ${todo.length} 處`)}${tab("all", `應到場清冊 ${all.length} 處`)}</div>
    <div class="tablewrap"><table class="vtable"><tr><th>責任區</th><th>場所</th><th>地址</th><th>用途</th><th>列管</th><th>聯絡人</th><th>手機</th>${visitView === "all" ? "<th>到場</th><th>最近到場</th>" : ""}</tr>
    ${list.map((s) => `<tr><td>${esc(s.area)}</td><td>${esc(s.name)}</td><td>${esc(s.address)}</td><td>${esc(s.use)}</td><td>${esc(s.status)}</td><td>${esc(s.contact)}</td><td>${esc(s.mobile)}</td>${visitView === "all" ? `<td>${s.n ? "✅ 已到場" : "未到場"}</td><td>${vRoc(s.last)}</td>` : ""}</tr>`).join("")}</table></div></div>`;
}

function visitUploadBox() {
  if (!visit.canUpload) return "";
  return `<details class="card vsec vup"${visitPending ? " open" : ""}><summary><h2>⬆️ 上傳新的檢查紀錄</h2></summary>
    <p class="note">從安管系統匯出「防火管理」檢查紀錄 CSV，整年度或只有這個月都可以；同一筆重複上傳不會重複算。只算應到場清冊裡的場所。${visit.canSites ? "<br>管理者：要更新應到場清冊（分母），請同時選「防管清冊」和「共同防火」兩個檔，筆數少的自動當共同防火，預覽會寫出哪個檔當哪個。" : ""}</p>
    <input type="file" id="vFile" accept=".csv,text/csv" multiple><div id="vPrev">${visitPending ? visitPrevHtml() : ""}</div></details>`;
}

async function visitFiles(files) {
  let rows = null; const lists = [];
  for (const f of files) {
    const r = csvParse(csvDecode(await f.arrayBuffer())), k = visitKind(f.name, r);
    if (k === "records") rows = (rows || []).concat(visitRecRows(r)); else if (k === "list") lists.push({ name: f.name, rows: r });
  }
  if (!rows && lists.length && visit.canSites) {   // 管理者更新分母
    lists.sort((a, b) => b.rows.length - a.rows.length);
    const sites = visitSiteRows(lists[0].rows, lists[1] ? lists[1].rows : []), by = {}, now = {};
    sites.forEach((r) => { by[r.unit] = (by[r.unit] || 0) + 1; });
    visit.units.forEach((u) => { now[u.unit] = u.total; });
    visitPending = { kind: "sites", rows: sites, by, now, names: [lists[0].name, lists[0].rows.length, lists[1] && lists[1].name, lists[1] ? lists[1].rows.length : 0] };
    drawVisit(); return;
  }
  if (!rows) { visitPending = { kind: lists.length ? "list" : "bad" }; drawVisit(); return; }
  const siteOf = Object.fromEntries((visit.sites || []).map((s) => [s.id, s]));
  const newIds = new Set(rows.filter((r) => /到場/.test(r.opinion) && siteOf[r.id] && !siteOf[r.id].n && r.date.slice(0, 4) === String(visit.year)).map((r) => r.id));
  const by = {}; newIds.forEach((id) => { const u = siteOf[id].unit; by[u] = (by[u] || 0) + 1; });
  visitPending = { kind: "records", rows, arrive: rows.filter((r) => /到場/.test(r.opinion)).length, newN: newIds.size, by,
    range: rows.length ? [rows.reduce((m, r) => (r.date < m ? r.date : m), "9"), rows.reduce((m, r) => (r.date > m ? r.date : m), "")] : null };
  drawVisit();
}
function visitPrevHtml() {
  const p = visitPending;
  if (p.kind === "list") return `<p class="err">這是清冊，不是檢查紀錄。應到場清冊（分母）只有管理者能更新；請上傳防火管理檢查紀錄。</p>`;
  if (p.kind === "sites") {
    const [rn, rc, cn, cc] = p.names, T = p.rows.length, T0 = Object.values(p.now).reduce((a, b) => a + b, 0);
    return `<div class="vprev"><p>防管清冊：${esc(rn)}（${rc} 筆）<br>共同防火：${cn ? `${esc(cn)}（${cc} 筆）` : "⚠️ 沒選，沒扣到共同防火"}</p>
      <p>新的應到場清冊 <b>${T}</b> 處（現在 ${T0} 處，${T - T0 >= 0 ? "+" : ""}${T - T0}）：${Object.entries(p.by).map(([u, n]) => `${vShort(u)} ${n}${p.now[u] != null && p.now[u] !== n ? `（原 ${p.now[u]}）` : ""}`).join("、")}</p>
      <p class="note">會整份換掉目前的分母，聯絡人、手機也一起更新；已上傳的檢查紀錄不受影響。</p><button id="vSend">確認更新清冊</button> <button class="ghost" data-vcancel="1">取消</button></div>`;
  }
  if (p.kind === "bad") return `<p class="err">看不懂這個檔：請選安管系統匯出的防火管理檢查紀錄（要有「綜合意見」欄）。</p>`;
  return `<div class="vprev"><p>防火管理檢查紀錄 <b>${p.rows.length}</b> 筆${p.range ? `（${p.range[0].slice(0, 10)}～${p.range[1].slice(0, 10)}）` : ""}，其中寫了「到場」的 ${p.arrive} 筆。</p>
    <p>上傳後新增到場：<b>${p.newN}</b> 處${p.newN ? "：" + Object.entries(p.by).map(([u, n]) => `${vShort(u)} +${n}`).join("、") : "（都已經算過了）"}</p>
    <button id="vSend">確認上傳</button> <button class="ghost" data-vcancel="1">取消</button></div>`;
}

async function visitClick(x) {
  if (x.target.closest("#vRetry")) { loadVisit(); return; }
  if (x.target.closest("[data-vcancel]")) { visitPending = null; drawVisit(); return; }
  const csv = x.target.closest("[data-vcsv]");
  if (csv) { visitCsv(csv.dataset.vcsv); return; }
  if (x.target.closest("[data-vclose]")) { visitUnit = ""; drawVisit(); return; }
  const vv = x.target.closest("[data-vview]");
  if (vv) { visitView = vv.dataset.vview; if ($("#vList")) $("#vList").innerHTML = visitListHtml(visitUnit); return; }
  const send = x.target.closest("#vSend");
  if (send && visitPending) {
    send.disabled = true; send.textContent = "上傳中…";
    try {
      const r = await api({ action: "visit_upload", kind: visitPending.kind, rows: visitPending.rows });
      flash(visitPending.kind === "sites" ? `應到場清冊已更新：${r.sites} 處` : `已上傳：新增 ${r.added} 筆紀錄`);
      visitPending = null; await loadVisit();
    } catch (e) { send.disabled = false; send.textContent = "再試一次"; flash("上傳失敗：" + e.message); }
    return;
  }
  const card = x.target.closest("[data-vunit]");
  if (card && visit.canList) { visitUnit = visitUnit === card.dataset.vunit ? "" : card.dataset.vunit; drawVisit(); if (visitUnit && $("#vList")) $("#vList").scrollIntoView({ behavior: "smooth", block: "start" }); }
}


function visitCsv(unit) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["分隊", "責任區", "場所編號", "場所名稱", "地址", "用途", "列管狀況", "聯絡人", "手機", "到場", "最近到場", "備註"]]   // 備註留白給分隊填（預計到場日、歇業、已到場未登錄…）
    .concat(visit.sites.filter((s) => s.unit === unit && (visitView === "all" || !s.n)).sort((a, b) => (a.n ? 1 : 0) - (b.n ? 1 : 0) || (a.area > b.area ? 1 : -1))
      .map((s) => [s.unit, s.area, s.id, s.name, s.address, s.use, s.status, s.contact, s.mobile ? `="${s.mobile}"` : "", s.n ? "已到場" : "未到場", vRoc(s.last), ""]));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }));
  a.download = `到場指導_${visitView === "all" ? "應到場清冊" : "尚未到場"}_${unit}_${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replace(/-/g, "")}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}
