// Player roles (archetypes) from era-relative skill z-scores, and how well a group of them fits together.
// Shared by the game engine (lineup synergy) and the UI (badges on player cards, team fit panel).
import { K, RATING_LABELS, ratingOf, bpmOf } from './data';

export const POS_NUM: Record<string, number> = { PG: 1, G: 1.5, SG: 2, 'G-F': 2.5, GF: 2.5, SF: 3, F: 3.5, 'F-G': 3, PF: 4, 'F-C': 4.5, FC: 4.5, 'C-F': 4.5, C: 5 };
export const posN = (pos: string) => POS_NUM[pos] ?? POS_NUM[pos?.split('-')[0]] ?? 3;

export interface Archetype {
  id: string;
  name: string;
  short: string;
  blurb: string;          // what he does
  plus: string;           // what he brings to a lineup
  minus: string;          // the usual hole in his game / what he needs around him
  score: (z: number[], pn: number, q: number) => number;
}

const g = (z: number[], k: number) => z[k] ?? 0;
const big = (pn: number) => pn >= 3.75;
const perim = (pn: number) => pn <= 3.25;
const NO = -9;

export const ARCHETYPES: Archetype[] = [
  { id: 'twoway', name: 'Two-Way Star', short: '2W', blurb: 'Carries the offence and guards the other team\'s best.', plus: 'Fits anywhere – the rare piece every lineup wants.', minus: 'Heavy minutes on both ends wear him down.',
    score: (z, _pn, q) => (q >= 3.5 ? 0 : NO) + Math.min(g(z, K.usg) + 0.3 * Math.max(g(z, K.ins), g(z, K.tp)), g(z, K.def) + 0.3 * g(z, K.stl)) + (g(z, K.def) >= 0.9 && g(z, K.usg) >= 0.9 ? 0.35 : NO) },
  { id: 'general', name: 'Floor General', short: 'FG', blurb: 'Runs the offence, sees the floor and keeps it tidy.', plus: 'Fewer turnovers, more assisted shots for everyone.', minus: 'Needs finishers and shooters to pass to.',
    score: (z, pn) => (pn <= 2.5 ? 0 : pn <= 3.25 ? -0.5 : NO) + g(z, K.ast) - 0.35 * g(z, K.tov) },
  { id: 'creator', name: 'Shot Creator', short: 'SC', blurb: 'Gets his own shot whenever he wants it.', plus: 'A bailout late in the clock and in crunch time.', minus: 'Ball-dominant – two of them share one ball.',
    score: (z, pn) => (perim(pn) ? 0 : -0.4) + 0.9 * g(z, K.usg) + 0.35 * Math.max(g(z, K.ins), g(z, K.tp)) + 0.25 * g(z, K.drw) - 0.2 },
  { id: 'sniper', name: 'Sharpshooter', short: 'SS', blurb: 'Lives behind the arc and punishes help defence.', plus: 'Spacing: driving lanes open for everyone else.', minus: 'Often a target on defence and the glass.',
    score: (z) => 0.75 * g(z, K.tp) + 0.55 * g(z, K.tpr) - 0.1 },
  { id: '3d', name: '3&D Wing', short: '3D', blurb: 'Guards the perimeter and spots up in the corner.', plus: 'Low-maintenance glue: spacing plus defence.', minus: 'Limited off the dribble – needs a creator.',
    score: (z, pn) => (pn >= 1.5 && pn <= 4 ? 0 : NO) + Math.min(0.5 * g(z, K.tp) + 0.25 * g(z, K.tpr), 0.6 * g(z, K.def) + 0.25 * g(z, K.stl)) * 1.9 - 0.15 * Math.max(0, g(z, K.usg)) + 0.1 },
  { id: 'slasher', name: 'Slasher', short: 'SL', blurb: 'Attacks the rim and lives at the free-throw line.', plus: 'Pressure on the rim; gets the other bigs in foul trouble.', minus: 'Cramped without shooters around him.',
    score: (z, pn) => (perim(pn) ? 0 : pn <= 4 ? -0.3 : NO) + 0.55 * g(z, K.ins) + 0.6 * g(z, K.drw) - 0.3 * g(z, K.tpr) - 0.1 },
  { id: 'pointfwd', name: 'Point Forward', short: 'PtF', blurb: 'A forward who initiates the offence.', plus: 'A second ball-handler with size.', minus: 'Takes the ball out of the guards\' hands.',
    score: (z, pn) => (pn >= 2.75 && pn < 4.5 ? 0 : NO) + 0.9 * g(z, K.ast) + 0.15 * g(z, K.usg) - 0.1 },
  { id: 'lockdown', name: 'Lockdown Defender', short: 'LD', blurb: 'Hounds ball-handlers and jumps passing lanes.', plus: 'Takes the other team\'s best scorer away.', minus: 'Often limited as a scorer.',
    score: (z, pn) => (pn <= 3.5 ? 0 : NO) + 0.7 * g(z, K.def) + 0.55 * g(z, K.stl) - 0.3 * Math.max(0, g(z, K.usg)) - 0.15 },
  { id: 'unicorn', name: 'Unicorn', short: 'UN', blurb: 'Protects the rim and shoots threes.', plus: 'Spacing and rim protection in one roster spot.', minus: 'Rare – and teams build everything around him.',
    score: (z, pn) => (big(pn) ? 0 : NO) + Math.min(g(z, K.blk) + 0.3 * g(z, K.def), 0.7 * g(z, K.tp) + 0.6 * g(z, K.tpr)) + 0.35 },
  { id: 'stretch', name: 'Stretch Big', short: 'SB', blurb: 'A big man who pops out to the three-point line.', plus: 'Pulls the opposing centre away from the rim.', minus: 'Usually soft at the rim and on the glass.',
    score: (z, pn) => (big(pn) ? 0 : NO) + 0.6 * g(z, K.tp) + 0.7 * g(z, K.tpr) - 0.1 },
  { id: 'protector', name: 'Rim Protector', short: 'RP', blurb: 'Blocks and alters everything near the basket.', plus: 'Guards can gamble – mistakes get cleaned up at the rim.', minus: 'Clogs the paint on offence.',
    score: (z, pn) => (big(pn) ? 0 : pn >= 3 ? -0.4 : NO) + 0.8 * g(z, K.blk) + 0.4 * g(z, K.def) },
  { id: 'glass', name: 'Glass Cleaner', short: 'GC', blurb: 'Owns the boards at both ends.', plus: 'Extra possessions, one-and-done for the opponent.', minus: 'Rarely a threat away from the basket.',
    score: (z, pn) => (big(pn) ? 0 : pn >= 3 ? -0.4 : NO) + 0.5 * g(z, K.orb) + 0.55 * g(z, K.drb) - 0.05 },
  { id: 'post', name: 'Post Scorer', short: 'PS', blurb: 'Back to the basket, he wants it on the block.', plus: 'Draws double teams – easy shots for the shooters.', minus: 'Slows the game; needs spacing around the post.',
    score: (z, pn) => (big(pn) ? 0 : pn >= 3 ? -0.4 : NO) + 0.5 * g(z, K.ins) + 0.6 * g(z, K.usg) - 0.35 * g(z, K.tpr) - 0.1 },
  { id: 'playbig', name: 'Playmaking Big', short: 'PB', blurb: 'Runs the offence from the elbow and the high post.', plus: 'Hand-offs and back-door cuts – offence through the big.', minus: 'Needs cutters and shooters around him.',
    score: (z, pn) => (big(pn) ? 0 : NO) + 1.1 * g(z, K.ast) - 0.05 },
  { id: 'runner', name: 'Rim Runner', short: 'RR', blurb: 'Rolls hard, finishes lobs and cleans up misses.', plus: 'Easy points out of pick and roll.', minus: 'Can\'t create for himself.',
    score: (z, pn) => (big(pn) ? 0 : NO) + 0.6 * g(z, K.ins) + 0.3 * g(z, K.orb) - 0.3 * g(z, K.usg) - 0.3 * g(z, K.tpr) - 0.15 },
];
const ROLE: Archetype = { id: 'role', name: 'Role Player', short: 'RL', blurb: 'Does a bit of everything without a standout skill.', plus: 'Fills gaps without needing the ball.', minus: 'No single skill that swings a game.', score: () => 0 };
export const ARCH_BY_ID: Record<string, Archetype> = Object.fromEntries([...ARCHETYPES, ROLE].map(a => [a.id, a]));

