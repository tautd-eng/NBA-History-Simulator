// Single-game records: league top 10 and each franchise's top 5, kept as games
// are played (box scores themselves are not stored for long). Season and
// career records are computed from the players' career lines when shown.
import { GameResult, League, StatLine } from '../types';

export interface Rec { v: number; pid?: string; name?: string; tid: string; opp: string; s: number; day: number; po: boolean; score?: string }
export interface Records { g: Record<string, Rec[]>; t: Record<string, Record<string, Rec[]>> }

export const gmsc = (l: StatLine) => l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;

/** Player single-game categories. */
export const GAME_CATS: [string, string, (l: StatLine) => number][] = [
  ['pts', 'Points', l => l.pts],
  ['reb', 'Rebounds', l => l.orb + l.drb],
  ['ast', 'Assists', l => l.ast],
  ['stl', 'Steals', l => l.stl],
  ['blk', 'Blocks', l => l.blk],
  ['tpm', 'Threes made', l => l.tpm],
  ['gms', 'Game Score', l => Math.round(gmsc(l) * 10) / 10],
];
/** Team single-game categories. */
export const TEAM_CATS: [string, string][] = [['tpts', 'Team points'], ['margin', 'Winning margin']];

const LEAGUE_N = 10, TEAM_N = 5;

function insert(list: Rec[], r: Rec, n: number) {
  if (list.length >= n && r.v <= list[list.length - 1].v) return;
  list.push(r);
  list.sort((a, b) => b.v - a.v || a.s - b.s || a.day - b.day);
  if (list.length > n) list.length = n;
}

export function trackGame(lg: League, res: GameResult) {
  const R = (lg.records ??= { g: {}, t: {} });
  const sides = [[res.home, res.away], [res.away, res.home]] as const;
  for (const [b, o] of sides) {
    const T = (R.t[b.tid] ??= {});
    const base = { tid: b.tid, opp: o.tid, s: res.season, day: res.day, po: res.po, score: `${b.pts}–${o.pts}` };
    for (const pl of b.players) {
      if (!pl.st.min) continue;
      for (const [k, , f] of GAME_CATS) {
        const v = f(pl.st);
        if (v <= 0) continue;
        const r = { ...base, v, pid: pl.pid, name: pl.name };
        insert((R.g[k] ??= []), r, LEAGUE_N);
        insert((T[k] ??= []), r, TEAM_N);
      }
    }
    const team: [string, number][] = [['tpts', b.pts], ['margin', b.pts - o.pts]];
    for (const [k, v] of team) {
      if (v <= 0) continue;
      const r = { ...base, v };
      insert((R.g[k] ??= []), r, LEAGUE_N);
      insert((T[k] ??= []), r, TEAM_N);
    }
  }
}

/** Older saves: start the record book from the games still kept. */
export function ensureRecords(lg: League) {
  if (lg.records) return;
  lg.records = { g: {}, t: {} };
  for (const r of lg.recent) trackGame(lg, r);
}

/** Playoff finish for every team this season: rounds reached (R+1 = champion), -1 = lost in the play-in. */
export function playoffFinish(lg: League): { r: number; n: number } & { by: Record<string, number> } {
  const by: Record<string, number> = {};
  const n = Math.max(0, ...lg.series.map(s => s.round));
  for (const p of lg.playIn ?? []) for (const t of [p.a, p.b]) if (t) by[t] = -1;
  for (const s of lg.series) for (const t of [s.hi, s.lo]) if (t) by[t] = Math.max(by[t] ?? 0, s.round);
  const fin = lg.series.find(s => s.round === n && s.winner);
  if (fin?.winner) by[fin.winner] = n + 1;
  return { r: n, n, by };
}

export function finishLabel(v: number | undefined, n: number) {
  if (v == null) return '–';
  if (v === -1) return 'Play-in';
  if (v === n + 1) return '🏆 Champion';
  if (v === n) return 'Finals';
  if (v === n - 1) return 'Conf. finals';
  if (v === n - 2) return 'Conf. semis';
  return 'First round';
}
