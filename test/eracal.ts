// Per-season calibration: for every season, nudge the era offsets until the
// simulated league (with that season's real rosters) matches the real league averages.
import { writeFileSync } from 'fs';
import { boot, runSeason, report } from './harness';
import { setEraCal, EraCal, NO_CAL } from '../src/engine/game';
import { logit, FIRST_SEASON, LAST_SEASON } from '../src/data';
boot();
const lg = (x: number) => logit(Math.min(0.999, Math.max(0.001, x)));
const out: Record<string, EraCal> = {};
const iters = +(process.argv[2] ?? 4);
for (let s = FIRST_SEASON; s <= LAST_SEASON; s++) {
  const e: EraCal = { ...NO_CAL };
  let last = 0;
  for (let it = 0; it < iters; it++) {
    setEraCal({ [s]: e });
    const r = report(s, runSeason(s, 1000 * s + it, 1));
    last = r.err;
    const v = Object.fromEntries(r.rows.map(([k, sim, real]) => [k, { sim, real }]));
    const d = 0.9;
    const ratio = (k: string) => Math.pow(v[k].real / v[k].sim, d);
    const dl = (k: string, scale = 1) => d * (lg(v[k].real / scale) - lg(v[k].sim / scale));
    e.pace /= ratio('pace');
    e.tpa += v['3par'].real > 0.005 ? dl('3par') : 0;
    e.p2 += dl('p2'); if (v['p3'].real > 0) e.p3 += dl('p3'); e.ft += dl('ft%');
    e.tov += dl('tov%', 100);
    e.orb *= Math.exp(dl('orb%', 100));
    e.ast *= ratio('ast/fg'); e.stl *= ratio('stl/g'); e.blk *= ratio('blk/g');
    e.ftr *= ratio('ftr');
    e.pf = Math.max(0, e.pf + (v['pf/g'].real - v['pf/g'].sim) / 7.5);
  }
  out[s] = Object.fromEntries(Object.entries(e).map(([k, x]) => [k, Math.round((x as number) * 10000) / 10000])) as any;
  console.log(s, 'err', (100 * last).toFixed(2) + '%', JSON.stringify(out[s]));
}
writeFileSync(new URL('../src/engine/eracal.json', import.meta.url), JSON.stringify(out));
