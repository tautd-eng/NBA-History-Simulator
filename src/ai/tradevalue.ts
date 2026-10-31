// Trade value: what a player or a pick is worth to a team, in one currency.
//
// Production is convex in quality (one star is worth more than two good
// starters – he occupies one rotation spot and wins games on his own), measured
// year by year over his projected development and weighted by the team's
// horizon (contenders: now; rebuilders: later). Salary is a cost: what that
// money would buy on the open market, weighted by how much this team cares about
// money (over the cap, rebuilding: more). Contracts matter: a star on a capped
// max deal or a good player on a rookie deal carries surplus value; an
// overpaid veteran is a negative asset. Expiring players count fully only this
// season; after that the team keeps a share (it can re-sign him at market
// price). Picks are expected prospects at the projected slot on cheap rookie
// deals, with the upside of the best outcomes.
import { H, bpmOf } from '../data';
import { hiddenBoost } from '../hboost';
import { League, Player, Team } from '../types';
import { ageIn, bucket } from '../players';
import { projectBpm, MIN_SAL, maxSalary, payroll, SAL_K, SAL_EXP } from './value';

const REPL = -2.5;           // replacement level (BPM)
const EXP = 1.8;             // convexity of production
const SCALE = 0.25;
export type Horizon = Team['strategy'] | 'allin' | 'tank' | 'rising';
export const HORIZON: Record<Horizon, number[]> = {
  allin: [2.4, 0.7, 0.3, 0.15, 0.1],     // this season above all
  rising: [0.8, 1.0, 1.0, 0.8, 0.6],     // a young core about to be good: the next three years
  contend: [1.6, 0.8, 0.45, 0.25, 0.15],
  middle: [1.1, 0.85, 0.65, 0.45, 0.3],
  rebuild: [0.5, 0.8, 0.9, 0.85, 0.75],
  tank: [0.1, 0.55, 0.95, 1.0, 0.9],      // this season does not matter (losing even helps)
};
/** Which time horizon a team values by: its mode if it has one, otherwise its strategy. */
export const horizonOf = (t: Team): Horizon => (t.mode === 'allin' || t.mode === 'tank' || t.mode === 'rising' ? t.mode : t.strategy);
/** All-in teams pay with picks they discount; tanking teams prize them. */
export const PICK_MUL: Record<Horizon, number> = { allin: 0.6, contend: 0.85, middle: 1, rising: 1, rebuild: 1.15, tank: 1.35 };

/** On-court value of one season at this BPM. */
export const prodOf = (b: number) => Math.pow(Math.max(0, b - REPL), EXP) * SCALE;
/** What the open market buys with this salary, in the same units. */
export const costOf = (sal: number) => prodOf(Math.pow(Math.max(sal, MIN_SAL) / SAL_K, 1 / SAL_EXP) + REPL);
/** Market salary for a BPM level (same curve as asking salaries). */
const marketSal = (b: number) => Math.max(MIN_SAL, SAL_K * Math.pow(Math.max(0, b - REPL), SAL_EXP));

/** How much this team cares about money (0.3–0.8). */
export function moneyWeight(lg: League, tid: string) {
  const t = lg.teams[tid];
  const pay = payroll(lg, tid);
  let w = pay > 1.15 ? 0.75 : pay > 1.0 ? 0.6 : pay < 0.75 ? 0.35 : 0.45;
  if (t.strategy === 'rebuild') w += 0.1;
  if (t.strategy === 'contend') w -= 0.08;
  if (t.mode === 'allin') w -= 0.15;   // will take on salary to win now
  if (t.mode === 'capclear') w += 0.25; // every dollar off the books counts
  return Math.max(0.2, Math.min(0.9, w));
}

export interface Parts { prod: number; cost: number; years: number[] }

