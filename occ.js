// ---- 犀牛辦業務：容留人數抽查月報（2026-11-01）----
// 算法照舊月報（使用者 11/1 逐月核對後定案）：
//   列管家數＝次月初從安管系統匯出的列管清冊（管理項目含「容留人數」）全部家數，含免列管，依列管單位分中隊
//   檢查件次＝當月「容留人數」安檢紀錄筆數（同場所多次照計），合格／不合格看檢查結果；無法檢查原因是停業的另計「停業」
//   前次＝上月本次；新增＝本月清冊有、上月清冊沒有的場所；減少＝前次＋新增－本次（名單列出上月有、本月沒有的）
//   複查、限期改善、罰鍰、停水停電、強制疏散：有不合格才需要，先手動填
// 匯出：templates/occ-template.xlsx（使用者原檔用 Excel 另存）原樣保留，只改格子的值、複製一頁當新月份，格式一個位元都不碰
let occ = null;          // 後端 {months:[{ym,data,snap}], canEdit}
let occDraft = null;     // 上傳後的預覽 {ym, list, insp, ...}
let occView = "";        // 畫面上看哪個月（空白＝最新）
const OCC_UNITS = ["大安中隊", "信義中隊", "南港中隊"];
const OCC_CODE = { 211: "大安中隊", 213: "大安中隊", 221: "南港中隊", 222: "南港中隊", 223: "南港中隊", 231: "信義中隊", 232: "信義中隊" };
const OCC_TEAM = { 安和分隊: "大安中隊", 金華分隊: "大安中隊", 成德分隊: "南港中隊", 南港分隊: "南港中隊", 舊莊分隊: "南港中隊", 信義分隊: "信義中隊", 莊敬分隊: "信義中隊" };
const OCC_MANUAL = [["reinsp", "複查件次"], ["refail", "複查不合格件次"], ["limit", "限期改善"], ["fine", "罰鍰"], ["cut", "停止供水、供電"], ["evac", "強制疏散"]];
const OCC_NOTE = "列管家數＝次月初匯出之列管清冊（管理項目含容留人數）全部家數，含免列管，依列管單位分中隊；新增／減少由前後兩月清冊比對；檢查件次＝當月容留人數安檢紀錄筆數（同場所多次照計）；停業另計，不算檢查件次；檢查率＝檢查件次÷列管家數；合格率＝合格件次÷檢查件次。複查、限期改善、罰鍰、停水停電、強制疏散有不合格才填（手動）。";
const occYm = (y, m) => `${y}${String(m).padStart(2, "0")}`;
const occLabel = (ym) => `${Number(ym.slice(0, 3))}年${Number(ym.slice(3))}月`;
const occPrevYm = (ym) => { let y = Number(ym.slice(0, 3)), m = Number(ym.slice(3)) - 1; if (!m) { y--; m = 12; } return occYm(y, m); };
const occPct = (a, b) => (b ? (Math.round((a / b) * 10000) / 100).toFixed(2) + "%" : "—");
const occSum = (units, k) => OCC_UNITS.reduce((s, u) => s + (Number((units[u] || {})[k]) || 0), 0);

function renderOcc() {
  if (!me || !(me.role === "admin" || me.role === "squadron")) {
    $("#view").innerHTML = `<div class="card empty"><p>容留人數月報是中隊的業務，要用中隊帳號登入才能看。</p><button id="ocLogin">登入</button></div>`;
    $("#ocLogin").addEventListener("click", () => { openBack = "biz"; logout(""); });
    return;
  }
  $("#view").innerHTML = `<div id="ocBox"><p class="note">容留人數月報資料載入中…</p></div>`;
  $("#ocBox").addEventListener("click", occClick);
  $("#ocBox").addEventListener("change", occChange);
  $("#ocBox").addEventListener("input", occInput);
  occLoad();
}
async function occLoad() {
  try { occ = await api({ action: "occ_data" }); } catch (e) {
    if ($("#ocBox")) $("#ocBox").innerHTML = `<div class="card empty"><p class="err">月報資料讀不到：${esc(e.message)}</p></div>`;
    return;
  }
  occ.months.sort((a, b) => a.ym.localeCompare(b.ym));
  // ym 結尾 00＝輔助資料（今年 1 月起已抽查過的場所，給「今年還沒查過」用），不是月報
  occ.aux = occ.months.filter((m) => m.ym.endsWith("00")); occ.months = occ.months.filter((m) => !m.ym.endsWith("00"));
  occDraw();
}
const occMonth = (ym) => occ.months.find((m) => m.ym === ym);

