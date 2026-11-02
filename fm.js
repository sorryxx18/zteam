/* 防火管理月報：匯入上月大隊月報＋本月不合格明細＋各中隊報表，核對後照原 Excel 格式加一頁本月。11/2 改成網站共用樣式、管理者自動存檔 */
(function (root) {
  "use strict";
  const units = ["大安中隊", "信義中隊", "南港中隊"];
  const cols = "B C D E F G H I J K L M N O P Q R S T U V W X Y Z AA AB AC AD".split(" ");
  function number(v) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  function ratio(a, b) {
    return a === null || b === null || !b ? null : a / b;
  }
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const TNS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
  const els = (d, n) => Array.from(d.getElementsByTagNameNS("*", n));
  function xml(s) {
    const d = new root.DOMParser().parseFromString(s, "application/xml");
    if (els(d, "parsererror").length) throw Error("XML 格式錯誤");
    return d;
  }
  const serial = (d) => new root.XMLSerializer().serializeToString(d);
  const clean = (s) => String(s || "").replace(/\s/g, "");
  const colName = (n) => (n < 26 ? String.fromCharCode(65 + n) : "A" + String.fromCharCode(65 + n - 26));
  const colIndex = (s) => Array.from(s).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  function rates(v) {
    for (const [out, a, b] of [
      ["D", "C", "B"],
      ["H", "G", "F"],
      ["L", "K", "J"],
      ["P", "O", "N"],
      ["Y", "X", "V"],
    ])
      v[out] = ratio(v[a], v[b]);
    return v;
  }
  async function zipLoad(bytes) {
    if (!root.JSZip) {
      if (typeof loadJSZip === "function") await loadJSZip();
      else throw Error("離線 JSZip 未載入");
    }
    return root.JSZip.loadAsync(bytes);
  }
  async function matrix(zip, path, ods = false) {
    const d = xml(await zip.file(path).async("string"));
    const rows = [];
    if (ods) {
      const table = els(d, "table")[0];
      if (!table) throw Error("找不到工作表");
      for (const row of els(table, "table-row").slice(0, 250)) {
        const values = [];
        for (const c of Array.from(row.childNodes).filter(
          (x) => x.localName === "table-cell" || x.localName === "covered-table-cell",
        )) {
          const repeat = Math.min(31, Number(c.getAttributeNS(TNS, "number-columns-repeated") || 1));
          const ps = els(c, "p");
          const text = ps.map((p) => p.textContent).join("\n");
          for (let i = 0; i < repeat && values.length < 31; i++) values.push(text);
        }
        rows.push(values);
      }
    } else {
      const ss = zip.file("xl/sharedStrings.xml")
        ? els(xml(await zip.file("xl/sharedStrings.xml").async("string")), "si").map((x) =>
            els(x, "t")
              .map((t) => t.textContent)
              .join(""),
          )
        : [];
      for (const r of els(d, "row")) {
        const values = [];
        for (const c of els(r, "c")) {
          const idx = colIndex(c.getAttribute("r").replace(/\d/g, ""));
          if (idx > 30) continue;
          const type = c.getAttribute("t");
          const v = els(c, "v")[0];
          values[idx] =
            type === "s"
              ? ss[Number(v?.textContent)]
              : type === "inlineStr"
                ? els(c, "t")
                    .map((t) => t.textContent)
                    .join("")
                : (v?.textContent ?? "");
        }
        rows[Number(r.getAttribute("r")) - 1] = values;
      }
    }
    return rows;
  }
  async function workbook(zip) {
    const doc = xml(await zip.file("xl/workbook.xml").async("string"));
    const rel = xml(await zip.file("xl/_rels/workbook.xml.rels").async("string"));
    return {
      doc,
      rel,
      sheets: els(doc, "sheet").map((s) => {
        const id = s.getAttributeNS(RNS, "id");
        const target = els(rel, "Relationship")
          .find((r) => r.getAttribute("Id") === id)
          ?.getAttribute("Target");
        return {
          name: s.getAttribute("name"),
          path: target?.startsWith("/") ? target.slice(1) : "xl/" + target,
          node: s,
        };
      }),
    };
  }
  function parseRows(rows) {
    const hi = rows.findIndex((r) => r && r.some((c) => clean(c) === "遴用防火管理人"));
    if (hi < 0 || !rows[hi].some((c) => clean(c).includes("製定共同消防防護計畫")))
      throw Error("找不到防火管理月報表頭");
    const total = rows.findIndex((r, i) => i > hi && r && clean(r[0]) === "總計");
    if (total < 0) throw Error("找不到總計列");
    const txt = rows.slice(0, hi).flat().join(" ");
    const match = txt.match(/(?:中華民國\s*)?(\d{2,3})\s*年\s*(\d{1,2})\s*月/);
    const values = {};
    for (const c of cols) values[c] = number(rows[total][colIndex(c)]);
    return {
      values: rates(values),
      sourcePeriod: match ? match[1] + match[2].padStart(2, "0") : null,
      totalRow: total + 1,
      rows,
      headerRow: hi + 1,
    };
  }
  async function readReport(bytes, kind = "xlsx", sheetName) {
    const zip = await zipLoad(bytes);
    let path = "content.xml";
    if (kind !== "ods") {
      const wb = await workbook(zip);
      const sheet = sheetName ? wb.sheets.find((s) => s.name === sheetName) : wb.sheets[0];
      if (!sheet) throw Error("找不到指定月份工作表");
      path = sheet.path;
    }
    return parseRows(await matrix(zip, path, kind === "ods"));
  }
  function csvRows(text) {
    const rows = [];
    let row = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (quoted) throw Error("CSV 引號未閉合");
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
  function parseCSV(bytes, period) {
    let text,
      encoding = "UTF-8";
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      text = new TextDecoder("big5", { fatal: true }).decode(bytes);
      encoding = "CP950 / Big5";
    }
    const rows = csvRows(text.replace(/^\uFEFF/, ""));
    const h = rows.shift()?.map(clean) || [];
    const needed = ["分隊名稱", "檢查日期", "安檢項目", "檢查結果"];
    if (needed.some((k) => !h.includes(k))) throw Error("CSV 缺少必要表頭");
    const counts = Object.fromEntries(units.map((u) => [u, 0]));
    const out = {
      counts,
      encoding,
      tailRows: 0,
      otherMonths: 0,
      unknownUnits: 0,
      missingUnits: 0,
      invalidDates: 0,
      matched: 0,
      blocked: false,
    };
    const team = {
      安和分隊: units[0],
      金華分隊: units[0],
      信義分隊: units[1],
      莊敬分隊: units[1],
      南港分隊: units[2],
      舊莊分隊: units[2],
      成德分隊: units[2],
    };
    for (const r of rows) {
      if (r.every((c) => !clean(c))) continue;
      if (/^\d+筆$/.test(clean(r[0])) && r.slice(1).every((c) => !clean(c))) {
        out.tailRows++;
        continue;
      }
      const get = (k) => clean(r[h.indexOf(k)]);
      const items = String(r[h.indexOf("安檢項目")] || "")
        .trim()
        .split(/\r?\n/)
        .map(clean);
      const results = String(r[h.indexOf("檢查結果")] || "")
        .trim()
        .split(/\r?\n/)
        .map(clean);
      if (!items.some((x, i) => x === "防火管理" && /^(限改|限期改善)$/.test(results[i] || ""))) continue;
      const m = get("檢查日期").match(/^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) {
        out.invalidDates++;
        continue;
      }
      const y = Number(m[1]) > 1911 ? Number(m[1]) - 1911 : Number(m[1]);
      if (String(y) + m[2].padStart(2, "0") !== period) {
        out.otherMonths++;
        continue;
      }
      const u = get("分隊名稱");
      if (!u) {
        out.missingUnits++;
        continue;
      }
      if (!team[u]) {
        out.unknownUnits++;
        continue;
      }
      counts[team[u]]++;
      out.matched++;
    }
    out.blocked = !!(out.unknownUnits || out.missingUnits || out.invalidDates);
    return out;
  }
  function create(period = "11510") {
    if (!/^\d{3}(0[1-9]|1[0-2])$/.test(period)) throw Error("請選擇有效民國年月");
    return { period, previous: null, template: null, reports: {}, csv: null, choices: {}, ledger: null };
  }
  function prevPeriod(p) {
    let y = Number(p.slice(0, 3)),
      m = Number(p.slice(3)) - 1;
    if (!m) {
      y--;
      m = 12;
    }
    return String(y) + String(m).padStart(2, "0");
  }
  async function importPrevious(s, bytes) {
    const p = prevPeriod(s.period);
    const report = await readReport(bytes, "xlsx", String(Number(p.slice(3))));
    if (report.sourcePeriod !== p) throw Error("上月原檔月份不符");
    const previous = {};
    for (const u of units) {
      const row = report.rows.find((r) => r && clean(r[0]) === u);
      if (!row) throw Error("上月缺少單位：" + u);
      previous[u] = {};
      for (const c of cols) previous[u][c] = number(row[colIndex(c)]);
    }
    s.previous = previous;
    s.template = new Uint8Array(bytes);
    s.choices = {};
    return review(s);
  }
  async function importUnit(s, unit, bytes, kind = "xlsx") {
    if (!units.includes(unit)) throw Error("請明確選擇中隊單位");
    const r = await readReport(bytes, kind);
    if (r.sourcePeriod && r.sourcePeriod !== s.period) throw Error(`檔案標題寫 ${Number(r.sourcePeriod.slice(0, -2))} 年 ${Number(r.sourcePeriod.slice(-2))} 月，跟所選月份不符。確定是本月的話，請改用上方「中隊網頁填報 → 用 Excel 檔帶入」，核對後送出`);
    const named = r.rows
      .map((x) => x?.[0])
      .filter((x) => units.includes(clean(x)))
      .map(clean);
    if (named.length && (!named.includes(unit) || named.length > 1))
      throw Error("來源單位不符或含多個中隊，請提供單一中隊報表");
    s.reports[unit] = { values: r.values, sourcePeriod: r.sourcePeriod, confirmedPeriod: null, totalRow: r.totalRow };
    delete s.choices[unit];
    delete s.choices[unit + ":T"];
    return review(s);
  }
  function confirmPeriod(s, u, p) {
    if (p !== s.period || !s.reports[u]) throw Error("確認期間不符");
    s.reports[u].confirmedPeriod = p;
    return review(s);
  }
  function importCSV(s, bytes) {
    if (!bytes) throw Error("請提供本月不合格 CSV");
    s.csv = parseCSV(bytes, s.period);
    s.choices = {};
    return review(s);
  }
  function choose(s, u, choice, field = "AA") {
    if (!s.reports[u] || !["computed", "reported"].includes(choice) || !["AA", "T"].includes(field))
      throw Error("請選擇採推算或採填報");
    s.choices[field === "AA" ? u : u + ":T"] = choice;
    return review(s);
  }
  // 中隊網頁填報（11/2）：input 只有「當月現況」和「本月新增」，累計＝上月大隊月報＋本月；一月從 0 起算
  const WEB_NOW = ["B", "C", "F", "G", "J", "K", "N", "O", "U", "V", "W", "X", "Z"];
  function webValues(s, u, r) {
    const i = r.input || {}, p = s.previous?.[u], jan = s.period.slice(3) === "01";
    const has = (x) => x !== null && x !== undefined;
    const acc = (k, m) => (!has(i[m]) ? null : jan ? i[m] : p && has(p[k]) ? p[k] + i[m] : null);
    const v = {};
    for (const c of cols) v[c] = null;
    for (const c of WEB_NOW) v[c] = has(i[c]) ? i[c] : null;
    v.R = acc("R", "Rm");
    v.S = acc("S", "Sm");
    v.AC = acc("AC", "U");
    return v;
  }
  // ---- 安管清冊（11/2 局承辦人意見）：應／已家數改用安管 5 份清冊算，不靠中隊填 ----
  // 防管全清冊、共同清冊（場所列管清冊格式）、未遴用、未計畫（防火管理狀況格式）、限改中名單（限改單格式）
  // 只取場所編號、名稱、列管單位、列管日期、列管狀況、停業與違規類型；身分證、姓名、地址讀了就丟
  const SQ_CODE = { 211: "大安中隊", 213: "大安中隊", 221: "南港中隊", 222: "南港中隊", 223: "南港中隊", 231: "信義中隊", 232: "信義中隊" };
  const SQ_TEAM = { 安和分隊: "大安中隊", 金華分隊: "大安中隊", 信義分隊: "信義中隊", 莊敬分隊: "信義中隊", 南港分隊: "南港中隊", 舊莊分隊: "南港中隊", 成德分隊: "南港中隊" };
  function decodeCSV(bytes) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { text = new TextDecoder("big5").decode(bytes); }
    const rows = csvRows(text.replace(/^﻿/, ""));
    const h = (rows.shift() || []).map(clean);
    return rows.filter((r) => r.length > 3 && r.some((c) => clean(c))).map((r) => Object.fromEntries(h.map((k, i) => [k, String(r[i] ?? "").trim()])));
  }
  // 依表頭認檔；全清冊與共同清冊同格式 → 檔名有「共同」或筆數較少的是共同；未遴用與未計畫同格式 → 檔名有「計畫」或筆數較多的是未計畫（未遴用一定也未計畫）
  function sortLedgerFiles(files) {
    const reg = [], status = [], open = [];
    for (const f of files) {
      const rows = f.rows, h = rows[0] ? Object.keys(rows[0]) : [];
      if (h.includes("單況") && h.includes("違反事項")) open.push(f);
      else if (h.includes("防火管理人") && h.includes("防護計畫")) status.push(f);
      else if (h.includes("列管單位") && h.includes("管理項目")) reg.push(f);
      else throw Error(`「${f.name}」看不出是哪一份安管清冊`);
    }
    const pick = (list, kw, bigIsKw) => {
      if (list.length !== 2) return null;
      const byName = list.find((f) => f.name.includes(kw));
      if (byName) return [byName, list.find((f) => f !== byName)];
      const [a, b] = [...list].sort((x, y) => x.rows.length - y.rows.length);
      return bigIsKw ? [b, a] : [a, b];
    };
    const r = pick(reg, "共同", false), st = pick(status, "計畫", true);
    if (!r) throw Error("需要「防管全」和「共同」兩份場所清冊");
    if (!st) throw Error("需要「未遴用」和「未計畫」兩份清冊");
    if (open.length !== 1) throw Error("需要一份「限改中」名單");
    return { joint: r[0].rows, all: r[1].rows, noPlan: st[0].rows, noMgr: st[1].rows, open: open[0].rows };
  }
  function monthEnd(p) {
    const y = Number(p.slice(0, 3)) + 1911, m = Number(p.slice(3));
    return new Date(y, m, 0);
  }
  const ymd = (d) => d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
  function computeLedger(period, files) {
    const f = sortLedgerFiles(files), end = monthEnd(period), newSince = ymd(new Date(end.getTime() - 30 * 86400000));
    const jid = new Set(f.joint.map((r) => r["場所編號"]));
    const openOf = {};
    for (const r of f.open) {
      if (r["單況"] !== "限改") continue;   // 複查＝已複查合格
      const v = r["違反事項"] || "", type = /共同防火管理人/.test(v) ? "joint" : /遴用防火管理人/.test(v) ? "mgr" : /消防防護計畫/.test(v) ? "plan" : "other";
      (openOf[r["場所編號"]] = openOf[r["場所編號"]] || []).push({ type, due: r["限改期限"], date: (r["檢查日期"] || "").slice(0, 10), what: v.split(/\s+/)[0] || v.slice(0, 20) });
    }
    const noMgr = new Set(f.noMgr.map((r) => r["場所編號"])), noPlan = new Set(f.noPlan.map((r) => r["場所編號"]));
    // 11/2 使用者：遴用看安管實際狀態。限改中但狀態清冊已寫「已遴用」（例：瓏澤 9/22 補遴用、限改待複查）→ 算已遴用，計畫仍照清冊
    const appointed = new Set([...f.noMgr, ...f.noPlan].filter((r) => r["防火管理人"] === "已遴用").map((r) => r["場所編號"]));
    const out = { period, asOf: ymd(end), newSince, units: {} };
    for (const u of units) out.units[u] = { B: 0, C: 0, J: 0, K: 0, G: 0, gapMgr: [], gapPlan: [], gapJoint: [], open: [], excl: { 免列管: 0, 停業: 0, 未營業: [], 新手村: [] } };
    const why = (r) => r["列管狀況"] === "免列管" ? "免列管" : r["停業日期"] ? "停業" : /尚未營業|立案中|籌備/.test(r["場所名稱"]) ? "未營業" : r["列管日期"] >= newSince && !openOf[r["場所編號"]] ? "新手村" : "";
    const nm = (r) => r["場所名稱"].replace(/股份有限公司|有限公司/g, "").slice(0, 24);
    const today = ymd(new Date());
    for (const r of f.all) {
      const u = SQ_CODE[r["列管單位"]];
      if (!u) continue;
      const x = out.units[u], id = r["場所編號"], w = why(r), op = openOf[id] || [], joint = jid.has(id);
      for (const o of op) x.open.push({ name: nm(r), ...o, counted: !w, overdue: o.due && o.due < today });
      if (w) { if (Array.isArray(x.excl[w])) x.excl[w].push(nm(r) + "（" + r["列管日期"] + "）"); else x.excl[w]++; continue; }
      if (joint) {
        x.J++;
        if (op.some((o) => o.type === "joint")) x.gapJoint.push(nm(r)); else x.K++;
        continue;
      }
      x.B++;
      const m = noMgr.has(id) || (op.some((o) => o.type === "mgr") && !appointed.has(id));
      const p = m || noPlan.has(id) || op.some((o) => o.type === "plan");   // 沒遴用就一定沒計畫
      if (m) x.gapMgr.push(nm(r) + (op.length ? "（限改中）" : "（列管 " + r["列管日期"] + "，未開限改）")); else x.C++;
      if (!m && appointed.has(id) && op.some((o) => o.type === "mgr")) x.note = (x.note || []).concat(nm(r) + "：限改未遴用，安管已登錄遴用、待複查 → 算已遴用");
      if (p) x.gapPlan.push(nm(r) + (m ? "" : op.length ? "（限改中）" : "（未開限改）")); else x.G++;
    }
    for (const u of units) { const x = out.units[u]; x.F = x.B; }
    return out;
  }
  async function importLedger(s, list) {
    const files = [];
    for (const { name, bytes } of list) files.push({ name, rows: decodeCSV(bytes) });
    s.ledger = computeLedger(s.period, files);
    return review(s);
  }
  const has0 = (x) => x !== null && x !== undefined;
  const show0 = (v) => (v === null || v === undefined ? 0 : v);
  function review(s) {
    const out = {
      blockers: [],
      missing: units.filter((u) => !s.reports[u]),
      computed: {},
      differences: [],
      fixes: [],
      ledgerDiff: [],   // 中隊填的家數跟安管清冊算的不同（以清冊為準）   // 匯入時自動修正的（11/2 十月：信義累計忘了加、罰鍰空白）
      checks: [],   // 匯出前檢查：{ bad: true 擋正式匯出 }
      acDifferences: [],
      units: {},
      total: {},
      formal: false,
      draft: false,
    };
    if (!s.template || !s.previous) out.blockers.push("缺少上月原始 XLSX");
    if (!s.csv) out.blockers.push("缺少本月不合格 CSV");
    else if (s.csv.blocked) out.blockers.push("CSV 有漏單位、未知分隊或無效日期，請修正來源");
    for (const u of units) {
      const old = s.previous?.[u]?.AA;
      out.computed[u] = old === null || old === undefined || !s.csv ? null : old + s.csv.counts[u];
      const r = s.reports[u];
      if (!r) continue;
      if (!r.sourcePeriod && r.confirmedPeriod !== s.period) out.blockers.push(u + "：來源年月空白，請確認期間");
      if (out.computed[u] === null) out.blockers.push(u + "：上月 AA 或 CSV 缺來源");
      const v = r.via === "web" ? webValues(s, u, r) : { ...r.values };
      const lg = s.ledger?.units?.[u];
      if (lg) {
        const d = [];
        for (const c of ["B", "C", "F", "G", "J", "K"]) {
          if (has0(v[c]) && v[c] !== lg[c]) { out.ledgerDiff.push({ unit: u, field: c, reported: v[c], ledger: lg[c] }); d.push(`${labels[c]} ${v[c]}→${lg[c]}`); }
          v[c] = lg[c];
        }
        if (d.length && r.via !== "web") out.fixes.push(`${u.replace("中隊", "")}家數依安管清冊（中隊填的不採用）：${d.join("、")}`);
      }
      const p = s.previous?.[u], jan = s.period.slice(3) === "01", has = (x) => x !== null && x !== undefined, short = u.replace("中隊", "");
      // 11/2 使用者：罰鍰原則上沒有＝0；有的話大隊另外填（s.fines），不靠中隊
      const fn = s.fines?.[u];
      for (const c of ["U", "V", "W", "X", "Z"]) if (fn && has(fn[c])) v[c] = fn[c]; else if (r.via === "web" && !has(v[c])) v[c] = 0;
      if (r.via !== "web") {
        const blank = ["U", "V", "W", "X", "Z"].filter((c) => !has(v[c]));
        blank.forEach((c) => (v[c] = 0));
        // 罰鍰原則上沒有：空白直接當 0，不另外列

        for (const k of ["R", "S"]) if (!jan && p && has(p[k]) && has(v[k]) && v[k] < p[k]) {
          out.fixes.push(`${short}「${labels[k]}」填 ${v[k]}，比上月累計 ${p[k]} 少，判斷是只填本月，已改成 ${p[k]}＋${v[k]}＝${p[k] + v[k]}`);
          v[k] = p[k] + v[k];
        }
      }
      // 累計裁罰＝上月累計＋本期處罰鍰件次（跟累計限改一樣自己算，不靠中隊填）
      const ac = jan ? v.U : p && has(p.AC) && has(v.U) ? p.AC + v.U : null;
      if (r.via !== "web" && has(ac) && has(v.AC) && v.AC !== ac) out.fixes.push(`${short}「累計裁罰」${has(v.AC) ? "填 " + v.AC : "空白"}，改用上月 ${p ? show0(p.AC) : 0}＋本期 ${v.U}＝${ac}`);
      if (has(ac)) v.AC = ac;
      for (const field of ["AA", "T"]) {
        const computed = field === "AA" ? out.computed[u] : (s.csv?.counts[u] ?? null),
          key = field === "AA" ? u : u + ":T";
        // 11/2 使用者：本期／累計限改一律以安管明細為準，中隊填報不同只留紀錄，不再讓人選
        if (r.via !== "web" && v[field] !== computed) out.differences.push({ unit: u, field, reported: v[field], computed, choice: "computed" });
        if (computed !== null) v[field] = computed;
      }
      out.acDifferences.push({
        unit: u,
        previous: s.previous?.[u]?.AC ?? null,
        reported: v.AC,
        note: "AC 沿用中隊填報，未提供累計裁罰明細，不推算缺值",
      });
      for (const c of ["E", "I", "M", "Q", "AB", "AD"]) v[c] = null;
      out.units[u] = rates(v);
      if (v.V === 0 && v.X === 0) out.units[u].Y = 0;   // 沒有罰鍰：收繳率照舊月報填 0，不留空
      // 匯出前檢查：跟上月比
      for (const [a, b] of [["C", "B"], ["G", "F"], ["K", "J"], ["O", "N"]]) if (has(v[a]) && has(v[b]) && v[a] > v[b]) out.checks.push({ bad: true, text: `${short}「${labels[a]}」${v[a]} 比「${labels[b]}」${v[b]} 多` });
      // 11/2 使用者：沒遴用防火管理人就一定沒製定消防防護計畫 → 未製定家數 ≥ 未遴用家數
      if (has(v.B) && has(v.C) && has(v.F) && has(v.G) && v.F - v.G < v.B - v.C) out.checks.push({ bad: true, text: `${short}未製定消防防護計畫 ${v.F - v.G} 家，比未遴用防火管理人 ${v.B - v.C} 家還少（沒遴用就一定沒計畫）` });
      for (const k of ["B", "C", "F", "G", "J", "K", "N", "O", "R", "S"]) if (!has(v[k])) out.checks.push({ bad: true, text: "BCFGJK".includes(k) && !lg ? `${short}「${labels[k]}」還沒有：請在「③ 安管清冊」匯入 5 份清冊` : `${short}「${labels[k]}」空白` });
      if (p && !jan) {
        for (const k of ["R", "S", "AA", "AC"]) if (has(v[k]) && has(p[k]) && v[k] < p[k]) out.checks.push({ bad: true, text: `${short}「${labels[k]}」${v[k]} 比上月 ${p[k]} 少（累計不會變少）` });
        for (const k of ["B", "F", "J"]) if (has(v[k]) && p[k] && Math.abs(v[k] - p[k]) / p[k] > 0.05) out.checks.push({ text: `${short}「${labels[k]}」上月 ${p[k]} → 本月 ${v[k]}，變動超過 5%，請確認` });
        if (has(v.R) && has(p.R) && v.R - p.R > 300) out.checks.push({ text: `${short}本月新增訓練 ${v.R - p.R} 件，偏多請確認` });
      }
    }
    for (const c of cols) {
      const values = units.map((u) => out.units[u]?.[c] ?? null);
      out.total[c] = values.some((v) => v === null) ? null : values.reduce((a, b) => a + b, 0);
    }
    rates(out.total);
    if (out.units[units[0]] || out.units[units[1]] || out.units[units[2]]) for (const c of ["Y"]) if (out.total.V === 0 && out.total.X === 0) out.total.Y = 0;
    out.draft = out.blockers.length === 0;
    out.formal = out.draft && !out.missing.length && !out.checks.some((c) => c.bad);
    return out;
  }
  const escapeXML = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
  function setCell(source, ref, value) {
    const rx = new RegExp('<c\\b(?=[^>]*\\br="' + ref + '")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');
    return source.replace(rx, (old) => {
      const attrs = old
        .match(/^<c\b([^>]*?)(?:\/?>)/)[1]
        .replace(/\s+t="[^"]*"/g, "")
        .replace(/\/$/, "");
      return (
        "<c" +
        attrs +
        (value === null
          ? "/>"
          : typeof value === "number"
            ? "><v>" + value + "</v></c>"
            : ' t="inlineStr"><is><t>' + escapeXML(value) + "</t></is></c>")
      );
    });
  }
  async function exportXLSX(s, { draft = false, date } = {}) {
    const r = review(s);
    if (r.blockers.length) throw Error(r.blockers.join("；"));
    if (!draft && !r.formal) throw Error("三中隊未齊，禁止完整正式匯出");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw Error("請確認編製日期");
    const zip = await zipLoad(s.template),
      wb = await workbook(zip);
    const previous = String(Number(prevPeriod(s.period).slice(3)));
    const src = wb.sheets.find((x) => x.name === previous);
    if (!src) throw Error("找不到上月工作表");
    const name = String(Number(s.period.slice(3))) + (draft ? "-未齊草稿" : "");
    if (wb.sheets.some((x) => x.name === name)) throw Error("原檔已有本月工作表，請使用上月原檔");
    let page = await zip.file(src.path).async("string");
    const parsed = parseRows(await matrix(zip, src.path));
    const ti = parsed.totalRow,
      unitRows = {};
    for (const u of units) {
      const idx = parsed.rows.findIndex((row) => row && clean(row[0]) === u);
      if (idx < 0) throw Error("原檔缺中隊列");
      unitRows[u] = idx + 1;
    }
    // 僅新頁複製原列印範圍 A1:AE17；原頁及其印表外九月案件完全不動。
    page = page.replace(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (row, n) =>
      Number(n) > 17
        ? ""
        : row.replace(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell, c) =>
            colIndex(c) > 30 ? "" : cell,
          ),
    );
    // 11/2：新月份排第一頁、打開就看到（舊月報都是新的在前）
    page = page.replace(/(<dimension\b[^>]*\bref=")[^"]+"/, '$1A1:AE17"').replace(/ tabSelected="1"/g, "").replace(/<sheetView\b/, '<sheetView tabSelected="1"');
    for (const x of wb.sheets) {
      const t = await zip.file(x.path).async("string");
      if (t.includes(' tabSelected="1"')) zip.file(x.path, t.replace(/ tabSelected="1"/g, ""));
    }
    for (const [u, row] of Object.entries(unitRows)) {
      for (const c of cols) page = setCell(page, c + row, r.units[u]?.[c] ?? null);
      if (!r.units[u]) page = setCell(page, "A" + row, u + "（待補）");
    }
    for (const c of cols) page = setCell(page, c + ti, r.total[c]);
    const suffix = draft ? "【未齊草稿；待補：" + (r.missing.join("、") || "無") + "】" : "";
    page = setCell(
      page,
      "A4",
      "中華民國" + Number(s.period.slice(0, 3)) + "年" + Number(s.period.slice(3)) + "月 " + suffix,
    );
    const [yy, mm, dd] = date.split("-").map(Number);
    page = setCell(page, "AB12", "中華民國" + (yy - 1911) + "年" + mm + "月" + dd + "日編製");
    if (draft)
      page = setCell(
        page,
        "A16",
        "未齊草稿／非完整正式報表。待補：" +
          (r.missing.join("、") || "無") +
          "。僅複製上月列印範圍，印表外案件未帶入本月。",
      );
    const n =
      Math.max(...Object.keys(zip.files).map((p) => Number(p.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1] || 0))) +
      1;
    const path = "xl/worksheets/sheet" + n + ".xml";
    const rid = "rIdFM" + n;
    const id = Math.max(...wb.sheets.map((x) => Number(x.node.getAttribute("sheetId")))) + 1;
    zip.file(path, page);
    const relPath = src.path.replace("worksheets/", "worksheets/_rels/") + ".rels";
    if (zip.file(relPath))
      zip.file(path.replace("worksheets/", "worksheets/_rels/") + ".rels", await zip.file(relPath).async("uint8array"));
    let w = await zip.file("xl/workbook.xml").async("string");
    w = w.replace(/<sheets>/, '<sheets><sheet name="' + name + '" sheetId="' + id + '" r:id="' + rid + '"/>');
    w = w.replace(/localSheetId="(\d+)"/g, (_, n) => 'localSheetId="' + (Number(n) + 1) + '"');   // 前面多一頁，原本各頁的編號往後移
    w = w.replace(/<workbookView\b([^>]*?)\/>/, (_, a) => "<workbookView" + a.replace(/\s+(activeTab|firstSheet)="[^"]*"/g, "") + ' activeTab="0" firstSheet="0"/>');
    const definitions =
      '<definedName name="_xlnm.Print_Area" localSheetId="0' +
      "\">'" +
      name +
      "'!$A$1:$AE$17</definedName>";
    w = w.includes("</definedNames>")
      ? w.replace("</definedNames>", definitions + "</definedNames>")
      : w.replace("</sheets>", "</sheets><definedNames>" + definitions + "</definedNames>");
    w = w.replace(
      /<calcPr\b([^>]*?)\/>/,
      (_, a) =>
        "<calcPr" +
        a.replace(/\s+(fullCalcOnLoad|forceFullCalc)="[^"]*"/g, "") +
        ' fullCalcOnLoad="1" forceFullCalc="1"/>',
    );
    zip.file("xl/workbook.xml", w);
    let rel = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    rel = rel.replace(
      "</Relationships>",
      '<Relationship Id="' +
        rid +
        '" Type="' +
        RNS +
        '/worksheet" Target="worksheets/sheet' +
        n +
        '.xml"/></Relationships>',
    );
    zip.file("xl/_rels/workbook.xml.rels", rel);
    let ct = await zip.file("[Content_Types].xml").async("string");
    ct = ct.replace(
      "</Types>",
      '<Override PartName="/' +
        path +
        '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    );
    zip.file("[Content_Types].xml", ct);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  // ---- 存檔（2026-11-02）：管理者的匯入結果與差異選擇存到後端，信義晚到隔天接著補 ----
  function toB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const snapshot = (s, date) => ({ period: s.period, date, previous: s.previous, reports: s.reports, csv: s.csv, choices: s.choices, prevFrom: s.prevFrom || "", memo: s.memo || "", ledger: s.ledger || null, fines: s.fines || null });
  function nextPeriod(p) {
    let y = Number(p.slice(0, 3)), m = Number(p.slice(3)) + 1;
    if (m > 12) { y++; m = 1; }
    return String(y) + String(m).padStart(2, "0");
  }
  function restore(saved, tpl) {
    const s = create(saved.period);
    Object.assign(s, { previous: saved.previous || null, reports: saved.reports || {}, csv: saved.csv || null, choices: saved.choices || {}, prevFrom: saved.prevFrom || "", memo: saved.memo || "", ledger: saved.ledger || null, fines: saved.fines || null });
    s.template = tpl ? fromB64(tpl) : null;
    if (!s.template) s.previous = null;   // 沒有原檔就不能匯出，上月數字一起重來
    return s;
  }
  function lastMonth() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return String(d.getFullYear() - 1911) + String(d.getMonth() + 1).padStart(2, "0");
  }
  const labels = {
    B: "應遴用", C: "已遴用", D: "遴用比例", E: "上年比較", F: "應訂消防計畫", G: "已訂消防計畫", H: "消防計畫比例", I: "上年比較",
    J: "應訂共同計畫", K: "已訂共同計畫", L: "共同比例", M: "上年比較", N: "應訂施工計畫", O: "已訂施工計畫", P: "施工比例", Q: "上年比較",
    R: "訓練件數累計", S: "訓練人數累計", T: "本期限改", U: "本期裁罰件數", V: "裁罰金額", W: "收繳件次", X: "收繳金額", Y: "收繳率",
    Z: "強制執行", AA: "累計限改", AB: "上年比較", AC: "累計裁罰", AD: "上年比較",
  };

  // 填報表單還沒送出的數字：手機轉向、換分頁會重新 mount，存在這裡才不會不見
  const drafts = {};
  function mount(container) {
    const e = escapeXML;
    const api = typeof root.api === "function" ? root.api : null;
    const today = new Date();
    let s = create(lastMonth()),
      date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-"),
      busy = false,
      canEdit = !api,   // 沒接後端（本機測試）就照舊可用
      months = [],
      saved = { by: "", at: "", state: api ? "loading" : "off" },
      tplDirty = false,
      dirty = false,   // 有變更還沒按儲存（#view 裡有 .dirty，網站原本的離開／切換提醒就會跳）
      stored = new Set(),   // 系統裡已存的來源
      over = new Set(),   // 這次儲存會覆蓋掉的已存來源
      drop = new Set(),   // 這次儲存要明確拿掉／取代的中隊網頁填報（後端預設保留較新的網頁填報）
      myUnit = "",   // 中隊帳號：自己的中隊
      fillUnit = "",
      fill = null,   // 填報表單目前的數字
      fillNote = [];
    const sourcesOf = (x) => new Set([...(x.previous ? ["上月大隊月報"] : []), ...(x.csv ? ["本月不合格明細"] : []), ...(x.ledger ? ["安管清冊"] : []), ...units.filter((u) => x.reports[u]).map((u) => u + "報表")]);
    const ymLabel = (p) => p.slice(0, 3) + " 年 " + Number(p.slice(3)) + " 月";
    const show = (v) => (v === null || v === undefined ? "—" : String(v));
    const token = (container.__fmToken = {});   // 分頁重畫會重新 mount；舊的那份讀完存檔不能再畫到新畫面上
    const live = () => container.__fmToken === token;
    container.innerHTML = `<div class="fm">
      <div class="card vsec fmhead"><h2>📋 防火管理月報<span class="note" id="fmSub">三中隊報表彙整，照原 Excel 格式匯出</span></h2>
        <div class="fmbar">
          <label>月份<select id="fmYm"></select></label>
          <label>編製日期<input id="fmDate" type="date" value="${date}"></label>
          <span id="fmSaved" class="fmsaved" role="status" aria-live="polite"></span>
        </div>
        <details id="fmMemoBox" class="fmmemo"><summary>📝 本月備註<span id="fmMemoHint" class="note"></span></summary>
          <textarea id="fmMemo" rows="6" placeholder="這個月的特別處理、跟中隊確認過的事（只存在網頁，不會進送署的 Excel）"></textarea></details>
      </div>
      <div id="fmUnits" class="grid vunits fmunits"></div>
      <p id="fmMessage" class="fmmsg" role="status" aria-live="polite"></p>
      <details id="fmUploads" class="card vsec fmup" open><summary><h2>⬆️ 匯入來源檔案<span id="fmImportCount" class="note"></span></h2></summary>
        <div class="fmsteps">
          <label class="fmstep"><b>① 上月大隊月報</b><span class="note">大隊上個月送出的整本 Excel（.xlsx）</span><span id="fmPrevTag"></span><input id="fmPrevious" type="file" accept=".xlsx"></label>
          <label class="fmstep"><b>② 本月不合格明細</b><span class="note">安管匯出的 CSV</span><span id="fmCsvTag"></span><input id="fmCSV" type="file" accept=".csv"></label>
          <label class="fmstep"><b>③ 安管清冊（5 份）</b><span class="note">防管全、共同、未遴用、未計畫、限改中，可一次全選（.csv）；應／已家數照這 5 份算</span><span id="fmLedgerTag"></span><input id="fmLedger" type="file" accept=".csv" multiple></label>
          <div class="fmstep"><b>④ 中隊月報</b><span class="note">先選中隊，再選檔案（.ods／.xlsx）</span>
            <select id="fmUnit" aria-label="中隊"><option value="">選擇中隊</option>${units.map((u) => `<option>${u}</option>`).join("")}</select>
            <input aria-label="中隊報表檔案" id="fmUnitFile" type="file" accept=".ods,.xlsx"></div>
        </div>
        <p class="note">檔案在瀏覽器裡讀取；第一次匯入自動存到系統，要蓋掉已存的檔案才需要按「💾 儲存」。換台電腦也接得上。</p>
      </details>
      <div id="fmFill"></div>
      <div id="fmResults"></div>
      <div class="card vsec fmrules"><h2>📐 計算原則<span class="note">115/11/2 依局承辦人意見，十月起適用</span></h2>
        <ol>
          <li><b>家數由大隊統一算</b>：應／已遴用防火管理人、消防防護計畫、共同消防防護計畫，大隊每月匯入安管清冊計算，中隊不用填。</li>
          <li><b>不算進「應」的場所</b>：免列管、停業、還沒營業（立案中、籌備處）、新列管未滿 30 天而且還沒開限改的（新手村）。</li>
          <li><b>沒遴用防火管理人</b>，就一定也算沒有消防防護計畫。</li>
          <li><b>開了限改、還沒複查合格</b>，算還沒做到；複查合格才算做到。但安管已登錄補遴用的（例如補遴用、待複查），算已遴用，計畫照清冊。</li>
          <li><b>共同防火管理人沒遴用</b>，扣在「共同消防防護計畫」那欄。</li>
          <li><b>限改件數</b>照安管不合格明細；<b>罰鍰</b>原則上沒有（填 0），有的話大隊另外處理。</li>
          <li><b>中隊每月只要填 4 格</b>：施工中消防防護計畫應／已製定家數、本月新增訓練件數與人數。累計網頁會自動加。</li>
        </ol>
      </div>
      <p class="fmclearrow"><button id="fmClear" class="ghost">清除這個月的匯入</button></p>
    </div>`;
    const q = (id) => container.querySelector(id);

    function savedText() {
      if (saved.state === "off") return "";
      if (saved.state === "loading") return "⏳ 讀取存檔中…";
      if (saved.state === "saving") return "⏳ 存檔中…";
      if (!canEdit) return myUnit ? (saved.at ? `大隊資料更新：${e(saved.at)}` : "") : saved.at ? `👀 只能看（管理者 ${e(saved.at)} 存）` : "👀 只能看；管理者匯入後這裡會出現";
      const btn = `<button id="fmSave" class="save" ${dirty && !busy ? "" : "disabled"}>💾 儲存</button>`;
      if (saved.state === "error") return `<span class="tag warn">⚠️ 存檔失敗，請再按一次儲存</span>${btn}`;
      if (dirty) return `<span class="tag warn">有變更還沒儲存</span>${btn}`;
      return (saved.at ? `☁️ 已存檔 ${e(saved.at)}` : "☁️ 匯入後自動儲存") + btn;
    }

    // ---- 中隊網頁填報（11/2）：中隊帳號填自己那一隊；管理者可代填，或用中隊交來的 Excel 帶入後核對送出 ----
    // 11/2 分工定案：家數大隊用安管清冊算、罰鍰大隊另外填；中隊只填施工中和本月新增訓練
    const FILL_GROUPS = [
      ["① 施工中消防防護計畫（這個月的現況）", [["N", "應製定（家）"], ["O", "已製定（家）"]]],
      ["② 自衛消防編組訓練（只填這個月新增的）", [["Rm", "本月新增件數"], ["Sm", "本月新增人數"]]],
    ];
    const FILL_REQ = ["N", "O", "Rm", "Sm"];
    const jan = () => s.period.slice(3) === "01";
    function fillFrom(u) {   // 表單起始值：還沒送出的草稿 → 已送過的網頁填報 → 已匯入的檔案 → 上月數字
      const d = drafts[s.period + u];
      if (d) { fillNote = d.notes; return { ...d.fill }; }
      const r = s.reports[u], p = s.previous?.[u] || {}, f = {};
      if (r && r.via === "web") return { ...r.input };
      const src = r ? r.values : p;
      for (const k of ["B", "C", "F", "G", "J", "K", "N", "O"]) f[k] = src[k] ?? null;
      for (const k of ["U", "V", "W", "X", "Z"]) f[k] = r ? (r.values[k] ?? 0) : 0;
      f.Rm = r ? monthly(u, "R", r.values.R).n : null;
      f.Sm = r ? monthly(u, "S", r.values.S).n : null;
      return f;
    }
    // 檔案裡的「本年累計」換成本月新增；比上月少就當作中隊填成本月（11/2 信義：710 → 139）
    function monthly(u, k, total) {
      const prev = s.previous?.[u]?.[k];
      if (total === null || total === undefined) return { n: null };
      if (jan()) return { n: total };
      if (prev === null || prev === undefined) return { n: null, note: "還沒有上月大隊月報，無法換算本月新增" };
      if (total < prev) return { n: total, note: `檔案的本年累計${k === "R" ? "訓練件數" : "訓練人數"} ${total} 比上月 ${prev} 少，判斷是填成本月，已當作本月新增 ${total}，請確認` };
      return { n: total - prev };
    }
    function fillCheck(f, u) {
      const err = [], warn = [];
      const lab = { N: "施工中應製定家數", O: "施工中已製定家數", Rm: "本月新增訓練件數", Sm: "本月新增訓練人數" };
      for (const k of FILL_REQ) if (f[k] === null || f[k] === undefined || f[k] === "") err.push(lab[k] + "沒填");
      if (f.O > f.N) err.push(`施工中已製定 ${f.O} 家，比應製定 ${f.N} 家還多`);
      if (f.Rm > 300) warn.push(`本月新增訓練 ${f.Rm} 件偏多，確定不是本年累計？`);
      if (f.Sm > 0 && !f.Rm) warn.push("有訓練人數，但件數是 0");
      return { err, warn };
    }
    function fillCalc(f, u) {
      const p = s.previous?.[u] || {}, line = (name, k, m, unit) => {
        if (f[m] === null || f[m] === undefined || f[m] === "") return "";
        if (jan()) return `${name}本年累計 ${f[m]} ${unit}（一月從 0 起算）`;
        return p[k] === null || p[k] === undefined ? `${name}本月 ${f[m]} ${unit}（等大隊匯入上月月報後自動加總）` : `${name}本年累計：上月 ${p[k]} ＋ 本月 ${f[m]} ＝ <b>${p[k] + Number(f[m])}</b> ${unit}`;
      };
      return [line("訓練件數", "R", "Rm", "件"), line("訓練人數", "S", "Sm", "人")].filter(Boolean).join("<br>");
    }
    function drawFill() {
      if (!live()) return;
      const box = q("#fmFill");
      if (!api || !(canEdit || myUnit)) { box.innerHTML = ""; return; }
      const u = myUnit || fillUnit;
      if (u && !fill) fill = fillFrom(u);
      const r = u ? s.reports[u] : null;
      const inp = (k, name) => `<label>${name}<input type="number" min="0" inputmode="numeric" data-fk="${k}" value="${fill && fill[k] !== null && fill[k] !== undefined ? fill[k] : ""}">${(k === "N" || k === "O") && has0(s.previous?.[u]?.[k]) ? `<span class="note">上月 ${show(s.previous[u][k])}</span>` : ""}</label>`;
      box.innerHTML = `<details class="card vsec fmfill ${u && drafts[s.period + u] ? "dirty" : ""}" ${myUnit || fillUnit ? "open" : ""}><summary><h2>✍️ ${myUnit ? "本月填報" : "中隊填報（代填）"}<span class="note">${u ? e(u) + " " + ymLabel(s.period) : "中隊交檔案或打電話報的，大隊在這裡代填"}</span></h2></summary>
        ${myUnit ? `<p class="note">中隊每月只要填下面 4 格。遴用、消防計畫、共同計畫的家數由大隊用安管清冊統一計算；限改件數、罰鍰也由大隊處理，都不用填。</p>` : `<div class="fmbar">
          <label>代哪一隊填<select id="fmFillUnit"><option value="">選擇中隊</option>${units.map((x) => `<option ${x === fillUnit ? "selected" : ""}>${x}</option>`).join("")}</select></label>
          ${u ? `<label class="fmfile">📂 用中隊交來的 Excel 帶入<input id="fmFillFile" type="file" accept=".ods,.xlsx"></label>` : ""}</div>`}
        ${u ? `${r && r.via === "web" ? `<p class="note">✅ 已送出（${e(r.by || "")} ${e(r.at || "")}），要修改直接改數字再送一次。</p>` : r ? `<p class="note">目前用的是匯入的檔案；在這裡送出會改用網頁填報的數字。</p>` : ""}
        ${fillNote.length ? `<p class="fmnote">⚠️ ${fillNote.map(e).join("<br>⚠️ ")}</p>` : ""}
        ${FILL_GROUPS.map(([title, ks]) => `<fieldset class="fmgroup"><legend>${title}</legend><div class="fmgrid">${ks.map(([k, n]) => inp(k, n)).join("")}</div></fieldset>`).join("")}
        <p id="fmCalc" class="fmcalc">${fillCalc(fill || {}, u)}</p>
        <p class="fmacts"><button id="fmFillSend">📨 送出 ${e(u)} ${ymLabel(s.period)}填報</button></p>` : `<p class="note">先選要代填的中隊。</p>`}
      </details>`;
    }
    function fillTemplate(u) {   // 範本：版面照署表，「總計」列給網頁讀；只填黃色格，累計格用公式加上月
      const p = s.previous?.[u] || {}, f = fill || fillFrom(u), y = Number(s.period.slice(0, 3)), m = Number(s.period.slice(3));
      const wb = new root.ExcelJS.Workbook(), ws = wb.addWorksheet("填報");
      ws.getCell("A1").value = "縣市防火管理執行情形（中隊填報範本）";
      ws.getCell("A2").value = `中華民國${y}年${m}月`;
      ws.getCell("A3").value = "填報單位：" + u;
      ws.getCell("A5").value = "區域別";
      [["B5", "遴用防火管理人"], ["F5", "製定消防防護計畫"], ["J5", "製定共同消防防護計畫"], ["N5", "製定施工中消防防護計畫"], ["R5", "本年累計自衛消防編組訓練"], ["T5", "本期違反防火管理案件"], ["W5", "本期罰鍰收繳情形"], ["Z5", "本期強制執行件次"], ["AA5", "本年累計違反防火管理"]].forEach(([a, t]) => (ws.getCell(a).value = t));
      cols.forEach((c) => (ws.getCell(c + "6").value = labels[c]));
      ws.getCell("A7").value = "總計";
      const yellow = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3A8" } }, grey = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      for (const c of ["B", "C", "F", "G", "J", "K", "N", "O", "U", "V", "W", "X", "Z"]) { const cell = ws.getCell(c + "7"); cell.value = f[c] ?? null; cell.fill = yellow; }
      const pct = (o, a, b) => { ws.getCell(o + "7").value = { formula: `IF(${b}7=0,"",${a}7/${b}7)` }; ws.getCell(o + "7").numFmt = "0.00%"; ws.getCell(o + "7").fill = grey; };
      pct("D", "C", "B"); pct("H", "G", "F"); pct("L", "K", "J"); pct("P", "O", "N"); pct("Y", "X", "V");
      ws.getCell("A10").value = "↓ 本月新增（只填黃色格）"; ws.getCell("A11").value = "本月新增訓練件數"; ws.getCell("A12").value = "本月新增訓練人數";
      ws.getCell("C10").value = "本月新增"; ws.getCell("D10").value = "上月本年累計";
      ws.getCell("C11").value = f.Rm ?? null; ws.getCell("C12").value = f.Sm ?? null; ws.getCell("C11").fill = yellow; ws.getCell("C12").fill = yellow;
      const base = (k) => (jan() ? 0 : p[k] ?? 0);
      ws.getCell("D11").value = base("R"); ws.getCell("D12").value = base("S"); ws.getCell("D13").value = base("AC"); ws.getCell("A13").value = "上月累計罰鍰件數";
      const sum = (a, b) => (a === null || a === undefined || b === null || b === undefined ? undefined : Number(a) + Number(b));
      ws.getCell("R7").value = { formula: "D11+C11", result: sum(base("R"), f.Rm) }; ws.getCell("S7").value = { formula: "D12+C12", result: sum(base("S"), f.Sm) }; ws.getCell("AC7").value = { formula: "D13+U7", result: sum(base("AC"), f.U) };
      for (const c of ["R", "S", "AC"]) ws.getCell(c + "7").fill = grey;
      ws.getCell("T7").value = "大隊自動帶入"; ws.getCell("AA7").value = "大隊自動帶入";
      ws.getCell("A15").value = "說明：黃色格子要填，灰色格子會自動計算；本期與累計限改由大隊用安管資料帶入，不用填。填好存檔後，回網頁「用 Excel 檔帶入」上傳，或交給大隊。";
      // 框線、表頭合併、橫式一頁寬，印出來像署表
      for (const [r1, r2] of [["B5", "E5"], ["F5", "I5"], ["J5", "M5"], ["N5", "Q5"], ["R5", "S5"], ["W5", "Y5"], ["AA5", "AD5"], ["A5", "A6"], ["A1", "AD1"], ["A15", "AD15"]]) ws.mergeCells(r1 + ":" + r2);
      const thin = { style: "thin", color: { argb: "FF333333" } }, box = { top: thin, left: thin, bottom: thin, right: thin };
      for (let r = 5; r <= 7; r++) for (let c = 1; c <= 30; c++) { const cell = ws.getRow(r).getCell(c); cell.border = box; if (r < 7) { cell.font = { bold: true }; if (!cell.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } }; } }
      for (let r = 10; r <= 13; r++) for (let c = 1; c <= 4; c++) ws.getRow(r).getCell(c).border = box;
      ws.getCell("A1").font = { bold: true, size: 16 }; ws.getCell("A1").alignment = { horizontal: "center" };
      ws.getCell("A2").font = { bold: true, size: 12 }; ws.getCell("A3").font = { bold: true, size: 12 }; ws.getCell("A7").font = { bold: true };
      ws.getCell("A15").alignment = { wrapText: true, vertical: "top" }; ws.getRow(15).height = 36;
      ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
      ws.views = [{ state: "frozen", xSplit: 1, ySplit: 0 }];
      ws.getColumn(1).width = 22;
      for (let i = 2; i <= 30; i++) ws.getColumn(i).width = 11;
      for (const rr of [5, 6]) ws.getRow(rr).alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      ws.getRow(6).height = 48;
      return wb;
    }
    async function fillFile(el) {
      const file = el.files[0], u = myUnit || fillUnit;
      if (!file || !u) return;
      try {
        const rep = await readReport(new Uint8Array(await file.arrayBuffer()), file.name.toLowerCase().endsWith(".ods") ? "ods" : "xlsx");
        const v = rep.values, notes = [];
        if (rep.sourcePeriod && rep.sourcePeriod !== s.period) notes.push(`檔案標題寫 ${Number(rep.sourcePeriod.slice(0, -2))} 年 ${Number(rep.sourcePeriod.slice(-2))} 月，不是 ${ymLabel(s.period)}，請確認是不是舊檔`);
        const f = {};
        for (const k of ["B", "C", "F", "G", "J", "K", "N", "O"]) f[k] = v[k];
        for (const k of ["U", "V", "W", "X", "Z"]) f[k] = v[k] ?? 0;
        for (const [k, mk] of [["R", "Rm"], ["S", "Sm"]]) { const x = monthly(u, k, v[k]); f[mk] = x.n; if (x.note) notes.push(x.note); }
        fill = f;
        fillNote = notes;
        drafts[s.period + u] = { fill: { ...f }, notes };
        message("已從檔案帶入，請逐格核對後按「送出」。");
      } catch (err) {
        message("檔案讀不到：" + err.message, true);
      }
      el.value = "";
      drawFill();
    }
    async function fillSend() {
      const u = myUnit || fillUnit;
      const f = {};
      for (const el of q("#fmFill").querySelectorAll("[data-fk]")) f[el.dataset.fk] = el.value === "" ? null : Number(el.value);
      fill = f;
      const { err, warn } = fillCheck(f, u);
      if (err.length) { fillNote = err; message("還不能送出：" + err.join("、"), true); drawFill(); return; }
      if (dirty) { message("請先按右上角「💾 儲存」，再送出填報。", true); return; }
      const sum = fillCalc(f, u).replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
      if (!confirm(`送出 ${u} ${ymLabel(s.period)}填報？\n\n${warn.length ? "⚠️ 請確認：\n" + warn.join("\n") + "\n\n" : ""}${sum}`)) return;
      try {
        await api({ action: "fm_unit_save", ym: s.period, unit: u, input: f });
        delete drafts[s.period + u];
        const keep = u;
        await load(s.period);
        fillUnit = keep;
        message(`✅ ${u} ${ymLabel(s.period)}填報已送出。`);
        draw();
      } catch (err) {
        message("送出失敗：" + err.message, true);
      }
    }
    // 安管清冊計算結果：各隊應／已、缺哪幾家、限改中（過期待複查）、不列入的
    function ledgerHtml() {
      const L = s.ledger;
      if (!L && myUnit) return `<div class="card vsec"><h2>🏢 我們中隊的缺口</h2><p class="note">大隊還沒匯入這個月的安管清冊，匯入後這裡會列出缺哪幾家。</p></div>`;
      if (!L) return `<div class="card vsec"><h2>🏢 安管清冊計算結果</h2><p class="note">還沒匯入安管清冊。匯入「③ 安管清冊」5 份後，這裡會列出各中隊的應／已家數、缺哪幾家、哪些限改中。沒匯入的話，家數照中隊填報。</p></div>`;
      const pct = (a, b) => (b ? ((a / b) * 100).toFixed(2) + "%" : "—");
      const li = (arr) => (arr.length ? `<ul>${arr.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : `<p class="note">無</p>`);
      const rows = units.filter((u) => !myUnit || u === myUnit).map((u) => { const x = L.units[u]; return `<tr><td>${u.replace("中隊", "")}</td><td>${x.B}／${x.C}</td><td>${x.B - x.C}</td><td>${x.F}／${x.G}</td><td>${x.F - x.G}</td><td>${x.J}／${x.K}</td><td>${x.J - x.K}</td></tr>`; }).join("");
      const sum = (k) => units.reduce((a, u) => a + L.units[u][k], 0);
      const show = (u, label) => (myUnit ? myUnit === u : true);
      return `<div class="card vsec fmledger"><h2>🏢 ${myUnit ? "我們中隊的缺口" : "安管清冊計算結果"}<span class="note">算到 ${e(L.asOf)}；新手村＝${e(L.newSince)} 以後新列管且未開限改</span></h2>
        <div class="tablewrap"><table><tr><th>中隊</th><th>遴用 應／已</th><th>未遴用</th><th>消防計畫 應／已</th><th>未製定</th><th>共同 應／已</th><th>未製定共同</th></tr>${rows}
          ${myUnit ? "" : `<tr><td>合計</td><td>${sum("B")}／${sum("C")}（${pct(sum("C"), sum("B"))}）</td><td>${sum("B") - sum("C")}</td><td>${sum("F")}／${sum("G")}（${pct(sum("G"), sum("F"))}）</td><td>${sum("F") - sum("G")}</td><td>${sum("J")}／${sum("K")}（${pct(sum("K"), sum("J"))}）</td><td>${sum("J") - sum("K")}</td></tr>`}</table></div>
        ${units.filter((u) => show(u)).map((u) => { const x = L.units[u], od = x.open.filter((o) => o.overdue);
          return `<details class="fmlgunit" ${myUnit ? "open" : ""}><summary><b>${e(u)}</b>：未遴用 ${x.gapMgr.length}、未製定計畫 ${x.gapPlan.length}、未製定共同 ${x.gapJoint.length}${od.length ? `<span class="tag warn">${od.length} 件限改過期待複查</span>` : ""}</summary>
            <div class="fmlggrid"><div><b>未遴用防火管理人</b>${li(x.gapMgr)}</div><div><b>未製定消防防護計畫</b>${li(x.gapPlan)}</div><div><b>未製定共同計畫（未遴用共同防火管理人）</b>${li(x.gapJoint)}</div>
            <div><b>限改中</b>${li(x.open.map((o) => `${o.name}：${o.what}，期限 ${o.due}${o.overdue ? "（已過期，請複查）" : ""}${o.counted ? "" : "（不列入計算）"}`))}</div>
            ${x.note ? `<div><b>依實際狀態</b>${li(x.note)}</div>` : ""}
            <div><b>不列入計算</b><p class="note">免列管 ${x.excl.免列管} 家、停業 ${x.excl.停業} 家</p>${x.excl.未營業.length ? `<p class="note">尚未營業／立案中：</p>${li(x.excl.未營業)}` : ""}${x.excl.新手村.length ? `<p class="note">新手村（30 天內新列管）：</p>${li(x.excl.新手村)}` : ""}</div></div></details>`; }).join("")}
      </div>`;
    }
    function draw() {
      if (!live()) return;
      const r = review(s);
      const ymOpts = new Set([lastMonth(), s.period, ...months.map((m) => m.ym)]);
      q("#fmYm").innerHTML = [...ymOpts].sort().reverse().map((p) => `<option value="${p}" ${p === s.period ? "selected" : ""}>${ymLabel(p)}${months.some((m) => m.ym === p) ? "（有存檔）" : ""}</option>`).join("");
      q("#fmSaved").innerHTML = savedText();
      q(".fmhead").classList.toggle("dirty", dirty);
      const memo = q("#fmMemo");
      if (document.activeElement !== memo) memo.value = s.memo || "";
      memo.readOnly = !!api && !canEdit;
      q("#fmMemoHint").textContent = s.memo ? "（有備註）" : "";
      if (s.memo && !q("#fmMemoBox").dataset.seen) { q("#fmMemoBox").open = true; q("#fmMemoBox").dataset.seen = "1"; }
      const count = units.filter((u) => s.reports[u]).length;
      q("#fmUnits").innerHTML = units.map((u) => {
        const x = s.reports[u], v = r.units[u];
        const pending = x && !x.sourcePeriod && x.confirmedPeriod !== s.period;
        return `<div class="card vunit ${x ? (pending ? "near" : "ok") : "fmwait"}"><div class="vname">${e(u.replace("中隊", ""))}<span class="tag ${x ? (pending ? "warn" : "ok") : ""}">${x ? (pending ? "待確認" : "已收到") : "待補"}</span></div>
          <p class="note">${v ? `本期限改 ${show(v.T)}・累計 ${show(v.AA)}` : "還沒收到報表"}</p></div>`;
      }).join("");
      const tag = (ok, yes, no) => `<span class="tag ${ok ? "ok" : ""}">${ok ? yes : no}</span>`;
      q("#fmPrevTag").innerHTML = s.previous && s.prevFrom
        ? `<span class="tag ok">✓ 已自動帶入 ${Number(s.prevFrom.slice(3))} 月網頁匯出的月報</span><span class="note">匯出後若在 Excel 手改過數字，請重新上傳這裡</span>`
        : tag(s.previous, "✓ 已匯入", "未匯入");
      q("#fmLedgerTag").innerHTML = tag(s.ledger, "✓ 已匯入（算到 " + (s.ledger ? s.ledger.asOf : "") + "）", "未匯入");
      q("#fmCsvTag").innerHTML = tag(s.csv, "✓ 已匯入 " + (s.csv ? s.csv.matched : 0) + " 筆限改", "未匯入");
      q("#fmImportCount").textContent = `上月原檔${s.previous ? "✓" : "✗"}・明細${s.csv ? "✓" : "✗"}・清冊${s.ledger ? "✓" : "✗"}・中隊 ${count}/3`;
      for (const el of container.querySelectorAll(".fmup input, .fmup select, #fmClear")) el.disabled = busy || !canEdit;
      const unresolved = units.filter((u) => s.reports[u] && !s.reports[u].sourcePeriod && s.reports[u].confirmedPeriod !== s.period).length;
      const diffHtml = (u, d) => {
        const name = d.field === "T" ? "本期限改" : "累計限改";
        return `<p class="fmnote">⚠️ ${e(u.replace("中隊", ""))}填報${name} ${show(d.reported)}，已改用安管 ${show(d.computed)}<span class="note">（${d.field === "T" ? "本月明細" : "上月累計＋本月明細"}；請和中隊確認）</span></p>`;
      };
      const unitHtml = (u) => {
        const x = s.reports[u];
        if (!x) return "";
        const ds = r.differences.filter((d) => d.unit === u);
        return `<section class="fmunit"><h3>${e(u)}</h3>
          ${!x.sourcePeriod ? `<label class="fmconfirm"><input type="checkbox" data-confirm="${e(u)}" ${x.confirmedPeriod === s.period ? "checked" : ""} ${canEdit ? "" : "disabled"}> 確認這份是 ${ymLabel(s.period)}的報表 <span class="note">（檔案裡沒寫年月，要人工確認）</span></label>` : ""}
          ${ds.map((d) => diffHtml(u, d)).join("")}
          ${!ds.length ? `<p class="note">${s.csv && s.previous ? "✅ 限改件數和安管明細相符。" : "等上月原檔和本月明細進來再核對。"}</p>` : ""}
          <details class="note"><summary>計算依據</summary><p>總計取來源第 ${x.totalRow} 列；年月：${x.sourcePeriod ? e(x.sourcePeriod) : "未填，人工確認"}。累計限改：上月 ${show(s.previous?.[u]?.AA)} ＋ 本月明細 ${show(s.csv?.counts[u])} ＝ ${show(r.computed[u])}；中隊填報 ${show(x.values.AA)}。累計裁罰：上月 ${show(s.previous?.[u]?.AC)}，本月填報 ${show(x.values.AC)}。</p></details></section>`;
      };
      const rowsHtml = [...units, "合計"].map((u) => {
        const v = u === "合計" ? r.total : r.units[u];
        return `<tr><td>${e(u)}${!v ? "（待補）" : ""}</td>${cols.map((c) => `<td>${v?.[c] === null || v?.[c] === undefined ? "—" : ["D", "H", "L", "P", "Y"].includes(c) ? (v[c] * 100).toFixed(2) + "%" : e(v[c])}</td>`).join("")}</tr>`;
      }).join("");
      const squadView = !!api && !canEdit;
      q("#fmSub").textContent = squadView ? "每月填 4 格、看自己中隊的缺口" : "三中隊報表彙整，照原 Excel 格式匯出";   // 中隊帳號：只看自己的填報、缺口、原則（11/2 使用者：版面乾淨、中隊看得懂）
      for (const el of [q("#fmUploads"), q(".fmclearrow"), q("#fmUnits"), q("#fmMemoBox"), q("#fmDate").closest("label")]) el.style.display = squadView ? "none" : "";   // 用 style：.grid 的 display 會蓋過 hidden
      drawFill();
      if (squadView) { q("#fmResults").innerHTML = ledgerHtml(); return; }
      q("#fmResults").innerHTML = `
        <div class="card vsec"><h2>🔍 核對報表${unresolved ? `<span class="tag warn">${unresolved} 隊待確認年月</span>` : ""}<span class="note">限改件數以安管明細為準</span></h2>
          ${count ? units.map(unitHtml).join("") : `<p class="note">還沒有中隊報表。收到的會在這裡和明細核對；還沒收到的中隊先留著，不用重填。</p>`}</div>
        <details class="card vsec"><summary><h2>📊 本月月報數據<span class="note">${r.missing.length ? "尚缺 " + r.missing.map(e).join("、") : "三中隊已齊"}</span></h2></summary>
          <div class="tablewrap"><table><tr><th>單位</th>${cols.map((c) => `<th>${labels[c]}</th>`).join("")}</tr>${rowsHtml}</table></div>
          <p class="note">— 是未知或分母為 0；缺值不當成 0。</p>
          ${s.csv ? `<p class="note">明細共 ${s.csv.matched} 筆限改；排除尾列 ${s.csv.tailRows}、其他月份 ${s.csv.otherMonths}。未知分隊 ${s.csv.unknownUnits}、漏單位 ${s.csv.missingUnits}、無效日期 ${s.csv.invalidDates}。</p>` : ""}
          ${r.blockers.length ? `<p class="err">${r.blockers.map(e).join("；")}</p>` : ""}</details>
        ${ledgerHtml()}
        <div class="card vsec fmexport"><h2>📥 匯出${r.formal ? `<span class="tag ok">可以匯出</span>` : r.missing.length ? `<span class="tag warn">未齊</span>` : ""}</h2>
          <p class="note">${r.blockers.length ? "還不能下載：" + r.blockers.map((b) => e(b.replace("來源年月空白，請確認期間", "請先在上面勾「確認這份是本月報表」"))).join("；") : r.formal ? "沿用上月原始 Excel，加一頁本月，歷史分頁原樣保留。" : "還缺 " + r.missing.map(e).join("、") + "，正式月報先鎖住；可以先下載草稿。"}</p>
          ${count ? `<div class="fmchecks"><b>🔎 匯出前檢查</b>${r.checks.length || r.fixes.length ? "" : `<p>✅ 跟上月比對沒有發現問題。</p>`}
            ${r.checks.map((c) => `<p class="${c.bad ? "err" : ""}">${c.bad ? "❌" : "⚠️"} ${e(c.text)}</p>`).join("")}
            ${r.fixes.length ? `<p class="note">匯入時自動修正（請確認）：</p>${r.fixes.map((x) => `<p>🔧 ${e(x)}</p>`).join("")}` : ""}
            ${r.checks.some((c) => c.bad) ? `<p class="err">有 ❌ 的項目要先處理，正式月報才能匯出。</p>` : ""}</div>` : ""}
          <details class="fmfines" ${s.fines ? "open" : ""}><summary>💰 本月罰鍰、收繳、強制執行：${s.fines ? "已填" : "原則上沒有，預設 0"}<span class="note">（有的話點開填）</span></summary>
            <div class="tablewrap"><table><tr><th>中隊</th>${["U", "V", "W", "X", "Z"].map((c) => `<th>${labels[c]}</th>`).join("")}</tr>
            ${units.map((u) => `<tr><td>${u.replace("中隊", "")}</td>${["U", "V", "W", "X", "Z"].map((c) => `<td><input type="number" min="0" data-fine="${u}|${c}" value="${s.fines?.[u]?.[c] ?? 0}" style="width:90px"></td>`).join("")}</tr>`).join("")}</table></div></details>
          <p class="fmacts"><button id="fmDraft" class="ghost" ${!r.draft || busy ? "disabled" : ""}>下載未齊草稿</button><button id="fmFormal" ${!r.formal || busy ? "disabled" : ""}>📥 匯出正式月報</button></p></div>`;
    }
    function message(text, err) {
      q("#fmMessage").textContent = text || "";
      q("#fmMessage").className = "fmmsg" + (err ? " err" : "");
    }
    // 11/2 使用者：第一次匯入、勾確認、改日期自動存；會蓋掉系統裡已存的才要按儲存。每次都要在畫面上講清楚
    async function markDirty(label, doneText = "") {
      if (!api || !canEdit) { message(doneText); return; }
      dirty = true;
      if (label && stored.has(label)) over.add(label);
      if (!over.size) return save(true, doneText);
      message(doneText + "⚠️ 這次會覆蓋系統裡已存的：" + [...over].join("、") + "，請按右上角「💾 儲存」確認。", true);
      draw();
    }
    async function save(auto = false, doneText = "") {
      if (!auto && over.size && !confirm("儲存後會用新的資料覆蓋系統裡原本存的：\n" + [...over].join("、") + "\n\n確定儲存？")) return;
      saved.state = "saving";
      draw();
      const body = { action: "fm_save", ym: s.period, state: snapshot(s, date), drop: [...drop] };
      if (tplDirty) body.tpl = s.template ? toB64(s.template) : "";
      try {
        const res = await api(body);
        tplDirty = false;
        dirty = false;
        over.clear();
        drop.clear();
        stored = sourcesOf(s);
        saved = { state: "ok", by: res.updated_by, at: res.updated_at };
        message(auto ? "✅ " + doneText + "已自動儲存（" + res.updated_at + "）。" : "✅ 已儲存（" + res.updated_at + "）。");
        if (!months.some((m) => m.ym === s.period)) months.push({ ym: s.period });
      } catch (err) {
        saved.state = "error";
        message("⚠️ " + doneText + "存檔失敗（" + err.message + "），請按右上角「💾 儲存」再試一次。", true);
      }
      draw();
    }
    async function load(period) {
      s = create(period);
      tplDirty = false;
      dirty = false;
      over.clear();
      drop.clear();
      stored = new Set();
      fill = null;
      fillNote = [];
      if (!api) { draw(); return; }
      saved = { state: "loading" };
      draw();
      try {
        const res = await api({ action: "fm_data", ym: period });
        if (!live()) return;
        canEdit = !!res.canEdit;
        myUnit = units.includes(res.myUnit) ? res.myUnit : "";
        if (myUnit) fillUnit = myUnit;
        months = res.months || [];
        if (res.state && res.state.period === period) {
          s = restore(res.state, res.tpl);
          stored = sourcesOf(s);
          if (res.state.date) q("#fmDate").value = date = res.state.date;
        }
        saved = { state: "ok", by: res.updated_by, at: res.updated_at };
        q("#fmUploads").open = canEdit && !(s.previous && s.csv && units.every((u) => s.reports[u]));
      } catch (err) {
        saved = { state: "off" };
        message("讀不到存檔：" + err.message + "（這次匯入不會存）", true);
      }
      draw();
    }
    async function run(task, okText, label) {
      busy = true;
      message("處理中…");
      draw();
      try {
        await task();
        await markDirty(label, okText || "");
      } catch (err) {
        message(err.message, true);
      } finally {
        busy = false;
        for (const el of container.querySelectorAll("input[type=file]")) el.value = "";
        draw();
      }
    }
    const fileBytes = async (input) => new Uint8Array(await input.files[0].arrayBuffer());
    // 重匯已經有的來源先問；取消就當沒選
    const replaceOk = (el, has, name) => {
      if (!has || confirm(name + "已經匯入過，要用新檔案取代嗎？")) return true;
      el.value = "";
      return false;
    };
    q("#fmPrevious").onchange = () => {
      if (!q("#fmPrevious").files[0]) return;
      const el = q("#fmPrevious");
      if (!replaceOk(el, s.previous, "上月大隊月報")) return;
      run(async () => {
        const bytes = await fileBytes(el);
        s.previous = null; s.template = null; s.choices = {};
        await importPrevious(s, bytes);
        s.prevFrom = "";   // 手動上傳的，下個月自動帶入不會蓋掉
        tplDirty = true;
      }, "上月大隊月報匯入完成。", "上月大隊月報");
    };
    q("#fmLedger").onchange = () => {
      const el = q("#fmLedger");
      if (!el.files.length) return;
      if (!replaceOk(el, s.ledger, "安管清冊")) return;
      run(async () => {
        const list = [];
        for (const f of el.files) list.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        await importLedger(s, list);
      }, "安管清冊匯入完成，家數已依清冊重算。", "安管清冊");
    };
    q("#fmCSV").onchange = () => {
      if (!q("#fmCSV").files[0]) return;
      const el = q("#fmCSV");
      if (!replaceOk(el, s.csv, "本月不合格明細")) return;
      run(async () => {
        const bytes = await fileBytes(el);
        s.csv = null; s.choices = {};
        importCSV(s, bytes);
      }, "本月不合格明細匯入完成。", "本月不合格明細");
    };
    q("#fmUnitFile").onchange = () => {
      const el = q("#fmUnitFile"), file = el.files[0], u = q("#fmUnit").value;
      if (!file) return;
      if (u && !replaceOk(el, s.reports[u], u + "報表")) return;
      run(async () => {
        if (!u) throw Error("請先選中隊，再選檔案");
        const bytes = await fileBytes(el);
        await importUnit(s, u, bytes, file.name.toLowerCase().endsWith(".ods") ? "ods" : "xlsx");
        drop.add(u);
        q("#fmUnit").value = "";
      }, u ? u + "報表匯入完成。" : "", u + "報表");
    };
    q("#fmResults").onchange = (event) => {
      const el = event.target;
      if (el.dataset.fine) {
        const [u, c] = el.dataset.fine.split("|");
        s.fines = s.fines || Object.fromEntries(units.map((x) => [x, { U: 0, V: 0, W: 0, X: 0, Z: 0 }]));
        s.fines[u][c] = el.value === "" ? 0 : Number(el.value);
        draw();
        markDirty("", "罰鍰已更新，");
        return;
      }
      if (!el.dataset.confirm) return;
      if (el.checked) confirmPeriod(s, el.dataset.confirm, s.period);
      else s.reports[el.dataset.confirm].confirmedPeriod = null;
      draw();
      markDirty("", el.checked ? "年月確認已勾選，" : "年月確認已取消，");
    };
    q("#fmResults").onclick = (event) => {
      const id = event.target.id;
      if (id !== "fmDraft" && id !== "fmFormal") return;
      const draft = id === "fmDraft";
      busy = true;
      message("產生 Excel 中…");
      exportXLSX(s, { draft, date: q("#fmDate").value }).then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "縣市防火管理執行情形-" + s.period + (draft ? "-未齊草稿" : "-完整正式") + ".xlsx";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message("已下載。");
        if (!draft) return carryForward(bytes);
      }).catch((err) => message(err.message, true)).finally(() => { busy = false; draw(); });
    };
    // 11/2：正式匯出的整本自動存成下個月的「上月大隊月報」，下個月不用再上傳；下個月已手動上傳過就不蓋
    async function carryForward(bytes) {
      if (!api || !canEdit) return;
      const next = nextPeriod(s.period);
      try {
        const res = await api({ action: "fm_data", ym: next });
        const old = res.state && res.state.period === next ? res.state : null;
        if (old && old.previous && !old.prevFrom) { message("已下載。" + ymLabel(next) + "已經手動上傳過上月月報，沒有自動帶入。"); return; }
        const n = create(next);
        if (old) Object.assign(n, { reports: old.reports || {}, csv: old.csv || null, choices: old.choices || {} });
        await importPrevious(n, bytes);
        n.prevFrom = s.period;
        await api({ action: "fm_save", ym: next, state: snapshot(n, old ? old.date : ""), tpl: toB64(bytes) });
        if (!months.some((m) => m.ym === next)) months.push({ ym: next });
        message("已下載，也已自動帶入成為 " + ymLabel(next) + " 的上月月報，下個月不用再上傳。");
      } catch (err) {
        message("已下載；但自動帶入下個月失敗（" + err.message + "），下個月請手動上傳這份。", true);
      }
      draw();
    }
    q("#fmFill").onchange = (event) => {
      if (event.target.id === "fmFillUnit") { fillUnit = event.target.value; fill = null; fillNote = []; drawFill(); }
      if (event.target.id === "fmFillFile") fillFile(event.target);
    };
    q("#fmFill").oninput = (event) => {
      const k = event.target.dataset.fk;
      if (!k) return;
      fill = fill || {};
      fill[k] = event.target.value === "" ? null : Number(event.target.value);
      const u = myUnit || fillUnit;
      drafts[s.period + u] = { fill: { ...fill }, notes: fillNote };
      q(".fmfill").classList.add("dirty");
      q("#fmCalc").innerHTML = fillCalc(fill, myUnit || fillUnit);
    };
    q("#fmFill").onclick = async (event) => {
      if (event.target.id === "fmFillSend") fillSend();
      if (event.target.id === "fmTpl") {
        const u = myUnit || fillUnit;
        try { await loadExcelJS(); } catch (err) { message("Excel 元件載入失敗，請檢查網路後再試一次", true); return; }
        const wb = fillTemplate(u), buf = await wb.xlsx.writeBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `防火管理月報填報範本-${u}-${s.period}.xlsx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    };
    q("#fmSaved").onclick = (event) => { if (event.target.id === "fmSave") save(); };
    q("#fmYm").onchange = () => {
      if (dirty && !confirm(ymLabel(s.period) + "還有變更沒儲存，切換月份就會不見。確定要切換？")) { q("#fmYm").value = s.period; return; }
      message("");
      load(q("#fmYm").value);
    };
    q("#fmMemo").onchange = () => { s.memo = q("#fmMemo").value.slice(0, 3000); markDirty("", "備註已改，"); };
    q("#fmDate").onchange = () => { date = q("#fmDate").value; draw(); markDirty("", "編製日期已改，"); };
    q("#fmClear").onclick = () => {
      if (!confirm("清掉 " + ymLabel(s.period) + " 已匯入的檔案和確認？" + (api && canEdit ? "\n（畫面先清掉；按「💾 儲存」才會清掉系統裡的存檔）" : ""))) return;
      s = create(s.period);
      units.forEach((u) => drop.add(u));
      tplDirty = true;
      q("#fmUploads").open = true;
      for (const x of stored) over.add(x);
      draw();
      markDirty("", "已清除畫面。");
    };
    F.controller = {
      getState: () => ({ period: s.period, previous: s.previous ? structuredClone(s.previous) : null, reports: structuredClone(s.reports), csv: s.csv ? structuredClone(s.csv) : null, choices: { ...s.choices } }),
      getReview: () => structuredClone(review(s)),
    };
    load(s.period);
    return F.controller;
  }
  const F = {
    units, cols, number, ratio, readReport, parseCSV, create, importPrevious, importUnit, confirmPeriod, importCSV, choose, review, exportXLSX, mount, computeLedger, decodeCSV, importLedger,
    snapshot, restore,
  };
  root.FireManagement = F;
  if (typeof module !== "undefined") module.exports = F;
})(typeof window !== "undefined" ? window : globalThis);
