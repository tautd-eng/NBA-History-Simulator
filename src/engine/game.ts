// Possession-by-possession game simulation.
//
// Every player arrives with era-relative skill z-scores. For the season being
// played they are turned into rates (usage, TOV%, FTA/FGA, 3PA share, 2P%, 3P%,
// FT%, AST%, ORB%, DRB%, STL%, BLK%, fouls/min) with that season's league
// distribution, so league averages come out of the players rather than a table.
// The constants in C are global calibration knobs, tuned by test/calibrate.ts.

import { Rng, hash01 } from '../rng';
import { K, rate, sigm, logit, bpmOf } from '../data';
import { shownFromBpm } from '../data';
import { emptyLine, StatLine, Player, Box } from '../types';

/** Per-season calibration offsets, produced by test/eracal.ts. */
export interface EraCal { pace: number; tpa: number; p2: number; p3: number; ft: number; tov: number; orb: number; ast: number; stl: number; blk: number; pf: number; ftr: number }
export const NO_CAL: EraCal = { pace: 1, tpa: 0, p2: 0, p3: 0, ft: 0, tov: 0, orb: 1, ast: 1, stl: 1, blk: 1, pf: 1, ftr: 1 };
let ERA_CAL: Record<string, EraCal> = {};
export function setEraCal(t: Record<string, EraCal>) { ERA_CAL = t; }
export function getEraCal(season: number): EraCal {
  if (ERA_CAL[season]) return ERA_CAL[season];
  const ks = Object.keys(ERA_CAL).map(Number);
  if (!ks.length) return NO_CAL;
  const near = ks.reduce((a, b) => (Math.abs(b - season) < Math.abs(a - season) ? b : a));
  return ERA_CAL[near];
}

export const C = {
  tov: 0.006, p2: -0.014, p3: -0.008, ft: -0.012,
  orb: 1.033, orbFt: 0.45, ast: 0.953, blk: 0.952, stlShare: 0.81,
  foulTrip: 0.976, andOne: 0.055, silentPf: 0.075,
  home: 0.045, def: 0.25, stlDef: 0.06, usgEff: 0.35,
  fatigue: 0.55, fatBase: 0.8, tpa: 0.104, drain: 0.00062, recover: 0.0011,
  possSec: 1.09, putback3: 0.45, zoneGap: 1.0,
  fbStl: 0.55, fbDrb: 0.15, fbMake: 0.45, fbThree: 0.6, lateClock: 0.2, // transition and shot-clock pressure
  star: 1.35, stay: 1.2, depth: 10, minAlpha: 1.0, maxMin: 40,
  mmDef: 0.5, mmHt: 0.01, mmUsg: 0.15, mmSize: 0.03, // matchups: own defender's weight, size edge inside, shot selection toward mismatches
};

interface GP {
  p: Player;
  bpm: number;
  q: number;            // coach quality score
  posNum: number;
  usg: number; tov: number; drw: number; tpr: number; p2: number; p3: number; pft: number;
  ast: number; orb: number; drb: number; stl: number; blk: number; pf: number; def: number; stlZ: number;
  endurMul: number;
  e: number;            // energy
  target: number;       // planned minutes
  on: boolean;
  fouls: number;
  st: StatLine;
  starter: boolean;
  injAt?: number;       // gets hurt after this many minutes
  hurt?: boolean;
}

export function posNum(pos: string): number {
  const m: Record<string, number> = { PG: 1, SG: 2, G: 1.5, GF: 2.5, SF: 3, F: 3.5, FC: 4.5, PF: 4, C: 5, 'G-F': 2.5, 'F-G': 2.5, 'F-C': 4.5, 'C-F': 4.5 };
  if (m[pos] !== undefined) return m[pos];
  const first = pos.split('-')[0];
  return m[first] ?? 3;
}

/** Fatigue at tip-off: tired legs first (rebounding, defence, steals, blocks, drawing fouls), finishing a little, shooting barely. */
export const FATIGUE = { phys: 0.022, ins: 0.011, shot: 0.005, tov: 0.008, energy: 0.008, minutes: 0.012, free: 6 };
function tired(z: number[], f: number): number[] {
  const s = Math.max(0, f - FATIGUE.free);
  if (s <= 0) return z;
  const o = z.slice();
  for (const k of [K.orb, K.drb, K.stl, K.blk, K.def, K.drw]) o[k] -= FATIGUE.phys * s;
  o[K.ins] -= FATIGUE.ins * s;
  o[K.tp] -= FATIGUE.shot * s; o[K.ft] -= FATIGUE.shot * s;
  o[K.tov] += FATIGUE.tov * s;
  return o;
}

export function prep(p: Player, season: number): GP {
  const fat = Math.max(0, ((p as any).fatNow ?? 0) - FATIGUE.free);
  const z = tired(p.z, (p as any).fatNow ?? 0);
  const bpm = bpmOf(p.z);
  return {
    p, bpm, q: Math.pow(Math.max(0.5, bpm + 6), C.star) * Math.max(0.6, 1 - FATIGUE.minutes * fat), posNum: posNum(p.pos),
    usg: rate(K.usg, z[K.usg], season),
    tov: rate(K.tov, z[K.tov], season),
    drw: rate(K.drw, z[K.drw], season),
    tpr: rate(K.tpr, z[K.tpr], season),
    p2: rate(K.ins, z[K.ins], season),
    p3: rate(K.tp, z[K.tp], season),
    pft: rate(K.ft, z[K.ft], season),
    ast: rate(K.ast, z[K.ast], season),
    orb: rate(K.orb, z[K.orb], season),
    drb: rate(K.drb, z[K.drb], season),
    stl: rate(K.stl, z[K.stl], season),
    blk: rate(K.blk, z[K.blk], season),
    pf: rate(K.pf, z[K.pf], season),
    def: z[K.def], stlZ: z[K.stl],
    endurMul: 1 - 0.12 * p.endur,
    e: Math.max(0.7, 1 - FATIGUE.energy * fat), target: 0, on: false, fouls: 0, st: emptyLine(), starter: false,
    injAt: (p as any).injAt,
  };
}

interface Side { tid: string; gps: GP[]; on: GP[]; pts: number; q: number[]; home: boolean; paceZ: number }

export interface GameOpts { season: number; po: boolean; rng: Rng; pbp?: boolean; ctl?: Control }

