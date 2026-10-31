// Monte Carlo side analysis for real NBA games, using the NBA History Simulator engine.
// Usage: bun predict/sim.ts input.json > output.json
//
// input.json:
// {
//   "sims": 1000, "seed": 1,
//   "games": [{
//     "home": "BOS", "away": "NYK",
//     "line": -6.5,                       // optional: home team spread (negative = home favoured)
//     "total": 224.5,                     // optional: game total
//     "out": ["Jayson Tatum"],            // optional: players who will not play (names or Basketball-Reference ids)
//     "add": { "BOS": ["Some Player"] },  // optional: players now on a team who are missing from the opening roster
//     "props": [{ "player": "Jalen Brunson", "stat": "pts", "line": 27.5 }]
//   }]
// }
// stat: pts | reb | ast | tpm | stl | blk | pra | pts_reb | pts_ast | reb_ast
//
// Ratings are each player's latest real season (2025–26) and rosters are the 2026–27 opening rosters,
// so treat the output as one independent signal, never as the decision on its own.
import { readFileSync } from 'fs';
import { loadHistory, LAST_SEASON } from '../src/data';
import { newLeague } from '../src/league/league';
import { simGame, setEraCal } from '../src/engine/game';
import { Rng } from '../src/rng';
import cal from '../src/engine/eracal.json';

const ALIAS: Record<string, string> = { BKN: 'BRK', PHX: 'PHO', CHO: 'CHA', NO: 'NOP', NOR: 'NOP', SA: 'SAS', GS: 'GSW', NY: 'NYK', UTAH: 'UTA', WSH: 'WAS' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
const tidOf = (t: string) => ALIAS[t.toUpperCase()] ?? t.toUpperCase();

type Stat = 'pts' | 'reb' | 'ast' | 'tpm' | 'stl' | 'blk' | 'pra' | 'pts_reb' | 'pts_ast' | 'reb_ast';
const statOf = (st: any, k: Stat): number => {
  const reb = st.orb + st.drb;
  switch (k) {
    case 'pts': return st.pts; case 'reb': return reb; case 'ast': return st.ast; case 'tpm': return st.tpm;
    case 'stl': return st.stl; case 'blk': return st.blk; case 'pra': return st.pts + reb + st.ast;
    case 'pts_reb': return st.pts + reb; case 'pts_ast': return st.pts + st.ast; case 'reb_ast': return reb + st.ast;
  }
};
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const input = JSON.parse(readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8'));
const N = Math.max(100, Math.min(5000, input.sims ?? 1000));

loadHistory(JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url), 'utf8')));
setEraCal(cal as any);
const lg = newLeague(0.5, 11, undefined, { start: 2027 });
const season = Math.min(lg.season, LAST_SEASON); // 2026–27 is past the data: rate tables and calibration come from the latest real season

// name index over every player the league knows (rostered and free agents)
const byName = new Map<string, string[]>();
for (const p of Object.values(lg.players)) { const k = norm(p.name); byName.set(k, [...(byName.get(k) ?? []), p.id]); }
const warnings: string[] = [];
function findPid(q: string, prefer?: string[]): string | null {
  if (lg.players[q]) return q;
  const k = norm(q);
  let ids = byName.get(k);
  if (!ids) { // last name + first initial fallback
    const parts = k.split(' '); const last = parts.at(-1)!, ini = parts[0]?.[0];
    ids = [...byName.entries()].filter(([n]) => n.split(' ').at(-1) === last && n[0] === ini).flatMap(([, v]) => v);
  }
  if (!ids?.length) { warnings.push(`player not found: ${q}`); return null; }
  if (ids.length > 1 && prefer) { const hit = ids.find(id => prefer.includes(id)); if (hit) return hit; }
  return ids[0];
}

