import { readFileSync } from 'fs';
import { loadHistory, H, seasonInfo } from '../src/data';
import { newPlayer } from '../src/players';
import { simGame } from '../src/engine/game';
import { Rng } from '../src/rng';
import { Player, STAT_KEYS, emptyLine, addLine, StatLine } from '../src/types';

export function boot() { loadHistory(JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url), 'utf8'))); }

export function realTeams(season: number) {
  const si = seasonInfo(season);
  const teams: Record<string, { tid: string; players: Player[]; paceZ: number; realW: number; realL: number }> = {};
  for (const [tid, t] of Object.entries(si.teams)) teams[tid] = { tid, players: [], paceZ: (t.pace / si.league.pace - 1) / 0.03, realW: t.w, realL: t.l };
  for (const [pid, hp] of Object.entries(H.players)) {
    const s = hp.s.find(x => x[0] === season);
    if (!s || !teams[s[1]]) continue;
    teams[s[1]].players.push(newPlayer(pid, s[7], s[1], season));
  }
  for (const t of Object.values(teams)) {
    t.players.sort((a, b) => (H.players[b.id].s.find(x => x[0] === season)![3]) - (H.players[a.id].s.find(x => x[0] === season)![3]));
    t.players = t.players.slice(0, 15);
  }
  return teams;
}

export function runSeason(season: number, seed = 1, reps = 2) {
  const rng = new Rng(seed);
  const teams = realTeams(season);
  const ids = Object.keys(teams);
  const lines: Record<string, StatLine> = {};
  const tot = emptyLine();
  const wins: Record<string, number> = {}, games: Record<string, number> = {};
  let homeW = 0, n = 0, ots = 0;
  const realGames = seasonInfo(season).games;
  const perPair = Math.max(1, Math.round(realGames / (2 * (ids.length - 1))));
  for (let r = 0; r < reps * perPair; r++)
    for (const h of ids) for (const a of ids) {
      if (h === a) continue;
      const res = simGame(teams[h], teams[a], { season, po: false, rng });
      for (const b of [res.home, res.away]) for (const pl of b.players) {
        (lines[pl.pid] ??= emptyLine()); addLine(lines[pl.pid], pl.st); addLine(tot, pl.st);
      }
      const hw = res.home.pts > res.away.pts;
      wins[h] = (wins[h] ?? 0) + (hw ? 1 : 0); wins[a] = (wins[a] ?? 0) + (hw ? 0 : 1);
      games[h] = (games[h] ?? 0) + 1; games[a] = (games[a] ?? 0) + 1;
      if (hw) homeW++; n++; ots += res.ot ? 1 : 0;
    }
  return { teams, lines, tot, wins, games, homeW: homeW / n, n, ots: ots / n };
}

export function corr(x: number[], y: number[]) {
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

export function report(season: number, r: ReturnType<typeof runSeason>, verbose = false) {
  const L = seasonInfo(season).league, t = r.tot;
  const g2 = r.n * 2; // team-games
  const poss = t.fga + 0.44 * t.fta - t.orb + t.tov;
  const rows: [string, number, number][] = [
    ['pace', poss / g2 * (48 / (t.min / g2 / 5)), L.pace],
    ['ppg', t.pts / g2, L.ppg],
    ['ortg', 100 * t.pts / poss, L.ortg],
    ['efg', (t.fgm + 0.5 * t.tpm) / t.fga, L.efg],
    ['p2', (t.fgm - t.tpm) / (t.fga - t.tpa), L.p2],
    ['p3', t.tpm / Math.max(1, t.tpa), L.p3],
    ['3par', t.tpa / t.fga, L.tpar],
    ['ft%', t.ftm / t.fta, L.pft],
    ['ftr', t.fta / t.fga, L.ftr],
    ['tov%', 100 * t.tov / (t.fga + 0.44 * t.fta + t.tov), L.tov],
    ['orb%', 100 * t.orb / (t.orb + t.drb), L.orb],
    ['ast/fg', t.ast / t.fgm, L.ast_fg],
    ['stl/g', t.stl / g2, L.stl_g],
    ['blk/g', t.blk / g2, L.blk_g],
    ['pf/g', t.pf / g2, L.pf_g],
  ];
  const out: string[] = [`== ${season}  home win ${(100 * r.homeW).toFixed(1)}%  OT ${(100 * r.ots).toFixed(1)}%`];
  let err = 0;
  for (const [k, sim, real] of rows) {
    const d = (sim - real) / (Math.abs(real) || 1);
    err += Math.abs(d);
    out.push(`${k.padEnd(7)} sim ${sim.toFixed(3).padStart(8)}  real ${real.toFixed(3).padStart(8)}  ${(100 * d).toFixed(1)}%`);
  }
  // team wins
  const ids = Object.keys(r.teams);
  const simW = ids.map(i => r.wins[i] / r.games[i]);
  const realW = ids.map(i => r.teams[i].realW / (r.teams[i].realW + r.teams[i].realL));
  const sdS = Math.sqrt(simW.reduce((a, b) => a + (b - 0.5) ** 2, 0) / ids.length);
  const sdR = Math.sqrt(realW.reduce((a, b) => a + (b - 0.5) ** 2, 0) / ids.length);
  out.push(`win% corr ${corr(simW, realW).toFixed(3)}  sd sim ${sdS.toFixed(3)} real ${sdR.toFixed(3)}`);
  // player lines
  const P: { pid: string; mpg: number; ppg: number; rpg: number; apg: number; r: any }[] = [];
  for (const [pid, l] of Object.entries(r.lines)) {
    const rs = H.players[pid].s.find(x => x[0] === season)!;
    if (rs[3] < 1200 || l.gp < 10) continue;
    P.push({ pid, mpg: l.min / l.gp, ppg: l.pts / l.gp, rpg: (l.orb + l.drb) / l.gp, apg: l.ast / l.gp, r: rs });
  }
  const realMpg = P.map(p => p.r[3] / p.r[2]);
  out.push(`player corr  mpg ${corr(P.map(p => p.mpg), realMpg).toFixed(3)}  ppg ${corr(P.map(p => p.ppg), P.map(p => p.r[4])).toFixed(3)}  rpg ${corr(P.map(p => p.rpg), P.map(p => p.r[5])).toFixed(3)}  apg ${corr(P.map(p => p.apg), P.map(p => p.r[6])).toFixed(3)}`);
  const top = [...P].sort((a, b) => b.ppg - a.ppg).slice(0, verbose ? 12 : 5);
  for (const p of top) out.push(`  ${H.players[p.pid].n.padEnd(24)} sim ${p.mpg.toFixed(1)}m ${p.ppg.toFixed(1)}p ${p.rpg.toFixed(1)}r ${p.apg.toFixed(1)}a | real ${(p.r[3] / p.r[2]).toFixed(1)}m ${p.r[4]}p ${p.r[5]}r ${p.r[6]}a`);
  return { text: out.join('\n'), err: err / rows.length, rows };
}