/** Interactive control (clutch mode): from `fromRem` seconds left in the 4th quarter the game pauses before every possession. */
export interface Control { side: 'h' | 'a'; fromRem: number; timeouts: number }
export type OffCall = 'auto' | 'three' | 'inside' | 'iso' | 'milk' | 'quick' | 'two4one' | 'hold';
export type DefCall = 'normal' | 'pressure' | 'foul';
export interface Decision { off?: OffCall; pid?: string; def?: DefCall; timeout?: boolean; five?: string[] }
export interface PState { pid: string; name: string; pos: string; e: number; fouls: number; on: boolean; st: StatLine; ovr: number }
export interface GameState {
  period: number; rem: number; hs: number; as: number; off: 'h' | 'a';
  h: PState[]; a: PState[]; logLen: number; timeouts: number; q: { h: number[]; a: number[] }; log: PbpEv[];
}

/** One play-by-play event. Coordinates are feet on a half court (basket at 25, 5.25). */
export interface PbpEv {
  t: number;            // elapsed game seconds
  p: number;            // period
  c: number;            // seconds left in the period
  s: 'h' | 'a' | '';    // side that acted
  k: string;            // kind: make2 make3 miss2 miss3 blk ft ftm tov orb drb foul sub period end start
  txt: string;
  hs: number; as: number;
  x?: number; y?: number;
  dsc?: 'zone' | 'switch' | 'press';       // the defence's scheme on this trip (man-to-man when absent)
  cr?: string;                              // who set the shot up (the assist, or the pass before a miss)
  pl?: string;                              // the play that produced it (iso, pnrDrive, pnrPull, roll, pop, post, cut, kick, offscreen, drive, pullup, fb, putback)
  sk?: string;                              // shot kind (dunk, layup, putback, hook, turnaround, floater, jumper, fadeaway, three, stepback)
  m?: string;                               // primary defender on the play (matchup)
  v?: string;                               // turnover type: strip, pick (intercepted pass), bad (pass out of bounds), travel, oob, clock (shot clock)
  fb?: 1;                                   // fast break
  call?: string;                            // the offence's situational call (milk, quick, hold, two4one, three)
  d?: [string, string, number][];          // stat deltas [pid, stat, n]
  on?: { h: string[]; a: string[] };       // lineups after a substitution
}
const short = (n: string) => {
  const parts = n.split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : n;
};

/**
 * Coach. Before the game he sets a minutes plan from player quality
 * (depth chart); during the game he keeps players near that plan, rests tired
 * players, protects players in foul trouble, plays his best five in crunch time
 * and empties the bench in blowouts.
 */
function planMinutes(side: Side) {
  const avail = [...side.gps].sort((a, b) => b.q - a.q);
  const n = Math.min(avail.length, C.depth);
  const w = avail.map((g, i) => (i < n ? Math.pow(g.q, C.minAlpha) : 0));
  const T = spread(w, 240);
  // positional balance: about two big men and two guards on the floor
  const bigShare = (g: GP) => (g.posNum >= 4 ? 1 : g.posNum >= 3.5 ? 0.5 : 0);
  const smallShare = (g: GP) => (g.posNum <= 2 ? 1 : g.posNum <= 2.5 ? 0.6 : g.posNum <= 3 ? 0.3 : 0);
  for (const share of [bigShare, smallShare]) {
    const have = avail.reduce((a, g, i) => a + T[i] * share(g), 0);
    const need = 84 - have;
    if (need <= 0) continue;
    const idx = avail.map((g, i) => i).filter(i => share(avail[i]) >= 0.5 && T[i] < C.maxMin);
    if (!idx.length) continue;
    let moved = 0;
    for (const i of idx) {
      const add = Math.min(C.maxMin - T[i], need * (w[i] || 0.5 * Math.pow(avail[i].q, C.minAlpha)) / idx.reduce((a, j) => a + (w[j] || 0.5 * Math.pow(avail[j].q, C.minAlpha)), 0));
      T[i] += add; moved += add;
    }
    // take the minutes back from the lowest-ranked players who do not fill the need
    for (let i = avail.length - 1; i >= 0 && moved > 0.01; i--) {
      if (share(avail[i]) >= 0.5) continue;
      const take = Math.min(T[i], moved);
      T[i] -= take; moved -= take;
    }
  }
  avail.forEach((g, i) => (g.target = T[i]));
}

/** split `total` minutes in proportion to w, nobody above C.maxMin */
function spread(w: number[], total: number) {
  const target = w.map(() => 0);
  const free = w.map(x => x > 0);
  let left = total;
  for (let iter = 0; iter < 6; iter++) {
    const sw = w.reduce((a, x, i) => a + (free[i] ? x : 0), 0);
    if (sw <= 0) break;
    let over = 0;
    for (let i = 0; i < w.length; i++) if (free[i]) {
      target[i] = left * w[i] / sw;
      if (target[i] > C.maxMin) { over += target[i] - C.maxMin; target[i] = C.maxMin; free[i] = false; }
    }
    if (over < 0.01) break;
    left = total - target.reduce((a, x, i) => a + (free[i] ? 0 : x), 0);
  }
  return target;
}

function chooseLineup(side: Side, period: number, rem: number, margin: number, start: boolean, elapsed: number) {
  const avail = side.gps.filter(g => g.fouls < 6 && !g.hurt);
  const garbage = period >= 4 && ((rem < 330 && Math.abs(margin) >= 20) || (rem < 540 && Math.abs(margin) >= 28));
  const crunch = (period >= 4 && rem < 300 && Math.abs(margin) <= 10) || period > 4;
  const allowed = period === 1 ? 2 : period === 2 ? 3 : period === 3 ? 4 : 5;
  const look = elapsed + 150;
  const score = (g: GP) => {
    let s: number;
    if (crunch) s = 100 + g.q * (0.25 + 0.75 * g.e);
    else if (garbage) s = -g.q + (g.target > 26 ? -1000 : 0);
    else {
      s = (g.target * look) / 2880 - g.st.min;           // minutes "owed" by the plan
      if (g.on && !start) s += C.stay;
      s += g.q * 0.004;
    }
    if (g.e < 0.3) s -= 50;
    if (!crunch && g.fouls >= allowed) s -= 6;
    return s;
  };
  const ranked = [...avail].sort((a, b) => score(b) - score(a));
  let five = ranked.slice(0, 5);
  // positional sanity: two ball handlers/wings (<=2.5) and two bigs (>=3.5) when the roster allows
  const small = (g: GP) => g.posNum <= 2.5, big = (g: GP) => g.posNum >= 3.5;
  for (const [ok, other] of [[small, big], [big, small], [small, big], [big, small]] as const) {
    if (five.filter(ok).length >= 2) continue;
    const cand = ranked.find(g => !five.includes(g) && ok(g) && score(g) > -40);
    if (!cand) continue;
    const otherCount = five.filter(other).length;
    const drop = [...five].reverse().find(g => !ok(g) && (!other(g) || otherCount > 2)) ?? [...five].reverse().find(g => !ok(g));
    if (!drop) continue;
    five = five.map(g => (g === drop ? cand : g));
  }
  // never fewer than five on the floor (a short-handed team plays its fouled-out or hurt men)
  if (five.length < 5) for (const g of side.gps) if (five.length < 5 && !five.includes(g)) five.push(g);
  for (const g of side.gps) g.on = false;
  for (const g of five) g.on = true;
  side.on = five;
}

