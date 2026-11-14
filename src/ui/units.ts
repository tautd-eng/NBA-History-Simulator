// Height in metres or in feet and inches (a preference kept in this browser).
let unit: 'm' | 'ft' = (() => { try { return localStorage.getItem('htUnit') === 'ft' ? 'ft' : 'm'; } catch { return 'm'; } })();
export const htUnit = () => unit;
export function setHtUnit(u: 'm' | 'ft') { unit = u; try { localStorage.setItem('htUnit', u); } catch { /* ignore */ } }
/** inches → "2.01 m" or "6′7″" */
export function htStr(inches: number): string {
  if (unit === 'ft') { const i = Math.round(inches); return `${Math.floor(i / 12)}′${i % 12}″`; }
  return `${(inches * 0.0254).toFixed(2)} m`;
}
/** a table column: shows the height in the chosen unit, sorts by inches */
export const htCol = (get: (r: any) => number) => ({ key: 'ht', label: 'Ht', title: unit === 'ft' ? 'Height, feet and inches' : 'Height, metres', get, fmt: (v: number) => htStr(v).replace(' m', '') });
/** a height difference in inches → "+5 cm" or "+2″" */
export const htDiff = (d: number) => unit === 'ft' ? `${d > 0 ? '+' : ''}${Math.round(d)}″` : `${d > 0 ? '+' : ''}${Math.round(d * 2.54)} cm`;
