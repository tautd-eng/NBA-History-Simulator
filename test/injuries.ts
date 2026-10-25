// Injury check against NBA injury studies: player-games lost per team, injuries per team, types, severe injuries.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import { injName } from '../src/league/injuries';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 1995), years = +(process.argv[3] ?? 2);
const G = process.argv[4] ? +process.argv[4] : null;
const lg = newLeague(0, 21, { games: G, series: null }, { start });
for (let y = 0; y < years; y++) {
  const S = lg.season;
  let missed = 0;
  const nTeams = Object.values(lg.teams).filter(t => t.active).length;
  while (lg.phase === 'regular') {
    const before = lg.schedule.filter(g => g.done).length;
    simDay(lg);
    for (const g of lg.schedule.filter(g => g.done).slice(before)) for (const tid of [g.home, g.away]) missed += lg.teams[tid].roster.filter(pid => lg.players[pid].injury > 0).length;
  }
  const regGames = lg.schedule.length;
  while (lg.phase === 'playoffs') simDay(lg);
  const hist = Object.values(lg.players).flatMap(p => (p.injHist ?? []).filter(h => h.s === S));
  const types: Record<string, number> = {};
  for (const h of hist) types[h.k] = (types[h.k] ?? 0) + 1;
  const inGame = hist.filter(h => h.w === 'game').length;
  console.log(`${S}: ${nTeams} teams | player-games lost per team (reg. season) ${(missed / nTeams).toFixed(0)} | injuries per team ${(hist.length / nTeams).toFixed(1)} (in games ${(inGame / hist.length * 100).toFixed(0)}%) | per 1000 player-games in games ${(inGame / (regGames * 2 * 10) * 1000).toFixed(1)} | mean games out ${(hist.reduce((a, h) => a + h.g, 0) / hist.length).toFixed(1)}`);
  console.log('   ' + Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${injName(k)} ${n}`).join(', '));
  const lasting = Object.values(lg.players).flatMap(p => (p.injHist ?? []).filter(h => h.s === S && h.lasting).map(h => `${p.name} (${injName(h.k)}, ${h.g})`));
  console.log('   severe:', lasting.slice(0, 12).join('; '));
  if (y < years - 1) { runDraftPhase(lg); startNewSeason(lg); console.log(`   carried into ${lg.season}: ${Object.values(lg.players).filter(p => p.inj && p.tid).map(p => `${p.name} ${p.injury}`).join(', ')}`); }
}
