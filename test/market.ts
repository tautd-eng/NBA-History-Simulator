// Free-agent decisions: who goes where and why, discounts, max contracts, extensions.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, enterFreeAgency, faStage, startSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import { askingSalary, maxSalary, payroll } from '../src/ai/value';
import { ageIn } from '../src/players';
import { shownOvr } from '../src/data';
import { discount, traits } from '../src/league/prefs';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 2003), years = +(process.argv[3] ?? 2);
const lg = newLeague(0.3, 4, undefined, { start });
for (let y = 0; y < years; y++) {
  const t0 = Date.now();
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  const ext = Object.values(lg.players).filter(p => p.ext);
  const expiring = Object.values(lg.players).filter(p => p.tid && p.contract.exp === lg.season);
  console.log(`${lg.season}: season ${((Date.now() - t0) / 1000).toFixed(0)}s | extensions ${ext.length} of ${expiring.length} expiring; e.g. ${ext.slice(0, 4).map(p => `${p.name} ${(p.ext!.sal * 100).toFixed(0)}%x${p.ext!.exp - lg.season}`).join(', ')}`);
  runDraftPhase(lg);
  const t1 = Date.now();
  enterFreeAgency(lg);
  while (lg.fa!.stage <= 3) faStage(lg);
  const signs = lg.fa!.log.filter(x => x.kind === 'sign' && x.sal);
  const rows = signs.map(x => { const p = lg.players[x.pid!]; const ask = askingSalary(p, lg.season); return { p, x, ratio: x.sal! / ask, ovr: shownOvr(p.z), age: ageIn(p, lg.season), tr: traits(p, lg.season) }; });
  const vets = rows.filter(r => r.age >= 31), young = rows.filter(r => r.age <= 25);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  console.log(`   FA ${((Date.now() - t1) / 1000).toFixed(1)}s | signings ${signs.length} | paid/ask: all ${avg(rows.map(r => r.ratio)).toFixed(2)}, vets ${avg(vets.map(r => r.ratio)).toFixed(2)}, young ${avg(young.map(r => r.ratio)).toFixed(2)} | max deals ${rows.filter(r => r.x.sal! >= maxSalary(r.p, lg.season) - 1e-6).length}`);
  const show = [...rows.filter(r => r.ovr >= 80), ...rows.filter(r => r.ratio < 0.85).slice(0, 4), ...rows.filter(r => r.ratio > 1.2).slice(0, 3)];
  for (const r of show.slice(0, 12)) {
    const t = lg.teams[r.x.tid!];
    console.log(`   ${r.p.name} (${r.ovr}, ${r.age}) → ${t.abbr} (${t.w}-${t.l}) ${(r.x.sal! * 100).toFixed(1)}% vs ask ${(askingSalary(r.p, lg.season) * 100).toFixed(1)}% | disc ${(discount(lg, r.p, r.x.tid!) * 100).toFixed(0)}% | money ${r.tr.money.toFixed(2)} win ${r.tr.win.toFixed(2)}`);
  }
  startSeason(lg);
  const pays = Object.values(lg.teams).filter(t => t.active).map(t => payroll(lg, t.tid));
  console.log(`   payroll avg ${(avg(pays) * 100).toFixed(0)}% max ${(Math.max(...pays) * 100).toFixed(0)}%`);
}
