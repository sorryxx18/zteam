// ---- 匯出 Excel 共用格式（2026-11-01 使用者：要像可以直接用的 Excel）----
// 外框＋內線、標題列粗體灰底、欄寬配合內容、自動換行、列高跟著行數、凍結標題列、A4 橫向一頁寬、每頁重複標題
const XL_FONT = { name: "新細明體", size: 12 };
const XL_THIN = { style: "thin" }, XL_BOX = { top: XL_THIN, left: XL_THIN, bottom: XL_THIN, right: XL_THIN };
// 顯示寬度：中文一字算 2
const xlW = (s) => [...String(s ?? "")].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
const xlLines = (text, width) => String(text ?? "").split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(xlW(line) / Math.max(1, width - 2))), 0);
// head＝欄名陣列；rows＝二維陣列；opt.widths 指定欄寬（不給就依內容自動，6～40）；opt.title 會在最上面合併一列當表名
function xlTable(wb, name, head, rows, opt = {}) {
  const ws = wb.addWorksheet(String(name).slice(0, 31), { pageSetup: { paperSize: 9, orientation: opt.portrait ? "portrait" : "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } } });
  const widths = head.map((h, j) => (opt.widths && opt.widths[j]) || Math.min(40, Math.max(6, xlW(h) + 2, ...rows.slice(0, 500).map((r) => Math.min(42, Math.max(...String(r[j] ?? "").split("\n").map(xlW)) + 2)))));
  ws.columns = widths.map((width) => ({ width }));
  let top = 1;
  // opt.notes：表格上方的說明文字（每行一列、合併整列寬）
  (opt.notes || []).forEach((line, k) => {
    const r = ws.getRow(top); r.getCell(1).value = line; ws.mergeCells(top, 1, top, head.length);
    r.getCell(1).font = { ...XL_FONT, bold: k === 0 }; r.getCell(1).alignment = { wrapText: true, vertical: "top" };
    r.height = 17 * xlLines(line, widths.reduce((a, w) => a + w, 0)) + 3; top++;
  });
  if (opt.notes && opt.notes.length) top++;
  if (opt.title) {
    const t = ws.getRow(top); t.getCell(1).value = opt.title; ws.mergeCells(top, 1, top, head.length);
    t.font = { ...XL_FONT, size: 14, bold: true }; t.alignment = { vertical: "middle" }; t.height = 24; top++;
  }
  const hr = ws.getRow(top); hr.values = head;
  rows.forEach((r, i) => { ws.getRow(top + 1 + i).values = r.map((v) => (v === null || v === undefined ? "" : v)); });
  for (let n = top; n <= top + rows.length; n++) {
    const row = ws.getRow(n);
    for (let j = 1; j <= head.length; j++) {
      const c = row.getCell(j);
      c.border = XL_BOX; c.font = n === top ? { ...XL_FONT, bold: true } : XL_FONT;
      c.alignment = { wrapText: true, vertical: n === top ? "middle" : "top", horizontal: n === top ? "center" : undefined };
      if (n === top) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
    }
    row.height = 17 * Math.max(1, ...widths.map((w, j) => xlLines(row.getCell(j + 1).value, w))) + 2;
  }
  ws.views = [{ state: "frozen", ySplit: top }];
  ws.pageSetup.printTitlesRow = `${top}:${top}`;
  return ws;
}
// 物件陣列 → 表格（欄位＝第一筆的 key 順序）
const xlObjects = (wb, name, list, opt) => list.length ? xlTable(wb, name, Object.keys(list[0]), list.map((o) => Object.values(o)), opt) : null;
async function xlSave(wb, filename) {
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
if (typeof module !== "undefined") module.exports = { xlTable, xlObjects, xlW };
