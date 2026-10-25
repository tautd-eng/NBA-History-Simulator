// Fatigue check: tip-off fatigue levels, back-to-back effect on results, league scoring.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { setEraCal, FATIGUE } from '../src/engine/game';
if (process.env.NOFAT) FATIGUE.free = 1e9;
import { fatigueExcess } from '../src/league/fatigue';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 2010);
const lg = newLeague(0, 9, undefined, { start });
const tip: number[] = [];
let n = 0;
while (lg.phase === 'regular') {
  simDay(lg);
  // fatigue players carried into today's games = stored before the game; sample from players who just played
  for (const r of lg.recent.slice(-15)) for (const b of [r.home, r.away]) for (const pl of b.players) if (pl.st.min >= 25) { const p = lg.players[pl.pid]; tip.push(p.fat! - 0.6 * pl.st.min * (1 - 0.1 * p.endur)); }
  if (++n > 400) break;
}
tip.sort((a, b) => a - b);
const q = (f: number) => tip[Math.floor(f * (tip.length - 1))].toFixed(1);
console.log(`tip-off fatigue of 25+ min players: p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} | excess median ${fatigueExcess(+q(0.5)).toFixed(1)}`);
// back-to-back effect
const played = new Map<string, number[]>();
for (const g of lg.schedule) for (const t of [g.home, g.away]) (played.get(t) ?? played.set(t, []).get(t)!).push(g.day);
const b2b = (t: string, d: number) => played.get(t)!.includes(d - 1);
let w = 0, gms = 0, wr = 0, gr = 0;
for (const g of lg.schedule) {
  if (g.hs === undefined) continue;
  const hb = b2b(g.home, g.day), ab = b2b(g.away, g.day);
  if (hb === ab) continue;
  const tiredWon = hb ? g.hs! > g.as! : g.as! > g.hs!;
  gms++; if (tiredWon) w++;
}
const teams = Object.values(lg.teams).filter(t => t.gp);
const ppg = teams.reduce((a, t) => a + t.st!.pts / t.gp!, 0) / teams.length;
const rpg = teams.reduce((a, t) => a + (t.st!.orb + t.st!.drb) / t.gp!, 0) / teams.length;
console.log(`B2B team vs rested: won ${(w / gms * 100).toFixed(1)}% of ${gms} | ppg ${ppg.toFixed(1)} rpg ${rpg.toFixed(1)}`);