type TeamIn = { tid: string; players: Player[]; paceZ: number };
export function simGame(home: TeamIn, away: TeamIn, o: GameOpts) {
  const g = gameGen(home, away, o);
  let r = g.next();
  while (!r.done) r = g.next({});
  return r.value;
}

export function* gameGen(home: TeamIn, away: TeamIn, o: GameOpts): Generator<GameState, ReturnType<typeof finishBox>, Decision> {
  const { season, rng } = o;
  const seasonOf = season;
  const ctl = o.ctl;
  const mk = (t: typeof home, isHome: boolean): Side => ({
    tid: t.tid, gps: t.players.map(p => prep(p, season)), on: [], pts: 0, q: [], home: isHome, paceZ: t.paceZ,
  });
  const H = mk(home, true), A = mk(away, false);
  const E = getEraCal(season);
  const leagueTov = rate(K.tov, 0, season);
  const leaguePf = rate(K.pf, 0, season);
  const pace = seasonPace(season) * (1 + 0.03 * (H.paceZ + A.paceZ) / 2);
  const T0 = (2880 / (2 * pace)) * 0.86 * C.possSec * E.pace;

  planMinutes(H); planMinutes(A);
  // starters: best five by quality with positional balance
  for (const s of [H, A]) {
    const save = s.gps.map(g => g.target);
    s.gps.forEach(g => (g.target = g.q));
    chooseLineup(s, 1, 720, 0, true, 2880);
    s.gps.forEach((g, i) => (g.target = save[i]));
    for (const g of s.on) { g.starter = true; g.st.gs = 1; }
  }
  let elapsed = 0;
  let clutch = false;
  let offCall: OffCall = 'auto', defCall: DefCall = 'normal', isoPid: string | null = null;
  // each team's defensive identity for the night: zone only once it was legal (2001–02), switching in the
  // positionless era, otherwise man-to-man; a trailing team presses late
  const dIdent = (tid: string) => {
    const h1 = hash01(tid + season + 'zone'), h2 = hash01(tid + season + 'sw');
    return {
      zone: season >= 2002 ? (h1 < 0.25 ? 0.06 + 0.14 * hash01(tid + season + 'zz') : 0.015) : 0,
      sw: season >= 2014 ? 0.15 + 0.45 * h2 : season >= 2004 ? 0.05 + 0.1 * h2 : 0.02,
    };
  };
  let dsc: 'man' | 'zone' | 'switch' | 'press' = 'man';
  // how the last possession ended decides whether the next one can be a fast break
  let ended: 'make' | 'drb' | 'stl' | 'dead' = 'dead';
  let stopped = false; // the ball went dead during the possession (free throws, a timeout)
  let fastBreak = false, lateClock = false;
  let userFive: string[] | null = null;
  let timeoutsLeft = ctl?.timeouts ?? 0;

  let offense = rng.chance(0.5) ? H : A;
  let period = 1;
  let ot = 0;
  const other = (s: Side) => (s === H ? A : H);

  const score = (s: Side, pts: number) => {
    s.pts += pts;
    for (const g of s.on) g.st.pm += pts;
    for (const g of other(s).on) g.st.pm -= pts;
  };
  const tick = (dt: number) => {
    for (const s of [H, A]) for (const g of s.gps) {
      if (g.on) {
        g.st.min += dt / 60; g.e = Math.max(0, g.e - dt * C.drain * g.endurMul);
        if (g.injAt !== undefined && !g.hurt && g.st.min >= g.injAt) {
          g.hurt = true;
          ev('inj', s, `${short(g.p.name)} is hurt and leaves the game`);
        }
      }
      else g.e = Math.min(1, g.e + dt * C.recover);
    }
  };
  const restAll = (amt: number) => { for (const s of [H, A]) for (const g of s.gps) g.e = Math.min(1, g.e + amt); };
  // ---- play-by-play (cosmetic draws use their own generator so results do not change)
  const log: PbpEv[] | null = o.pbp || ctl ? [] : null;
  const cr = new Rng(Math.floor(rng.s[3] * 7919 + 13));
  let pending: [string, string, number][] = [];
  let curPeriod = 1, curRem = 720;
  const inc = (g: GP, k: keyof StatLine, n = 1) => { (g.st as any)[k] += n; if (log) pending.push([g.p.id, k, n]); };
  const sideOf = (s: Side): 'h' | 'a' => (s === H ? 'h' : 'a');
  const ev = (k: string, s: Side | null, txt: string, extra: Partial<PbpEv> = {}) => {
    if (!log) return;
    log.push({ t: Math.round(elapsed), p: curPeriod, c: Math.max(0, Math.round(curRem)), s: s ? sideOf(s) : '', k, txt, hs: H.pts, as: A.pts, d: pending.length ? pending : undefined, ...extra });
    pending = [];
  };
  const lineupKey = () => H.on.map(g => g.p.id).sort().join() + '|' + A.on.map(g => g.p.id).sort().join();
  let lastLineup = '';
  const logSubs = (prevH: GP[], prevA: GP[]) => {
    if (!log) return;
    const key = lineupKey();
    if (key === lastLineup) return;
    lastLineup = key;
    const parts: string[] = [];
    for (const [side, prev] of [[H, prevH], [A, prevA]] as const) {
      const inn = side.on.filter(g => !prev.includes(g)).map(g => short(g.p.name));
      const out = prev.filter(g => !side.on.includes(g)).map(g => short(g.p.name));
      if (inn.length && prev.length) parts.push(`${side === H ? '{h}' : '{a}'}: ↑ ${inn.join(', ')} ↓ ${out.join(', ')}`);
    }
    if (prevH.length && !parts.length) return;
    ev('sub', null, parts.join(' · ') || 'Starting lineups', { on: { h: H.on.map(g => g.p.id), a: A.on.map(g => g.p.id) } });
  };
  /**
   * Where the shot is taken from, decided before it goes up – and it matters: a shot at the rim goes in far
   * more often than a mid-range jumper, a corner three a little more often than one above the break, a deep
   * three less. The player's overall percentages stay what his ratings say (the zones are scaled so that
   * their mix averages out to them), so a big who lives at the rim and a guard who lives in the mid-range
   * keep their real shooting – the location just decides which particular shots go in.
   */
  type Zone = { k: 'rim' | 'mid' | 'corner' | 'deep' | 'arc' | 'putback'; mix: [number, number][]; adj: number };
  const zoneOf = (three: boolean, actor: GP, fb: boolean, afterOrb: boolean): Zone => {
    const big = actor.posNum >= 4, season = seasonOf;
    if (three) {
      const cP = (actor.posNum <= 1.5 ? 0.14 : big ? 0.3 : 0.38) * (season < 1995 ? 0.6 : season < 2010 ? 0.85 : 1.05);
      const dP = (season >= 2013 && actor.usg > 0.24 && actor.p3 > 0.36 ? 0.3 : season >= 2008 ? 0.08 : 0.03) * (1 - cP);
      const mix: [number, number][] = [[cP, 0.2], [dP, -0.4], [1 - cP - dP, 0]];
      const u = cr.next();
      return u < cP ? { k: 'corner', mix, adj: 0.2 } : u < cP + dP ? { k: 'deep', mix, adj: -0.4 } : { k: 'arc', mix, adj: 0 };
    }
    if (afterOrb) return { k: 'putback', mix: [[1, 0]], adj: 0 };
    const r = fb ? 0.88 : big ? 0.6 : season >= 2010 ? 0.46 : 0.4;
    const mix: [number, number][] = [[r, C.zoneGap / 2], [1 - r, -C.zoneGap / 2]];
    return cr.chance(r) ? { k: 'rim', mix, adj: C.zoneGap / 2 } : { k: 'mid', mix, adj: -C.zoneGap / 2 };
  };
  /** make probability from this zone, keeping the player's average over his zone mix at p */
  const zoneP = (p: number, z: Zone) => {
    const L = logit(Math.min(0.97, Math.max(0.02, p)));
    const m = z.mix.reduce((a, [w, adj]) => a + w * sigm(L + adj), 0);
    return Math.min(0.97, p * sigm(L + z.adj) / (m || p));
  };
  /** exactly where the shot comes from inside its zone, and what it looks like (cosmetic stream) */
  const shotSpot = (three: boolean, actor: GP, fb: boolean, afterOrb: boolean, made: boolean, blocked: boolean, z: Zone): { x: number; y: number; rim: boolean; sk: string } => {
    const big = actor.posNum >= 4, h = hash01(actor.p.id + 'side');
    // every player has a favourite side of the floor
    const side = () => (cr.chance(0.5 + (h - 0.5) * 0.5) ? 1 : -1);
    const at = (ang: number, r: number) => ({ x: 25 + Math.sin(ang) * r, y: Math.max(1, 5.25 + Math.cos(ang) * r) });
    const season = seasonOf;
    if (three) {
      if (z.k === 'corner') { const sd = side(); return { x: sd > 0 ? 47.6 + cr.next() * 1.1 : 2.4 - cr.next() * 1.1, y: 1.5 + cr.next() * 8, rim: false, sk: 'three' }; } // behind the 22-ft corner line
      const r = 23.9 + (z.k === 'deep' ? 2.6 + cr.next() * 4.4 : cr.next() * 2.4);
      const ang = side() * (actor.posNum <= 1.5 ? cr.next() * 0.55 : 0.25 + cr.next() * 0.85);
      return { ...at(ang, r), rim: false, sk: actor.usg > 0.25 && cr.chance(0.35) ? 'stepback' : 'three' };
    }
    if (afterOrb) { const p = at((cr.next() - 0.5) * 2.2, 0.8 + cr.next() * 3); return { ...p, rim: true, sk: big && cr.chance(dunkP(actor) * 0.7) && made ? 'dunk' : 'putback' }; }
    if (z.k === 'rim') {
      const ang = side() * (0.15 + cr.next() * 1.1), r = 1 + cr.next() * 3.2;
      const dunk = cr.chance(dunkP(actor) * (fb ? 1.6 : 1) * (made ? 1.25 : 0.12)) && !blocked; // a missed dunk is rare
      return { ...at(ang, r), rim: true, sk: dunk ? 'dunk' : 'layup' };
    }
    if (big) {
      // post moves from the block, or a face-up jumper from the elbow / short corner for a stretch big
      if (cr.chance(actor.tpr > 0.12 ? 0.35 : 0.12)) { const ang = side() * (cr.chance(0.5) ? 0.55 + cr.next() * 0.3 : 1.25 + cr.next() * 0.3); return { ...at(ang, 13 + cr.next() * 5), rim: false, sk: 'jumper' }; }
      const ang = side() * (0.7 + cr.next() * 0.6);
      return { ...at(ang, 5 + cr.next() * 5), rim: false, sk: cr.chance(0.6) ? 'hook' : 'turnaround' };
    }
    if (cr.chance(0.28)) return { ...at(side() * cr.next() * 0.9, 6.5 + cr.next() * 4.5), rim: false, sk: 'floater' };
    // mid-range: elbows, wings, baseline
    const spot = cr.next();
    const ang = side() * (spot < 0.45 ? 0.45 + cr.next() * 0.35 : spot < 0.8 ? 0.9 + cr.next() * 0.4 : 1.35 + cr.next() * 0.2);
    const r = 14 + cr.next() * 6.5;
    return { ...at(spot < 0.12 ? 0 : ang, r), rim: false, sk: actor.usg > 0.25 && cr.chance(0.3) ? 'fadeaway' : 'jumper' };
  };
  /**
   * The kind of play that produced the shot (cosmetic stream – it only tells the viewer how it happened).
   * Roles decide: a centre who does not handle the ball scores from the post, rolls or cuts – he does not
   * drive from the three-point line; ball-dominant stars isolate; shooters come off screens or spot up.
   */
  const playOf = (actor: GP, mates: GP[], three: boolean, spot: { rim: boolean; sk: string }, fb: boolean, afterOrb: boolean, passer: GP | null): { pl: string; cr?: string } => {
    const big = actor.posNum >= 4, handler = actor.ast >= 0.2 && actor.usg >= 0.22, star = actor.usg >= 0.27;
    const pick = (opts: [string, number][]) => { let r = cr.next() * opts.reduce((a, o) => a + o[1], 0); for (const [k, w] of opts) if ((r -= w) <= 0) return k; return opts[0][0]; };
    const passed = !!passer, by = passer?.p.id;
    // the passer decides how the shot came: a post-up big who draws a double team kicks it out to the open man;
    // a guard who drives draws help and kicks to a shooter – who either lets it fly or attacks the late closeout
    const postBig = !!passer && passer.posNum >= 4 && passer.tpr < 0.15;
    const driver = !!passer && passer.posNum <= 3.5;
    // a star handler draws a blitz on the pick and roll: two on the ball, he gets it out, 4-on-3 behind it
    const starPasser = !!passer && passer.usg >= 0.27 && passer.posNum <= 3.5;
    const P = (pl: string) => ({ pl, cr: by });
    if (afterOrb) return { pl: spot.rim ? 'putback' : 'kick', cr: spot.rim ? undefined : by };
    if (fb) return P('fb');
    if (spot.sk === 'hook' || spot.sk === 'turnaround') return { pl: 'post' };
    if (three) {
      if (passed) return P(big ? 'pop' : postBig ? pick([['double', 0.7], ['kick', 0.3]]) : starPasser ? pick([['blitz', 0.35], ['kick', 0.4], ['offscreen', 0.25]]) : driver ? pick([['kick', 0.6], ['offscreen', 0.4]]) : pick([['kick', 0.5], ['offscreen', 0.5]]));
      if (big && !handler) return { pl: 'pop' };
      return { pl: star && cr.chance(0.5) ? 'iso' : pick([['pnrPull', 0.5], ['pullup', 0.5]]) };
    }
    if (spot.rim) {
      if (big && !handler) return passed ? P(pick([['roll', 0.55], ['cut', 0.25], ['post', 0.2]])) : { pl: pick([['post', 0.6], ['roll', 0.25], ['cut', 0.15]]) };
      if (big) return passed ? P(pick([['roll', 0.4], ['cut', 0.3], ['drive', 0.3]])) : { pl: pick([['iso', 0.4], ['drive', 0.3], ['post', 0.3]]) };
      if (passed) return P(postBig ? pick([['double', 0.45], ['cut', 0.55]]) : pick([['cut', 0.4], ['kickdrive', 0.4], ['drive', 0.2]]));
      return { pl: star && cr.chance(0.55) ? 'iso' : pick([['drive', 0.5], ['pnrDrive', 0.5]]) };
    }
    if (big && !handler) return passed ? P('pop') : { pl: 'post' };
    if (passed) return P(postBig ? pick([['double', 0.6], ['kick', 0.4]]) : starPasser ? pick([['blitz', 0.3], ['offscreen', 0.35], ['kick', 0.35]]) : pick([['offscreen', 0.45], ['kick', 0.4], ['kickdrive', 0.15]]));
    return { pl: star && cr.chance(0.45) ? 'iso' : pick([['pullup', 0.5], ['pnrPull', 0.5]]) };
  };
  /** a teammate who could have made the pass (for misses, which have no assist): the playmakers most often */
  const passerOf = (mates: GP[]): GP | null => {
    if (!mates.length) return null;
    let r = cr.next() * mates.reduce((a, g) => a + g.ast + 0.02, 0);
    for (const g of mates) if ((r -= g.ast + 0.02) <= 0) return g;
    return mates[0];
  };
  /** how likely a finish at the rim is a dunk: size, finishing and era */
  const dunkP = (g: GP) => Math.max(0.03, Math.min(0.8, (0.12 + 0.05 * (g.p.ht - 77) + 1.4 * (g.p2 - 0.5)) * (seasonOf < 1978 ? 0.5 : 1)));
  const foulOn = (s: Side, weights?: number[]) => {
    const on = s.on;
    const i = rng.weighted(weights ?? on.map(g => g.pf));
    const g = on[i];
    g.fouls++; inc(g, 'pf');
    ev('foul', s, `Foul: ${short(g.p.name)} (${g.fouls})`);
    return g;
  };

  logSubs([], []);
  while (true) {
    const plen = period <= 4 ? 720 : 300;
    let rem = plen;
    curPeriod = period; curRem = rem;
    const startPts = [H.pts, A.pts];
    if (period > 1) {
      restAll(period === 3 ? 0.22 : 0.07);
      const ph = H.on, pa = A.on;
      chooseLineup(H, period, rem, H.pts - A.pts, false, elapsed); chooseLineup(A, period, rem, A.pts - H.pts, false, elapsed);
      if (clutch) applyUserFive();
      logSubs(ph, pa);
    }
    while (rem > 0) {
      const off = offense, def = other(off);
      // --- interactive: pause before the possession and take the coach's call
      offCall = 'auto'; defCall = 'normal'; isoPid = null;
      if (ctl && (period > 4 || (period === 4 && rem <= ctl.fromRem))) {
        if (!clutch && ctl) userFive = (ctl.side === 'h' ? H : A).on.map(g => g.p.id);
        clutch = true;
        const dec: Decision = (yield snapshot(period, rem, off)) ?? {};
        const user = ctl.side === 'h' ? H : A;
        if (dec.timeout && timeoutsLeft > 0) {
          timeoutsLeft--; stopped = true;
          for (const s2 of [H, A]) for (const g of s2.gps) g.e = Math.min(1, g.e + (s2 === user ? 0.14 : 0.08));
          ev('timeout', user, 'Timeout');
        }
        if (dec.five) { userFive = dec.five; applyUserFive(); }
        if (off === user) { offCall = dec.off ?? 'auto'; isoPid = dec.pid ?? null; }
        else defCall = dec.def ?? 'normal';
      }
      aiCalls(off, def, period, rem);
      // transition: a steal or a long rebound starts a break before the defence is set
      const pushes = offCall === 'quick' || offCall === 'two4one' ? 1.5 : offCall === 'milk' || offCall === 'hold' ? 0 : 1;
      fastBreak = defCall !== 'foul' && rem > 4 && rng.chance((ended === 'stl' ? C.fbStl : ended === 'drb' ? C.fbDrb : 0) * pushes * (1 + 0.15 * off.paceZ));
      ended = 'dead';
      // --- one possession (may contain several plays through offensive rebounds)
      let first = true;
      let possEnded = false;
      while (!possEnded) {
        // possession length: most shots come mid-clock, few with the clock nearly gone
        let dur = first ? T0 * (0.3 + 0.6 * (rng.next() + rng.next())) : T0 * (0.25 + 0.5 * rng.next());
        if (first && fastBreak) dur = 2 + 4 * rng.next();
        else if (first) dur = callDuration(dur, rem);
        dur = Math.max(2, Math.min(dur, first ? 23.7 : 13.7)); // within the shot clock
        lateClock = first && !fastBreak && dur >= 19;
        if (first && offCall === 'milk' && off.pts > def.pts && rem <= 24 && defCall !== 'foul' && period >= 4) dur = rem; // run it all out
        if (dur > rem) dur = rem;
        tick(dur); rem -= dur; elapsed += dur; curRem = rem;
        // ahead with the shot clock turned off and nobody fouling: dribble out the clock, no shot
        if (first && offCall === 'milk' && off.pts > def.pts && rem <= 0 && defCall !== 'foul' && period >= 4) {
          ev('hold', off, `${off === H ? '{h}' : '{a}'} dribble out the clock`);
          possEnded = true; break;
        }
        const res = first && defCall === 'foul' ? intentionalFoul(off, def) : play(off, def, !first);
        first = false;
        fastBreak = false;
        if (res !== 'orb') possEnded = true;
        if (rem <= 0) possEnded = true;
      }
      // silent (non-shooting, non-bonus) fouls by the defence
      if (rem > 0 && rng.chance(C.silentPf * E.pf * leaguePf * 10)) foulOn(def);
      offense = def;
      // substitutions only on a dead ball: a whistle (free throws, a violation, a ball out of bounds, a timeout)
      // or a made basket in the last two minutes, when the clock stops – never on a live rebound or a steal.
      // A fouled-out or hurt player is replaced at once.
      const forced = [...H.on, ...A.on].some(g => g.fouls >= 6 || g.hurt);
      const dead = stopped || ended === 'dead' || (ended === 'make' && period >= 4 && rem < 120) || forced;
      stopped = false;
      const ph = H.on, pa = A.on;
      if (dead) {
        chooseLineup(H, period, rem, H.pts - A.pts, false, elapsed);
        chooseLineup(A, period, rem, A.pts - H.pts, false, elapsed);
      }
      if (clutch) applyUserFive();
      if (rem > 0) logSubs(ph, pa);
    }
    H.q.push(H.pts - startPts[0]); A.q.push(A.pts - startPts[1]);
    curRem = 0;
    const over = period >= 4 && H.pts !== A.pts;
    ev(over ? 'end' : 'period', null, over ? 'Final' : period < 4 ? `End of Q${period}` : period === 4 ? 'Tied – overtime!' : `End of OT${period - 4} – another overtime`);
    if (period >= 4 && H.pts !== A.pts) break;
    if (period >= 4) ot++;
    period++;
  }

  // --------------------------------------------------------------- interactive helpers
  function snapshot(period: number, rem: number, off: Side): GameState {
    const ps = (s: Side): PState[] => s.gps.map(g => ({ pid: g.p.id, name: g.p.name, pos: g.p.pos, e: Math.round(g.e * 100) / 100, fouls: g.fouls, on: g.on, st: { ...g.st }, ovr: shownFromBpm(g.bpm) }));
    return { period, rem, hs: H.pts, as: A.pts, off: off === H ? 'h' : 'a', h: ps(H), a: ps(A), logLen: log ? log.length : 0, timeouts: timeoutsLeft, q: { h: [...H.q], a: [...A.q] }, log: log ?? [] };
  }
  function applyUserFive() {
    if (!ctl || !userFive) return;
    const side = ctl.side === 'h' ? H : A;
    const want = userFive.map(pid => side.gps.find(g => g.p.id === pid)).filter((g): g is GP => !!g && g.fouls < 6 && !g.hurt);
    if (want.length === 5 && want.every(g => side.on.includes(g))) return;
    const fill = side.on.filter(g => !want.includes(g) && g.fouls < 6 && !g.hurt);
    const bench = side.gps.filter(g => !want.includes(g) && !fill.includes(g) && g.fouls < 6 && !g.hurt).sort((a, b) => b.q - a.q);
    const five = [...want, ...fill, ...bench].slice(0, 5);
    for (const g of side.gps) g.on = false;
    for (const g of five) g.on = true;
    side.on = five;
  }
  /** The AI side's late-game strategy in interactive games. */
  /** Situational strategy of every AI-coached side (the user's calls stand in clutch mode). */
  function aiCalls(off: Side, def: Side, period: number, rem: number) {
    const user = ctl && clutch ? (ctl.side === 'h' ? H : A) : null;
    const lead = off.pts - def.pts;
    const late = period >= 4 && Math.abs(lead) <= 15;
    if (off !== user) {
      // late game: protect a lead with the whole shot clock, play for the last shot when tied, chase points when behind
      // behind, the deficit and the clock decide: two points are enough for a small gap, a big one needs threes
      const d = -lead;
      if (late && lead > 0 && rem < 60) offCall = 'milk';
      else if (late && d >= 0 && d <= 2 && rem < 24) offCall = 'milk';
      else if (late && d === 3 && rem < 35) offCall = 'three';
      else if (late && d >= 4 && d <= 6 && rem < 22) offCall = 'three';
      else if (late && d >= 4 && d <= 6 && rem < 50) offCall = 'quick';
      else if (late && d >= 7 && rem < 45) offCall = 'three';
      else if (late && d >= 7 && rem < 100) offCall = 'quick';
      // end of a quarter: take a quick shot to get the ball back (2-for-1), or hold for the last shot
      else if (offCall === 'auto' && rem > 29 && rem < 40) offCall = 'two4one';
      else if (offCall === 'auto' && rem <= 26 && rem > 3) offCall = 'hold';
    }
    if (def !== user && late && period >= 4) {
      // trailing late: foul to stop the clock and send a poor shooter to the line
      if (((lead >= 4 && lead <= 9 && rem < 45) || (lead === 3 && rem < 40 && rem > 24)) && rem > 2) defCall = 'foul';
      // down two to four possessions in the last three minutes: press full court after scores
      else if (lead >= 5 && lead <= 14 && rem < 180 && rem > 45 && (ended === 'make' || stopped) && cr.chance(0.55)) defCall = 'pressure';
    }
    // the defence's scheme on this trip (what the viewer sees, and a nudge toward threes against a zone)
    const id = dIdent(def.tid);
    dsc = defCall === 'pressure' ? 'press' : cr.chance(id.zone) ? 'zone' : cr.chance(id.sw) ? 'switch' : 'man';
  }
  function callDuration(dur: number, rem: number) {
    if (defCall === 'foul') return 1.5 + 2.5 * rng.next();
    if (offCall === 'milk') return rem <= 24 ? Math.max(1, rem - 1 - rng.next() * 1.5) : 18 + rng.next() * 5;
    if (offCall === 'hold') return Math.max(1, rem - 1 - rng.next() * 2.5);
    if (offCall === 'quick') return 3 + rng.next() * 4;
    if (offCall === 'two4one') return Math.max(3, rem - 30 + rng.next() * 2);
    if (defCall === 'pressure') return dur * 0.85;
    return dur;
  }
  function intentionalFoul(off: Side, def: Side): 'end' | 'orb' {
    const target = off.on[rng.weighted(off.on.map(g => Math.pow(1.05 - g.pft, 3)))];
    const f = def.on[rng.weighted(def.on.map(g => g.pf))];
    f.fouls++; inc(f, 'pf');
    ev('foul', def, `Intentional foul: ${short(f.p.name)} (${f.fouls}) on ${short(target.p.name)}`);
    return ftTrip(off, def, target, 2);
  }

  // --------------------------------------------------------------- one play
  function play(off: Side, def: Side, afterOrb: boolean): 'end' | 'orb' {
    const on = off.on, dOn = def.on;
    const usgSum = on.reduce((a, g) => a + g.usg, 0);
    const defZ = dOn.reduce((a, g) => a + g.def, 0) / 5;
    // matchups: defenders guard the offensive player at the same position slot
    const byPos = (a: GP, b: GP) => a.posNum - b.posNum;
    const oS = [...on].sort(byPos), dS = [...dOn].sort(byPos);
    const guard = (g: GP) => dS[oS.indexOf(g)] ?? dS[0];
    // the offence looks for the weak spot: a soft or much smaller defender draws more shots
    const edge = (g: GP) => { const d = guard(g); return C.mmUsg * (defZ - d.def) + C.mmSize * Math.max(-6, Math.min(6, g.p.ht - d.p.ht)) * (g.posNum >= 3.5 ? 1 : 0.4); };
    let actor = on[rng.weighted(on.map(g => g.usg * (0.6 + 0.4 * g.e) * Math.exp(edge(g)) * (offCall === 'three' && !afterOrb ? Math.max(0.05, g.tpr) * 3 : 1)))];
    if (offCall === 'iso' && isoPid && !afterOrb) {
      const iso = on.find(g => g.p.id === isoPid);
      if (iso && cr.chance(0.85)) actor = iso;
    }
    const callShift = offCall === 'quick' ? -0.12 : offCall === 'milk' ? -0.03 : offCall === 'inside' ? 0.04 : 0;
    const fb = fastBreak && !afterOrb, lc = lateClock && !afterOrb;
    const tag: Partial<PbpEv> = { ...(fb ? { fb: 1 as const } : {}), ...(offCall !== 'auto' && !afterOrb ? { call: offCall } : {}), ...(dsc !== 'man' && !fb ? { dsc } : {}) };
    const fat = C.fatigue * Math.max(0, C.fatBase - actor.e);
    const homeAdv = off.home ? C.home : -C.home;
    const md = guard(actor);
    const stlZ = dOn.reduce((a, g) => a + g.stlZ, 0) / 5;
    const usgShift = C.usgEff * (usgSum - 1);
    const an = log ? short(actor.p.name) : '';

    // turnover
    // ball pressure: his own defender's hands count as much as the team's
    const pTov = sigm(logit(actor.tov) + C.tov + E.tov + C.stlDef * (C.mmDef * md.stlZ + (1 - C.mmDef) * stlZ) + 0.8 * fat - 0.5 * homeAdv - 0.3 * usgShift + (defCall === 'pressure' ? 0.35 : 0) + (offCall === 'milk' ? 0.1 : 0) + (lc ? 0.15 : 0));
    if (rng.chance(pTov)) {
      inc(actor, 'tov');
      const sumStl = dOn.reduce((a, g) => a + g.stl, 0);
      if (rng.chance(Math.min(0.95, (sumStl / leagueTov) * C.stlShare * E.stl))) {
        const st = dOn[rng.weighted(dOn.map(g => g.stl * (g === md ? 2.2 : 1)))];
        inc(st, 'stl');
        // his own man strips him; anyone else jumps a passing lane
        ended = 'stl';
        if (log) ev('tov', off, st === md ? `${short(st.p.name)} strips ${an}` : `${an}'s pass is picked off by ${short(st.p.name)}`, { m: md.p.id, v: st === md ? 'strip' : 'pick', ...tag });
      } else if (log) {
        const r = cr.next();
        const v = lc && r < 0.18 ? 'clock' : r < 0.45 ? 'bad' : r < 0.7 ? 'travel' : 'oob';
        ev('tov', off, v === 'clock' ? `Shot clock violation on ${off === H ? '{h}' : '{a}'}` : v === 'bad' ? `${an} throws it away` : v === 'travel' ? `${an} travels` : `${an} loses it out of bounds`, { m: md.p.id, v, ...tag });
      }
      return 'end';
    }
    // free-throw trip without a field-goal attempt (shooting foul / bonus)
    const defPf = dOn.reduce((a, g) => a + g.pf, 0) / 5;
    const r = Math.max(0, actor.drw - C.andOne * 0.5);
    const qTrip = Math.min(0.45, (r / (2 + r)) * C.foulTrip * E.ftr * Math.sqrt(defPf / leaguePf) * (offCall === 'inside' ? 1.35 : 1) * (fb ? 1.2 : 1));
    if (rng.chance(qTrip)) {
      foulOn(def);
      return ftTrip(off, def, actor, 2);
    }
    // field-goal attempt
    let tprAdj = sigm(logit(Math.min(0.97, Math.max(0.003, actor.tpr))) + C.tpa + E.tpa);
    if (!afterOrb && offCall === 'three') tprAdj = Math.max(tprAdj, 0.85);
    if (offCall === 'inside') tprAdj *= 0.15;
    if (dsc === 'zone' && !fb) tprAdj = sigm(logit(Math.min(0.97, Math.max(0.01, tprAdj))) + 0.25); // a zone dares you to shoot
    if (fb) tprAdj *= C.fbThree;
    const three = rng.chance(afterOrb ? tprAdj * C.putback3 : tprAdj);
    // defence on the shot: his own defender matters most, help defence (team) the rest; size inside
    const defOn = C.mmDef * md.def + (1 - C.mmDef) * defZ;
    const size = three ? 0 : C.mmHt * Math.max(-8, Math.min(8, actor.p.ht - md.p.ht));
    const shift = homeAdv - fat + usgShift - C.def * defOn * (three ? 0.7 : 1) + size + callShift + (defCall === 'pressure' ? 0.08 : 0) + (fb && !three ? C.fbMake : 0) - (lc ? C.lateClock : 0);
    inc(actor, 'fga');
    if (three) inc(actor, 'tpa');
    const zone = zoneOf(three, actor, fb, afterOrb);
    let made: boolean;
    let blocker: GP | null = null;
    if (three) {
      made = rng.chance(zoneP(sigm(logit(actor.p3) + C.p3 + E.p3 + shift), zone));
    } else {
      // shots at the rim get blocked far more often than jumpers (same total)
      const rimW = zone.mix[0][0], blkZ = zone.k === 'rim' ? 1.4 / (rimW * 1.4 + (1 - rimW) * 0.45) : zone.k === 'mid' ? 0.45 / (rimW * 1.4 + (1 - rimW) * 0.45) : 1;
      const pBlk = Math.min(0.3, dOn.reduce((a, g) => a + g.blk, 0) * C.blk * E.blk * blkZ);
      const pMake = zoneP(sigm(logit(actor.p2) + C.p2 + E.p2 + shift), zone);
      if (rng.chance(pBlk)) {
        blocker = dOn[rng.weighted(dOn.map(g => g.blk * (g === md ? 2.5 : 1)))];
        inc(blocker, 'blk');
        made = false;
      } else made = rng.chance(Math.min(0.97, pMake / (1 - pBlk)));
    }
    const spot = log ? shotSpot(three, actor, fb, afterOrb, made, !!blocker, zone) : { x: 0, y: 0, rim: zone.k === 'rim', sk: '' };
    const what = three ? 'a three' : afterOrb ? 'a putback' : spot.rim ? 'at the rim' : 'a mid-range jumper';
    const MADE: Record<string, string> = { dunk: fb ? 'throws it down on the break' : afterOrb ? 'slams home the putback' : 'throws it down', layup: fb ? 'scores on the break' : 'scores at the rim', putback: 'scores on the putback', hook: 'hits a hook shot', turnaround: 'hits a turnaround jumper', floater: 'drops in a floater', fadeaway: 'hits a fadeaway', jumper: 'hits a mid-range jumper' };
    const MISS: Record<string, string> = { dunk: 'misses at the rim', layup: 'misses at the rim', putback: 'misses the putback', hook: 'misses a hook shot', turnaround: 'misses a turnaround', floater: 'misses a floater', fadeaway: 'misses a fadeaway', jumper: 'misses a mid-range jumper' };
    if (made) {
      const pts = three ? 3 : 2;
      inc(actor, 'fgm'); if (three) inc(actor, 'tpm');
      inc(actor, 'pts', pts); score(off, pts);
      const mates = on.filter(g => g !== actor);
      const pAst = Math.min(0.95, C.ast * E.ast * mates.reduce((a, g) => a + g.ast, 0) * (three ? 1.18 : 0.94));
      let astTxt = '';
      let asG: GP | null = null;
      if (rng.chance(pAst)) { const as = mates[rng.weighted(mates.map(g => g.ast))]; inc(as, 'ast'); astTxt = ` (assist ${short(as.p.name)})`; asG = as; }
      const play = log ? playOf(actor, mates, three, spot, fb, afterOrb, asG) : undefined;
      const pl = play?.pl;
      ended = 'make';
      ev(three ? 'make3' : 'make2', off, three ? `${an} hits a ${spot.sk === 'stepback' && !astTxt ? 'step-back ' : ''}three${astTxt}` : `${an} ${MADE[spot.sk] ?? `scores ${fb ? 'on the break' : what}`}${astTxt}`, { x: spot.x, y: spot.y, sk: spot.sk || undefined, pl, cr: play?.cr, m: md.p.id, ...tag });
      if (!three && rng.chance(C.andOne)) {
        foulOn(def);
        ftTrip(off, def, actor, 1);
        return 'end';
      }
      return 'end';
    }
    ev(three ? 'miss3' : 'miss2', off, blocker ? `${short(blocker.p.name)} blocks ${an}${spot.sk ? `'s ${({ dunk: 'dunk attempt', stepback: 'step-back' } as Record<string, string>)[spot.sk] ?? spot.sk}` : ''}` : three ? `${an} misses a three` : `${an} ${MISS[spot.sk] ?? `misses ${what === 'at the rim' ? 'at the rim' : what === 'a putback' ? 'the putback' : 'a mid-range jumper'}`}`, { x: spot.x, y: spot.y, sk: spot.sk || undefined, ...(log ? (() => { const ms = on.filter(g => g !== actor); const pp = playOf(actor, ms, three, spot, fb, afterOrb, cr.chance(three ? 0.55 : spot.rim ? 0.4 : 0.35) ? passerOf(ms) : null); return { pl: pp.pl, cr: pp.cr }; })() : {}), m: md.p.id, ...tag });
    return rebound(off, def, false);
  }

  function ftTrip(off: Side, def: Side, actor: GP, n: number): 'end' | 'orb' {
    stopped = true; // free throws: the clock is stopped, the table can wave subs in
    let lastMade = true;
    for (let i = 0; i < n; i++) {
      inc(actor, 'fta');
      lastMade = rng.chance(sigm(logit(actor.pft) + C.ft + E.ft - 0.3 * C.fatigue * Math.max(0, C.fatBase - actor.e)));
      if (lastMade) { inc(actor, 'ftm'); inc(actor, 'pts'); score(off, 1); }
      ev(lastMade ? 'ft' : 'ftm', off, `${log ? short(actor.p.name) : ''} free throw ${i + 1}/${n}: ${lastMade ? 'good' : 'missed'}`);
    }
    if (lastMade) { ended = 'make'; return 'end'; }
    return rebound(off, def, true);
  }

  function rebound(off: Side, def: Side, ft: boolean): 'end' | 'orb' {
    const O = off.on.reduce((a, g) => a + g.orb, 0) * C.orb * E.orb * (ft ? C.orbFt : 1);
    const D = def.on.reduce((a, g) => a + g.drb, 0);
    if (rng.chance(O / (O + D))) {
      const g = off.on[rng.weighted(off.on.map(g => g.orb))];
      inc(g, 'orb');
      ev('orb', off, `${log ? short(g.p.name) : ''} grabs the offensive rebound`);
      return 'orb';
    }
    const g = def.on[rng.weighted(def.on.map(g => g.drb))];
    inc(g, 'drb');
    ended = 'drb';
    ev('drb', def, `${log ? short(g.p.name) : ''} grabs the rebound`);
    return 'end';
  }

  return finishBox(H, A, ot, log);
}

function finishBox(H: Side, A: Side, ot: number, log: PbpEv[] | null) {
  const box = (s: Side): Box => ({
    tid: s.tid, pts: s.pts, q: s.q,
    players: s.gps.map(g => {
      g.st.min = Math.round(g.st.min * 10) / 10;
      if (g.st.min > 0) g.st.gp = 1;
      return { pid: g.p.id, name: g.p.name, st: g.st, starter: g.starter, ...(g.hurt ? { hurt: true } : {}) };
    }),
  });
  return { home: box(H), away: box(A), ot, pbp: log ?? undefined };
}

let paceCache: Record<number, number> = {};
import { seasonInfo } from '../data';
export function seasonPace(season: number) {
  if (paceCache[season] === undefined) paceCache[season] = seasonInfo(season).league.pace;
  return paceCache[season];
}
