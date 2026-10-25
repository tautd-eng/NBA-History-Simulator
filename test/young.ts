// Young players: how often do they lose ground when they played about as expected?
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { performanceShift, initDev } from '../src/league/health';
import { setEraCal } from '../src/engine/game';
import { ovrOf } from '../src/data';
import { ageIn } from '../src/players';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any); initDev();
const years = +(process.argv[2] ?? 6);
const lg = newLeague(0, 5);
const B: Record<string, { n: number; d3: number; sum: number; flopN: number; flopSum: number; up: number }> = {};
for (let y = 0; y < years; y++) {
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  const S = lg.season;
  runDraftPhase(lg);
  const perf = performanceShift(lg, S);
  const before = new Map(Object.values(lg.players).map(p => [p.id, ovrOf(p.z)]));
  startNewSeason(lg);
  for (const p of Object.values(lg.players)) {
    if (p.retired || !before.has(p.id) || p.entered > S) continue;
    const age = ageIn(p, S);
    const k = age <= 22 ? '≤22' : age <= 24 ? '23-24' : age <= 26 ? '25-26' : age <= 29 ? '27-29' : '30+';
    const b = (B[k] ??= { n: 0, d3: 0, sum: 0, flopN: 0, flopSum: 0, up: 0 });
    const c = ovrOf(p.z) - before.get(p.id)!;
    const g = perf.get(p.id)?.ovrGain ?? 0;
    if (g < -3) { b.flopN++; b.flopSum += c; continue; }
    b.n++; b.sum += c; if (c <= -3) { b.d3++; if (age <= 24 && process.env.DBG) console.log("DROP", S, p.name, age, before.get(p.id), "->", ovrOf(p.z), "gain", g.toFixed(2), "hist", JSON.stringify(p.ovrHist.slice(-3)), "flop", (p.dev as any)?.flop, "tid", p.tid); } if (c >= 3) b.up++;
  }
}
for (const k of ['≤22', '23-24', '25-26', '27-29', '30+']) {
  const b = B[k]; if (!b) continue;
  console.log(`${k.padEnd(6)} played ~as expected: n=${b.n} avg ${(b.sum / b.n).toFixed(2)} drop≥3 ${(b.d3 / b.n * 100).toFixed(0)}% rise≥3 ${(b.up / b.n * 100).toFixed(0)}% | flops n=${b.flopN} avg ${(b.flopSum / Math.max(1, b.flopN)).toFixed(2)}`);
}