const results: any[] = [];
let seed = input.seed ?? 1;
for (const g of input.games ?? []) {
  const h = tidOf(g.home), a = tidOf(g.away);
  if (!lg.teams[h] || !lg.teams[a]) { results.push({ home: g.home, away: g.away, error: 'unknown team' }); continue; }
  const roster = (tid: string, withOut: boolean) => {
    const ids = new Set(lg.teams[tid].roster);
    for (const q of g.add?.[tid] ?? g.add?.[tid === h ? g.home : g.away] ?? []) { const id = findPid(q); if (id) ids.add(id); }
    const outIds = new Set(withOut ? (g.out ?? []).map((q: string) => findPid(q, [...ids])).filter(Boolean) : []);
    const healthy = new Set((g.healthy ?? []).map((q: string) => findPid(q)).filter(Boolean));
    // long-term injuries known on opening night stay out unless listed in "healthy"
    return [...ids].map(id => lg.players[id]).filter(p => p && !outIds.has(p.id) && !(p.injury > 0 && !healthy.has(p.id)));
  };
  const run = (hp: any[], ap: any[], s: number) => {
    const margins: number[] = [], totals: number[] = [], lines: Record<string, any[]> = {};
    const rng = new Rng(s);
    for (let i = 0; i < N; i++) {
      const res = simGame({ tid: h, players: hp, paceZ: lg.teams[h].paceZ }, { tid: a, players: ap, paceZ: lg.teams[a].paceZ }, { season, po: false, rng });
      margins.push(res.home.pts - res.away.pts); totals.push(res.home.pts + res.away.pts);
      for (const b of [res.home, res.away]) for (const pl of b.players) (lines[pl.pid] ??= []).push(pl.st);
    }
    return { margins, totals, lines };
  };
  const gameSeed = seed++;
  const hp = roster(h, true), ap = roster(a, true);
  const R = run(hp, ap, gameSeed);
  // same game with everyone in "out" available: the difference isolates what the absences change,
  // which is the most trustworthy part of the engine (it cancels its own biases)
  const hasOut = (g.out ?? []).length > 0;
  const F = hasOut ? run(roster(h, false), roster(a, false), gameSeed) : R;
  const { margins, totals, lines } = R;
  const sd = Math.sqrt(mean(margins.map(x => (x - mean(margins)) ** 2)));
  const playerRow = (pid: string) => {
    const L = lines[pid] ?? [], B = F.lines[pid] ?? [];
    const m = (k: Stat) => r1(mean(L.map(s => statOf(s, k))));
    const row: any = { pid, name: lg.players[pid].name, min: r1(mean(L.map(s => s.min))), pts: m('pts'), reb: m('reb'), ast: m('ast'), tpm: m('tpm'), pra: m('pra') };
    if (hasOut && B.length) { row.dMin = r1(mean(L.map(s => s.min)) - mean(B.map(s => s.min))); row.dPts = r1(mean(L.map(s => s.pts)) - mean(B.map(s => s.pts))); row.dPra = r1(mean(L.map(s => statOf(s, 'pra'))) - mean(B.map(s => statOf(s, 'pra')))); }
    return row;
  };
  const top = (ps: any[]) => ps.map(p => playerRow(p.id)).sort((x, y) => y.min - x.min).slice(0, 9);
  const out: any = {
    home: h, away: a, sims: N,
    homeWinPct: r3(margins.filter(x => x > 0).length / N),
    meanMargin: r1(mean(margins)), medianMargin: pct(margins, 0.5), sdMargin: r1(sd), p10: pct(margins, 0.1), p90: pct(margins, 0.9),
    meanTotal: r1(mean(totals)),
    usedOut: (g.out ?? []),
    homePlayers: top(hp), awayPlayers: top(ap),
  };
  if (hasOut) out.injuryAdjPts = r1(mean(margins) - mean(F.margins)); // margin change caused by the absences (+ = helps home)
  if (typeof g.line === 'number') {
    const cov = margins.map(x => x + g.line);
    out.line = g.line;
    out.homeCoverPct = r3(cov.filter(x => x > 0).length / N);
    out.awayCoverPct = r3(cov.filter(x => x < 0).length / N);
    out.pushPct = r3(cov.filter(x => x === 0).length / N);
    out.simEdgePts = r1(mean(margins) + g.line); // >0 favours home side of the line
  }
  if (typeof g.total === 'number') { out.total = g.total; out.overPct = r3(totals.filter(x => x > g.total).length / N); }
  out.props = (g.props ?? []).map((pr: any) => {
    const pid = findPid(pr.player, [...hp, ...ap].map(p => p.id));
    if (!pid || !lines[pid]) return { ...pr, error: pid ? 'player not in either lineup' : 'player not found' };
    const v = lines[pid].map(s => statOf(s, pr.stat));
    const r: any = { ...pr, pid, mean: r1(mean(v)), median: pct(v, 0.5), overPct: r3(v.filter(x => x > pr.line).length / N), underPct: r3(v.filter(x => x < pr.line).length / N), minutes: r1(mean(lines[pid].map(s => s.min))) };
    if (hasOut && F.lines[pid]) { const b = mean(F.lines[pid].map(s => statOf(s, pr.stat))); r.fullRosterMean = r1(b); r.injuryDeltaPct = r1(100 * (mean(v) - b) / Math.max(1, b)); }
    return r;
  });
  results.push(out);
}
process.stdout.write(JSON.stringify({ engine: 'nba-history-simulator', season, ratingsFrom: 'latest real season (2025-26)', warnings, games: results }, null, 2));
