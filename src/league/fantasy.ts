// Fantasy draft: every player of the starting season's league goes into one pool and the
// teams build new rosters in a snake draft. AI teams pick by value and need.
import { League, Player } from '../types';
import { isHuman } from './humans';
import { rngOf, beginFirstSeason } from './league';
import { askingSalary, contractYears, MIN_SAL, hardCap, payroll } from '../ai/value';
import { marketPlayerValue } from '../ai/trades';
import { posNum } from '../engine/game';
import { ageIn, tagOf, addTx } from '../players';

export function fantasyOnClock(lg: League): { tid: string; round: number; pick: number } | null {
  const f = lg.fantasy;
  if (!f || f.done) return null;
  const n = f.order.length;
  const i = f.picks.length;
  const round = Math.floor(i / n) + 1;
  if (round > f.rounds) return null;
  const k = i % n;
  const tid = round % 2 === 1 ? f.order[k] : f.order[n - 1 - k];
  return { tid, round, pick: i + 1 };
}

export function fantasyPool(lg: League): Player[] {
  return Object.values(lg.players).filter(p => !p.tid && !p.retired && !(p as any).stash);
}

/**
 * How a front office rates a player in a fantasy draft: exactly as the trade market will rate him once the
 * season starts (impact and overall, age, a young player's upside, on the market-value contract he signs after
 * the draft) – so a player is not worth more on draft day than in a trade a week later.
 */
export function fantasyValue(lg: League, p: Player) {
  const S = lg.season, age = ageIn(p, S);
  const years = age <= 29 ? 3 : age <= 32 ? 2 : 1;
  const c = p.contract;
  p.contract = { sal: askingSalary(p, S), exp: S - 1 + years };
  const v = marketPlayerValue(lg, p);
  p.contract = c;
  return v;
}

function aiChoice(lg: League, tid: string): Player {
  const rng = rngOf(lg);
  const t = lg.teams[tid];
  const roster = t.roster.map(pid => lg.players[pid]);
  const bigs = roster.filter(p => posNum(p.pos) >= 4).length;
  const guards = roster.filter(p => posNum(p.pos) <= 2).length;
  let best: Player | null = null, bestV = -1e9;
  for (const p of fantasyPool(lg)) {
    let v = fantasyValue(lg, p);
    const pn = posNum(p.pos), m = Math.abs(v);
    if (roster.length >= 3) {
      if (pn >= 4 && bigs < 2) v += 0.15 * m;
      if (pn <= 2 && guards < 2) v += 0.15 * m;
      if (pn >= 4 && bigs >= 5) v -= 0.2 * m;
      if (pn <= 2 && guards >= 5) v -= 0.2 * m;
    }
    v += rng.normal() * (1.2 - t.gm.scouting) * 0.6;
    if (v > bestV) { bestV = v; best = p; }
  }
  lg.rng = [...rng.s] as any;
  return best!;
}

function take(lg: League, tid: string, p: Player) {
  const on = fantasyOnClock(lg)!;
  p.tid = tid;
  lg.teams[tid].roster.push(p.id);
  lg.fantasy!.picks.push({ round: on.round, pick: on.pick, tid, pid: p.id });
  addTx(p, lg.season, `Fantasy draft: No. ${on.pick} (round ${on.round}), ${lg.teams[tid].name}`, -3);
}

/** The user's pick. Returns false when it is not the user's turn or the player is taken. */
export function fantasyUserPick(lg: League, pid: string) {
  const on = fantasyOnClock(lg);
  const p = lg.players[pid];
  if (!on || on.tid !== lg.userTid || !p || p.tid) return false;
  take(lg, on.tid, p);
  return true;
}

/** One AI pick (not when the user is on the clock). Returns whether a pick was made. */
export function fantasyStep(lg: League) {
  const on = fantasyOnClock(lg);
  if (!on || isHuman(lg, on.tid)) { if (on) lg.userTid = on.tid; return false; }
  take(lg, on.tid, aiChoice(lg, on.tid));
  if (!fantasyOnClock(lg)) fantasyFinish(lg);
  return true;
}

/** AI picks until it is the user's turn (or everything is done when `all`). */
export function fantasyAdvance(lg: League, all = false) {
  let on = fantasyOnClock(lg);
  while (on && (all || !isHuman(lg, on.tid))) {
    take(lg, on.tid, aiChoice(lg, on.tid));
    on = fantasyOnClock(lg);
  }
  if (on && !all) lg.userTid = on.tid; // hot seat: the controls go to whoever is on the clock
  if (!on) fantasyFinish(lg);
}

export function fantasyFinish(lg: League) {
  const f = lg.fantasy!;
  if (f.done) return;
  f.done = true;
  const rng = rngOf(lg);
  // new contracts for drafted players; the rest become free agents
  for (const p of Object.values(lg.players)) {
    if (p.tid) p.contract = { sal: askingSalary(p, lg.season), exp: lg.season - 1 + Math.max(1, contractYears(p, lg.season, () => rng.next())) };
    else p.contract = { sal: MIN_SAL, exp: lg.season };
  }
  lg.rng = [...rng.s] as any;
  const first = lg.players[f.picks[0].pid];
  lg.news.push({ s: lg.season, t: `Fantasy draft complete. First pick: ${tagOf(first, lg.season)}, ${lg.teams[f.picks[0].tid].abbr}.` });
  beginFirstSeason(lg);
  // fresh contracts after a fantasy draft can't all fit: one season's grace, then everyone must be under the hard cap
  lg.capGrace = lg.season;
  lg.news.push({ s: lg.season, t: `The ${lg.season - 1}–${String(lg.season).slice(2)} season begins. Destiny slider: ${Math.round(lg.destiny * 100)}%.` });
  const hc = hardCap(lg), over = Object.values(lg.teams).filter(t => t.active && payroll(lg, t.tid) > hc + 1e-9);
  if (hc < Infinity && over.length) lg.news.push({ s: lg.season, t: `Cap exception for the first season: ${over.length} team${over.length > 1 ? 's are' : ' is'} over the hard cap (${Math.round(hc * 100)}% of the cap) after the fantasy draft${over.some(t => t.tid === lg.userTid) ? ', yours included' : ''}. That is allowed this season, but by the start of next season every team must be under it – whoever still is over then releases his worst contracts.` });
}
export { ageIn };
