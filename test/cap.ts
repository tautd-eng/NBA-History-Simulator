// Hard cap check: payrolls over seasons, dumps, buyouts, modes.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import { payroll, hardCap } from '../src/ai/value';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 2000), years = +(process.argv[3] ?? 3), hc = process.argv[4] ? +process.argv[4] : undefined;
const lg = newLeague(0.3, 5, { games: null, series: null, hardCap: hc }, { start });
const report = (label: string) => {
  const ts = Object.values(lg.teams).filter(t => t.active);
  const pays = ts.map(t => payroll(lg, t.tid)).sort((a, b) => b - a);
  const modes: Record<string, number> = {};
  for (const t of ts) if (t.mode) modes[t.mode] = (modes[t.mode] ?? 0) + 1;
  const by = (m: string) => { const xs = ts.filter(t => (t.mode ?? t.strategy) === m).map(t => payroll(lg, t.tid)); return xs.length ? (xs.reduce((a, b) => a + b) / xs.length * 100).toFixed(0) : '-'; };
  console.log(`   by mode: allin ${by('allin')} contend ${by('contend')} middle ${by('middle')} rising ${by('rising')} rebuild ${by('rebuild')} tank ${by('tank')} | under 85%: ${pays.filter(x => x < 0.85).length}, under 70%: ${pays.filter(x => x < 0.7).length}`);
  console.log(`${label}: hard cap ${Math.round(hardCap(lg) * 100)}% | payroll max ${(pays[0] * 100).toFixed(0)}% top3 ${pays.slice(0, 3).map(x => (x * 100).toFixed(0)).join('/')} avg ${(pays.reduce((a, b) => a + b) / pays.length * 100).toFixed(0)}% | over: ${pays.filter(x => x > hardCap(lg) + 1e-9).length} | modes ${JSON.stringify(modes)}`);
};
report(`${lg.season} start`);
for (let y = 0; y < years; y++) {
  const n0 = lg.trades?.length ?? 0;
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  report(`${lg.season} end`);
  runDraftPhase(lg); startNewSeason(lg);
  const tr = (lg.trades ?? []).slice(n0);
  const dumps = tr.filter(t => t.aGets.length === 0);
  console.log(`   trades ${tr.length}, salary dumps ${dumps.length}: ${dumps.slice(0, 3).map(t => t.desc).join(' | ')}`);
  console.log(`   buyouts: ${lg.news.filter(n => n.s === lg.season && n.t.includes('buy out')).length} | mode news: ${lg.news.filter(n => n.t.includes('rising with a young') || n.t.includes('close to the hard cap')).slice(-3).map(n => n.t).join(' | ')}`);
  report(`${lg.season} after summer`);
}
