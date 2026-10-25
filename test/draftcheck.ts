// Checks every draft, lottery and expansion over a full run.
import { boot } from './harness';
import { newLeague, simDay } from '../src/league/league';
import { runDraftPhase, startNewSeason } from '../src/league/offseason';
import { setEraCal } from '../src/engine/game';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const years = +(process.argv[2] ?? 47), seed = +(process.argv[3] ?? 3);
const lg = newLeague(+(process.argv[4] ?? 0.5), seed, (process.argv[5] ? JSON.parse(process.argv[5]) : undefined) as any);
const problems: string[] = [];
const bad = (s: string) => { problems.push(s); };
for (let y = 0; y < years && !lg.ended; y++) {
  while (lg.phase === 'regular' || lg.phase === 'playoffs') simDay(lg);
  const S = lg.season;
  const beforeTeams = new Set(Object.values(lg.teams).filter(t => t.active).map(t => t.tid));
  const po = new Set(lg.series.flatMap(s => [s.hi, s.lo]).filter(Boolean));
  const st = lg.history.at(-1)!.standings;
  runDraftPhase(lg);
  const sum = lg.history.at(-1)!;
  const nTeams = Object.values(lg.teams).filter(t => t.active).length;
  const newTeams = [...Object.values(lg.teams)].filter(t => t.active && !beforeTeams.has(t.tid)).map(t => t.tid);
  const d = sum.draft ?? [];
  // each original slot exactly once per round
  for (const r of [1, 2]) {
    const slots = d.filter((x: any) => (r === 1 ? x.pick <= nTeams : x.pick > nTeams));
    const origs = slots.map((x: any) => x.via ?? x.tid);
    const uniq = new Set(origs);
    if (slots.length && uniq.size !== slots.length) bad(`${S}: round ${r} duplicate original team ${origs.filter((o: string, i: number) => origs.indexOf(o) !== i).join(',')}`);
    if (slots.length && slots.length !== nTeams && !(r === 2 && slots.length < nTeams)) bad(`${S}: round ${r} has ${slots.length} picks for ${nTeams} teams`);
  }
  // lottery: top picks must be non-playoff teams; expansion teams not in standings
  const firstOrig = d[0] ? (d[0].via ?? d[0].tid) : null;
  if (firstOrig && po.has(firstOrig)) bad(`${S}: #1 pick went to playoff team ${firstOrig}`);
  for (const t of newTeams) if (st.some(x => x.tid === t)) bad(`${S}: new team ${t} appears in standings`);
  for (const t of newTeams) {
    const n = d.filter((x: any) => (x.via ?? x.tid) === t).length;
    if (n !== 2) bad(`${S}: expansion ${t} has ${n} draft picks`);
    const size = lg.teams[t].roster.length;
    if (size < 8) bad(`${S}: expansion ${t} roster only ${size}`);
  }
  const line = `${S} draft: #1 ${lg.teams[d[0]?.tid]?.abbr} (${sum.lottery ?? ''}) new ${newTeams.join(',') || '-'} | first 6 ${d.slice(0, 6).map((x: any) => lg.teams[x.via ?? x.tid].abbr + (x.via ? '>' + lg.teams[x.tid].abbr : '')).join(' ')}`;
  console.log(line);
  if (newTeams.length) {
    for (const t of newTeams) console.log(`   ${t} after expansion: ${lg.teams[t].roster.length} players, slots ${d.filter((x: any) => (x.via ?? x.tid) === t).map((x: any) => x.pick).join(',')}`);
    // how many players did each old team lose
    const lost: Record<string, number> = {};
    for (const t of newTeams) for (const pid of lg.teams[t].roster) { const p = lg.players[pid]; const prev = p.career.filter((c: any) => !c.po).at(-1)?.tid; if (prev && prev !== t) lost[prev] = (lost[prev] ?? 0) + 1; }
    const multi = Object.entries(lost).filter(([, n]) => n > 1);
    if (multi.length) bad(`${S}: old teams lost >1 player in expansion: ${multi.map(([t, n]) => t + ':' + n).join(',')}`);
  }
  startNewSeason(lg);
  for (const t of Object.values(lg.teams).filter(t => t.active)) {
    if (t.roster.length < 12 || t.roster.length > 15) bad(`${lg.season}: ${t.tid} roster ${t.roster.length}`);
  }
}
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'OK – no problems');
