// AI trades over seasons: what moves and whether it looks sensible.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 2005), years = +(process.argv[3] ?? 1);
const lg = newLeague(0, 12, undefined, { start });
for (let y = 0; y < years; y++) {
  const n0 = lg.trades?.length ?? 0;
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  console.log('modes: ' + Object.values(lg.teams).filter(t => t.mode).map(t => `${t.abbr}=${t.mode}(${t.w}-${t.l})`).join(' '));
  runDraftPhase(lg); startNewSeason(lg);
  const tr = (lg.trades ?? []).slice(n0);
  console.log(`${lg.season - 1}: ${tr.length} trades (${tr.filter(t => t.phase === 'regular').length} in season, ${tr.filter(t => t.phase === 'freeagency').length} summer)`);
  const m = (tid: string) => lg.teams[tid].mode ?? lg.teams[tid].strategy;
  for (const t of tr.slice(0, 16)) console.log(`  [${t.phase === 'regular' ? 'd' + t.day : 'vas.'}] ${t.a}:${m(t.a)} / ${t.b}:${m(t.b)} | ${t.desc}`);
}