export interface Role {
  arch: Archetype;
  second?: Archetype;
  strengths: string[];
  weaknesses: string[];
}

const ABILITY = RATING_LABELS.filter(r => !r.tendency);

/** The player's role: the best-fitting archetype (plus a second one when close), and his best and worst skills. */
export function roleOf(z: number[], pos: string): Role {
  const pn = posN(pos);
  const q = bpmOf(z);
  const sc = ARCHETYPES.map(a => ({ a, s: a.score(z, pn, q) })).sort((x, y) => y.s - x.s);
  const arch = sc[0].s >= 0.55 ? sc[0].a : ROLE;
  const second = arch !== ROLE && sc[1].s >= 0.55 && sc[1].s > sc[0].s - 0.35 ? sc[1].a : undefined;
  // what counts for his position: nobody minds a point guard who doesn't block shots
  const skip = new Set(pn <= 3 ? [K.blk, K.orb] : pn >= 4 ? [K.stl] : []);
  const rated = ABILITY.filter(r => !skip.has(r.k)).map(r => ({ n: r.name, v: ratingOf(z[r.k], r.inv), w: r.k === K.pf ? -10 : 0 }));
  const hi = rated.filter(r => r.v >= 64).sort((a, b) => b.v + b.w - a.v - a.w).slice(0, 3);
  const lo = rated.filter(r => r.v <= 38).sort((a, b) => a.v - a.w - b.v + b.w).slice(0, 3);
  const strengths = (hi.length ? hi : rated.slice().sort((a, b) => b.v - a.v).slice(0, 1)).map(r => r.n);
  const weaknesses = (lo.length ? lo : rated.filter(r => r.v < 50).sort((a, b) => a.v - b.v).slice(0, 1)).map(r => r.n);
  return { arch, second, strengths, weaknesses };
}

