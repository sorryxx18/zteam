// ---- 犀牛辦業務：自治條例月報 ----
let ordinance = null, ordinanceImportPending = null;
const ORDINANCE_UNITS = ["大安中隊", "信義中隊", "南港中隊"];
const ORDINANCE_SHEETS = {
  "上半年大型空間_三隊整合": "first_large",
  "下半年避難弱者_三隊整合": "second_vulnerable",
  "下半年大型空間_三隊整合": "second_large"
};
const ORDINANCE_CAT_LABELS = {
  first_large: "第5條第一階段｜上半年大型空間",
  second_vulnerable: "第5條第二階段｜下半年避難弱者場所",
  second_large: "第5條第二階段｜下半年大型空間"
};
const ORDINANCE_STATES = ["尚未回報", "未辦理", "辦理中", "已完成"];
const ORDINANCE_ARTICLES = [
  ["art6", "第6條自衛消防編組應變能力驗證"], ["art8", "第8條歌舞廳場所燈光音響查核"],
  ["art12", "第12條身障機構閃滅音響裝置查核"], ["art15", "第15條定期維護保養查核"]
];
const ordinalPeriodLabel = (p) => { const m = /^(\d{4})-(\d{2})$/.exec(p || ""); return m ? `${Number(m[1]) - 1911}年${Number(m[2])}月` : p; };

function renderOrdinance() {
  if (!me || !["admin", "squadron"].includes(me.role)) {
    $("#view").innerHTML = `<div class="card empty"><p>自治條例填報限管理者或中隊帳號登入。</p><button id="ordLogin">登入</button></div>`;
    $("#ordLogin").addEventListener("click", () => { openBack = "biz"; logout(""); });
    return;
  }
  ordinanceImportPending = null;
  $("#view").innerHTML = `<div id="ordBox"><p class="note">自治條例資料載入中…</p></div>`;
  const box = $("#ordBox");
  box.addEventListener("change", ordinanceChange);
  box.addEventListener("input", ordinanceInput);
  box.addEventListener("click", ordinanceClick);
  loadOrdinance();
}

async function loadOrdinance(period) {
  try {
    ordinance = await api({ action: "ordinance_data", period: period || (ordinance && ordinance.period) || "2026-09" });
    drawOrdinance();
  } catch (e) {
    const box = $("#ordBox");
    if (box) box.innerHTML = `<div class="card empty"><p class="err">自治條例資料讀不到：${esc(e.message)}</p><button id="ordRetry">再試一次</button></div>`;
  }
}

