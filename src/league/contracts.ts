// Contract rules by era: rookie scale with team options, player and team
// options on veteran deals, restricted free agency (qualifying offers and the
// right to match offer sheets).
import { Rng } from '../rng';
import { Contract, League, Player } from '../types';
import { ageIn } from '../players';
import { MIN_SAL, askingSalary, playerValue, peakBpm } from '../ai/value';

export function rules(N: number) {
  return {
    /** before the 1988 agreement every free agent's team had a right of first refusal */
    rfaAll: N < 1989,
    /** 1999 agreement: first-round rookies get 2 guaranteed years + team options for years 3 and 4 */
    rookieOptions: N >= 2000,
    /** option years on veteran contracts */
    vetOptions: N >= 1990,
  };
}

export function rookieContract(pick: number, round: number, Y: number): Contract {
  const N = Y + 1;
  if (round === 1) {
    const sal = Math.max(MIN_SAL, 0.075 * Math.exp(-(pick - 1) / 11));
    if (rules(N).rookieOptions) return { sal, exp: N + 3, opts: [{ s: N + 2, k: 'team' }, { s: N + 3, k: 'team' }], rookie: true };
    return { sal, exp: N + 2, rookie: true };
  }
  return { sal: MIN_SAL, exp: N + 1, rookie: true };
}

/** A veteran contract of `years` seasons from season N, sometimes with an option on the last year. */
export function vetContract(p: Player, N: number, sal: number, years: number, rng: Rng): Contract {
  const c: Contract = { sal, exp: N - 1 + years };
  if (!rules(N).vetOptions || years < 2) return c;
  const age = ageIn(p, N);
  if (years >= 3 && rng.chance(sal > 0.12 ? 0.4 : 0.15)) c.opts = [{ s: c.exp, k: 'player' }];
  else if (age >= 30 && rng.chance(0.18)) c.opts = [{ s: c.exp, k: 'team' }];
  return c;
}

/** Restricted when his first contract ends (or always, before 1989), unless his option was declined. */
export function rfaEligible(p: Player, N: number, lg?: League) {
  if (p.noRfa) return false;
  return (!!lg?.settings?.rfaHistoric && rules(N).rfaAll) || !!p.contract.rookie;
}
export const qoAmount = (p: Player) => Math.max(MIN_SAL * 1.2, p.contract.sal * 1.25);

/**
 * Newly signed players can't be traded right away (NBA: until mid-December,
 * or about three months after an in-season signing): s = season, f = share of
 * its regular season that has to pass first.
 */
const dayCache = new WeakMap<object, number>();
function seasonDays(lg: League) {
  if (!lg.schedule.length) return 170;
  let d = dayCache.get(lg.schedule);
  if (d === undefined) { d = Math.max(...lg.schedule.map(g => g.day)) + 1; dayCache.set(lg.schedule, d); }
  return d;
}
export function lockTrade(lg: League, p: Player) {
  if (lg.phase === 'regular') {
    const days = seasonDays(lg);
    p.tradeLock = { s: lg.season, f: Math.min(1, lg.day / days + 0.3) };
  } else p.tradeLock = { s: lg.season, f: 0.3 };
}
/** Can this player be traded now? The user's own players are exempt. */
export function tradeLocked(lg: League, p: Player) {
  const l = p.tradeLock;
  if (!l || p.tid === lg.userTid) return false;
  if (lg.season > l.s) return false;
  if (lg.phase !== 'regular') return true;
  return lg.day / seasonDays(lg) < l.f;
}
export function lockLabel(lg: League, p: Player) {
  const l = p.tradeLock!;
  const days = lg.season === l.s && lg.phase === 'regular' ? seasonDays(lg) : 170;
  return l.f >= 1 ? 'the end of the season' : `day ${Math.ceil(l.f * days) + 1} of the season`;
}

/** Short label for a contract's options, e.g. "TO 2004" (team option), "PO 2006" (player option). */
export function optLabel(c: Contract) {
  return (c.opts ?? []).map(o => `${o.k === 'team' ? 'TO' : 'PO'} ${o.s}`).join(', ');
}

/** GM's view: keep him at this salary? */
export function worthKeeping(lg: League, p: Player, sal: number, N: number, strategy: 'contend' | 'middle' | 'rebuild') {
  const ask = askingSalary(p, N);
  const young = ageIn(p, N) <= 24 && peakBpm(p, N) > 0;
  return ask >= sal * 0.8 || young || playerValue(p, N, strategy) / Math.max(MIN_SAL, sal) > 11;
}

/** Player's view of his option: opt out when the market pays clearly more. */
export function optsOut(p: Player, N: number) {
  return ageIn(p, N) < 34 && askingSalary(p, N) > p.contract.sal * 1.15;
}
