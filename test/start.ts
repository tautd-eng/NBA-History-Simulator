// Start-year and class-mode check.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import { H, ovrOf } from '../src/data';
import { ageIn } from '../src/players';
import { careerValue } from '../src/league/classes';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 2000), mode = (process.argv[3] ?? 'real') as any, years = +(process.argv[4] ?? 2);
const lg = newLeague(0.5, 11, undefined, { start, classMode: mode });
const teams = Object.values(lg.teams);
console.log(`start ${lg.season}: ${teams.length} teams, rosters ${Math.min(...teams.map(t => t.roster.length))}-${Math.max(...teams.map(t => t.roster.length))}, players ${Object.keys(lg.players).length}, stash ${Object.values(lg.players).filter((p: any) => p.stash).length}`);
const top = Object.values(lg.players).filter(p => p.tid).sort((a, b) => ovrOf(b.z) - ovrOf(a.z)).slice(0, 5);
console.log('  top', top.map(p => `${p.name} ${lg.teams[p.tid!].abbr} ${ovrOf(p.z)}`).join(', '));
if (lg.classMap) {
  const ys = Object.keys(lg.classMap).slice(0, 8);
  for (const y of ys) {
    const c = lg.classMap[y];
    const vals = c.map(careerValue).sort((a, b) => b - a);
    console.log(`  class ${y}${lg.classSrc ? ' (=' + lg.classSrc[y] + ')' : ''}: n=${c.length} top3 ${c.slice().sort((a, b) => careerValue(b) - careerValue(a)).slice(0, 3).map(pid => H.players[pid].n).join(', ')} | stars(v>50) ${vals.filter(v => v > 50).length} sum ${vals.reduce((a, b) => a + b, 0).toFixed(0)}`);
  }
}
for (let y = 0; y < years; y++) {
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  runDraftPhase(lg);
  const s = lg.history.at(-1)!;
  const d = s.draft!.slice(0, 3).map(x => { const p = lg.players[x.pid]; return `${p.name} (age ${ageIn(p, lg.season + 1)}, OVR ${ovrOf(p.z)}, shift ${p.shift ?? 0})`; });
  console.log(`${s.season}: champ ${s.champion} | draft ${d.join('; ')}`);
  startNewSeason(lg);
}