function occTable(d) {
  const row = (name, x) => `<tr><th>${name}</th><td>${x.list}</td><td>${x.insp}</td><td>${x.pass}</td><td class="${x.fail ? "err" : ""}">${x.fail}</td><td>${x.closed}</td><td>${occPct(x.insp, x.list)}</td><td>${occPct(x.pass, x.insp)}</td><td>${x.prev ?? ""}</td><td>${x.dec ?? ""}</td><td>${x.inc ?? ""}</td></tr>`;
  return `<div class="tablewrap"><table><tr><th>單位</th><th>列管家數</th><th>檢查件次</th><th>合格</th><th>不合格</th><th>停業</th><th>檢查率</th><th>合格率</th><th>前次</th><th>減少</th><th>新增</th></tr>
    ${OCC_UNITS.map((u) => row(u, d.units[u])).join("")}${row("第二大隊", d.total)}</table></div>`;
}
function occLists(d) {
  const li = (l) => l.length ? `<ul>${l.map((x) => `<li>${esc(x.unit.replace("中隊", ""))}｜${esc(x.name)}<span class="note">　${esc(x.addr)}${x.st ? "（" + esc(x.st) + "）" : ""}</span></li>`).join("")}</ul>` : `<p class="note">無</p>`;
  return `<div class="grid charts"><div><h3>新增 ${d.inc.length} 家</h3>${li(d.inc)}</div><div><h3>減少 ${d.dec.length} 家</h3>${li(d.dec)}</div></div>${d.listNote ? `<p class="note">⚠️ ${esc(d.listNote)}</p>` : ""}`;
}

function occDraw() {
  const box = $("#ocBox"); if (!box || !occ) return;
  const ms = occ.months.filter((m) => !m.data.seed);
  const cur = ms.find((m) => m.ym === occView) || ms[ms.length - 1];
  const trend = occ.months.slice(-12);
  box.innerHTML = `<div class="card"><h2>容留人數抽查月報 <span class="note">次月 1 日前填報（大隊內部期限；Excel 表頭照原表）</span></h2>
      <p class="note">${esc(OCC_NOTE)}</p>
      <p><button id="ocExport">📥 匯出月報 Excel（整本，格式同原檔）</button>${occ.canEdit ? ` <button id="ocNew" class="ghost">＋ 製作／更新月報</button>` : ""}
      ${ms.length > 1 ? ` <select id="ocView">${ms.slice().reverse().map((m) => `<option value="${m.ym}" ${m === cur ? "selected" : ""}>看 ${occLabel(m.ym)}</option>`).join("")}</select>` : ""}</p></div>
    ${occDraft ? occDraftHtml() : ""}
    ${cur ? occMonthHtml(cur) : `<div class="card empty"><p>還沒有用網頁做過的月報。${occ.canEdit ? "按「製作／更新月報」上傳安管匯出檔。" : ""}</p></div>`}
    <div class="card"><h2>各月一覽</h2><div class="tablewrap"><table><tr><th>月份</th>${OCC_UNITS.map((u) => `<th>${u.replace("中隊", "")} 列管／檢查</th>`).join("")}<th>二大 列管／檢查</th><th>檢查率</th></tr>
      ${trend.slice().reverse().map((m) => `<tr><td>${occLabel(m.ym)}${m.data.seed ? `<span class="note">（舊月報）</span>` : ""}</td>${OCC_UNITS.map((u) => `<td>${m.data.units[u].list}／${m.data.units[u].insp}</td>`).join("")}<td>${m.data.total.list}／${m.data.total.insp}</td><td>${occPct(m.data.total.insp, m.data.total.list)}</td></tr>`).join("")}</table></div>
      <p class="note">114年12月～115年9月是原本手做的月報，網頁從 115年10月起接手；舊月份在匯出檔裡原樣保留。</p></div>`;
}

// 一個月的完整呈現：A 重點卡片、C 本月查了哪些、E 今年還沒查過、D 用途分布、異動名單
function occMonthHtml(m) {
  const d = m.data, prev = occ.months.filter((x) => x.ym < m.ym).pop();
  const delta = (a, b, pct) => {
    if (b === undefined || b === null) return "";
    const x = Math.round((a - b) * (pct ? 10000 : 1)) / (pct ? 100 : 1);
    return `<span class="note">${x > 0 ? "▲" : x < 0 ? "▼" : "＝"} 比上月 ${x > 0 ? "+" : ""}${x}${pct ? " 個百分點" : ""}</span>`;
  };
  const rate = (x) => (x.list ? x.insp / x.list : 0), prate = (x) => (x.insp ? x.pass / x.insp : 1);
  const pt = prev && prev.data.total;
  const card = (title, big, sub) => `<div class="card stat"><div class="sub">${title}</div><div class="num">${big}</div>${sub}</div>`;
  const kpi = `<div class="grid four">${card("列管家數", d.total.list, delta(d.total.list, pt && pt.list))}${card("檢查件次", d.total.insp, delta(d.total.insp, pt && pt.insp))}
    ${card("檢查率", occPct(d.total.insp, d.total.list), delta(rate(d.total), pt && rate(pt), true))}${card("合格率", occPct(d.total.pass, d.total.insp), d.total.fail ? `<span class="err">不合格 ${d.total.fail} 件</span>` : `<span class="note">全部合格</span>`)}</div>`;
  // C：本月查了哪些場所
  const list = d.insp || [];
  const byUnit = OCC_UNITS.map((u) => {
    const l = list.filter((x) => x.unit === u), x = d.units[u];
    return `<div class="card"><h3>${u} <span class="note">檢查 ${x.insp} 件｜列管 ${x.list} 家｜檢查率 ${occPct(x.insp, x.list)}</span></h3>
      ${l.length ? `<div class="tablewrap"><table><tr><th>日期</th><th>場所</th><th>用途</th><th>結果</th><th>綜合意見</th></tr>${l.map((r) => `<tr><td>${esc(r.date.slice(5, 10))}</td><td>${esc(r.name)}</td><td>${esc(r.use)}</td><td class="${r.res === "不合格" ? "err" : ""}">${r.res === "不合格" ? "❌ " : r.res === "停業" ? "⏸ " : "✅ "}${r.res}</td><td class="note">${esc(r.note)}</td></tr>`).join("")}</table></div>`
        : `<p class="note">${list.length ? "本月沒有抽查" : "這個月存檔時還沒有記明細，重新匯入一次就會有。"}</p>`}</div>`;
  }).join("");
  return `<div class="card"><h2>${occLabel(m.ym)} <span class="note">${esc(m.updated_by || "")} ${esc(m.updated_at || "")}</span></h2>${kpi}${occTable(d)}</div>
    <h2 class="occsec">本月抽查了哪些場所</h2>${byUnit}
    ${occNotYetHtml(m)}${occUseHtml(m)}
    <div class="card"><h2>列管異動（${occLabel(m.ym)}）</h2>${occLists(d)}</div>`;
}