function ordinanceChange(e) {
  const x = e.target;
  if (x.id === "ordPeriod") { loadOrdinance(x.value); return; }
  if (["ordCategory", "ordUnit", "ordState"].includes(x.id)) { drawOrdinance(); return; }
  if (x.id === "ordImportFile") { ordinanceChangeFile(x.files && x.files[0]); return; }
  if (x.matches("[data-f]")) { const row = x.closest("[data-id]"); if (row) row.classList.add("dirty"); }
}
function ordinanceInput(e) {
  if (e.target.id === "ordSearch") {
    const pos = e.target.selectionStart; drawOrdinance();
    const n = $("#ordSearch"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }
  if (e.target.matches("[data-f]")) { const row = e.target.closest("[data-id]"); if (row) row.classList.add("dirty"); }
}

function drawOrdinance() {
  const box = $("#ordBox"); if (!box || !ordinance) return;
  const periods = [...new Set([...(ordinance.periods || []), ordinance.period])].filter(Boolean).sort().reverse();
  const allRows = ordinance.rows || [], allMetrics = ordinance.metrics || [];
  const unitFilter = me.role === "admin" ? (( $("#ordUnit") && $("#ordUnit").value) || "") : me.name;
  const categoryFilter = ($("#ordCategory") && $("#ordCategory").value) || "";
  const stateFilter = ($("#ordState") && $("#ordState").value) || "";
  const query = (( $("#ordSearch") && $("#ordSearch").value) || "").trim().toLowerCase();
  const units = me.role === "admin" ? ORDINANCE_UNITS : [me.name];
  const summary = [];
  [["art5_first", ["first_large"], "第5條第一階段"], ["art5_second", ["second_vulnerable", "second_large"], "第5條第二階段"]].forEach(([article, categoryCodes, label]) => {
    units.forEach((unit) => {
      const target = allMetrics.find((m) => m.unit === unit && m.article === article);
      const active = allRows.filter((r) => r.unit === unit && categoryCodes.includes(r.category) && r.closed !== "1");
      const counts = Object.fromEntries(ORDINANCE_STATES.map((s) => [s, active.filter((r) => (r.status || "尚未回報") === s).length]));
      const closed = allRows.filter((r) => r.unit === unit && categoryCodes.includes(r.category) && r.closed === "1").length;
      summary.push({ unit, article, label, expected: target ? Number(target.expected) : null, actual: active.length, counts, closed });
    });
  });
  const warning = summary.filter((s) => s.expected != null && s.actual !== s.expected);
  const filteredRows = allRows.filter((r) => (!unitFilter || r.unit === unitFilter) && (!categoryFilter || r.category === categoryFilter)
    && (!stateFilter || (stateFilter === "closed" ? r.closed === "1" : r.closed !== "1" && (r.status || "尚未回報") === stateFilter))
    && (!query || [r.site_id, r.name, r.address, r.responsibility].some((v) => String(v || "").toLowerCase().includes(query))))
    .sort((a, b) => ORDINANCE_UNITS.indexOf(a.unit) - ORDINANCE_UNITS.indexOf(b.unit) || String(a.category).localeCompare(String(b.category)) || String(a.seq).localeCompare(String(b.seq), "zh-Hant", { numeric: true }));
  const metricRows = allMetrics.filter((m) => ORDINANCE_ARTICLES.some(([code]) => m.article === code) && (!unitFilter || m.unit === unitFilter));
  const periodOptions = periods.map((p) => `<option value="${esc(p)}"${p === ordinance.period ? " selected" : ""}>${esc(ordinalPeriodLabel(p))}</option>`).join("");
  box.innerHTML = `<div class="card ord-head"><div><h2>自治條例執行情形｜${esc(ordinalPeriodLabel(ordinance.period))}</h2>
    <p class="note">第5條逐筆名冊由中隊回報；第6、8、12、15條以各中隊彙總數填報。中隊帳號僅能讀寫所屬資料；應辦數由管理者維護。</p></div>
    <label>報告月份 <select id="ordPeriod">${periodOptions || `<option value="${esc(ordinance.period)}">${esc(ordinalPeriodLabel(ordinance.period))}</option>`}</select></label></div>
    ${warning.length ? `<div class="card ord-warning"><b>⚠ 名冊筆數與結果表應辦數不一致</b><div>${warning.map((s) => `${esc(s.unit)} ${esc(s.label)}：明細 ${s.actual} 筆、應辦 ${s.expected} 筆（差 ${s.actual - s.expected > 0 ? "+" : ""}${s.actual - s.expected}）`).join("<br>")}</div><p class="note">保留原始名冊，不自動刪除或改分母；請管理者依正式資料確認。</p></div>` : ""}
    <div class="ord-summary">${summary.map((s) => `<div class="card ord-sum"><div class="ord-sumtitle">${esc(s.unit)}｜${esc(s.label)}</div>
      <div class="ord-total">名冊 ${s.actual}／應辦 ${s.expected == null ? "未匯入" : s.expected}${s.closed ? ` <span class="note">（停業／歇業排除 ${s.closed}）</span>` : ""}</div>
      <div class="ord-counts">已完成 ${s.counts["已完成"]}　辦理中 ${s.counts["辦理中"]}　未辦理 ${s.counts["未辦理"]}　未回報 ${s.counts["尚未回報"]}</div></div>`).join("")}</div>
    <div class="card ord-metrics"><h3>其他條文｜彙總填報</h3><p class="note">完成數由中隊填報；應辦數只有管理者能調整。數字來源：匯入檔「工作表1」。</p>
      ${metricRows.length ? `<div class="tablewrap"><table><tr><th>中隊</th><th>條文</th><th>應辦數</th><th>已完成數</th><th></th></tr>${metricRows.map((m) => `<tr data-id="${esc(m.id)}" class="ord-metric-row">
        <td>${esc(m.unit)}</td><td>${esc(m.label)}</td><td>${me.role === "admin" ? `<input type="number" min="0" max="10000" data-f="expected" value="${esc(m.expected)}">` : esc(m.expected)}</td>
        <td><input type="number" min="0" max="10000" data-f="completed" value="${esc(m.completed)}"></td>
        <td><button class="save" data-save="metric">儲存</button></td></tr>`).join("")}</table></div>` : `<p class="note">尚未匯入彙總基準資料。</p>`}</div>
    <div class="card ord-list"><h3>第5條｜逐筆名冊填報</h3><div class="ord-filters">
      <select id="ordCategory"><option value="">全部名冊</option>${Object.entries(ORDINANCE_CAT_LABELS).map(([k, v]) => `<option value="${k}"${k === categoryFilter ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
      ${me.role === "admin" ? `<select id="ordUnit"><option value="">全部中隊</option>${ORDINANCE_UNITS.map((u) => `<option value="${u}"${u === unitFilter ? " selected" : ""}>${esc(u)}</option>`).join("")}</select>` : ""}
      <select id="ordState"><option value="">全部狀態</option>${ORDINANCE_STATES.map((s) => `<option value="${s}"${s === stateFilter ? " selected" : ""}>${s}</option>`).join("")}<option value="closed"${stateFilter === "closed" ? " selected" : ""}>停業／歇業（排除）</option></select>
      <input id="ordSearch" type="search" placeholder="搜尋場所／地址／編號" value="${esc(query)}"></div>
      <p class="note">顯示 ${filteredRows.length} 筆；已標示停業／歇業者保留查看但不列入應辦數。填寫後按該筆儲存，變更保留月份紀錄。</p>
      ${filteredRows.length ? filteredRows.map(ordinanceRowHtml).join("") : `<p class="note">此月份／篩選條件沒有明細。${me.role === "admin" && !allRows.length ? "請先由管理者匯入名冊。" : ""}</p>`}</div>
    ${me.role === "admin" ? ordinanceImportHtml() : ""}`;
}

function ordinanceRowHtml(r) {
  const closed = r.closed === "1", status = r.status || (closed ? "不適用" : "尚未回報");
  const field = (label, key, value, wide = false) => `<label class="ord-field${wide ? " wide" : ""}">${label}${wide
    ? `<textarea data-f="${key}" rows="2">${esc(value)}</textarea>`
    : `<input data-f="${key}" value="${esc(value)}" placeholder="${key === "planned" || key === "actual" ? "例：115/09/30 09:00" : ""}">`}</label>`;
  return `<article class="card ord-row${closed ? " ord-closed" : ""}" data-id="${esc(r.id)}">
    <div class="ord-rowhead"><div><span class="tag">${esc(r.unit)}</span> <span class="tag">${esc(ORDINANCE_CAT_LABELS[r.category] || r.category)}</span>
      <h4>${esc(r.seq)}. ${esc(r.name)}</h4><div class="note">編號 ${esc(r.site_id)}｜${esc(r.address)}${r.area ? `｜${esc(r.area)}㎡` : ""}</div>
      <div class="note">用途 ${esc(r.use)}｜類別 ${esc(r.classification)}｜責任區 ${esc(r.responsibility)}</div></div>
      ${closed ? `<span class="tag bad">停業／歇業・排除</span>` : `<label class="ord-field ord-status">填報狀態<select data-f="status">${ORDINANCE_STATES.map((s) => `<option value="${s}"${s === status ? " selected" : ""}>${s}</option>`).join("")}</select></label>`}</div>
    ${closed ? `<p class="note">此列依來源檔標示停業／歇業，唯讀保留，不計入應辦數。</p>` : `<div class="ord-fields">${field("預定演練時間", "planned", r.planned)}${field("實際演練時間", "actual", r.actual)}${field("是否合格", "qualified", r.qualified)}${field("進度成果", "progress", r.progress, true)}${field("填報備註", "note", r.note, true)}</div><div class="ord-actions"><button class="save" data-save="record">儲存</button><span class="note">${r.updated_at ? `最後更新 ${esc(r.updated_at)}（${esc(r.updated_by)}）` : "尚未更新"}</span></div>`}
  </article>`;
}

function ordinanceImportHtml() {
  return `<details class="card ord-import"><summary><h3>管理者｜匯入名冊與應辦數</h3></summary>
    <p class="note">選擇自治條例整合版 Excel（需含「工作表1」及三張「三隊整合」明細表）。匯入會新增／更新名冊，不刪除既有資料；同月份重匯保留中隊已填欄位與完成數。應辦數依「工作表1」匯入。</p>
    <div class="ord-import-controls"><label>報告月份 <input id="ordImportPeriod" type="month" value="${esc(ordinance.period || "2026-09")}"></label><input id="ordImportFile" type="file" accept=".xlsx,.xls"></div>
    <div id="ordImportPreview">${ordinanceImportPending ? ordinanceImportPreviewHtml() : ""}</div></details>`;
}

function ordinanceCellMap(row) { return Object.fromEntries(row.map((v, i) => [String(v || "").replace(/\s/g, ""), i])); }
function ordinanceCell(row, map, name) { return row[map[name]] == null ? "" : String(row[map[name]]).trim(); }
function ordinanceReadBook(book) {
  if (!book.SheetNames.includes("工作表1") || Object.keys(ORDINANCE_SHEETS).some((s) => !book.SheetNames.includes(s))) throw new Error("檔案缺工作表1或三張三隊整合明細表");
  const records = [], metricRows = [], seen = new Set();
  for (const [sheetName, category] of Object.entries(ORDINANCE_SHEETS)) {
    const grid = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, defval: "", raw: false });
    const map = ordinanceCellMap(grid[0] || []);
    const required = ["項次", "場所編號", "場所名稱", "場所地址", "場所用途", "場所面積", "中隊名稱", "類別", "預定演練時間", "實際演練時間", "是否合格", "進度成果", "責任區"];
    if (required.some((h) => map[h] == null)) throw new Error(`${sheetName} 欄位格式不符`);
    grid.slice(1).forEach((r, i) => {
      const siteId = ordinanceCell(r, map, "場所編號"), name = ordinanceCell(r, map, "場所名稱");
      if (!siteId && !name) return;
      const unit = ordinanceCell(r, map, "中隊名稱");
      if (!ORDINANCE_UNITS.includes(unit)) throw new Error(`${sheetName} 第 ${i + 2} 列中隊名稱無效`);
      const id = `${category}|${unit}|${siteId}`;
      if (!siteId || seen.has(id)) throw new Error(`${sheetName} 第 ${i + 2} 列場所編號空白或重複`);
      seen.add(id);
      const qualified = ordinanceCell(r, map, "是否合格"), progress = ordinanceCell(r, map, "進度成果"), use = ordinanceCell(r, map, "場所用途");
      records.push({ category, seq: ordinanceCell(r, map, "項次"), site_id: siteId, name,
        address: ordinanceCell(r, map, "場所地址"), use, area: ordinanceCell(r, map, "場所面積"), unit,
        classification: ordinanceCell(r, map, "類別"), planned: ordinanceCell(r, map, "預定演練時間"),
        actual: ordinanceCell(r, map, "實際演練時間"), qualified, progress, responsibility: ordinanceCell(r, map, "責任區"),
        source: ordinanceCell(r, map, "合併來源"), source_row: ordinanceCell(r, map, "優先來源列"),
        closed: /停業|歇業/.test(`${qualified} ${progress} ${use} ${ordinanceCell(r, map, "預定演練時間")} ${ordinanceCell(r, map, "實際演練時間")}`) });
    });
  }
  if (!records.length || records.length > 300) throw new Error("名冊筆數無效");
  const grid = XLSX.utils.sheet_to_json(book.Sheets["工作表1"], { header: 1, defval: "", raw: false });
  const units = (grid[0] || []).slice(3, 6).map((x) => String(x || "").trim());
  if (units.length !== 3 || units.some((u) => !ORDINANCE_UNITS.includes(u))) throw new Error("工作表1 中隊欄位不符");
  const n = (v, label) => { const x = Number(String(v || "0").replace(/,/g, "")); if (!Number.isInteger(x) || x < 0 || x > 10000) throw new Error(`${label}不是有效整數`); return x; };
  const findRow = (pred) => grid.find((r) => pred(r));
  const addMetric = (unit, article, expected, completed, label) => metricRows.push({ unit, article, expected, completed, label, source: "工作表1" });
  const phase1 = findRow((r) => String(r[1] || "").includes("第一階段") && String(r[2] || "").includes("應執行"));
  const phase2 = findRow((r) => String(r[1] || "").includes("第二階段") && String(r[2] || "").includes("應執行"));
  if (!phase1 || !phase2) throw new Error("工作表1 找不到第5條兩階段應辦數");
  units.forEach((u, i) => {
    addMetric(u, "art5_first", n(phase1[i + 3], "第5條第一階段應辦數"), "", "第5條第一階段");
    addMetric(u, "art5_second", n(phase2[i + 3], "第5條第二階段應辦數"), "", "第5條第二階段");
  });
  for (const [code, title] of ORDINANCE_ARTICLES) {
    const num = code.slice(3), expectRow = findRow((r) => new RegExp(`第\\s*${num}\\s*條`).test(String(r[0] || "")) && /應(辦理|查核)/.test(String(r[1] || "")));
    const doneRow = expectRow && grid.slice(grid.indexOf(expectRow) + 1).find((r) => /已(辦理|查核)/.test(String(r[1] || "")));
    if (!expectRow || !doneRow) throw new Error(`工作表1 找不到${title}彙總列`);
    units.forEach((u, i) => addMetric(u, code, n(expectRow[i + 3], title + "應辦數"), n(doneRow[i + 3], title + "已完成數"), title));
  }
  if (metricRows.length !== 18) throw new Error("工作表1 應辦數資料不完整");
  return { records, metrics: metricRows };
}

function ordinanceImportPreviewHtml() {
  const p = ordinanceImportPending; if (!p) return "";
  const totals = Object.entries(ORDINANCE_CAT_LABELS).map(([k, label]) => {
    const rows = p.records.filter((r) => r.category === k), closed = rows.filter((r) => r.closed).length;
    return `<li>${esc(label)}：${rows.length} 筆（排除停業／歇業 ${closed}）</li>`;
  }).join("");
  const mismatch = p.metrics.filter((m) => m.article.startsWith("art5_")).map((m) => {
    const cats = m.article === "art5_first" ? ["first_large"] : ["second_vulnerable", "second_large"];
    const n = p.records.filter((r) => r.unit === m.unit && cats.includes(r.category) && !r.closed).length;
    return n === Number(m.expected) ? "" : `${m.unit} ${m.label}：明細 ${n} 筆、應辦 ${m.expected} 筆`;
  }).filter(Boolean);
  return `<div class="ord-preview"><p><b>${esc(ordinalPeriodLabel(p.period))} 匯入預覽</b>：名冊 ${p.records.length} 筆；彙總基準 ${p.metrics.length} 筆。</p><ul>${totals}</ul>
    ${mismatch.length ? `<p class="err">⚠ 筆數差異（不自動刪除）：${mismatch.map(esc).join("；")}</p>` : `<p class="tag ok">第5條名冊應辦數一致</p>`}
    <button id="ordImportConfirm">確認匯入</button> <button class="ghost" id="ordImportCancel">取消</button></div>`;
}

async function ordinanceClick(e) {
  if (e.target.closest("#ordRetry")) { loadOrdinance(); return; }
  if (e.target.closest("#ordImportCancel")) { ordinanceImportPending = null; drawOrdinance(); return; }
  if (e.target.closest("#ordImportConfirm") && ordinanceImportPending) {
    const b = e.target.closest("#ordImportConfirm"); b.disabled = true; b.textContent = "匯入中…";
    try {
      const r = await api({ action: "ordinance_import", period: ordinanceImportPending.period, records: ordinanceImportPending.records, metrics: ordinanceImportPending.metrics });
      const p = ordinanceImportPending.period; ordinanceImportPending = null; flash(`匯入完成：名冊新增 ${r.added}、更新 ${r.updated} 筆；應辦數新增 ${r.metricAdded}、更新 ${r.metricUpdated} 筆`); await loadOrdinance(p);
    } catch (err) { b.disabled = false; b.textContent = "再試一次"; flash("匯入失敗：" + err.message); }
    return;
  }
  const row = e.target.closest("[data-id]");
  if (!row || !e.target.closest("[data-save]")) return;
  const btn = e.target.closest("[data-save]"), isMetric = btn.dataset.save === "metric", source = isMetric ? ordinance.metrics : ordinance.rows;
  const rec = source.find((x) => x.id === row.dataset.id); if (!rec) return;
  const fields = {};
  row.querySelectorAll("[data-f]").forEach((x) => { if (String(rec[x.dataset.f] ?? "") !== x.value) fields[x.dataset.f] = x.value; });
  if (!Object.keys(fields).length) { row.classList.remove("dirty"); btn.textContent = "儲存"; updateDirtyBar(); return; }
  btn.disabled = true; btn.textContent = "儲存中…";
  try {
    const data = await api({ action: isMetric ? "ordinance_metric_update" : "ordinance_update", id: rec.id, ...fields });
    Object.assign(rec, fields); if (data.updated_at) rec.updated_at = data.updated_at;
    row.classList.remove("dirty"); btn.disabled = false; btn.textContent = "已儲存"; updateDirtyBar(); flash("自治條例進度已儲存");
  } catch (err) { btn.disabled = false; btn.textContent = "重試儲存"; flash("儲存失敗：" + err.message); }
}

async function ordinanceChangeFile(file) {
  if (!file) return;
  try {
    await loadXlsx();
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const data = ordinanceReadBook(book), period = $("#ordImportPeriod").value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("請選擇有效報告月份");
    ordinanceImportPending = { ...data, period }; drawOrdinance();
    const preview = $("#ordImportPreview"); if (preview) preview.innerHTML = ordinanceImportPreviewHtml();
  } catch (err) { ordinanceImportPending = null; drawOrdinance(); flash("名冊檔案無法讀取：" + err.message); }
}