/** Production and salary cost of a player for a team with this horizon. */
export function playerParts(lg: League, p: Player, strategy: Horizon): Parts {
  const S = lg.season;
  const age = ageIn(p, S);
  const hb = hiddenBoost(p.id);
  const proj = projectBpm(p.z, age, 5).map(v => v + hb);
  const w = HORIZON[strategy];
  // seasons left on his deal (this one included), an extension adds more
  const left = Math.max(1, p.contract.exp - S + 1);
  const extLeft = p.ext ? Math.max(0, p.ext.exp - p.contract.exp) : 0;
  // a long injury takes away part of this season
  const n = Object.values(lg.teams).filter(t => t.active).length || 1;
  const G = lg.schedule.length ? lg.schedule.length * 2 / n : 82;
  const injF = lg.phase === 'regular' || lg.phase === 'playoffs' ? Math.max(0, 1 - (p.injury ?? 0) / Math.max(1, G)) : 1;
  const upside = age <= 21 ? 1.15 : age <= 23 ? 1.08 : 1;
  const retain = p.contract.rookie ? 0.8 : 0.55; // chance he stays after the deal (rights, restricted free agency)
  let prod = 0, cost = 0;
  const years: number[] = [];
  for (let y = 0; y < 5; y++) {
    const pr = prodOf(proj[y]) * (y === 0 ? injF : 1) * upside;
    let c: number, keep = 1;
    if (y < left) c = costOf(p.contract.sal);
    else if (y < left + extLeft) c = costOf(p.ext!.sal);
    else { keep = retain; c = costOf(Math.min(maxSalary(p, S + y), marketSal(proj[y]))); }
    prod += w[y] * keep * pr;
    cost += w[y] * keep * c;
    years.push(pr);
  }
  return { prod, cost, years };
}

/** Net value of a player to a team (production minus what it costs them). */
export function tradeValue(lg: League, p: Player, tid: string) {
  const t = lg.teams[tid];
  const parts = playerParts(lg, p, horizonOf(t));
  return parts.prod - moneyWeight(lg, tid) * parts.cost;
}

// ---------------------------------------------------------------- picks
const ROOKIE_SAL = (slot: number) => (slot <= 30 ? Math.max(MIN_SAL, 0.075 * Math.exp(-(slot - 1) / 11)) : MIN_SAL);
const SD = [3.0, 2.6, 2.3, 2.1, 1.9, 1.8, 1.7];     // spread of outcomes by slot bucket
const HYPE = [1.5, 1.3, 1.15, 1.05, 1, 1, 1];      // GMs pay extra for the top of the draft
const CENTER = [2, 7, 15.5, 25.5, 38, 53, 70];     // middle slot of each bucket (1–3, 4–10, 11–20, 21–30, 31–45, 46–60, later)
/** Expected development path and chance to make it, interpolated between slot buckets. */
function slotPath(slot: number) {
  let i = 0;
  while (i < CENTER.length - 2 && slot > CENTER[i + 1]) i++;
  const t = Math.max(0, Math.min(1, (slot - CENTER[i]) / (CENTER[i + 1] - CENTER[i])));
  const a = projectBpm(H.draftPrior[i].z, 20, 5), b = projectBpm(H.draftPrior[i + 1].z, 20, 5);
  return {
    mean: a.map((v, k) => v + (b[k] - v) * t),
    play: H.draftPrior[i].play + (H.draftPrior[i + 1].play - H.draftPrior[i].play) * t,
    sd: SD[i] + (SD[i + 1] - SD[i]) * t,
    hype: HYPE[i] + (HYPE[i + 1] - HYPE[i]) * t,
  };
}
const PCACHE: Record<string, number> = {};

/**
 * Expected value of the prospect taken at a slot: development from the
 * typical rookie at that slot, over the spread of outcomes (busts and stars),
 * on a rookie contract for four years.
 */
export function prospectValue(slot: number, strategy: Horizon, moneyW: number) {
  const key = `${slot}|${strategy}|${moneyW.toFixed(2)}`;
  if (PCACHE[key] !== undefined) return PCACHE[key];
  const path = slotPath(slot);
  const mean = path.mean;
  const w = HORIZON[strategy];
  const pts = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2], dens = pts.map(x => Math.exp(-x * x / 2));
  const dsum = dens.reduce((a, x) => a + x, 0);
  let v = 0;
  for (let y = 0; y < 5; y++) {
    let e = 0;
    pts.forEach((x, i) => (e += dens[i] / dsum * prodOf(mean[y] + x * path.sd * Math.min(1, 0.5 + 0.2 * y))));
    const c = y < 4 ? costOf(ROOKIE_SAL(slot)) : costOf(marketSal(mean[y]));
    const keep = y < 4 ? 1 : 0.8;
    v += w[y] * keep * (e - moneyW * c);
  }
  v *= path.play * path.hype * PICK_MUL[strategy];
  PCACHE[key] = v;
  return v;
}

export { bpmOf };
