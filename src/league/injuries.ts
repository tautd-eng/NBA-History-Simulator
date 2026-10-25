// Injuries, modelled on NBA injury studies (Drakos et al. 2010, 17 seasons:
// ~19 game injuries per 1000 player-games, half of all injuries outside games,
// lateral ankle sprains the most common, lower extremity ~70% of games lost,
// ~120 player-games lost per team per season; rate not tied to age, but
// recovery slows and Achilles ruptures cluster after 30).
//
// Injuries happen during games (the player leaves the floor at that moment)
// or between games (practice, illness). Their length is in calendar days, so
// rest days heal and long injuries can run into next season. Severe injuries
// (ACL, Achilles, meniscus, fractures) leave a mark on the physical skills,
// and every player has a hidden injury proneness that grows with serious injuries.
import { K } from '../data';
import { Rng, hash01 } from '../rng';
import { League, Player } from '../types';
import { ageIn, tagOf } from '../players';
import { shownOvr } from '../data';

export interface InjType {
  k: string; name: string; share: number;
  med: number; sd: number;            // games missed: lognormal median and spread (before age)
  lasting?: number;                    // permanent loss on physical skills (z), scaled by age
  age?: (a: number) => number;         // relative likelihood by age
}

export const INJ_TYPES: InjType[] = [
  { k: 'ankle', name: 'ankle sprain', share: 0.22, med: 3, sd: 0.7 },
  { k: 'patella', name: 'patellar tendinitis', share: 0.11, med: 4, sd: 0.9, age: a => (a >= 30 ? 1.3 : 1) },
  { k: 'back', name: 'back strain', share: 0.10, med: 3, sd: 0.8, age: a => (a >= 30 ? 1.3 : 1) },
  { k: 'hamstring', name: 'hamstring strain', share: 0.07, med: 4, sd: 0.7 },
  { k: 'groin', name: 'groin strain', share: 0.06, med: 3, sd: 0.7 },
  { k: 'knee', name: 'knee sprain', share: 0.06, med: 8, sd: 0.8 },
  { k: 'bruise', name: 'contusion', share: 0.10, med: 1.5, sd: 0.6 },
  { k: 'concussion', name: 'concussion', share: 0.03, med: 3, sd: 0.5 },
  { k: 'upper', name: 'shoulder or hand injury', share: 0.06, med: 4, sd: 0.9 },
  { k: 'foot', name: 'plantar fasciitis', share: 0.05, med: 5, sd: 0.9, age: a => (a >= 30 ? 1.3 : 1) },
  { k: 'illness', name: 'illness', share: 0.04, med: 1.5, sd: 0.5 },
  { k: 'fracture', name: 'fracture', share: 0.06, med: 18, sd: 0.6 },
  { k: 'meniscus', name: 'torn meniscus', share: 0.03, med: 20, sd: 0.5, lasting: 0.1 },
  { k: 'acl', name: 'torn ACL', share: 0.008, med: 65, sd: 0.15, lasting: 0.25, age: a => (a <= 26 ? 1.2 : 0.9) },
  { k: 'achilles', name: 'torn Achilles', share: 0.005, med: 75, sd: 0.15, lasting: 0.45, age: a => (a >= 30 ? 2.5 : 0.6) },
];
export const injName = (k: string) => INJ_TYPES.find(t => t.k === k)?.name ?? 'injury';

export const INJ = {
  game: 0.0185,       // per game at 30 minutes (time-loss injuries during games)
  day: 0.0024,        // per player per calendar day outside games (practice, illness)
  daysPerGame: 2,     // calendar days per missed game in the regular season
  summer: 150,        // calendar days between the finals and the next season
};

/** Hidden injury proneness: individual (0.6–1.7×) and higher after serious injuries. */
export function proneness(p: Player) {
  const base = Math.exp((hash01(p.id + 'inj') - 0.5) * 0.9);
  const serious = (p.injHist ?? []).filter(h => h.g >= 15).length;
  return base * Math.min(1.6, 1 + 0.12 * serious);
}

function pickType(rng: Rng, age: number): InjType {
  const w = INJ_TYPES.map(t => t.share * (t.age ? t.age(age) : 1));
  return INJ_TYPES[rng.weighted(w)];
}
/**
 * Season length relative to 82 games. Durations are real time, so in a
 * shorter season the same injury costs proportionally fewer games (an
 * Achilles rupture still means "the rest of this season", not three seasons).
 */
