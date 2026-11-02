// ---- 住警器安裝清冊匯入比對（2026-11-01）----
// 清冊 CSV 只在瀏覽器讀；後端名冊存的是姓名、門牌的雜湊「指紋」（visits.fp＝姓名|門牌|門牌＋房號），比對完只送回填結果。
// 規則（使用者 10/20、11/1 定案）：同名同址、同址家人、宿舍同房號 → 預設勾；同名不同址 → 列出不勾。
// 2026-11-02 使用者：訪視（宣導）跟安裝是兩回事，專案開始（9/21 決行）後的才算訪視；每月匯「住警器安裝清冊」「居家訪視紀錄」兩種檔自動更新：
// - 清冊：住警器寫「有裝・正常」；安裝日在 9/21 以後同時當訪視日，以前的只寫住警器。已有訪視日的也會補住警器
// - 居家訪視：沒有姓名，用門牌＋樓層比；寫訪視日、宣導「是」，住警器空白就填「已宣導（未檢查）」（算完成，之後清冊對到再升級）
// - 分隊自己填的住警器狀況（「已宣導（未檢查）」以外）一律不動；後端 visitsFill_ 用同一套規則再檢查一次
// 宿舍＝同一門牌名冊上 5 人以上、且一半以上有寫房號（例如 599 號大忠樓）；只比到同一房號才算，避免整棟鄰居都被勾。
// 同門牌人多但沒有房號的（例如一家 6 口）仍當家人。
const AF_DORM = 5;
const AF_CN = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
function afNorm(addr) {
  let a = String(addr || "").replace(/[\s　()（）]/g, "").replace(/臺/g, "台")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－—–]/g, "-").replace(/之/g, "-");
  a = a.replace(/臨/g, "").replace(/^台北市/, "").replace(/^[一-鿿]{1,3}區/, "").replace(/^[一-鿿]{1,3}里(?=[一-鿿])/, "").replace(/^\d+鄰/, "");
  return a.replace(/([一二三四五六七八九])段/g, (m, d) => AF_CN[d] + "段");
}
const afCore = (addr) => { const a = afNorm(addr), m = /^(.*?號)/.exec(a); return m ? m[1] : a; };
// 房號：「220室」「424房」；清冊常把房號寫在備註
function afRoom(...parts) { const m = /(\d+)\s*[室房]/.exec(parts.map((p) => afNorm(p)).join(" ")); return m ? m[1] : ""; }
// 樓層：「3樓」「三樓」「B1」「地下1樓」「103室」（房號第一碼）；號後面什麼都沒寫＝1 樓；寫了別的看不出樓層＝空白
const AF_CNUM = (t) => { const d = (c) => "一二三四五六七八九".indexOf(c) + 1; if (t === "十") return 10; if (t[0] === "十") return 10 + d(t[1]); if (t[1] === "十") return d(t[0]) * 10 + (t[2] ? d(t[2]) : 0); return d(t); };
function afFloor(addr) {
  const m = /^.*?號(.*)$/.exec(afNorm(addr));
  if (!m) return "";
  const rest = m[1].replace(/[一二三四五六七八九十]+(?=樓)/g, (t) => String(AF_CNUM(t)));
  let f;
  if ((f = /(?:B|地下)(\d+)/i.exec(rest))) return "B" + Number(f[1]);
  if ((f = /(\d+)(?:樓|F)/i.exec(rest))) return String(Number(f[1]));
  if ((f = /(?:^|\D)(\d{1,2})\d\d(?=[室房、,，])/.exec(rest)) && /[室房]/.test(rest)) return String(Number(f[1]));   // 「103、107室」取第一間
  return rest ? "" : "1";
}
const afName = (n) => String(n || "").replace(/[\s　]/g, "");
async function afHash(salt, kind, v) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + kind + "|" + v));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 指紋：姓名|門牌|門牌＋房號（沒房號就空）|門牌＋樓層（看不出樓層就空，居家訪視比對用）
const afFloorHash = async (salt, addr) => { const fl = afFloor(addr); return fl ? afHash(salt, "f", afCore(addr) + "#" + fl) : ""; };
async function afPrint(salt, name, addr, note) {
  const core = afCore(addr), room = afRoom(addr, note || "");
  return [await afHash(salt, "n", afName(name)), await afHash(salt, "a", core), room ? await afHash(salt, "r", core + "#" + room) : "", await afFloorHash(salt, addr)].join("|");
}
const AF_START = "2026-09-21";   // 專案開始（大隊長決行日），之前的不算訪視
const AF_TALK = "已宣導（未檢查）";
// 這一筆匯入後會寫什麼（跟後端 visitsFill_ 同規則）；回傳 null＝不用寫
function afPlan(v, kind, iso) {
  const f = {}, noVisit = !v.visit_date || v.visit_date < AF_START;
  if (kind === "visit") {
    if (iso < AF_START) return null;
    if (noVisit) f.visit_date = iso;
    if (!v.alarm) f.alarm = AF_TALK;
    if (!f.visit_date && !f.alarm) return null;
    if (!v.outreach) f.outreach = "是";
  } else {
    if (!v.alarm || v.alarm === AF_TALK) { f.alarm = "有裝・正常"; if (!v.alarm_installed) f.alarm_installed = "已協助安裝"; }
    if (iso >= AF_START && noVisit) f.visit_date = iso;
    if (!Object.keys(f).length) return null;
  }
  return f;
}
const AF_FIELD = { visit_date: "訪視日", alarm: "住警器", alarm_installed: "處理", outreach: "宣導" };
const afPlanText = (f) => Object.keys(f).map((k) => `${AF_FIELD[k]}：${k === "visit_date" ? f[k].slice(5).replace("-", "/") : f[k]}`).join("、");
const afRoc = (d) => { const m = /^(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(String(d || "")); return m ? { iso: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, roc: `${m[1] - 1911}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}` } : null; };
const AF_KIND = { exact: ["✅ 同名同址", true, ""], family: ["👪 同址家人", true, "：同址家人名下安裝"], room: ["🏢 宿舍同房", true, "：同房登記人名下安裝"], name: ["⚠️ 同名不同址", false, "：清冊地址不同，經確認同一人"],
  floor: ["🏠 同門牌同樓層", true, ""], nofloor: ["❔ 名冊沒寫樓層", false, "（名冊沒寫樓層，人工確認）"], other: ["⚠️ 同門牌不同樓", false, "（同門牌不同樓，人工確認）"] };
const AF_RANK = { exact: 0, room: 1, family: 2, name: 3, floor: 0, nofloor: 1, other: 2 };

// rows＝清冊（已解析），visits＝名冊（含 fp），回傳每筆名冊的最佳配對
async function afMatch(salt, rows, visits) {
  const fps = visits.filter((v) => v.fp).map((v) => { const [n, a, r] = v.fp.split("|"); return { v, n, a, r }; });
  const size = {}, roomy = {}; fps.forEach((f) => { size[f.a] = (size[f.a] || 0) + 1; if (f.r) roomy[f.a] = (roomy[f.a] || 0) + 1; });
  const dorm = (a) => size[a] >= AF_DORM && (roomy[a] || 0) * 2 >= size[a];
  const best = new Map(), unmatched = [];
  for (const row of rows) {
    const d = afRoc(row["安裝日期"]);
    if (!d || !afName(row["姓名"])) continue;
    const [n, a, r] = (await afPrint(salt, row["姓名"], row["地址"], row["備註"])).split("|");
    let hit = false;
    for (const f of fps) {
      let kind = "";
      if (f.n === n && f.a === a) kind = "exact";
      else if (f.a === a) kind = dorm(a) ? (r && f.r === r ? "room" : "") : "family";
      else if (f.n === n) kind = "name";
      if (!kind) continue;
      hit = true;
      const old = best.get(f.v.id);
      if (!old || AF_RANK[kind] < AF_RANK[old.kind] || (kind === old.kind && d.iso < old.date.iso)) best.set(f.v.id, { v: f.v, kind, date: d, src: row });
    }
    if (!hit) unmatched.push(row);
  }
  const list = [...best.values()].sort((x, y) => AF_RANK[x.kind] - AF_RANK[y.kind] || x.v.id.localeCompare(y.v.id));
  return { list, unmatched, noFp: visits.filter((v) => !v.fp).length };
}

// 居家訪視紀錄（宣導系統匯出）：沒有姓名，門牌＋樓層相同才自動勾；只算 9/21 以後的日期，同一戶取最早那天
async function hvMatch(salt, rows, visits) {
  const at = {};
  let used = 0;
  for (const row of rows) {
    const d = afRoc(row.date);
    if (!d || d.iso < AF_START || !afCore(row.addr)) continue;
    used++;
    const a = await afHash(salt, "a", afCore(row.addr)), f = await afFloorHash(salt, row.addr);
    (at[a] = at[a] || []).push({ f, date: d });
  }
  const list = [];
  visits.filter((v) => v.fp).forEach((v) => {
    const [, a, , f] = v.fp.split("|"), hits = at[a];
    if (!hits) return;
    const same = f ? hits.filter((h) => h.f === f) : [];
    const kind = same.length ? "floor" : f ? "other" : "nofloor";
    const date = (same.length ? same : hits).map((h) => h.date).sort((x, y) => (x.iso < y.iso ? -1 : 1))[0];
    list.push({ v, kind, date });
  });
  list.sort((x, y) => AF_RANK[x.kind] - AF_RANK[y.kind] || x.v.id.localeCompare(y.v.id));
  return { list, used, noFp: visits.filter((v) => !v.fp || v.fp.split("|").length < 4).length };
}
const hvNote = (d) => `已訪視、已宣導住警器（${Number(d.iso.slice(5, 7))}月居家訪視 ${d.iso.slice(5).replace("-", "/")}）`;
const afNote = (m) => `依住警器安裝清冊回填${AF_KIND[m.kind][2]}（安裝日 ${m.date.roc}${m.date.iso < AF_START ? "，早於專案開始不列為訪視" : ""}）`;

if (typeof module !== "undefined") module.exports = { afNorm, afCore, afRoom, afFloor, afPrint, afMatch, afRoc, afPlan, hvMatch, hvNote, AF_TALK };

// ---- 畫面 ----
let afPending = null;   // { kind: "alarm"|"visit", list, unmatched, total, picked:Set }
const afCan = () => me && (me.role === "admin" || me.role === "team");
const afButton = () => afCan() ? `<button id="afBtn" class="ghost">📋 匯入住警器安裝清冊</button><input id="afFile" type="file" accept=".csv" hidden>
  <button id="hvBtn" class="ghost">🏠 匯入居家訪視紀錄</button><input id="hvFile" type="file" accept=".xlsx,.csv" hidden>` : "";
const afTodo = (m) => afPlan(m.v, afPending.kind, m.date.iso);

function afPanel() {
  if (!afPending) return "";
  const p = afPending, alarm = p.kind === "alarm", todo = p.list.filter(afTodo), done = p.list.filter((m) => !afTodo(m));
  const nPick = todo.filter((m) => p.picked.has(m.v.id)).length;
  const tr = (m, box) => `<tr class="${box ? "" : "done"}"><td>${box ? `<input type="checkbox" data-af="${m.v.id}" ${p.picked.has(m.v.id) ? "checked" : ""}>` : "⏭️"}</td>
    <td>${m.v.stage}-${m.v.seq}</td><td>${esc(m.v.unit)}</td><td>${esc(m.v.name_m)}</td><td>${esc(m.v.addr_m)}</td><td>${AF_KIND[m.kind][0]}</td>
    <td>${alarm ? m.date.roc : m.date.iso.slice(5).replace("-", "/")}</td><td>${box ? esc(afPlanText(afTodo(m))) : "已有資料，不用改"}</td></tr>`;
  const head = alarm
    ? `清冊 ${p.total} 筆：對到名冊 ${p.list.length} 人（要更新 ${todo.length}、已有資料 ${done.length}）；${me.role === "team" ? "不在本分隊名冊" : "名冊裡找不到"} ${p.unmatched.length} 筆（一般安裝或別的分隊，不用處理）。
      住警器寫「有裝・正常」；安裝日在 9/21 專案開始以後的同時當訪視日，以前的只寫住警器。`
    : `訪視紀錄 ${p.used} 筆（9/21 以後）：對到名冊 ${p.list.length} 人（要更新 ${todo.length}、已有資料 ${done.length}）。
      門牌＋樓層相同的自動勾；同門牌不同樓、名冊沒寫樓層的列出來不勾，請確認是同一戶再勾。寫入訪視日、宣導「是」，住警器空白的填「${AF_TALK}」（算完成，之後清冊對到會自動改成有裝）。`;
  return `<div class="card" id="afPanel"><h2>${alarm ? "住警器安裝清冊" : "居家訪視紀錄"}比對結果</h2>
    <p class="note">${head} 檔案只在這台電腦比對，沒有上傳；分隊自己填的住警器狀況不會被改。</p>
    ${p.noFp ? `<p class="err">名冊有 ${p.noFp} 人還沒有比對用的指紋，這些人比不到，請通知管理者。</p>` : ""}
    <div class="tablewrap" style="max-height:420px"><table><tr><th>回填</th><th>階段-序號</th><th>分隊</th><th>姓名</th><th>地址</th><th>比對依據</th><th>${alarm ? "安裝日" : "訪視日"}</th><th>會寫入</th></tr>
    ${todo.map((m) => tr(m, true)).join("")}${done.map((m) => tr(m, false)).join("")}</table></div>
    <p><button id="afGo" ${nPick ? "" : "disabled"}>確認更新 ${nPick} 人</button> <button id="afCancel" class="ghost">取消</button></p></div>`;
}

// 居家訪視檔：Excel（宣導系統匯出）或 CSV，要有「宣導日期」和地址欄
async function hvRead(file) {
  let table;
  if (/\.csv$/i.test(file.name)) {
    const rows = csvParse(csvDecode(await file.arrayBuffer()));
    table = rows.map((r) => [r["宣導日期"], r["場所地址"] || r["地址"]]);
    if (!rows[0] || !("宣導日期" in rows[0])) table = null;
  } else {
    await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0], head = {};
    ws.getRow(1).eachCell((c, i) => { head[String(c.value || "").trim()] = i; });
    const di = head["宣導日期"], ai = head["場所地址"] || head["地址"];
    if (di && ai) {
      table = [];
      ws.eachRow((r, n) => { if (n > 1) table.push([r.getCell(di).value, r.getCell(ai).value]); });
    }
  }
  if (!table) throw new Error("這個檔案不像居家訪視紀錄，要有「宣導日期」和「場所地址」欄");
  const ymd = (d) => d instanceof Date ? `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` : String(d || "");
  return table.map(([d, a]) => ({ date: ymd(d), addr: String(a || "").trim() })).filter((r) => r.addr);
}

