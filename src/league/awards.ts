// Season awards: MVP, Defensive Player, Rookie, Sixth Man, Most Improved, Finals MVP,
// All-League (3 teams), All-Defensive (2 teams), All-Rookie (2 teams).
import { League, Player, StatLine } from '../types';
import { K } from '../data';

export interface Awards {
  mvp?: string; dpoy?: string; roy?: string; smoy?: string; mip?: string; fmvp?: string;
  allNba: string[][]; allDef: string[][]; allRookie: string[][];
  votes: Record<string, { pid: string; v: number }[]>; // top candidates per award
}

export const gmSc = (l: StatLine) => l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;

function posGroup(pos: string): 'G' | 'F' | 'C' {
  const f = pos.split('-')[0];
  return f.includes('G') ? 'G' : f === 'C' ? 'C' : 'F';
}

/** Pick `n` teams of 2 guards, 2 forwards and 1 center (falls back to best available). */
function positionalTeams(ranked: Player[], n: number): string[][] {
  const used = new Set<string>();
  const out: string[][] = [];
  for (let t = 0; t < n; t++) {
    const team: Player[] = [];
    for (const [g, k] of [['G', 2], ['F', 2], ['C', 1]] as const) {
      const c = ranked.filter(p => !used.has(p.id) && posGroup(p.pos) === g).slice(0, k);
      for (const p of c) { team.push(p); used.add(p.id); }
    }
    for (const p of ranked) { if (team.length >= 5) break; if (!used.has(p.id)) { team.push(p); used.add(p.id); } }
    if (team.length) out.push(team.map(p => p.id));
  }
  return out;
}

export function computeAwards(lg: League, S: number, games: number): Awards {
  const all = Object.values(lg.players).filter(p => p.tid && p.cur.gp > 0);
  const winPct = (tid: string | null) => { const t = tid ? lg.teams[tid] : null; return t ? t.w / Math.max(1, t.w + t.l) : 0.5; };
  const gpF = (p: Player) => Math.min(1, p.cur.gp / (games * 0.8));
  const per = (p: Player, k: keyof StatLine) => (p.cur[k] as number) / p.cur.gp;
  const mpg = (p: Player) => per(p, 'min');
  const qual = all.filter(p => p.cur.gp >= Math.max(1, games * 0.55));
  const top = (ps: Player[], f: (p: Player) => number, n = 5) => ps.map(p => ({ pid: p.id, v: f(p) })).sort((a, b) => b.v - a.v).slice(0, n).map(x => ({ pid: x.pid, v: Math.round(x.v * 10) / 10 }));

  // MVP: production, availability and team success
  const mvpF = (p: Player) => (gmSc(p.cur) / p.cur.gp) * gpF(p) * (0.55 + winPct(p.tid));
  // Defence: stocks, defensive rebounds, the defensive rating itself and team success
  const defF = (p: Player) => (mpg(p) < 20 ? -99 : 0) + 2.2 * per(p, 'stl') + 1.7 * per(p, 'blk') + 0.3 * per(p, 'drb') + 2.4 * p.z[K.def] + 0.03 * mpg(p) + 2 * winPct(p.tid);
  const rookies = all.filter(p => p.entered === S && p.cur.gp >= games * 0.4);
  const royF = (p: Player) => (gmSc(p.cur) / p.cur.gp) * gpF(p);
  // Sixth man: started fewer than 40% of his games
  const bench = qual.filter(p => p.cur.gs / p.cur.gp < 0.4);
  const smoyF = (p: Player) => (gmSc(p.cur) / p.cur.gp) * (0.85 + 0.3 * winPct(p.tid));
  // Most improved: production per game compared with last season (needs a real role both years)
  const prev = (p: Player) => p.career.find(c => c.s === S - 1 && !c.po);
  const mipPool = qual.filter(p => { const c = prev(p); return c && c.gp >= games * 0.3 && mpg(p) >= 20; });
  const mipF = (p: Player) => { const c = prev(p)!; return gmSc(p.cur) / p.cur.gp - gmSc(c) / c.gp + 0.15 * (per(p, 'pts') - c.pts / c.gp); };


  const votes: Awards['votes'] = {
    mvp: top(qual, mvpF), dpoy: top(qual, defF), roy: top(rookies, royF), smoy: top(bench, smoyF), mip: top(mipPool, mipF),
  };
  const nbaRank = [...qual].sort((a, b) => (gmSc(b.cur) / b.cur.gp) * gpF(b) * (0.8 + 0.4 * winPct(b.tid)) - (gmSc(a.cur) / a.cur.gp) * gpF(a) * (0.8 + 0.4 * winPct(a.tid)));
  const defRank = [...qual].sort((a, b) => defF(b) - defF(a));
  const rookRank = [...rookies].sort((a, b) => royF(b) - royF(a));
  return {
    mvp: votes.mvp[0]?.pid, dpoy: votes.dpoy[0]?.pid, roy: votes.roy[0]?.pid, smoy: votes.smoy[0]?.pid, mip: votes.mip[0]?.pid,
    allNba: positionalTeams(nbaRank, 3), allDef: positionalTeams(defRank, 2),
    allRookie: [rookRank.slice(0, 5).map(p => p.id), rookRank.slice(5, 10).map(p => p.id)].filter(t => t.length),
    votes,
  };
}

export function finalsMvp(lg: League, champ: string) {
  const champs = Object.values(lg.players).filter(p => p.tid === champ && p.curPo.gp > 0);
  return [...champs].sort((a, b) => gmSc(b.curPo) / b.curPo.gp - gmSc(a.curPo) / a.curPo.gp)[0]?.id;
}

export const AWARD_NAMES: Record<string, string> = {
  mvp: 'MVP', dpoy: 'Defensive Player of the Year', roy: 'Rookie of the Year', smoy: 'Sixth Man of the Year', mip: 'Most Improved Player', fmvp: 'Finals MVP',
};

export function applyAwardChips(lg: League, S: number, a: Awards) {
  const add = (pid: string | undefined, t: string) => { if (pid && lg.players[pid]) lg.players[pid].awards.push(`${S} ${t}`); };
  add(a.mvp, 'MVP'); add(a.dpoy, 'DPOY'); add(a.roy, 'ROY'); add(a.smoy, '6MOY'); add(a.mip, 'MIP');
  a.allNba.forEach((t, i) => t.forEach(pid => add(pid, `All-League ${i + 1}`)));
  a.allDef.forEach((t, i) => t.forEach(pid => add(pid, `All-Defensive ${i + 1}`)));
  a.allRookie.forEach((t, i) => t.forEach(pid => add(pid, `All-Rookie ${i + 1}`)));
}
