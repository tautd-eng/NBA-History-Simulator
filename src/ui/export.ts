// Any table on the page can be saved as CSV or Excel: hover it and a small bar appears in its corner.
// Sortable tables export every row (not only the ones shown), other tables what is on the screen.

export type Cell = string | number;
const exporters = new WeakMap<HTMLTableElement, () => Cell[][]>();
export function registerTable(el: HTMLTableElement | null, fn: () => Cell[][]) { if (el) exporters.set(el, fn); }

export function toCsv(rows: Cell[][]) {
  return '﻿' + rows.map(r => r.map(x => { const s = String(x ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
}

// ---- a minimal .xlsx writer (stored zip, one sheet)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: [string, string][]) {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nb, data); central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const cl = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cl, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export function toXlsx(rows: Cell[][], sheet = 'Sheet1') {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((x, ci) => {
    const ref = colName(ci) + (ri + 1);
    const num = typeof x === 'number' ? x : (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim()) ? +x : null);
    return num !== null && Number.isFinite(num) ? `<c r="${ref}"${ri === 0 ? ' s="1"' : ''}><v>${num}</v></c>` : `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t>${esc(String(x ?? ''))}</t></is></c>`;
  }).join('')}</row>`).join('');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`],
  ]);
}

export function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** What a table shows, read from the page (for tables without a registered exporter). */
function domRows(t: HTMLTableElement): Cell[][] {
  return Array.from(t.rows).map(r => Array.from(r.cells).map(c => (c.textContent ?? '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim()));
}
function titleOf(t: HTMLTableElement) {
  let el: HTMLElement | null = t;
  while (el && !el.classList?.contains('panel')) el = el.parentElement;
  const h = el?.querySelector('h2, h3')?.textContent ?? t.caption?.textContent ?? 'table';
  return h.replace(/[▾▸]/g, '').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'table';
}

/** The hover bar: one element outside the React tree, moved to the table under the pointer. */
export function installTableExport() {
  if ((window as any).__tblExport) return;
  (window as any).__tblExport = true;
  const bar = document.createElement('div');
  bar.className = 'tbl-export';
  bar.innerHTML = '<button type="button" data-k="csv" title="Save this table as CSV">CSV</button><button type="button" data-k="xlsx" title="Save this table as an Excel file">Excel</button>';
  bar.style.display = 'none';
  document.body.appendChild(bar);
  let cur: HTMLTableElement | null = null, hide: any = null;
  const place = (t: HTMLTableElement) => {
    const box = (t.closest('.tbl-wrap') as HTMLElement ?? t).getBoundingClientRect();
    bar.style.top = `${window.scrollY + box.top - 26}px`;
    bar.style.left = `${window.scrollX + box.right - 112}px`;
    bar.style.display = 'flex';
  };
  document.addEventListener('mouseover', e => {
    const el = e.target as HTMLElement;
    if (bar.contains(el)) { clearTimeout(hide); return; }
    const t = el.closest?.('table.tbl') as HTMLTableElement | null;
    if (t) { clearTimeout(hide); cur = t; place(t); }
    else { clearTimeout(hide); hide = setTimeout(() => { bar.style.display = 'none'; }, 600); }
  });
  bar.addEventListener('click', e => {
    const k = (e.target as HTMLElement).dataset?.k;
    if (!k || !cur) return;
    const rows = exporters.get(cur)?.() ?? domRows(cur);
    const name = titleOf(cur);
    if (k === 'csv') download(`${name}.csv`, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    else download(`${name}.xlsx`, toXlsx(rows, name));
  });
}
