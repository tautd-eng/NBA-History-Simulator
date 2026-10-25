// Free agency check: step through draft day and the three FA stages like the UI does.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { stepOnce } from '../src/api';
import { draftOnClock, draftAdvance, draftPick, faOffer, faDemand, faRelease } from '../src/league/offseason';
import { isFreeAgent } from '../src/ai/trades';
import { setEraCal } from '../src/engine/game';
import { ovrOf } from '../src/data';
import { payroll } from '../src/ai/value';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const years = +(process.argv[2] ?? 4);
const lg = newLeague(0.5, 7, undefined, { start: +(process.argv[3] ?? 1980) });
lg.userTid = 'BOS';
for (let y = 0; y < years && !lg.ended; y++) {
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  stepOnce(lg); // init draft
  const d = lg.draftDay!;
  draftAdvance(lg, 'user');
  const on = draftOnClock(lg);
  if (on) { console.log(`  user on clock at #${on.pick}`); draftPick(lg, d.pool[d.pool.length - 1]); }
  draftAdvance(lg, 'all');
  console.log(`${d.year} draft done=${d.done} picks=${d.picks.length} prospectsLeft=${Object.values(lg.players).filter(p => p.prospect).length}`);
  stepOnce(lg); // enter FA
  if (lg.ended) break;
  const dec = lg.fa!.decisions ?? [];
  console.log(`  stage 0 decisions for BOS: ${dec.map(d => `${d.kind} ${lg.players[d.pid].name} rec=${d.rec}`).join('; ')} | league log: options ${lg.fa!.log.filter(x => x.kind === 'option').length}, QO tendered ${lg.fa!.log.filter(x => x.kind === 'qo').length}`);
  stepOnce(lg); // stage 0 -> 1
  console.log(`  FA open ${lg.season}: pending user=${lg.fa!.pending.map(pid => lg.players[pid].name).join(', ')} | FAs ${Object.values(lg.players).filter(p => isFreeAgent(lg, p)).length}`);
  // user tries to sign the best FA
  const best = Object.values(lg.players).filter(p => isFreeAgent(lg, p)).sort((a, b) => ovrOf(b.z) - ovrOf(a.z))[0];
  if (best) {
    const need = faDemand(lg, best, 'BOS');
    console.log(`  best FA ${best.name} OVR ${ovrOf(best.z)} wants ${(need * 100).toFixed(1)}%; BOS payroll ${(payroll(lg, 'BOS') * 100).toFixed(0)}% ->`, faOffer(lg, best.id, need).msg);
  }
  for (let s = 1; s <= 3; s++) {
    stepOnce(lg);
    const log = lg.fa!.log.filter(x => x.st === s);
    console.log(`  stage ${s}: matches ${log.filter(x => x.kind === 'match').length} sheets ${log.filter(x => x.kind === 'sheet').length} | signs ${log.filter(x => x.kind === 'sign').length} resign ${log.filter(x => x.kind === 'resign').length} leave ${log.filter(x => x.kind === 'leave').length} trades ${log.filter(x => x.kind === 'trade').length}`);
  }
  stepOnce(lg); // start season
  console.log(`  QO accepted: ${lg.fa!.log.filter(x => x.kind === 'qo' && x.st === 3).length} | RFAs this summer ${lg.fa!.log.filter(x => x.kind === 'qo' && x.st === 0).length} | players with options ${Object.values(lg.players).filter(p => p.contract.opts?.length && p.tid).length} | rookies ${Object.values(lg.players).filter(p => p.contract.rookie && p.tid).length}`);
  const sizes = Object.values(lg.teams).filter(t => t.active).map(t => t.roster.length);
  const pays = Object.values(lg.teams).filter(t => t.active).map(t => payroll(lg, t.tid));
  console.log(`  season ${lg.season} phase ${lg.phase}: roster ${Math.min(...sizes)}-${Math.max(...sizes)} payroll avg ${(pays.reduce((a, b) => a + b) / pays.length * 100).toFixed(0)}% max ${(Math.max(...pays) * 100).toFixed(0)}% | FAs left ${Object.values(lg.players).filter(p => isFreeAgent(lg, p)).length} | BOS ${lg.teams.BOS.roster.length}`);
}
