// How strongly does on-court performance drive next season's ratings? Is the league stable?
import { boot, corr } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { performanceShift } from '../src/league/health';
import { setEraCal } from '../src/engine/game';
import { ovrOf } from '../src/data';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const years = +(process.argv[2] ?? 12);
const lg = newLeague(0, +(process.argv[3] ?? 5));
const gains: number[] = [], changes: number[] = [];
let breakouts: string[] = [];
for (let y = 0; y < years; y++) {
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  const S = lg.season;
  const ppg = Object.values(lg.teams).filter(t => t.gp).reduce((a, t) => a + t.st!.pts / t.gp!, 0) / Object.values(lg.teams).filter(t => t.gp).length;
  runDraftPhase(lg);
  const perf = performanceShift(lg, S);
  const before = new Map(Object.values(lg.players).map(p => [p.id, ovrOf(p.z)]));
  const mins = new Map(Object.values(lg.players).map(p => [p.id, p.career.filter(c => c.s === S).reduce((a, c) => a + c.min, 0)]));
  startNewSeason(lg);
  const ch: number[] = [];
  for (const p of Object.values(lg.players)) {
    if (p.retired || !before.has(p.id) || (mins.get(p.id) ?? 0) < 500) continue;
    const c = ovrOf(p.z) - before.get(p.id)!;
    ch.push(c); const g = perf.get(p.id)?.ovrGain; if (g !== undefined && Number.isFinite(g)) { changes.push(c); gains.push(g); }
    if (before.get(p.id)! < 52 && ovrOf(p.z) >= 62) breakouts.push(`${S + 1} ${p.name} ${before.get(p.id)}→${ovrOf(p.z)} (${Math.round(mins.get(p.id)!)} min)`);
  }
  const sd = Math.sqrt(ch.reduce((a, x) => a + x * x, 0) / ch.length);
  const top = Object.values(lg.players).filter(p => p.tid).map(p => ovrOf(p.z)).sort((a, b) => b - a);
  const h = lg.health!.at(-1)!;
  console.log(`${S}: ppg ${ppg.toFixed(1)} | ovr change sd ${sd.toFixed(1)}, +8 or more: ${ch.filter(x => x >= 8).length}, -8 or less: ${ch.filter(x => x <= -8).length} | top10 ${(top.slice(0, 10).reduce((a, b) => a + b, 0) / 10).toFixed(1)} (real-level ${h.real.top10.toFixed(1)}) | best ${top[0]}`);
}
console.log('corr(performance signal, actual change)', corr(gains, changes).toFixed(2));
console.log('breakouts (<52 → 62+ in one year):', breakouts.length); breakouts.slice(0, 12).forEach(b => console.log('  ' + b));