// E：今年還沒查過的場所＝本月清冊（扣免列管）裡，今年 1 月起一次都沒出現在容留人數安檢紀錄的
function occNotYet(m) {
  const yr = m.ym.slice(0, 3), seen = new Map();
  const aux = occ.aux.find((a) => a.ym === yr + "00");
  if (aux) Object.entries(aux.data.ids || {}).forEach(([id, dt]) => seen.set(id, dt));
  occ.months.filter((x) => x.ym.slice(0, 3) === yr && x.ym <= m.ym).forEach((x) => (x.data.insp || []).forEach((r) => { if (r.res !== "停業" && (!seen.get(r.id) || r.date > seen.get(r.id))) seen.set(r.id, r.date); }));
  const live = (m.snap || []).filter((s) => s.st !== "免列管");
  return { has: !!aux, upto: aux && aux.data.upto, live, not: live.filter((s) => !seen.has(s.id)), seen };
}
function occNotYetHtml(m) {
  const n = occNotYet(m), yr = Number(m.ym.slice(0, 3));
  const head = `<div class="card"><h2>今年還沒抽查過的場所 <span class="note">${yr}年 1 月起｜扣除免列管</span></h2>`;
  const btn = occ.canEdit ? `<button id="ocYearBtn" class="ghost">📂 匯入今年容留人數安檢紀錄</button><input id="ocYearFile" type="file" accept=".csv" multiple hidden>` : "";
  if (!n.has) return head + `<p class="note">要先匯入一次「${yr}年 1 月起到上個月」的容留人數安檢紀錄，才知道今年查過哪些。之後每個月存月報會自動累加。</p>${btn}</div>`;
  const cov = n.live.length - n.not.length;
  return head + `<p>列管 ${n.live.length} 家，今年已抽查 <b>${cov}</b> 家（${occPct(cov, n.live.length)}），還有 <b class="err">${n.not.length}</b> 家今年沒查過。<span class="note">歷史紀錄匯入到 ${esc(n.upto || "")}</span></p>
    ${OCC_UNITS.map((u) => {
      const l = n.not.filter((s) => s.unit === u), all = n.live.filter((s) => s.unit === u);
      return `<details${l.length ? "" : ""}><summary><b>${u}</b>：還有 ${l.length} 家沒查（列管 ${all.length}，已查 ${all.length - l.length}，${occPct(all.length - l.length, all.length)}）</summary>
        ${l.length ? `<div class="tablewrap"><table><tr><th>場所</th><th>用途</th><th>地址</th><th>列管狀況</th></tr>${l.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.use || "")}</td><td class="note">${esc(s.addr)}</td><td>${esc(s.st)}</td></tr>`).join("")}</table></div>` : `<p class="note">全部查過了 🎉</p>`}</details>`;
    }).join("")}${btn}</div>`;
}

// D：用途分布（列管 vs 本月抽查）
function occUseHtml(m) {
  const snap = (m.snap || []).filter((s) => s.st !== "免列管");
  if (!snap.some((s) => s.use)) return `<div class="card"><h2>場所用途分布</h2><p class="note">這個月存檔時清冊還沒記用途，重新匯入一次就會有。</p></div>`;
  const cnt = {}, ins = {};
  snap.forEach((s) => { cnt[s.use || "其他"] = (cnt[s.use || "其他"] || 0) + 1; });
  (m.data.insp || []).filter((r) => r.res !== "停業").forEach((r) => { const u = (snap.find((s) => s.id === r.id) || {}).use || r.use || "其他"; ins[u] = (ins[u] || 0) + 1; });
  const rows = Object.entries(cnt).sort((a, b) => b[1] - a[1]), max = rows[0][1];
  return `<div class="card"><h2>場所用途分布 <span class="note">列管 ${snap.length} 家（扣免列管）</span></h2>
    <div class="tablewrap"><table><tr><th>用途</th><th>列管家數</th><th style="width:40%"></th><th>本月抽查</th></tr>
    ${rows.map(([u, n]) => `<tr><td>${esc(u)}</td><td>${n}</td><td><div class="vbar"><i style="width:${(n / max) * 100}%"></i></div></td><td>${ins[u] || ""}</td></tr>`).join("")}</table></div></div>`;
}

function occDraftHtml() {
  const d = occDraft;
  if (!d.computed) return `<div class="card" id="ocDraft"><h2>製作月報</h2>
    <div class="form"><label>月份 <select id="ocYm">${occYmOptions(d.ym)}</select></label>
    <label>安管匯出檔（列管清冊＋當月安檢紀錄，可一次選兩個）<input id="ocFile" type="file" accept=".csv" multiple></label></div>
    ${d.files ? `<p class="note">已讀：${esc(d.files)}</p>` : ""}${d.err ? `<p class="err">${esc(d.err)}</p>` : ""}
    <p><button id="ocCancel" class="ghost">取消</button></p></div>`;
  const anyFail = OCC_UNITS.some((u) => d.units[u].fail);
  return `<div class="card" id="ocDraft"><h2>預覽：${occLabel(d.ym)} <span class="note">確認無誤再存檔</span></h2>
    <p class="note">${esc(d.files)}</p>
    ${d.warn.map((w) => `<p class="err">⚠️ ${esc(w)}</p>`).join("")}
    ${occTable(d)}
    <h3>停業件次${anyFail ? "、不合格後續處理" : ""}（手動）</h3>
    <div class="tablewrap"><table><tr><th>單位</th><th>停業</th>${anyFail ? OCC_MANUAL.map(([, n]) => `<th>${n}</th>`).join("") : ""}</tr>
      ${OCC_UNITS.map((u) => `<tr><th>${u}</th><td><input type="number" min="0" data-ocm="${u}|closed" value="${d.units[u].closed}" style="width:70px"></td>${anyFail ? OCC_MANUAL.map(([k]) => `<td><input type="number" min="0" data-ocm="${u}|${k}" value="${d.units[u][k]}" style="width:70px"></td>`).join("") : ""}</tr>`).join("")}</table></div>
    ${anyFail ? "" : `<p class="note">本月沒有不合格，複查、限期改善、罰鍰、停水停電、強制疏散都填 0。</p>`}
    ${occLists(d)}
    <p><button id="ocSave">💾 存檔 ${occLabel(d.ym)}</button> <button id="ocCancel" class="ghost">取消</button></p></div>`;
}
function occYmOptions(sel) {
  const now = new Date(), out = [];
  for (let k = 0; k < 6; k++) { const t = new Date(now.getFullYear(), now.getMonth() - k, 1); out.push(occYm(t.getFullYear() - 1911, t.getMonth() + 1)); }
  return out.map((ym) => `<option value="${ym}" ${ym === sel ? "selected" : ""}>${occLabel(ym)}${occMonth(ym) && !occMonth(ym).data.seed ? "（已存，重做會覆蓋）" : ""}</option>`).join("");
}

function occClick(e) {
  const t = e.target;
  if (t.id === "ocExport") return occExport();
  if (t.id === "ocNew") { const n = new Date(); const p = new Date(n.getFullYear(), n.getMonth() - 1, 1); occDraft = { ym: occYm(p.getFullYear() - 1911, p.getMonth() + 1) }; occDraw(); return; }
  if (t.id === "ocCancel") { occDraft = null; occDraw(); return; }
  if (t.id === "ocSave") return occSave();
  if (t.id === "ocYearBtn") { $("#ocYearFile").click(); return; }
}
function occChange(e) {
  const t = e.target;
  if (t.id === "ocYm") { occDraft.ym = t.value; return; }
  if (t.id === "ocFile") return occFiles(t.files);
  if (t.id === "ocYearFile") return occYearFiles(t.files);
  if (t.id === "ocView") { occView = t.value; occDraw(); return; }
}
function occInput(e) {
  const t = e.target; if (!t.dataset.ocm || !occDraft) return;
  const [u, k] = t.dataset.ocm.split("|");
  occDraft.units[u][k] = Math.max(0, Number(t.value) || 0);
  occTotals(occDraft);
}

async function occFiles(files) {
  const ym = $("#ocYm").value; occDraft = { ym };
  let list = null, rec = null; const names = [];
  for (const f of files) {
    const rows = csvParse(csvDecode(await f.arrayBuffer())), h = rows[0] || {};
    if ("管理項目" in h && "列管單位" in h) { list = rows; names.push(`${f.name}（列管清冊）`); }
    else if ("安檢項目" in h && "檢查日期" in h) { rec = rows; names.push(`${f.name}（安檢紀錄）`); }
    else names.push(`${f.name}（看不出是什麼檔，略過）`);
  }
  occDraft.files = names.join("、");
  if (!list || !rec) { occDraft.err = `還缺${!list ? "列管清冊" : ""}${!list && !rec ? "和" : ""}${!rec ? "當月安檢紀錄" : ""}，請兩個檔一起選。`; occDraw(); return; }
  try { Object.assign(occDraft, occCompute(ym, list, rec)); occDraft.computed = true; } catch (err) { occDraft.err = err.message; }
  occDraw();
}

// 用清冊＋安檢紀錄算當月數字；前次、新增、減少跟上一個存檔月份的清冊比
function occCompute(ym, listRows, recRows) {
  const warn = [];
  const snap = listRows.filter((r) => /^\d+$/.test(r["場所編號"]) && OCC_CODE[r["列管單位"]] && /容留人數/.test(r["管理項目"] || ""))
    .map((r) => ({ id: r["場所編號"], name: r["場所名稱"], addr: r["場所地址"], unit: OCC_CODE[r["列管單位"]], st: r["列管狀況"], use: r["用途名稱"] || "" }));
  const skipped = listRows.filter((r) => /^\d+$/.test(r["場所編號"]) && r["場所名稱"] && !OCC_CODE[r["列管單位"]]).length;   // 最後一列是筆數合計（只有編號欄有數字），不算
  if (skipped) warn.push(`清冊有 ${skipped} 家不是第二大隊的列管單位，沒有算進去。`);
  const y = Number(ym.slice(0, 3)) + 1911, m = Number(ym.slice(3));
  const units = Object.fromEntries(OCC_UNITS.map((u) => [u, { list: 0, insp: 0, pass: 0, fail: 0, closed: 0, reinsp: 0, refail: 0, limit: 0, fine: 0, cut: 0, evac: 0 }]));
  snap.forEach((s) => units[s.unit].list++);
  let other = 0, noUnit = 0, cant = 0; const insp = [];
  recRows.filter((r) => r["場所編號"] && /容留人數/.test(r["安檢項目"] || "")).forEach((r) => {
    const d = /^(\d{4})\D(\d{1,2})/.exec(r["檢查日期"] || "");
    if (!d || Number(d[1]) !== y || Number(d[2]) !== m) { other++; return; }
    const u = OCC_TEAM[r["分隊名稱"]] || (/(大安|信義|南港)中隊/.exec(r["檢查人員"] || "") || [])[0];
    if (!u) { noUnit++; return; }
    const why = String(r["無法檢查原因"] || "").trim(), res = String(r["檢查結果"] || "").trim();
    const one = { id: r["場所編號"], name: r["場所名稱"], unit: u, date: (r["檢查日期"] || "").slice(0, 16), use: r["用途"] || "", res: /不合格/.test(res) ? "不合格" : "合格", note: String(r["綜合意見"] || "").replace(/\s+/g, " ").trim().slice(0, 60) };
    if (why) { if (/停業/.test(why)) { units[u].closed++; insp.push({ ...one, res: "停業" }); } else cant++; return; }
    units[u].insp++; insp.push(one);
    if (/不合格/.test(res)) units[u].fail++; else units[u].pass++;
  });
  if (other) warn.push(`安檢紀錄有 ${other} 筆不是 ${occLabel(ym)} 的，沒有算。`);
  if (noUnit) warn.push(`安檢紀錄有 ${noUnit} 筆分不出中隊，沒有算。`);
  if (cant) warn.push(`有 ${cant} 筆「無法檢查」（不是停業），沒有算進檢查件次。`);
  // 前次／新增／減少：跟上一個有存檔的月份比
  const prev = occ.months.filter((x) => x.ym < ym).pop();
  const inc = [], dec = []; let listNote = "";
  if (prev) {
    const was = new Set(prev.snap.map((s) => s.id)), now = new Set(snap.map((s) => s.id));
    snap.forEach((s) => { if (!was.has(s.id)) inc.push(s); });
    prev.snap.forEach((s) => { if (!now.has(s.id)) dec.push(s); });
    if (prev.ym !== occPrevYm(ym)) warn.push(`上一個存檔的是 ${occLabel(prev.ym)}，不是上個月，新增／減少是這段期間合計。`);
    if (prev.data.snapNote) listNote = prev.data.snapNote;
    OCC_UNITS.forEach((u) => {
      const x = units[u]; x.prev = prev.data.units[u].list; x.inc = inc.filter((s) => s.unit === u).length; x.dec = x.prev + x.inc - x.list;
      if (x.dec !== dec.filter((s) => s.unit === u).length) listNote = (listNote ? listNote + "；" : "") + `${u}減少 ${x.dec} 家，但名單列出 ${dec.filter((s) => s.unit === u).length} 家（前次數字和上次存的清冊對不起來，差額是之前月份已扣或漏列）`;
    });
  } else warn.push("前面沒有存檔的月份，前次、新增、減少無法比對。");
  insp.sort((a, b) => b.date.localeCompare(a.date));
  const d = { ym, units, snap, inc, dec, listNote, warn, insp };
  occTotals(d);
  return d;
}
function occTotals(d) {
  d.total = {};
  ["list", "insp", "pass", "fail", "closed", "prev", "inc", "dec", ...OCC_MANUAL.map(([k]) => k)].forEach((k) => { d.total[k] = occSum(d.units, k); });
}

// E 用：匯入今年的容留人數安檢紀錄，只存「場所編號→最後抽查日」（不含停業、無法檢查）
async function occYearFiles(files) {
  const ms = occ.months.filter((m) => !m.data.seed), cur = ms.find((m) => m.ym === occView) || ms[ms.length - 1];
  const yr = (cur ? cur.ym : occYm(new Date().getFullYear() - 1911, 1)).slice(0, 3), y = Number(yr) + 1911;
  const ids = {}; let n = 0, last = "";
  for (const f of files) {
    const rows = csvParse(csvDecode(await f.arrayBuffer()));
    if (!rows[0] || !("安檢項目" in rows[0])) { alert(`${f.name} 不是安檢紀錄檔`); return; }
    rows.filter((r) => r["場所編號"] && /容留人數/.test(r["安檢項目"] || "") && !String(r["無法檢查原因"] || "").trim() && String(r["檢查日期"] || "").startsWith(String(y))).forEach((r) => {
      const dt = r["檢查日期"].slice(0, 16); n++; if (!ids[r["場所編號"]] || dt > ids[r["場所編號"]]) ids[r["場所編號"]] = dt; if (dt > last) last = dt;
    });
  }
  if (!n) { alert(`檔案裡沒有 ${yr} 年的容留人數安檢紀錄`); return; }
  const old = occ.aux.find((a) => a.ym === yr + "00");
  if (old) Object.entries(old.data.ids || {}).forEach(([id, dt]) => { if (!ids[id] || dt > ids[id]) ids[id] = dt; if (dt > last) last = dt; });
  if (!confirm(`讀到 ${n} 筆 ${yr} 年容留人數抽查，共 ${Object.keys(ids).length} 個場所（最後一筆 ${last.slice(0, 10)}）。要存起來嗎？`)) return;
  try { await api({ action: "occ_save", ym: yr + "00", data: { aux: true, ids, upto: last.slice(0, 10), total: { list: "", insp: n } }, snap: [] }); await occLoad(); flash("今年抽查紀錄已匯入"); }
  catch (e) { if (e.message !== "login") alert("存檔失敗：" + e.message); }
}

async function occSave() {
  const d = occDraft, b = $("#ocSave");
  if (occMonth(d.ym) && !occMonth(d.ym).data.seed && !confirm(`${occLabel(d.ym)} 已經存過，要覆蓋嗎？`)) return;
  b.disabled = true; b.textContent = "存檔中…";
  const data = { units: d.units, total: d.total, inc: d.inc, dec: d.dec, listNote: d.listNote, files: d.files, insp: d.insp };
  try {
    await api({ action: "occ_save", ym: d.ym, data, snap: d.snap });
    occDraft = null; await occLoad(); flash(`${occLabel(d.ym)} 月報已存檔`);
  } catch (e) { if (e.message !== "login") alert("存檔失敗：" + e.message); b.disabled = false; b.textContent = `💾 存檔 ${occLabel(d.ym)}`; }
}

// ---- 匯出：直接改原檔的 XML（不經 Excel 元件，避免 9.5 號字被四捨五入）----
const JSZIP_SRC = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
function loadJSZip() {
  if (window.JSZip) return Promise.resolve();
  return new Promise((ok, fail) => { const el = document.createElement("script"); el.src = JSZIP_SRC; el.onload = ok; el.onerror = () => { el.remove(); fail(new Error("jszip")); }; document.head.appendChild(el); });
}
const XNS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const occColN = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
// 在 sheet XML 裡找／建儲存格；v 是數字就寫數值，字串就寫 inline 字串；有公式的只更新快取值
function occCell(doc, ref, v, style) {
  const sd = doc.getElementsByTagNameNS(XNS, "sheetData")[0], rn = Number(ref.replace(/\D/g, ""));
  let row = [...sd.getElementsByTagNameNS(XNS, "row")].find((r) => Number(r.getAttribute("r")) === rn);
  if (!row) {
    row = doc.createElementNS(XNS, "row"); row.setAttribute("r", rn);
    const after = [...sd.getElementsByTagNameNS(XNS, "row")].find((r) => Number(r.getAttribute("r")) > rn);
    sd.insertBefore(row, after || null);
  }
  let c = [...row.getElementsByTagNameNS(XNS, "c")].find((x) => x.getAttribute("r") === ref);
  if (!c) {
    c = doc.createElementNS(XNS, "c"); c.setAttribute("r", ref); if (style != null) c.setAttribute("s", style);
    const after = [...row.getElementsByTagNameNS(XNS, "c")].find((x) => occColN(x.getAttribute("r")) > occColN(ref));
    row.insertBefore(c, after || null);
  }
  const f = c.getElementsByTagNameNS(XNS, "f")[0];
  [...c.childNodes].forEach((n) => { if (n !== f) c.removeChild(n); });
  if (v === null || v === undefined || v === "") { c.removeAttribute("t"); return; }
  if (typeof v === "number") { c.removeAttribute("t"); const x = doc.createElementNS(XNS, "v"); x.textContent = String(v); c.appendChild(x); return; }
  c.setAttribute("t", f ? "str" : "inlineStr");
  if (f) { const x = doc.createElementNS(XNS, "v"); x.textContent = v; c.appendChild(x); return; }
  const is = doc.createElementNS(XNS, "is"), t = doc.createElementNS(XNS, "t"); t.textContent = v; is.appendChild(t); c.appendChild(is);
}
// 一個月的資料寫進月報那一頁（版面照 11509：第 9～11 列三中隊、第 12 列合計、P～T 小表、第 26 列起新增／減少名單）
function occFillSheet(doc, ym, d, made) {
  occCell(doc, "A4", `中華民國 ${Number(ym.slice(0, 3))}年${Number(ym.slice(3))}月`);
  if (made) occCell(doc, "L13", made);
  OCC_UNITS.concat(["total"]).forEach((u, i) => {
    const x = u === "total" ? d.total : d.units[u], r = 9 + i;
    [["B", x.list], ["C", x.insp], ["D", x.pass], ["E", x.fail], ["F", x.closed]].forEach(([c, v]) => occCell(doc, c + r, v));
    occCell(doc, "G" + r, x.list ? x.insp / x.list : 0); occCell(doc, "H" + r, x.insp ? x.pass / x.insp : 1);
    [["I", "reinsp"], ["J", "refail"], ["K", null], ["L", "limit"], ["M", "fine"], ["N", "cut"], ["O", "evac"]].forEach(([c, k]) => occCell(doc, c + r, k ? x[k] || 0 : x.reinsp ? (x.refail || 0) / x.reinsp : 0));
    if (u !== "total") { [["Q", x.prev], ["R", x.dec], ["S", x.inc]].forEach(([c, v]) => occCell(doc, c + (r + 1), v ?? 0)); occCell(doc, "T" + (r + 1), (x.prev ?? x.list) - (x.dec || 0) + (x.inc || 0)); }
  });
  // 名單區：先清掉第 26 列以下，再寫（新增 N/O、減少 V/W，同 11509）
  const sd = doc.getElementsByTagNameNS(XNS, "sheetData")[0];
  [...sd.getElementsByTagNameNS(XNS, "row")].forEach((r) => { if (Number(r.getAttribute("r")) >= 26) sd.removeChild(r); });
  occCell(doc, "N26", "新增"); occCell(doc, "U26", "減少");
  d.inc.forEach((s, i) => { occCell(doc, "N" + (27 + i), s.name); occCell(doc, "O" + (27 + i), s.addr); });
  d.dec.forEach((s, i) => { occCell(doc, "V" + (27 + i), s.name); occCell(doc, "W" + (27 + i), s.addr); });
  const n = Math.max(d.inc.length, d.dec.length);
  const dim = doc.getElementsByTagNameNS(XNS, "dimension")[0]; if (dim) dim.setAttribute("ref", `A1:W${Math.max(29, 26 + n)}`);
}

async function occExport() {
  const b = $("#ocExport"); b.disabled = true; b.textContent = "匯出中…";
  try {
    await loadJSZip();
    const buf = await (await fetch("templates/occ-template.xlsx?v=20261101a")).arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const P = new DOMParser(), S = new XMLSerializer();
    const read = async (p) => P.parseFromString(await zip.file(p).async("string"), "application/xml");
    const write = (p, doc) => zip.file(p, S.serializeToString(doc));
    const wb = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels"), ct = await read("[Content_Types].xml");
    const sheetsEl = wb.getElementsByTagNameNS(XNS, "sheets")[0];
    const sheetOf = (name) => { const s = [...sheetsEl.getElementsByTagNameNS(XNS, "sheet")].find((x) => x.getAttribute("name") === name); if (!s) return null; const id = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"); return "xl/" + [...rels.documentElement.childNodes].find((x) => x.getAttribute && x.getAttribute("Id") === id).getAttribute("Target"); };
    const now = new Date(), made = `中華民國${now.getFullYear() - 1911}年${now.getMonth() + 1}月${now.getDate()}日編製`;
    // 原檔 11509 表頭誤寫成 8 月
    const p9 = sheetOf("11509"); if (p9) { const d9 = await read(p9); occCell(d9, "A4", "中華民國 115年9月"); write(p9, d9); }
    const tplPath = sheetOf("11509"), tplRels = tplPath.replace("worksheets/", "worksheets/_rels/") + ".rels";
    const tplXml = await zip.file(tplPath).async("string"), tplRelXml = await zip.file(tplRels).async("string");
    const total = [...sheetsEl.getElementsByTagNameNS(XNS, "sheet")].find((x) => /加總/.test(x.getAttribute("name")));
    let nFile = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length;
    let nSheetId = Math.max(...[...sheetsEl.getElementsByTagNameNS(XNS, "sheet")].map((x) => Number(x.getAttribute("sheetId"))));
    const done = occ.months.filter((m) => !m.data.seed);
    for (const m of done) {
      let path = sheetOf(m.ym);
      if (!path) {   // 新月份：複製 11509 那一頁
        nFile++; nSheetId++;
        path = `xl/worksheets/sheet${nFile}.xml`;
        const rid = "rIdOcc" + nFile, bin = `xl/printerSettings/printerSettings${nFile}.bin`;
        zip.file(path, tplXml.replace(/ tabSelected="1"/, ""));
        const tplBin = /Target="\.\.\/printerSettings\/(printerSettings\d+\.bin)"/.exec(tplRelXml);
        if (tplBin) { zip.file(bin, await zip.file("xl/printerSettings/" + tplBin[1]).async("uint8array")); zip.file(`xl/worksheets/_rels/sheet${nFile}.xml.rels`, tplRelXml.replace(tplBin[1], `printerSettings${nFile}.bin`)); }
        const sh = wb.createElementNS(XNS, "sheet"); sh.setAttribute("name", m.ym); sh.setAttribute("sheetId", nSheetId); sh.setAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "r:id", rid);
        sheetsEl.insertBefore(sh, total || null);
        const rel = rels.createElementNS(rels.documentElement.namespaceURI, "Relationship"); rel.setAttribute("Id", rid); rel.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"); rel.setAttribute("Target", `worksheets/sheet${nFile}.xml`); rels.documentElement.appendChild(rel);
        const ov = ct.createElementNS(ct.documentElement.namespaceURI, "Override"); ov.setAttribute("PartName", "/" + path); ov.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"); ct.documentElement.appendChild(ov);
        // 列印範圍：照原檔每頁 A1:O15；插在加總頁前面，加總頁後面的編號要往後移
        const idx = [...sheetsEl.getElementsByTagNameNS(XNS, "sheet")].indexOf(sh), dn = wb.getElementsByTagNameNS(XNS, "definedNames")[0];
        if (dn) {
          [...dn.getElementsByTagNameNS(XNS, "definedName")].forEach((x) => { const l = Number(x.getAttribute("localSheetId")); if (x.hasAttribute("localSheetId") && l >= idx) x.setAttribute("localSheetId", l + 1); });
          const pa = wb.createElementNS(XNS, "definedName"); pa.setAttribute("name", "_xlnm.Print_Area"); pa.setAttribute("localSheetId", idx); pa.textContent = `'${m.ym}'!$A$1:$O$15`; dn.appendChild(pa);
        }
      }
      const doc = await read(path); occFillSheet(doc, m.ym, m.data, made); write(path, doc);
    }
    // 各月檢查件次加總：115 年的月份填進 1～12 月欄，列管家數用最新月份
    if (total) {
      const tp = sheetOf(total.getAttribute("name")), td = await read(tp);
      const latest = done[done.length - 1];
      const cols = "CDEFGHIJKLMN";
      // 先讀原本的值（舊月份留著），再補網頁做的月份
      const val = (ref) => { const c = [...td.getElementsByTagNameNS(XNS, "c")].find((x) => x.getAttribute("r") === ref); const v = c && c.getElementsByTagNameNS(XNS, "v")[0]; return v ? Number(v.textContent) || 0 : 0; };
      done.filter((m) => m.ym.slice(0, 3) === "115").forEach((m) => { const c = cols[Number(m.ym.slice(3)) - 1]; OCC_UNITS.forEach((u, i) => occCell(td, c + (3 + i), m.data.units[u].insp)); });
      if (latest) OCC_UNITS.forEach((u, i) => occCell(td, "B" + (3 + i), latest.data.units[u].list));
      ["B", ...cols].forEach((c) => occCell(td, c + "6", val(c + "3") + val(c + "4") + val(c + "5") || (c === "B" ? 0 : "")));
      [3, 4, 5].forEach((r) => occCell(td, "O" + r, [...cols].reduce((s, c) => s + val(c + r), 0)));
      occCell(td, "O6", [3, 4, 5].reduce((s, r) => s + val("O" + r), 0));
      write(tp, td);
    }
    // 開檔時停在最新月份那頁
    const bv = wb.getElementsByTagNameNS(XNS, "workbookView")[0], all = [...sheetsEl.getElementsByTagNameNS(XNS, "sheet")];
    if (bv && done.length) { const i = all.findIndex((x) => x.getAttribute("name") === done[done.length - 1].ym); if (i >= 0) { bv.setAttribute("activeTab", i); bv.setAttribute("firstSheet", Math.max(0, i - 5)); } }
    for (const [i, x] of all.entries()) { const p = sheetOf(x.getAttribute("name")); const d = await read(p); const v = d.getElementsByTagNameNS(XNS, "sheetView")[0]; if (v) { if (bv && i === Number(bv.getAttribute("activeTab"))) v.setAttribute("tabSelected", "1"); else v.removeAttribute("tabSelected"); } write(p, d); }
    write("xl/workbook.xml", wb); write("xl/_rels/workbook.xml.rels", rels); write("[Content_Types].xml", ct);
    zip.remove("docProps/app.xml");   // 裡面記著舊的分頁清單，拿掉讓 Excel 自己重建
    const ctd = await read("[Content_Types].xml"); [...ctd.documentElement.childNodes].forEach((n) => { if (n.getAttribute && /docProps\/app\.xml/.test(n.getAttribute("PartName") || "")) ctd.documentElement.removeChild(n); }); write("[Content_Types].xml", ctd);
    const rr = await read("_rels/.rels"); [...rr.documentElement.childNodes].forEach((n) => { if (n.getAttribute && /docProps\/app\.xml/.test(n.getAttribute("Target") || "")) rr.documentElement.removeChild(n); }); write("_rels/.rels", rr);
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
    const last = done[done.length - 1];
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `115年容留人數抽查月報表${last ? "_" + last.ym : ""}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { alert("匯出失敗：" + e.message); }
  b.disabled = false; b.textContent = "📥 匯出月報 Excel（整本，格式同原檔）";
}
if (typeof module !== "undefined") module.exports = { occCompute, occFillSheet, occCell };