function afBind() {
  const pick = async (kind, file) => {
    if (!db.fp_salt) { alert("比對功能還沒啟用，請通知管理者。"); return; }
    const mine = db.visits.filter((v) => me.role === "admin" || v.unit === me.name);
    if (kind === "alarm") {
      const rows = csvParse(csvDecode(await file.arrayBuffer()));
      const miss = ["姓名", "地址", "安裝日期"].filter((k) => !(rows[0] && k in rows[0]));
      if (miss.length) { alert("這個檔案不像住警器安裝清冊，找不到欄位：" + miss.join("、")); return; }
      const r = await afMatch(db.fp_salt, rows, mine);
      afPending = { kind, ...r, total: rows.filter((x) => afName(x["姓名"])).length };
    } else {
      const r = await hvMatch(db.fp_salt, await hvRead(file), mine);
      afPending = { kind, ...r };
    }
    afPending.picked = new Set(afPending.list.filter((m) => AF_KIND[m.kind][1] && afTodo(m)).map((m) => m.v.id));
    renderTabs();
    const el = $("#afPanel"); if (el) el.scrollIntoView({ block: "start" });
  };
  [["alarm", "#afBtn", "#afFile"], ["visit", "#hvBtn", "#hvFile"]].forEach(([kind, bs, fs]) => {
    const b = $(bs), f = $(fs);
    if (!b || !f) return;
    b.addEventListener("click", () => f.click());
    f.addEventListener("change", async () => {
      const file = f.files[0]; f.value = "";
      if (!file) return;
      try { await pick(kind, file); } catch (e) { alert("讀取檔案失敗：" + e.message); }
    });
  });
  const count = () => afPending.list.filter((m) => afTodo(m) && afPending.picked.has(m.v.id));
  document.querySelectorAll("[data-af]").forEach((c) => c.addEventListener("change", () => {
    c.checked ? afPending.picked.add(c.dataset.af) : afPending.picked.delete(c.dataset.af);
    const n = count().length, go = $("#afGo");
    go.textContent = `確認更新 ${n} 人`; go.disabled = !n;
  }));
  const cancel = $("#afCancel"); if (cancel) cancel.addEventListener("click", () => { afPending = null; renderTabs(); });
  const go = $("#afGo");
  if (go) go.addEventListener("click", async () => {
    const kind = afPending.kind;
    const items = count().map((m) => ({ id: m.v.id, kind, date: m.date.iso, note: kind === "alarm" ? afNote(m) : hvNote(m.date) + AF_KIND[m.kind][2] }));
    if (!items.length || !confirm(`要更新 ${items.length} 人？`)) return;
    go.disabled = true; go.textContent = "更新中…（人多會跑一下）";
    try {
      const r = await api({ action: "visits_fill", items });
      afPending = null;
      await load();
      alert(`更新完成：${r.filled} 人` + (r.skipped.length ? `；略過 ${r.skipped.length} 人（已有資料或沒有權限）` : ""));
    } catch (e) {
      if (e.message !== "login") alert("更新失敗：" + e.message);
      go.disabled = false; go.textContent = `確認更新 ${items.length} 人`;
    }
  });
}
