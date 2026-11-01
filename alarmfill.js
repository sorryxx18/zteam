// ---- 住警器安裝清冊匯入比對（2026-11-01）----
// 清冊 CSV 只在瀏覽器讀；後端名冊存的是姓名、門牌的雜湊「指紋」（visits.fp＝姓名|門牌|門牌＋房號），比對完只送回填結果。
// 規則（使用者 10/20、11/1 定案）：同名同址、同址家人、宿舍同房號 → 預設勾；同名不同址 → 列出不勾；已有資料的列不動。
// 宿舍＝同一門牌名冊上 5 人以上、且一半以上有寫房號（例如 599 號大忠樓）；只比到同一房號才算，避免整棟鄰居都被勾。
// 同門牌人多但沒有房號的（例如一家 6 口）仍當家人。
const AF_DORM = 5;
const AF_CN = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
function afNorm(addr) {
  let a = String(addr || "").replace(/[\s　()（）]/g, "").replace(/臺/g, "台")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－—–]/g, "-").replace(/之/g, "-");
  a = a.replace(/^台北市/, "").replace(/^[一-鿿]{1,3}區/, "").replace(/^[一-鿿]{1,3}里(?=[一-鿿])/, "").replace(/^\d+鄰/, "");
  return a.replace(/([一二三四五六七八九])段/g, (m, d) => AF_CN[d] + "段");
}
const afCore = (addr) => { const a = afNorm(addr), m = /^(.*?號)/.exec(a); return m ? m[1] : a; };
// 房號：「220室」「424房」；清冊常把房號寫在備註
function afRoom(...parts) { const m = /(\d+)\s*[室房]/.exec(parts.map((p) => afNorm(p)).join(" ")); return m ? m[1] : ""; }
const afName = (n) => String(n || "").replace(/[\s　]/g, "");
async function afHash(salt, kind, v) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + kind + "|" + v));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 指紋：姓名|門牌|門牌＋房號（沒房號就空）
async function afPrint(salt, name, addr, note) {
  const core = afCore(addr), room = afRoom(addr, note || "");
  return [await afHash(salt, "n", afName(name)), await afHash(salt, "a", core), room ? await afHash(salt, "r", core + "#" + room) : ""].join("|");
}
const afFilled = (v) => !!(v.visit_date || v.alarm || v.alarm_installed);
const afRoc = (d) => { const m = /^(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(String(d || "")); return m ? { iso: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, roc: `${m[1] - 1911}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}` } : null; };
const AF_KIND = { exact: ["✅ 同名同址", true, ""], family: ["👪 同址家人", true, "：同址家人名下安裝"], room: ["🏢 宿舍同房", true, "：同房登記人名下安裝"], name: ["⚠️ 同名不同址", false, "：清冊地址不同，經確認同一人"] };
const AF_RANK = { exact: 0, room: 1, family: 2, name: 3 };

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

if (typeof module !== "undefined") module.exports = { afNorm, afCore, afRoom, afPrint, afMatch, afRoc };

// ---- 畫面 ----
let afPending = null;   // { list, unmatched, total, picked:Set }
const afCan = () => me && (me.role === "admin" || me.role === "team");
const afButton = () => afCan() ? `<button id="afBtn" class="ghost">📋 匯入住警器安裝清冊</button><input id="afFile" type="file" accept=".csv" hidden>` : "";

function afPanel() {
  if (!afPending) return "";
  const p = afPending, todo = p.list.filter((m) => !afFilled(m.v)), done = p.list.filter((m) => afFilled(m.v));
  const nPick = todo.filter((m) => p.picked.has(m.v.id)).length;
  const tr = (m, box) => `<tr class="${box ? "" : "done"}"><td>${box ? `<input type="checkbox" data-af="${m.v.id}" ${p.picked.has(m.v.id) ? "checked" : ""}>` : "⏭️"}</td>
    <td>${m.v.stage}-${m.v.seq}</td><td>${esc(m.v.unit)}</td><td>${esc(m.v.name_m)}</td><td>${esc(m.v.addr_m)}</td><td>${AF_KIND[m.kind][0]}</td>
    <td>${m.date.roc}</td><td>${box ? "" : esc([m.v.alarm, m.v.alarm_installed].filter(Boolean).join("／") || m.v.visit_date)}</td></tr>`;
  return `<div class="card" id="afPanel"><h2>住警器安裝清冊比對結果</h2>
    <p class="note">清冊 ${p.total} 筆：對到名冊 ${p.list.length} 人（可回填 ${todo.length}、已有資料 ${done.length}）；${me.role === "team" ? "不在本分隊名冊" : "名冊裡找不到"} ${p.unmatched.length} 筆（一般安裝或別的分隊，不用處理）。
    清冊只在這台電腦比對，沒有上傳。回填內容：住警器「有裝・正常」、處理「已協助安裝」、訪視日＝安裝日，備註註明來源；已有資料的列不會被改。</p>
    ${p.noFp ? `<p class="err">名冊有 ${p.noFp} 人還沒有比對用的指紋，這些人比不到，請通知管理者。</p>` : ""}
    <div class="tablewrap" style="max-height:420px"><table><tr><th>回填</th><th>階段-序號</th><th>分隊</th><th>姓名</th><th>地址</th><th>比對依據</th><th>安裝日</th><th>目前資料</th></tr>
    ${todo.map((m) => tr(m, true)).join("")}${done.map((m) => tr(m, false)).join("")}</table></div>
    <p><button id="afGo" ${nPick ? "" : "disabled"}>確認回填 ${nPick} 人</button> <button id="afCancel" class="ghost">取消</button></p></div>`;
}

function afBind() {
  const b = $("#afBtn"), f = $("#afFile");
  if (b && f) {
    b.addEventListener("click", () => f.click());
    f.addEventListener("change", async () => {
      const file = f.files[0]; f.value = "";
      if (!file) return;
      try {
        const rows = csvParse(csvDecode(await file.arrayBuffer()));
        const miss = ["姓名", "地址", "安裝日期"].filter((k) => !(rows[0] && k in rows[0]));
        if (miss.length) { alert("這個檔案不像住警器安裝清冊，找不到欄位：" + miss.join("、")); return; }
        if (!db.fp_salt) { alert("比對功能還沒啟用，請通知管理者。"); return; }
        const mine = db.visits.filter((v) => me.role === "admin" || v.unit === me.name);
        const r = await afMatch(db.fp_salt, rows, mine);
        afPending = { ...r, total: rows.filter((x) => afName(x["姓名"])).length, picked: new Set(r.list.filter((m) => !afFilled(m.v) && AF_KIND[m.kind][1]).map((m) => m.v.id)) };
        renderTabs();
        const el = $("#afPanel"); if (el) el.scrollIntoView({ block: "start" });
      } catch (e) { alert("讀取清冊失敗：" + e.message); }
    });
  }
  document.querySelectorAll("[data-af]").forEach((c) => c.addEventListener("change", () => {
    c.checked ? afPending.picked.add(c.dataset.af) : afPending.picked.delete(c.dataset.af);
    const n = afPending.list.filter((m) => !afFilled(m.v) && afPending.picked.has(m.v.id)).length, go = $("#afGo");
    go.textContent = `確認回填 ${n} 人`; go.disabled = !n;
  }));
  const cancel = $("#afCancel"); if (cancel) cancel.addEventListener("click", () => { afPending = null; renderTabs(); });
  const go = $("#afGo");
  if (go) go.addEventListener("click", async () => {
    const items = afPending.list.filter((m) => !afFilled(m.v) && afPending.picked.has(m.v.id))
      .map((m) => ({ id: m.v.id, date: m.date.iso, note: `依住警器安裝清冊回填${AF_KIND[m.kind][2]}（安裝日 ${m.date.roc}）` }));
    if (!items.length || !confirm(`要回填 ${items.length} 人？`)) return;
    go.disabled = true; go.textContent = "回填中…（人多會跑一下）";
    try {
      const r = await api({ action: "visits_fill", items });
      afPending = null;
      await load();
      alert(`回填完成：${r.filled} 人` + (r.skipped.length ? `；略過 ${r.skipped.length} 人（已有資料或沒有權限）` : ""));
    } catch (e) {
      if (e.message !== "login") alert("回填失敗：" + e.message);
      go.disabled = false; go.textContent = `確認回填 ${items.length} 人`;
    }
  });
}
