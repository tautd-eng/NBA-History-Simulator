// @ts-nocheck
// A table whose columns sort on click (again to reverse).
import { useMemo, useState } from 'react';

export interface Col { key: string; label: string; title?: string; get: (r: any) => any; fmt?: (v: any, r: any) => any; left?: boolean; asc?: boolean; cls?: string }

export function SortTable({ cols, rows, initial, initialAsc = false, footer, rowClass, limit, caption }: any) {
  const [key, setKey] = useState(initial ?? cols[0].key);
  const [asc, setAsc] = useState(initialAsc);
  const col = cols.find((c: Col) => c.key === key) ?? cols[0];
  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const na = va == null || Number.isNaN(va), nb = vb == null || Number.isNaN(vb);
      if (na && nb) return 0; if (na) return 1; if (nb) return -1;
      const d = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return asc ? d : -d;
    });
    return limit ? out.slice(0, limit) : out;
  }, [rows, key, asc, limit]);
  const click = (c: Col) => {
    if (c.key === key) setAsc(!asc);
    else { setKey(c.key); setAsc(!!c.asc); }
  };
  return (
    <div className="tbl-wrap">
      <table className="tbl sortable">
        {caption && <caption>{caption}</caption>}
        <thead><tr>
          {cols.map((c: Col) => (
            <th key={c.key} className={`${c.left ? 'l' : ''} ${c.key === key ? 'sorted' : ''}`} aria-sort={c.key === key ? (asc ? 'ascending' : 'descending') : 'none'}>
              <button className="th-btn" title={c.title ?? `Sort by: ${c.label}`} onClick={() => click(c)}>
                {c.label}{c.key === key ? (asc ? ' ▲' : ' ▼') : ''}
              </button>
            </th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map((r: any, i: number) => (
            <tr key={r.key ?? i} className={rowClass?.(r) ?? ''}>
              {cols.map((c: Col) => <td key={c.key} className={`${c.left ? 'l' : ''} ${c.cls ?? ''}`}>{c.fmt ? c.fmt(c.get(r), r) : c.get(r) ?? '–'}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export const f1 = (v: any) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(1));
export const f0 = (v: any) => (v == null || Number.isNaN(v) ? '–' : Math.round(v));
export const pctf = (v: any) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(3).replace(/^0/, ''));
export const div = (a: number, b: number) => (b ? a / b : NaN);
