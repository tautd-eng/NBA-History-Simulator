// Historical data (built by prep/prepare.py) and helpers that turn era-relative
// z-scores into rates for a given season.

export const K = {
  ins: 0, tp: 1, ft: 2, drw: 3, tpr: 4, usg: 5, tov: 6, ast: 7, orb: 8, drb: 9, stl: 10, blk: 11, pf: 12, def: 13,
} as const;
export const NK = 14;

/** Lithuanian labels for the 0–100 rating display. `inv` = lower z is better. */
export const RATING_LABELS: { k: number; short: string; name: string; inv?: boolean; tendency?: boolean }[] = [
  { k: K.ins, short: 'Ins', name: 'Two-point scoring' },
  { k: K.tp, short: '3P', name: 'Three-point shooting' },
  { k: K.ft, short: 'FT', name: 'Free throws' },
  { k: K.drw, short: 'Drw', name: 'Drawing fouls' },
  { k: K.ast, short: 'Pas', name: 'Passing' },
  { k: K.tov, short: 'BH', name: 'Ball security', inv: true },
  { k: K.orb, short: 'ORb', name: 'Offensive rebounding' },
  { k: K.drb, short: 'DRb', name: 'Defensive rebounding' },
  { k: K.stl, short: 'Stl', name: 'Steals' },
  { k: K.blk, short: 'Blk', name: 'Blocks' },
  { k: K.def, short: 'Def', name: 'Defense' },
  { k: K.pf, short: 'Dis', name: 'Discipline', inv: true },
  { k: K.usg, short: 'Usg', name: 'Usage', tendency: true },
  { k: K.tpr, short: '3PA%', name: 'Three-point tendency', tendency: true },
];

export type RealSeason = [number, string, number, number, number, number, number, number[]];
// [season, franchise, games, minutes, ppg, rpg, apg, z[]]

export interface HistPlayer {
  n: string; b: string; h: number; w: number; p: string; hof: boolean; f: number;
  s: RealSeason[];
  d?: [number, number, number, string]; // draft: year, pick, round, franchise
  c?: string;
}

export interface SeasonTeam { abbr: string; name: string; conf: 'E' | 'W'; w: number; l: number; pace: number }
export interface LeagueAvg {
  pace: number; ortg: number; efg: number; tov: number; orb: number; ftfga: number; tpar: number; ftr: number;
  p2: number; p3: number; pft: number; ast_fg: number; ppg: number; stl_g: number; blk_g: number; pf_g: number; games: number;
}
export interface SeasonInfo { teams: Record<string, SeasonTeam>; cap: number; league: LeagueAvg; games: number }

export interface History {
  keys: string[];
  transforms: Record<string, 'logit' | 'log' | 'lin'>;
  era: Record<string, Record<string, [number, number]>>;
  ovr: Record<string, number>;
  ages: number[];
  aging: Record<string, { mean: number[]; sd: number[] }>;
  seasons: Record<string, SeasonInfo>;
  players: Record<string, HistPlayer>;
  classes: Record<string, string[]>;
  arrivals: Record<string, string[]>;
  draftPrior: { z: number[]; play: number }[];
  roster1980: Record<string, string[]>;
  champions: Record<string, string>;
  awards: Record<string, { mvp?: string; roy?: string }>;
}

export let H: History;
let eraArr: Record<number, { mu: number[]; sd: number[] }> = {};
let ovrW: number[] = [];
let tfs: number[] = []; // 0 logit, 1 log, 2 lin
export let FIRST_SEASON = 1980;
export let LAST_SEASON = 2026;

export function loadHistory(h: History) {
  H = h;
  eraArr = {};
  for (const [s, e] of Object.entries(h.era)) {
    eraArr[+s] = { mu: h.keys.map(k => e[k][0]), sd: h.keys.map(k => e[k][1]) };
  }
  ovrW = h.keys.map(k => h.ovr[k]);
  tfs = h.keys.map(k => (h.transforms[k] === 'logit' ? 0 : h.transforms[k] === 'log' ? 1 : 2));
  const ss = Object.keys(h.seasons).map(Number);
  FIRST_SEASON = Math.min(...ss);
  LAST_SEASON = Math.max(...ss);
}

export function era(season: number) {
  return eraArr[Math.min(Math.max(season, FIRST_SEASON), LAST_SEASON)];
}
export function seasonInfo(season: number): SeasonInfo {
  return H.seasons[String(Math.min(Math.max(season, FIRST_SEASON), LAST_SEASON))];
}

const sigm = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => Math.log(p / (1 - p));
export { sigm };

/** z-score of skill k → rate in the given season (inverse of the prep transform). */
export function rate(k: number, z: number, season: number): number {
  const e = era(season);
  const x = e.mu[k] + e.sd[k] * z;
  const t = tfs[k];
  return t === 0 ? sigm(x) : t === 1 ? Math.exp(x) : x;
}
/** value in transformed space (logit / log) */
export function trate(k: number, z: number, season: number): number {
  const e = era(season);
  return e.mu[k] + e.sd[k] * z;
}

/** Box plus-minus estimate from ratings: the single number AI and coaches use for quality. */
export function bpmOf(z: number[]): number {
  let s = H.ovr._;
  for (let i = 0; i < NK; i++) s += ovrW[i] * z[i];
  return s;
}
export function ovrOf(z: number[]): number {
  return Math.max(25, Math.min(99, Math.round(48 + 5.5 * bpmOf(z))));
}
/**
 * Displayed overall (presentation only; the simulation keeps using ovrOf, uncapped).
 * Spread like a basketball game's ratings: a typical rotation player ~74, a good starter ~80,
 * an all-star ~88–91, the era's superstars 95+, and 99 already for the very best – anyone
 * above that is still 99 on the card but keeps his full impact in the games.
 */
const SHOWN: [number, number][] = [[-1.3, 74], [0.6, 80], [2.1, 86], [3.6, 91], [5.0, 95], [6.5, 99]];
export function shownFromBpm(b: number): number {
  const T = SHOWN;
  let v: number;
  if (b <= T[0][0]) v = T[0][1] + 3.2 * (b - T[0][0]);
  else if (b >= T[T.length - 1][0]) v = 99;
  else { let i = 0; while (b > T[i + 1][0]) i++; v = T[i][1] + (T[i + 1][1] - T[i][1]) * (b - T[i][0]) / (T[i + 1][0] - T[i][0]); }
  return Math.max(40, Math.min(99, Math.round(v)));
}
/** Displayed overall: impact per minute plus a nod to how much of the offence he carries (a 28-point scorer is not a role player). */
export const OVR_VOLUME = 0.5;
export function shownOvr(z: number[]): number { return shownFromBpm(bpmOf(z) + OVR_VOLUME * z[K.usg]); }
/** Converts a stored (simulation-scale) overall to the displayed scale. */
export function shownFromRaw(raw: number): number { return shownFromBpm((raw - 48) / 5.5); }
/** 0–100 display rating for a single skill */
export function ratingOf(z: number, inv = false): number {
  const v = 50 + 14 * (inv ? -z : z);
  return Math.max(1, Math.min(99, Math.round(v)));
}

export function agingIndex(age: number) {
  return Math.max(0, Math.min(H.ages.length - 1, age - H.ages[0]));
}