export function seasonScale(lg: League) {
  const n = Object.values(lg.teams).filter(t => t.active).length || 1;
  const G = lg.schedule.length ? (lg.schedule.length * 2) / n : 82;
  return Math.max(0.25, Math.min(1.5, G / 82));
}
function gamesOut(rng: Rng, t: InjType, age: number, scale: number) {
  const g = t.med * Math.exp(t.sd * rng.normal()) * (1 + Math.max(0, age - 30) * 0.03) * scale;
  return Math.max(1, Math.round(g));
}

/** Before a game: may this player get hurt during it, and after how many of his minutes? */
export function rollGameInjury(lg: League, p: Player, rng: Rng, fatigueExcess: number) {
  delete p.injAt;
  const gp = p.cur.gp + p.curPo.gp;
  const expMin = gp ? (p.cur.min + p.curPo.min) / gp : 18;
  if (expMin < 1) return;
  const chance = INJ.game * Math.pow(expMin / 30, 0.8) * proneness(p) * (1 + fatigueExcess / 25);
  if (rng.chance(chance)) p.injAt = Math.max(0.5, expMin * (0.05 + 0.95 * rng.next()));
}

/** Calendar day for injury bookkeeping (same calendar as fatigue). */
export function injure(lg: League, p: Player, cal: number, rng: Rng, where: 'game' | 'off') {
  const age = ageIn(p, lg.season);
  const t = pickType(rng, age);
  const g = gamesOut(rng, t, age, seasonScale(lg));
  const days = g * INJ.daysPerGame;
  p.inj = { k: t.k, until: cal + days };
  p.injury = g;
  (p.injHist ??= []).push({ s: lg.season, k: t.k, g, w: where });
  if (p.injHist.length > 40) p.injHist.shift();
  // severe injuries leave a mark on the legs (less for young players)
  if (t.lasting) {
    const f = t.lasting * (age <= 24 ? 0.6 : age <= 29 ? 1 : 1.4);
    for (const k of [K.orb, K.drb, K.stl, K.blk, K.def, K.drw]) p.z[k] -= f;
    p.z[K.ins] -= f * 0.4;
    p.injHist[p.injHist.length - 1].lasting = true;
  }
  // news for notable players and anything serious on the user's team
  const seasonEnd = lastRegCal(lg) - cal < days && lg.phase === 'regular';
  const team = p.tid ? lg.teams[p.tid] : null;
  if (team && (g >= 10 && (shownOvr(p.z) >= 78 || p.tid === lg.userTid) || (p.tid === lg.userTid && g >= 4))) {
    lg.news.push({ s: lg.season, t: `${tagOf(p, lg.season)}, ${team.abbr}: ${t.name}${where === 'off' ? ' (away from games)' : ''} – ${t.k === 'acl' || t.k === 'achilles' || seasonEnd ? 'out for the season' : `out ~${g} games`}.` });
  }
}

function lastRegCal(lg: League) { return lg.schedule.length ? Math.max(...lg.schedule.map(g => g.day)) : 0; }

/** Bring every player's "games out" up to date for calendar day `cal`. */
export function refreshInjuries(lg: League, cal: number, players: Player[] = Object.values(lg.players)) {
  for (const p of players) {
    if (!p.inj) { if (p.injury > 0 && !p.retired) p.injury = 0; continue; }
    const left = p.inj.until - cal;
    if (left <= 0) { delete p.inj; p.injury = 0; }
    else p.injury = Math.max(1, Math.ceil(left / INJ.daysPerGame));
  }
}

/** Injuries away from games (practice, illness) for the days since the last check. */
export function offDayInjuries(lg: League, cal: number, rng: Rng) {
  const last = lg.injCal ?? cal;
  const days = Math.max(0, cal - last);
  lg.injCal = cal;
  if (!days) return;
  for (const t of Object.values(lg.teams)) {
    if (!t.active) continue;
    for (const pid of t.roster) {
      const p = lg.players[pid];
      if (p.inj) continue;
      const ch = 1 - Math.pow(1 - INJ.day * proneness(p), days);
      if (rng.chance(ch)) injure(lg, p, last + 1 + Math.floor(rng.next() * days), rng, 'off');
    }
  }
  refreshInjuries(lg, cal);
}

/** Summer: injuries keep healing; only long ones reach into the next season. */
export function carryInjuries(lg: League, endCal: number) {
  for (const p of Object.values(lg.players)) {
    if (!p.inj) { p.injury = 0; continue; }
    const left = p.inj.until - endCal - INJ.summer * seasonScale(lg);
    if (left > 0) { p.inj.until = left; p.injury = Math.ceil(left / INJ.daysPerGame); }
    else { delete p.inj; p.injury = 0; }
  }
  lg.injCal = 0;
}
