// Long-run test: simulate many seasons headless and print what happened.
import { boot } from './harness';
import { newLeague, simDay, realChampion } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import { H, bpmOf, ovrOf } from '../src/data';
import { payroll } from '../src/ai/value';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const years = +(process.argv[2] ?? 3), destiny = +(process.argv[3] ?? 0.5), seed = +(process.argv[4] ?? 42);
const lg = newLeague(destiny, seed);
const t0 = Date.now();
for (let y = 0; y < years && !lg.ended; y++) {
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  runDraftPhase(lg);
  const s = lg.history[lg.history.length - 1];
  const nm = (pid?: string) => (pid ? lg.players[pid].name : '-');
  const real = H.awards[String(s.season)] ?? {};
  const active = Object.values(lg.players).filter(p => p.tid);
  const avgBpm = active.reduce((a, p) => a + bpmOf(p.z), 0) / active.length;
  const top = [...active].sort((a, b) => bpmOf(b.z) - bpmOf(a.z)).slice(0, 3).map(p => `${p.name} ${ovrOf(p.z)}`);
  const st = s.standings;
  const wp = st.map(x => x.w / (x.w + x.l)); const sd = Math.sqrt(wp.reduce((a, b) => a + (b - 0.5) ** 2, 0) / wp.length);
  console.log(`${s.season}: champ ${lg.teams[s.champion!].abbr} (real ${realChampion(s.season)}) | best ${st[0].abbr} ${st[0].w}-${st[0].l} worst ${st.at(-1)!.abbr} ${st.at(-1)!.w}-${st.at(-1)!.l} | MVP ${nm(s.mvp)} (real ${H.players[real.mvp!]?.n ?? '-'}) | ROY ${nm(s.roy)} | #1 ${s.draft?.[0] ? nm(s.draft[0].pid) + ' (real #' + s.draft[0].realPick + ')' : '-'} | sd ${sd.toFixed(3)} | avgBPM ${avgBpm.toFixed(2)} | top ${top.join(', ')}`);
  if (s.leaders?.pts) console.log(`       PTS ${nm(s.leaders.pts.pid)} ${s.leaders.pts.v}  REB ${nm(s.leaders.reb?.pid)} ${s.leaders.reb?.v}  AST ${nm(s.leaders.ast?.pid)} ${s.leaders.ast?.v}  | ${s.notes.join(' ')}`);
  const tr = (lg.trades ?? []).filter(t => t.s === s.season);
  console.log(`       trades in season ${tr.length}: ${tr.slice(0, 3).map(t => t.desc).join(' | ')}`);
  startNewSeason(lg);
  const st2 = (lg.trades ?? []).filter(t => t.s === lg.season);
  console.log(`       summer trades ${st2.length}: ${st2.slice(0, 2).map(t => t.desc).join(' | ')}`);
  const h = lg.health?.at(-1); if (h) console.log(`       health ${h.s}: top10 sim ${h.sim.top10.toFixed(1)} real ${h.real.top10.toFixed(1)} | rot ${h.sim.rotOvr.toFixed(1)}/${h.real.rotOvr.toFixed(1)} | sd ${h.sim.bpmSd.toFixed(2)}/${h.real.bpmSd.toFixed(2)} | 80+ ${h.sim.n80}/${h.real.n80} | shift ${h.shift} spread ${h.spread}`);
  const sizes = Object.values(lg.teams).filter(t => t.active).map(t => t.roster.length);
  const pays = Object.values(lg.teams).filter(t => t.active).map(t => payroll(lg, t.tid));
  console.log(`       rosters ${Math.min(...sizes)}-${Math.max(...sizes)}  payroll ${Math.min(...pays).toFixed(2)}-${Math.max(...pays).toFixed(2)}  FA ${Object.values(lg.players).filter(p => !p.tid && !p.retired).length}  teams ${sizes.length}`);
}
console.log('time', (Date.now() - t0) / 1000, 's', 'size', (JSON.stringify(lg).length / 1e6).toFixed(2), 'MB');