// ------------------------------------------------------------------ lineup fit
/** Per-player traits the lineup-fit model sums up. Soft (0..1-ish) so lineups don't jump at a threshold. */
export interface FitTraits { sh: number; hd: number; rp: number; cr: number }
const sig = (x: number) => 1 / (1 + Math.exp(-x));
export function fitTraits(z: number[], pn: number): FitTraits {
  return {
    sh: sig(3.2 * (g(z, K.tp) - 0.1)) * sig(3 * (g(z, K.tpr) + 0.25)),              // a shooter defences must respect
    hd: Math.max(-1, Math.min(2.5, g(z, K.ast) - 0.25 * g(z, K.tov))),                 // ball-handling / playmaking
    rp: Math.max(-1, Math.min(3, (g(z, K.blk) * 0.75 + g(z, K.def) * 0.25) * (pn >= 3.5 ? 1 : 0.55))), // rim protection
    cr: sig(3 * (g(z, K.usg) - 0.9)),                                                   // a ball-dominant creator
  };
}

/** League-typical values the engine centres on (measured over simulated rotations), so fit is zero-sum. */
export const FIT0 = { sh: 1.87, hd: 1.24, rp: 1.2, cr: 0.55, ck: 0.15 };
const FIT_ERA: [number, number, number, number, number][] = [[1980, 2.10, 1.19, 1.105, 0.152], [1995, 2.03, 1.23, 1.11, 0.128], [2010, 1.70, 1.217, 1.19, 0.121], [2024, 1.65, 1.343, 1.39, 0.195]];
/** Era-typical lineup-fit values (the engine centres on these, so fit doesn't move the league average). */
export function fit0(season: number) {
  const T = FIT_ERA;
  let i = 0;
  while (i < T.length - 2 && season > T[i + 1][0]) i++;
  const t = Math.max(0, Math.min(1, (season - T[i][0]) / (T[i + 1][0] - T[i][0])));
  const L = (k: number) => T[i][k] + (T[i + 1][k] - T[i][k]) * t;
  return { sh: L(1), hd: L(2), rp: L(3), ck: L(4) };
}

export interface LineupFit { spacing: number; handler: number; rim: number; cooks: number }
export function lineupFit(t: FitTraits[]): LineupFit {
  let sh = 0, hd = -1, rp = -1, cr = 0;
  for (const x of t) { sh += x.sh; if (x.hd > hd) hd = x.hd; if (x.rp > rp) rp = x.rp; cr += x.cr; }
  return { spacing: sh, handler: hd, rim: rp, cooks: cr };
}

