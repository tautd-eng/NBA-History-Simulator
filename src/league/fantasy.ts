// Fantasy draft: every player of the starting season's league goes into one pool and the
// teams build new rosters in a snake draft. AI teams pick by value and need.
import { League, Player } from '../types';
import { rngOf, beginFirstSeason } from './league';
import { valueFromZ, askingSalary, contractYears, MIN_SAL, hardCap, payroll } from '../ai/value';
import { K, OVR_VOLUME } from '../data';
import { hiddenBoost } from '../hboost';
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
 * How a front office rates a player in a fantasy draft: what he gives a team over the next years (age and the
 * aging curve included), about a third by impact and two thirds by the overall rating (scoring load counts there), plus the
 * upside scouts see in a young player – the higher he was drafted, the more of it.
 */
export function fantasyValue(p: Player, season: number) {
  const age = ageIn(p, season), hb = hiddenBoost(p.id);
  const pick = p.draft?.pick || 61;
  const ped = pick <= 3 ? 1.2 : pick <= 10 ? 0.9 : pick <= 20 ? 0.6 : pick <= 30 ? 0.4 : 0.2;
  const upside = age <= 23 ? (24 - age) * 0.3 * ped : 0;
  const impact = valueFromZ(p.z, age, 'middle', hb + upside);
  const overall = valueFromZ(p.z, age, 'middle', hb + upside + OVR_VOLUME * p.z[K.usg]);
  return 0.35 * impact + 0.65 * overall;
}

function aiChoice(lg: League, tid: string): Player {
  const rng = rngOf(lg);
  const t = lg.teams[tid];
  const roster = t.roster.map(pid => lg.players[pid]);
  const bigs = roster.filter(p => posNum(p.pos) >= 4).length;
  const guards = roster.filter(p => posNum(p.pos) <= 2).length;
  let best: Player | null = null, bestV = -1e9;
  for (const p of fantasyPool(lg)) {
    let v = fantasyValue(p, lg.season);
    const pn = posNum(p.pos);
    if (roster.length >= 3) {
      if (pn >= 4 && bigs < 2) v *= 1.15;
      if (pn <= 2 && guards < 2) v *= 1.15;
      if (pn >= 4 && bigs >= 5) v *= 0.8;
      if (pn <= 2 && guards >= 5) v *= 0.8;
    }
    v += rng.normal() * (1.2 - t.gm.scouting) * 2;
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
  if (!on || on.tid === lg.userTid) return false;
  take(lg, on.tid, aiChoice(lg, on.tid));
  if (!fantasyOnClock(lg)) fantasyFinish(lg);
  return true;
}

/** AI picks until it is the user's turn (or everything is done when `all`). */
export function fantasyAdvance(lg: League, all = false) {
  let on = fantasyOnClock(lg);
  while (on && (all || on.tid !== lg.userTid)) {
    take(lg, on.tid, aiChoice(lg, on.tid));
    on = fantasyOnClock(lg);
  }
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
