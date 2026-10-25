import { boot, runSeason, report } from './harness';
import { C } from '../src/engine/game';
import { logit } from '../src/data';
boot();
const seasons = (process.argv[2] ?? '1980,1988,1996,2004,2012,2020,2025').split(',').map(Number);
const iters = +(process.argv[3] ?? 6);
const lg = (x: number) => logit(Math.min(0.999, Math.max(0.001, x)));
for (let it = 0; it < iters; it++) {
  const acc: Record<string, number[]> = {};
  let errSum = 0;
  for (const s of seasons) {
    const r = report(s, runSeason(s, 100 + it, 1));
    errSum += r.err;
    for (const [k, sim, real] of r.rows) (acc[k] ??= []).push(k === 'pace' || k === 'ast/fg' || k === 'stl/g' || k === 'blk/g' || k === 'pf/g' ? sim / real : k === 'orb%' || k === 'tov%' ? (lg(real / 100) - lg(sim / 100)) : (lg(real) - lg(sim)));
  }
  const m = (k: string) => acc[k].reduce((a, b) => a + b, 0) / acc[k].length;
  console.log(`iter ${it} mean abs rel err ${(100 * errSum / seasons.length).toFixed(2)}%`);
  const d = 0.85;
  C.possSec *= Math.pow(m('pace'), d);
  C.tpa += d * m('3par');
  C.p2 += d * m('p2');
  C.p3 += d * m('p3');
  C.ft += d * m('ft%');
  C.tov += d * m('tov%');
  C.orb *= Math.exp(d * m('orb%'));
  C.ast /= Math.pow(m('ast/fg'), d);
  C.stlShare /= Math.pow(m('stl/g'), d);
  C.blk /= Math.pow(m('blk/g'), d);
  C.silentPf = Math.max(0, C.silentPf - d * (m('pf/g') - 1) * 0.6);
  C.foulTrip *= Math.exp(d * m('ftr'));
}
const keys = ['possSec', 'tpa', 'p2', 'p3', 'ft', 'tov', 'orb', 'ast', 'stlShare', 'blk', 'silentPf', 'foulTrip'] as const;
console.log(JSON.stringify(Object.fromEntries(keys.map(k => [k, Math.round((C as any)[k] * 10000) / 10000]))));
for (const s of seasons) console.log(report(s, runSeason(s, 999, 1)).text);