/** Team-fit report for a group of players (a rotation): grades and plain notes. */
export function teamFit(players: { z: number[]; pos: string; name?: string }[]) {
  const five = players.slice(0, 5), eight = players.slice(0, 8);
  const tr = five.map(p => fitTraits(p.z, posN(p.pos)));
  const f = lineupFit(tr);
  const roles = eight.map(p => roleOf(p.z, p.pos));
  const ids = roles.map(r => r.arch.id);
  const distinct = new Set(ids).size;
  const avg = (k: number) => five.reduce((a, p) => a + (p.z[k] ?? 0), 0) / Math.max(1, five.length);
  const reb = five.reduce((a, p) => a + (p.z[K.orb] ?? 0) * 0.4 + (p.z[K.drb] ?? 0) * 0.6, 0);
  const grade = (x: number) => Math.max(1, Math.min(99, Math.round(50 + 14 * x)));
  const items = [
    { k: 'Spacing', v: grade((f.spacing - FIT0.sh) / 0.9), d: `${f.spacing.toFixed(1)} shooters the defence must respect in the starting five` },
    { k: 'Playmaking', v: grade((f.handler - FIT0.hd) / 0.8), d: 'best ball-handler on the floor' },
    { k: 'Rim protection', v: grade((f.rim - FIT0.rp) / 0.8), d: 'best shot-blocker / paint defender' },
    { k: 'Perimeter D', v: grade(avg(K.def) / 0.5), d: 'average defence of the starters' },
    { k: 'Rebounding', v: grade(reb / 2), d: 'combined glass work of the starters' },
    { k: 'Shot creation', v: grade((Math.max(...five.map(p => p.z[K.usg] ?? 0)) - 1) / 0.7), d: 'someone who can get his own shot' },
  ];
  const notes: { good: boolean; t: string }[] = [];
  if (f.spacing < 1.2) notes.push({ good: false, t: 'Cramped floor: few real shooters, defences can pack the paint (two-point shots suffer).' });
  else if (f.spacing > 2.9) notes.push({ good: true, t: 'Five-out spacing: lanes are open for drivers and the post.' });
  if (f.handler < 0.6) notes.push({ good: false, t: 'No true ball-handler – expect more turnovers.' });
  else if (f.handler > 2) notes.push({ good: true, t: 'An elite playmaker keeps the offence clean.' });
  if (f.rim < 0.4) notes.push({ good: false, t: 'No rim protector: opponents finish easily inside.' });
  else if (f.rim > 1.9) notes.push({ good: true, t: 'An anchor at the rim deters drives.' });
  if (f.cooks > 2) notes.push({ good: false, t: 'Too many ball-dominant scorers – they take turns rather than help each other.' });
  if (f.cooks < 0.15) notes.push({ good: false, t: 'Nobody to create a shot when the play breaks down.' });
  if (distinct >= 6) notes.push({ good: true, t: `Diverse rotation: ${distinct} different roles in the top eight.` });
  const dup = Object.entries(ids.reduce((a: Record<string, number>, id) => ((a[id] = (a[id] ?? 0) + 1), a), {})).filter(([id, n]) => n >= 3 && ['creator', 'post', 'slasher', 'glass', 'protector', 'runner', 'general', 'playbig'].includes(id));
  for (const [id, n] of dup) notes.push({ good: false, t: `${n} × ${ARCH_BY_ID[id].name} in the top eight – overlapping skills.` });
  const fitScore = Math.round(items.reduce((a, i) => a + i.v, 0) / items.length);
  return { items, notes, roles, fit: f, fitScore, distinct };
}

// ------------------------------------------------------------------ role matchups
/**
 * Role matchups: each attack type has the roles that carry it and the roles that stop it. A lineup full of
 * slashers feasts on a defence with no rim protector or stopper; shooters punish a defence without wing defenders.
 */
