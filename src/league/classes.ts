// Draft classes: in their real years, whole real classes in a random order,
// or every prospect mixed together and dealt out so that each year gets about
// the same share of stars, starters and role players.
import { H, LAST_SEASON, bpmOf } from '../data';
import { Rng } from '../rng';
import { League } from '../types';

export type ClassMode = 'real' | 'shuffle' | 'mixed';
export const CLASS_MODES: [ClassMode, string, string][] = [
  ['real', 'Real classes in their own years', 'Every year brings that year\'s real draft class.'],
  ['shuffle', 'Real classes, random years', 'Classes stay intact (e.g. the whole 1984 class together), but you never know which year each one arrives.'],
  ['mixed', 'Mixed classes', 'All rookies are pooled and dealt out by year so every class gets a similar share of stars, starters and role players.'],
];

const draftYears = (start: number) => {
  const ys: number[] = [];
  for (let y = start; y <= Math.min(LAST_SEASON - 1, 2025); y++) if (H.classes[String(y)]?.length) ys.push(y);
  return ys;
};

/**
 * How good the prospect turned out in reality: the mean of his three best
 * seasons (quality × playing time), so short careers of recent players are
 * not mistaken for weak ones. 0 = never played.
 */
export function careerValue(pid: string) {
  const hp = H.players[pid];
  if (!hp?.s.length) return 0;
  const seasons = hp.s.map(s => Math.max(0, bpmOf(s[7]) + 2.5) * Math.min(s[3], 2600) / 2600).sort((a, b) => b - a);
  const top = seasons.slice(0, 3);
  while (top.length < 3) top.push(0);
  return (top[0] + top[1] + top[2]) / 3 * 10;
}

/** Builds the class of each draft year for the chosen mode (nothing to store for real classes). */
export function buildClasses(lg: League, mode: ClassMode, rng: Rng) {
  lg.classMode = mode;
  if (mode === 'real') return;
  const years = draftYears(lg.start ?? lg.season);
  const map: Record<string, string[]> = {};
  const src: Record<string, number> = {};
  if (mode === 'shuffle') {
    const perm = rng.shuffle([...years]);
    years.forEach((y, i) => { map[y] = [...H.classes[String(perm[i])]]; src[y] = perm[i]; });
  } else {
    const size: Record<number, number> = {};
    const pool: { pid: string; v: number }[] = [];
    for (const y of years) {
      size[y] = H.classes[String(y)].length;
      for (const pid of H.classes[String(y)]) pool.push({ pid, v: careerValue(pid) + rng.next() * 1e-3 });
    }
    pool.sort((a, b) => b.v - a.v);
    const total = pool.length;
    const got: Record<number, number> = Object.fromEntries(years.map(y => [y, 0]));
    for (const y of years) map[y] = [];
    // best first: each player goes to the year furthest behind its fair share so far (with some noise)
    pool.forEach(({ pid }, k) => {
      const frac = (k + 1) / total;
      let best = -1, bestD = -1e9;
      for (const y of years) {
        if (got[y] >= size[y]) continue;
        const d = size[y] * frac - got[y] + rng.normal() * 0.6;
        if (d > bestD) { bestD = d; best = y; }
      }
      map[best].push(pid); got[best]++;
    });
  }
  lg.classMap = map;
  lg.classSrc = mode === 'shuffle' ? src : undefined;
}

export function classFor(lg: League, Y: number): string[] {
  const own = lg.classMap ? lg.classMap[String(Y)] : H.classes[String(Y)];
  if (own?.length) return own;
  if (Y > lastClassYear()) return futureClass(lg, Y);
  return [];
}

// ---------------------------------------------------------------- beyond the data
// After the last real draft, a historical class comes round again each year: fresh copies of its players
// (ids "pid~year") who develop like the originals did in the same year of their careers.
export const cloneBase = (pid: string) => pid.split('~')[0];
/** Copies share the original's historical record (career, draft, looks). */
export function registerClone(id: string) {
  const b = cloneBase(id);
  if (b !== id && H.players[b] && !H.players[id]) (H.players as any)[id] = H.players[b];
}
export function registerClones(lg: League) {
  for (const id of Object.keys(lg.players)) registerClone(id);
  for (const ids of Object.values(lg.future?.cls ?? {})) ids.forEach(registerClone);
}
let lastCls = 0;
export function lastClassYear() {
  if (!lastCls) lastCls = Math.max(...Object.keys(H.classes).filter(y => H.classes[y]?.length).map(Number));
  return lastCls;
}
function futureClass(lg: League, Y: number): string[] {
  const f = (lg.future ??= { order: [], cls: {} });
  if (f.cls[String(Y)]) return f.cls[String(Y)];
  if (!f.order.length) {
    const ys = Object.keys(H.classes).map(Number).filter(y => H.classes[String(y)]?.length >= 20).sort((a, b) => a - b);
    f.order = new Rng(lg.seed * 31 + Y).shuffle(ys);
  }
  const src = f.order.shift()!;
  const ids = H.classes[String(src)].map(pid => `${pid}~${Y}`);
  ids.forEach(registerClone);
  f.cls[String(Y)] = ids;
  (lg.classSrc ??= {})[String(Y)] = src;
  return ids;
}

/** Years between a prospect's real draft and the draft he enters here. */
export function shiftFor(pid: string, Y: number) {
  const d = H.players[pid]?.d;
  return d ? Y - d[0] : 0;
}
