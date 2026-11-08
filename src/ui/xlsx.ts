// A small reader for spreadsheets the user uploads: .xlsx (first sheet) or .csv – no library needed.
// Returns the rows as arrays of cell text.

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new (globalThis as any).DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** The files inside a zip (an .xlsx is one), by name. */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Record<string, string>> {
  const b = new Uint8Array(buf), v = new DataView(buf);
  let e = b.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not an Excel (.xlsx) file.');
  const n = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out: Record<string, string> = {};
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + size);
    out[name] = dec.decode(method === 8 ? await inflate(raw) : raw);
  }
  return out;
}

const colIdx = (ref: string) => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };

async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dp = new DOMParser();
  const strings: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const d = dp.parseFromString(files['xl/sharedStrings.xml'], 'application/xml');
    for (const si of Array.from(d.getElementsByTagName('si'))) strings.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent ?? '').join(''));
  }
  // the first sheet of the workbook
  let path = 'xl/worksheets/sheet1.xml';
  try {
    const wb = dp.parseFromString(files['xl/workbook.xml'], 'application/xml');
    const first = wb.getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rels = dp.parseFromString(files['xl/_rels/workbook.xml.rels'], 'application/xml');
    const t = Array.from(rels.getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (t) path = 'xl/' + t.replace(/^\/?xl\//, '').replace(/^\//, '');
  } catch { /* default */ }
  const xml = files[path] ?? Object.entries(files).find(([k]) => k.startsWith('xl/worksheets/'))?.[1];
  if (!xml) throw new Error('The file has no sheet.');
  const d = dp.parseFromString(xml, 'application/xml');
  const rows: string[][] = [];
  for (const r of Array.from(d.getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const t = c.getAttribute('t'), ref = c.getAttribute('r') ?? '';
      const val = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const text = t === 's' ? strings[+val] ?? '' : t === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map(x => x.textContent).join('') : val;
      row[ref ? colIdx(ref) : row.length] = text;
    }
    rows.push(Array.from(row, x => (x ?? '').trim()));
  }
  return rows;
}

function readCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const head = lines[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  return lines.map(l => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

export async function readSheet(file: File): Promise<string[][]> {
  if (/\.csv$|\.txt$/i.test(file.name)) return readCsv(await file.text());
  return readXlsx(await file.arrayBuffer());
}