export const EDGE_TYPES = ['drive', 'shoot', 'post', 'handle'] as const;
export type EdgeType = typeof EDGE_TYPES[number];
const ATT: Record<EdgeType, Record<string, number>> = {
  drive: { slasher: 1, creator: 0.5, twoway: 0.5, pointfwd: 0.5, general: 0.3 },
  shoot: { sniper: 1, stretch: 1, unicorn: 0.8, '3d': 0.6, creator: 0.3 },
  post: { post: 1, playbig: 0.5, runner: 0.6, glass: 0.4 },
  handle: { general: 1, playbig: 0.7, pointfwd: 0.8, creator: 0.4 },
};
const CTR: Record<EdgeType, Record<string, number>> = {
  drive: { protector: 1, unicorn: 0.8, lockdown: 1, '3d': 0.5, twoway: 0.6 },
  shoot: { lockdown: 0.8, '3d': 1, twoway: 0.5 },
  post: { protector: 1, unicorn: 0.6, glass: 0.6, runner: 0.3 },
  handle: { lockdown: 1, '3d': 0.4, twoway: 0.5 },
};
/** Per-player attack and counter weights for each matchup type (primary role full, second role half). */
export function edgeTraits(z: number[], pos: string) {
  const r = roleOf(z, pos);
  const a = r.arch.id, b = r.second?.id;
  const att = {} as Record<EdgeType, number>, ctr = {} as Record<EdgeType, number>;
  for (const t of EDGE_TYPES) {
    att[t] = Math.min(1.2, (ATT[t][a] ?? 0) + 0.5 * (b ? ATT[t][b] ?? 0 : 0));
    ctr[t] = Math.min(1.2, (CTR[t][a] ?? 0) + 0.5 * (b ? CTR[t][b] ?? 0 : 0));
  }
  return { att, ctr };
}
/** Typical counter strength a defence has on the floor for each type (measured over simulated games). */
const CTR_ERA: [number, number, number, number, number][] = [[1980, 1.396, 0.595, 1.215, 0.58], [1995, 1.311, 0.706, 0.938, 0.741], [2010, 1.256, 0.725, 0.854, 0.749], [2024, 1.171, 0.719, 0.94, 0.673]];
export function ctr0(season: number): Record<EdgeType, number> {
  const T = CTR_ERA;
  let i = 0;
  while (i < T.length - 2 && season > T[i + 1][0]) i++;
  const t = Math.max(0, Math.min(1, (season - T[i][0]) / (T[i + 1][0] - T[i][0])));
  const L = (k: number) => T[i][k] + (T[i + 1][k] - T[i][k]) * t;
  return { drive: L(1), shoot: L(2), post: L(3), handle: L(4) };
}

// ------------------------------------------------------------------ roster fit (for GMs)
/** Switch for tests: GMs value fit. */
export const GMFIT = { on: true };
const roleCache = new Map<string, { r: Role; ft: FitTraits; ed: ReturnType<typeof edgeTraits> }>();
function cached(p: { id: string; z: number[]; pos: string }) {
  const k = p.id + '|' + p.z[0].toFixed(3) + p.z[13].toFixed(3) + p.pos;
  let v = roleCache.get(k);
  if (!v) {
    if (roleCache.size > 20000) roleCache.clear();
    v = { r: roleOf(p.z, p.pos), ft: fitTraits(p.z, posN(p.pos)), ed: edgeTraits(p.z, p.pos) };
    roleCache.set(k, v);
  }
  return v;
}
const cl = (x: number, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const BALL = ['creator', 'post', 'slasher', 'general', 'playbig', 'pointfwd'];
/**
 * How well a rotation fits together, roughly −1 (a pile of the same pieces) to +1 (complementary roles):
 * spacing, a ball-handler, a rim protector, not too many ball-dominant scorers, answers on defence to
 * every way of attacking, and more than one way to attack. Players must be sorted best first.
 */
export function rosterFit(players: { id: string; z: number[]; pos: string }[]) {
  const top = players.slice(0, 8).map(cached);
  if (top.length < 5) return 0;
  const five = top.slice(0, 5);
  let sh = 0, hd = -1, rp = -1, ck = 0;
  for (const x of five) { sh += x.ft.sh; hd = Math.max(hd, x.ft.hd); rp = Math.max(rp, x.ft.rp); ck += x.ft.cr; }
  let s = 0.3 * cl((sh - 1.9) / 1.2) + 0.25 * cl((hd - 1.2) / 1) + 0.25 * cl((rp - 1.2) / 1) - 0.35 * Math.max(0, ck - 1.4);
  for (const t of EDGE_TYPES) {
    let c = 0, a = 0;
    top.forEach((x, i) => { const w = i < 5 ? 1 : 0.5; c += w * x.ed.ctr[t]; a += w * x.ed.att[t]; });
    if (c < 0.5) s -= 0.1 * (1 - c / 0.5);   // no answer on defence to this kind of attack
    if (a >= 0.9) s += 0.06;                  // another way to attack
  }
  const n: Record<string, number> = {};
  for (const x of top) n[x.r.arch.id] = (n[x.r.arch.id] ?? 0) + 1;
  for (const [id, k] of Object.entries(n)) if (k >= 3 && BALL.includes(id)) s -= 0.12 * (k - 2);
  return cl(s - 0.15);
}
