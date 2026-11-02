// Trades. Every GM values a deal with the same model it uses everywhere else
// (player value by strategy, draft picks by expected slot), looks at the whole
// roster rather than single players (two decent players do not equal one star),
// pays attention to money, and only agrees when the deal helps its own team.
import { tradeLocked, lockLabel } from '../league/contracts';
import { H, seasonInfo, LAST_SEASON, ovrOf, bpmOf } from '../data';
import { Rng, hash01 } from '../rng';
import { League, Player, Team, Pick, TradeAsset, TradeRec, PickRight } from '../types';
import { rosterFit, GMFIT } from '../archetypes';
import { playerValue, valueFromZ, payroll, teamStrength, MIN_SAL, hardCap, askingSalary, peakBpm, projectBpm, releaseDead, deadPay } from './value';
import { playerParts, moneyWeight, prospectValue, tradeValue, horizonOf, Horizon, slotPeak } from './tradevalue';
import { posNum } from '../engine/game';
import { bucket, tagOf, ageIn } from '../players';
import { shownOvr } from '../data';

export const ROSTER_MIN = 13, ROSTER_MAX = 15;

/** Unsigned, active and available to sign (not on the draft board, not stashed abroad, not held in a re-signing window). */
export function isFreeAgent(lg: League, p: Player) {
  if (p.tid || p.retired || p.prospect || (p as any).stash) return false;
  const fa = lg.fa;
  if (!fa || lg.phase !== 'freeagency') return true;
  if (fa.stage <= 1 && fa.pending.includes(p.id)) return false;            // exclusive re-signing window
  if (fa.stage === 0 && fa.decisions?.some(d => d.pid === p.id)) return false; // waiting for the user's decision
  if (fa.sheets?.some(x => x.pid === p.id)) return false;                    // offer sheet waiting for match
  return true;
}
const DEPTH_W = [1, 1, 1, 1, 0.95, 0.85, 0.75, 0.6, 0.45, 0.32, 0.2, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01];

// ------------------------------------------------------------------ picks
export function ensurePicks(lg: League) {
  if (!lg.picks) lg.picks = [];
  const first = lg.phase === 'regular' || lg.phase === 'playoffs' || lg.phase === 'draft' || lg.phase === 'freeagency' ? lg.season : lg.season + 1;
  // drafts go on past the real data (future classes), so there are always three years of picks
  for (let y = first; y <= first + 2; y++) {
    for (const t of Object.values(lg.teams)) {
      if (!t.active) continue;
      for (const round of [1, 2]) {
        if (!lg.picks.some(p => p.season === y && p.round === round && p.orig === t.tid)) {
          lg.picks.push({ season: y, round, orig: t.tid, owner: t.tid });
        }
      }
    }
  }
  lg.picks = lg.picks.filter(p => p.season >= first);
}

/**
 * The Stepien rule (1980, after Cleveland owner Ted Stepien traded away first-rounder after first-rounder):
 * a team may not be left without a first-round pick in two consecutive future drafts.
 */
function stepien(lg: League, a: string, b: string, aGets: TradeAsset[], bGets: TradeAsset[]): string | null {
  const d = lg.draftDay;
  // the draft under way (or just held) is not a future draft
  const firstFuture = d && d.year === lg.season ? lg.season + 1 : lg.season;
  const firsts = (lg.picks ?? []).filter(pk => pk.round === 1 && pk.season >= firstFuture);
  const years = [...new Set(firsts.map(pk => pk.season))].sort((x, y) => x - y);
  for (const [tid, gets, gives] of [[a, aGets, bGets], [b, bGets, aGets]] as const) {
    if (!gives.some(x => x.pick?.round === 1 && x.pick.season >= firstFuture)) continue;   // only a team giving firsts away can break it
    const key = (pk: { season: number; round: number; orig: string }) => `${pk.season}-${pk.round}-${pk.orig}`;
    const out = new Set(gives.filter(x => x.pick).map(x => key(x.pick!)));
    const owns = (y: number) => firsts.some(pk => pk.season === y && pk.owner === tid && !out.has(key(pk))) || gets.some(x => x.pick?.round === 1 && x.pick.season === y);
    for (let i = 0; i + 1 < years.length; i++) {
      if (!owns(years[i]) && !owns(years[i + 1])) return `${lg.teams[tid].name} would have no first-round pick in both ${years[i]} and ${years[i + 1]} (Stepien rule: never two consecutive future drafts without a first).`;
    }
  }
  return null;
}

const owner = (lg: League, season: number, round: number, orig: string) => (lg.picks ?? []).find(p => p.season === season && p.round === round && p.orig === orig)?.owner;
/**
 * A player a team has just traded for is not shopped again right away: AI GMs leave him alone for about
 * a month in the season, and for the rest of the same summer.
 */
export function justTraded(lg: League, p: Player) {
  const a = (p as any).acq as { s: number; ph: string; day: number } | undefined;
  if (!a) return false;
  if (lg.phase === 'regular' && a.ph === 'regular' && a.s === lg.season) return lg.day - a.day < 30;
  if ((lg.phase === 'freeagency' || lg.phase === 'draft') && (a.ph === 'freeagency' || a.ph === 'draft') && a.s === lg.season) return true;
  return false;
}
/** Did this team trade him away this season? (nobody buys back the player it just sold) */
export function soldBy(lg: League, p: Player, tid: string) {
  const a = (p as any).acq;
  return !!a && a.from === tid && a.s === lg.season;
}
/** Is a pick tied up in an outstanding swap / less-favourable right? */
export function pickTied(lg: League, pk: { season: number; round: number; orig: string }) {
  return (lg.pickRights ?? []).some(r => r.season === pk.season && r.round === pk.round && (r.a === pk.orig || r.b === pk.orig));
}
function rightRules(lg: League, a: string, b: string, aGets: TradeAsset[], bGets: TradeAsset[]): string | null {
  const refs = [...aGets, ...bGets].filter(x => x.right).flatMap(x => [x.right!.season + '-' + x.right!.round + '-' + x.right!.a, x.right!.season + '-' + x.right!.round + '-' + x.right!.b]);
  if (new Set(refs).size < refs.length) return 'Two rights in one trade cannot involve the same pick.';
  for (const x of [...aGets, ...bGets]) if (x.pick && pickTied(lg, x.pick)) return `The ${x.pick.season} ${x.pick.round === 1 ? '1st' : '2nd'}-round pick (${lg.teams[x.pick.orig]?.abbr ?? x.pick.orig}) is tied up in a swap right until that draft.`;
  for (const [recv, giver, gets] of [[a, b, aGets], [b, a, bGets]] as const) {
    for (const x of gets) {
      const r = x.right; if (!r) continue;
      if (pickUsed(lg, { season: r.season, round: r.round, orig: r.a }) || (lg.draftDay?.year === r.season && (lg.draftDay.stage ?? 'draft') === 'draft')) return 'Pick rights can only be traded for drafts whose order is not set yet.';
      if (pickTied(lg, { season: r.season, round: r.round, orig: r.a }) || pickTied(lg, { season: r.season, round: r.round, orig: r.b })) return 'One of those picks is already tied up in a swap right.';
      if (r.kind === 'swap' && (owner(lg, r.season, r.round, r.a) !== recv || owner(lg, r.season, r.round, r.b) !== giver)) return 'A swap right needs each team to own one of the two picks.';
      if (r.kind === 'worse' && (owner(lg, r.season, r.round, r.a) !== giver || owner(lg, r.season, r.round, r.b) !== giver || r.a === r.b)) return 'The less favourable of two picks: the giving team must own both.';
      // the picks involved cannot move in the same trade
      if ([...aGets, ...bGets].some(y => y.pick && y.pick.season === r.season && y.pick.round === r.round && (y.pick.orig === r.a || y.pick.orig === r.b))) return 'A pick cannot be traded together with a right on it.';
    }
  }
  return null;
}

/** Pick rights the giver could offer the receiver: swaps of their firsts, or the less favourable of two firsts the giver holds. */
export function rightOptions(lg: League, giver: string, receiver: string): PickRight[] {
  const d = lg.draftDay;
  const firstFuture = d && d.year === lg.season ? lg.season + 1 : lg.season;
  const free = (lg.picks ?? []).filter(p => p.round === 1 && p.season >= firstFuture && !pickUsed(lg, p) && !pickTied(lg, p));
  const out: PickRight[] = [];
  for (const s of [...new Set(free.map(p => p.season))].sort()) {
    const mine = free.filter(p => p.season === s && p.owner === giver).sort((x, y) => (x.orig === giver ? -1 : 0) - (y.orig === giver ? -1 : 0));
    const theirs = free.filter(p => p.season === s && p.owner === receiver).sort((x, y) => (x.orig === receiver ? -1 : 0) - (y.orig === receiver ? -1 : 0));
    if (mine.length && theirs.length) out.push({ kind: 'swap', season: s, round: 1, a: theirs[0].orig, b: mine[0].orig });
    if (mine.length >= 2) out.push({ kind: 'worse', season: s, round: 1, a: mine[0].orig, b: mine[1].orig });
  }
  return out;
}

/** After the lottery the order is set: swap rights and less-favourable conveyances are settled. */
export function settlePickRights(lg: League, Y: number) {
  const d = lg.draftDay;
  if (!d || d.year !== Y || !lg.pickRights?.length) return;
  const slot = (round: number, orig: string) => d.order.findIndex(o => o.round === round && o.orig === orig);
  const keep: NonNullable<League['pickRights']> = [];
  for (const r of lg.pickRights) {
    if (r.season !== Y) { keep.push(r); continue; }
    const pa = (lg.picks ?? []).find(p => p.season === Y && p.round === r.round && p.orig === r.a);
    const pb = (lg.picks ?? []).find(p => p.season === Y && p.round === r.round && p.orig === r.b);
    const sa = slot(r.round, r.a), sb = slot(r.round, r.b);
    if (!pa || !pb || sa < 0 || sb < 0) continue;
    const H = lg.teams[r.holder], F = lg.teams[r.from];
    if (r.kind === 'swap') {
      if (pa.owner === r.holder && pb.owner === r.from && sb < sa) {
        pa.owner = r.from; pb.owner = r.holder;
        lg.news.push({ s: Y, t: `${H.name} exercise their swap right: they pick No. ${sb + 1} instead of No. ${sa + 1}; ${F.name} drop to No. ${sa + 1}.` });
      } else lg.news.push({ s: Y, t: `${H.name} keep their own pick – the swap right with ${F.name} is not worth exercising.` });
    } else {
      const worse = sa > sb ? pa : pb;
      if (worse.owner === r.from) { worse.owner = r.holder; lg.news.push({ s: Y, t: `${H.name} receive the less favourable of the ${F.name}' two first-rounders: No. ${Math.max(sa, sb) + 1}.` }); }
    }
  }
  lg.pickRights = keep;
}

/** A pick of the draft under way that has already been made (or any of a finished draft). */
export function pickUsed(lg: League, pk: { season: number; round: number; orig: string }) {
  const d = lg.draftDay;
  if (!d || d.year !== pk.season) return false;
  if (d.done) return true;
  const i = d.order.findIndex(o => o.round === pk.round && o.orig === pk.orig);
  return i >= 0 && i < d.idx;
}

export function pickOwner(lg: League, season: number, round: number, orig: string) {
  return lg.picks?.find(p => p.season === season && p.round === round && p.orig === orig)?.owner ?? orig;
}

// Values are cached for the current day (ratings only change in the off-season).
let stamp = '';
const vCache = new Map<string, number>();
let rankCache: { t: string; s: number }[] | null = null;
function fresh(lg: League) {
  const st = `${lg.seed}|${lg.season}|${lg.phase}|${lg.day}|${lg.trades?.length ?? 0}|${lg.fa?.stage ?? 0}|${lg.fa?.log.length ?? 0}`;
  if (st !== stamp) { stamp = st; vCache.clear(); pCache.clear(); rankCache = null; }
}
const pCache = new Map<string, { prod: number; cost: number }>();
function parts(lg: League, p: Player, strategy: Horizon) {
  const k = p.id + strategy;
  let v = pCache.get(k);
  if (!v) { v = playerParts(lg, p, strategy); pCache.set(k, v); }
  return v;
}
/** Net value of a player to a team: production minus salary cost weighted by how much the team minds money. */
function pv(lg: League, p: Player, strategy: Horizon, tid?: string) {
  const k = p.id + strategy + (tid ?? '');
  let v = vCache.get(k);
  if (v === undefined) { const x = parts(lg, p, strategy); v = x.prod - (tid ? moneyWeight(lg, tid) : 0.45) * x.cost; vCache.set(k, v); }
  return v;
}

const PV: Record<string, number> = {};
const UPSIDE = [1.7, 1.45, 1.25, 1.1, 1.0, 1.0, 1.0];
/** Value of an average prospect at a draft slot, for a given strategy. */
function slotValue(slot: number, strategy: Team['strategy']) {
  const key = `${bucket(slot)}${strategy}`;
  if (PV[key] === undefined) PV[key] = valueFromZ(H.draftPrior[bucket(slot)].z, 21, strategy) * H.draftPrior[bucket(slot)].play * UPSIDE[bucket(slot)];
  return PV[key];
}

/** Expected slot of a pick from the original team's current strength. */
function expectedSlot(lg: League, p: { season: number; round: number; orig: string }) {
  // during the draft the slot is known
  const d = lg.draftDay;
  if (d && !d.done && d.year === p.season && d.order.length) {
    const i = d.order.findIndex(o => o.round === p.round && o.orig === p.orig);
    if (i >= 0) return i + 1;
  }
  fresh(lg);
  const ranked = rankCache ??= Object.values(lg.teams).filter(t => t.active).map(t => ({ t: t.tid, s: teamStrength(lg, t.tid) })).sort((a, b) => a.s - b.s);
  const n = ranked.length;
  const idx = Math.max(0, ranked.findIndex(r => r.t === p.orig));
  // further away = more uncertain, pull toward the middle
  const years = Math.max(0, p.season - lg.season);
  const mid = (n + 1) / 2;
  const slot = (idx + 1) + (mid - (idx + 1)) * Math.min(0.8, 0.35 * years);
  return slot + (p.round - 1) * n;
}

/** Value of a package to a neutral, middle-of-the-pack GM (the "market" view used to sanity-check deals). */
export function neutralValue(lg: League, xs: TradeAsset[]) {
  let v = 0;
  for (const x of xs) v += x.pid ? Math.max(0, pv(lg, lg.players[x.pid], 'middle')) : x.right ? rightValue(lg, x.right, 'middle', 0.45) : pickValue(lg, x.pick!, 'middle', 0.45);
  return v;
}
/**
 * Value of a pick right. Both picks are uncertain (more so further out), so a swap is an option:
 * E[max(0, B - A)]; the less favourable of two is E[min(A, B)].
 */
export function rightValue(lg: League, r: PickRight, h: Horizon, moneyW: number) {
  const pa = pickValue(lg, { season: r.season, round: r.round, orig: r.a }, h, moneyW);
  const pb = pickValue(lg, { season: r.season, round: r.round, orig: r.b }, h, moneyW);
  const years = Math.max(0, r.season - lg.season);
  const unc = Math.max(0.05, (0.25 + 0.12 * years) * (pa + pb) / 2);
  const d = pb - pa, z = d / unc;
  const phi = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI), Phi = 0.5 * (1 + erf(z / Math.SQRT2));
  const eMaxPos = unc * phi + d * Phi;                    // E[max(0, B - A)]
  if (r.kind === 'swap') return eMaxPos;
  return pb - eMaxPos;                                    // E[min(A, B)] = B - E[max(0, B - A)]
}
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export function pickValue(lg: League, p: { season: number; round: number; orig: string }, strategy: Horizon, moneyW = 0.45, t?: Team) {
  if (t) { const w = draftPickWorth(lg, p, t, strategy, moneyW); if (w !== null) return w; }
  const years = Math.max(0, p.season - lg.season);
  const slot = Math.max(1, Math.round(expectedSlot(lg, p)));
  // future picks: further away, less certain, and not helping now
  const base = prospectValue(slot, strategy, moneyW) * Math.pow(0.9, years);
  return Math.max(0.05, base + classAdj(lg, p.season, slot, base));
}

const classCache = new Map<string, number[]>();
/**
 * This season's draft class is public: a deep class makes this year's picks worth more, a thin one less.
 * The prospect the consensus would take around that slot against what such a slot usually brings.
 */
function classAdj(lg: League, season: number, slot: number, base: number) {
  const c = lg.draftClass;
  if (!c || c.year !== season) return 0;
  const key = c.year + '|' + c.pool.length + '|' + lg.season;
  let peaks = classCache.get(key);
  if (!peaks) {
    peaks = c.pool.map(id => lg.players[id]).filter(p => p?.prospect).sort((a, b) => a.draft!.realPick - b.draft!.realPick)
      .map(p => Math.max(...projectBpm(p.z, ageIn(p, c.year + 1), 5)));
    classCache.clear(); classCache.set(key, peaks);
  }
  if (!peaks.length) return 0;
  // the exact slot is not known yet: average a few around it
  let d = 0, n = 0;
  for (let s = Math.max(1, slot - 2); s <= slot + 2; s++) { const k = Math.min(peaks.length - 1, s - 1); d += peaks[k] - slotPeak(s); n++; }
  const adj = 0.8 * d / n;
  return Math.max(-0.5 * base, Math.min(0.5 * base, adj));
}

// ------------------------------------------------------------------ valuation
interface Side { players: Player[]; picks: Pick[]; rights?: (PickRight & { role: 'holder' | 'giver' })[] }

/**
 * A roster's value to its team: production of its players in rotation order
 * (the 10th man adds little, so two good players are not one star), minus the
 * cost of all salaries, plus the picks it owns.
 */
function teamValue(lg: League, t: Team, side: Side, moneyW: number) {
  fresh(lg);
  const h = horizonOf(t);
  const ps = side.players.map(p => ({ p, ...parts(lg, p, h) }));
  ps.sort((a, b) => b.prod - a.prod);
  let v = 0;
  ps.forEach((x, i) => (v += x.prod * (DEPTH_W[i] ?? 0)));
  v -= moneyW * ps.reduce((a, x) => a + x.cost, 0);
  // above the hard cap the team must shed salary: every share of the cap over it weighs heavily
  const hc = hardCap(lg);
  if (hc < Infinity) {
    const pay = side.players.reduce((a, p) => a + p.contract.sal, 0) + deadPay(lg, t.tid);
    // (in the grace season after a fantasy draft being over is allowed: it only has to be fixed by next season,
    // so it weighs far less and nobody pays a fortune to shed salary right away)
    const g = lg.capGrace === lg.season ? 0.12 : 1;
    v -= g * (60 * Math.max(0, pay - hc) + 8 * Math.max(0, pay - (hc - 0.03)));
  }
  // a rotation needs ball handlers and big men: a missing piece costs (matters most to teams trying to win now)
  const top8 = ps.slice(0, 8);
  const guards = top8.filter(x => posNum(x.p.pos) <= 2.5).length, bigs = top8.filter(x => posNum(x.p.pos) >= 4).length;
  const missing = Math.max(0, 2 - guards) + Math.max(0, 2 - bigs);
  const fifth = ps[4]?.prod ?? 0;
  const needW = h === 'allin' ? 0.7 : h === 'contend' ? 0.5 : h === 'tank' ? 0.1 : 0.3;
  v -= missing * needW * fifth;
  // roles that fit together (shooters around a creator, a rim protector, answers on defence) beat a pile of the same pieces
  if (GMFIT.on) v += needW * 1.2 * fifth * rosterFit(ps.map(x => x.p).sort((a, b) => bpmOf(b.z) - bpmOf(a.z)));
  for (const pk of side.picks) v += pickValue(lg, pk, h, moneyW, t);
  for (const r of side.rights ?? []) v += (r.role === 'holder' ? 1 : -1) * rightValue(lg, r, h, moneyW);
  // tanking: a weaker roster this season moves the own pick up the lottery
  if (t.mode === 'tank') {
    const own = side.picks.find(pk => pk.orig === t.tid && pk.round === 1 && pk.season === lg.season && (lg.phase === 'regular' || lg.phase === 'freeagency'));
    if (own) {
      const strength = ps.slice(0, 8).reduce((a, x, i) => a + bpmOf(x.p.z) * [36, 34, 32, 30, 28, 24, 20, 16][i], 0) / 240 * 5;
      const others = Object.values(lg.teams).filter(x => x.active && x.tid !== t.tid).map(x => teamStrength(lg, x.tid));
      const slot = 1 + others.filter(s => s < strength).length;
      v += prospectValue(slot, h, moneyW) - pickValue(lg, own, h, moneyW);
    }
  }
  return v;
}

function sideOf(lg: League, tid: string): Side {
  return {
    players: lg.teams[tid].roster.map(pid => lg.players[pid]),
    picks: (lg.picks ?? []).filter(p => p.owner === tid && !pickUsed(lg, p)),
    rights: (lg.pickRights ?? []).filter(r => r.holder === tid || r.from === tid).map(r => ({ ...r, role: r.holder === tid ? 'holder' as const : 'giver' as const })),
  };
}

export interface TradeEval {
  ok: boolean;
  gainA: number; gainB: number;
  reason?: string;
}

const sal = (lg: League, ps: Player[]) => ps.reduce((a, p) => a + p.contract.sal, 0);

/** Rule check shared by AI and user trades. */
let faCache: { key: string; n: number } | null = null;
function freeAgentCount(lg: League) {
  const key = `${lg.season}|${lg.phase}|${lg.day}|${lg.fa?.stage ?? ''}`;
  if (faCache?.key !== key) faCache = { key, n: Object.values(lg.players).filter(p => isFreeAgent(lg, p)).length };
  return faCache.n;
}
export function tradeRules(lg: League, a: string, b: string, aGets: TradeAsset[], bGets: TradeAsset[]): string | null {
  if (!aGets.length && !bGets.length) return 'The trade is empty.';
  const inA = aGets.filter(x => x.pid).map(x => lg.players[x.pid!]);
  const inB = bGets.filter(x => x.pid).map(x => lg.players[x.pid!]);
  for (const p of [...inA, ...inB]) if (tradeLocked(lg, p)) return `${p.name} signed recently and can't be traded until ${lockLabel(lg, p)}.`;
  for (const [tid, inc, out] of [[a, inA, inB], [b, inB, inA]] as const) {
    const t = lg.teams[tid];
    const size = t.roster.length + inc.length - out.length;
    // AI teams may take an extra body or two and waive their last men afterwards
    const slack = a === lg.userTid || b === lg.userTid ? 0 : 2;
    if (size > ROSTER_MAX + slack) return `${t.name} would have too many players (${size}, max ${ROSTER_MAX}).`;
    // a team may go short only if free agents are there to fill the roster afterwards
    if (size < ROSTER_MIN - 1 && (size < ROSTER_MIN - 3 || freeAgentCount(lg) < ROSTER_MIN - size + 2)) return `${t.name} would have too few players (${size}).`;
    const payAfter = payroll(lg, tid) + sal(lg, inc) - sal(lg, out);
    const hc = hardCap(lg);
    if (payAfter > hc + 1e-9 && sal(lg, inc) > sal(lg, out) + 1e-9) return `${t.name} would exceed the hard cap (${Math.round(hc * 100)}% of the cap): payroll after the trade would be ${Math.round(payAfter * 100)}%.`;
    if (lg.season < 1985) {
      if (payAfter > 1.35 && sal(lg, inc) > sal(lg, out)) return `${t.name} would exceed its salary budget.`;
    }
  }
  if (lg.phase === 'playoffs') return 'No trades during the playoffs.';
  for (const x of [...aGets, ...bGets]) if (x.pick && pickUsed(lg, x.pick)) return 'That pick has already been used.';
  { const st = stepien(lg, a, b, aGets, bGets); if (st) return st; }
  { const rr = rightRules(lg, a, b, aGets, bGets); if (rr) return rr; }
  if (lg.phase === 'draft' && lg.draftDay && lg.draftDay.year === lg.season && (lg.draftDay.stage ?? 'draft') !== 'draft' && !lg.draftDay.done) return 'Trades open once the lottery and expansion draft are done.';
  if (lg.phase === 'regular' && pastDeadline(lg)) return 'The trade deadline has passed.';
  return null;
}
const pct = (x: number) => `${Math.round(x * 100)}% of the cap`;

export function pastDeadline(lg: League) {
  const last = lg.schedule.length ? lg.schedule[lg.schedule.length - 1].day : 160;
  return lg.day > last * 0.62;
}
export function deadlineDay(lg: League) {
  const last = lg.schedule.length ? lg.schedule[lg.schedule.length - 1].day : 160;
  return Math.floor(last * 0.62);
}

function applySide(lg: League, tid: string, base: Side, gets: TradeAsset[], gives: TradeAsset[]): Side {
  const givePids = new Set(gives.filter(x => x.pid).map(x => x.pid!));
  const giveKeys = new Set(gives.filter(x => x.pick).map(x => pkKey(x.pick!)));
  const players = base.players.filter(p => !givePids.has(p.id)).concat(gets.filter(x => x.pid).map(x => lg.players[x.pid!]));
  const picks = base.picks.filter(p => !giveKeys.has(pkKey(p))).concat(
    gets.filter(x => x.pick).map(x => ({ ...x.pick!, owner: tid })),
  );
  const rights = [...(base.rights ?? []),
    ...gets.filter(x => x.right).map(x => ({ ...x.right!, role: 'holder' as const })),
    ...gives.filter(x => x.right).map(x => ({ ...x.right!, role: 'giver' as const }))];
  return { players, picks, rights };
}
const pkKey = (p: { season: number; round: number; orig: string }) => `${p.season}-${p.round}-${p.orig}`;

/**
 * GMs hate giving up their best players: an extra cost for trading away one
 * of the team's top three (more for contenders, little for rebuilders who are
 * selling anyway).
 */
function coreReluctance(lg: League, tid: string, out: Player[]) {
  if (!out.length) return 0;
  const t = lg.teams[tid];
  const h = horizonOf(t);
  const top = t.roster.map(pid => lg.players[pid]).sort((x, y) => pv(lg, y, h, tid) - pv(lg, x, h, tid)).slice(0, 3).map(p => p.id);
  const share = h === 'allin' || h === 'contend' ? 0.25 : h === 'middle' ? 0.15 : 0.05;
  return out.filter(p => top.includes(p.id)).reduce((a, p) => a + share * Math.max(0, pv(lg, p, h, tid)), 0);
}
const afterPay = (lg: League, tid: string, inc: Player[], out: Player[]) => payroll(lg, tid) + sal(lg, inc) - sal(lg, out);

export function evaluateTrade(lg: League, a: string, b: string, aGets: TradeAsset[], bGets: TradeAsset[]): TradeEval {
  const rule = tradeRules(lg, a, b, aGets, bGets);
  const A = lg.teams[a], B = lg.teams[b];
  const baseA = sideOf(lg, a), baseB = sideOf(lg, b);
  const afterA = applySide(lg, a, baseA, aGets, bGets);
  const afterB = applySide(lg, b, baseB, bGets, aGets);
  const inA = aGets.filter(x => x.pid).map(x => lg.players[x.pid!]);
  const inB = bGets.filter(x => x.pid).map(x => lg.players[x.pid!]);
  // money weight from the payroll after the trade (taking on salary over the cap hurts more)
  const wA = Math.max(moneyWeight(lg, a), afterPay(lg, a, inA, inB) > hardCap(lg) - 0.15 ? 0.6 : 0);
  const wB = Math.max(moneyWeight(lg, b), afterPay(lg, b, inB, inA) > hardCap(lg) - 0.15 ? 0.6 : 0);
  const gainA = teamValue(lg, A, afterA, wA) - teamValue(lg, A, baseA, wA) - coreReluctance(lg, a, inB);
  const gainB = teamValue(lg, B, afterB, wB) - teamValue(lg, B, baseB, wB) - coreReluctance(lg, b, inA);
  return { ok: !rule, gainA, gainB, reason: rule ?? undefined };
}

/** How much a team needs to gain before agreeing (AI GMs are a little conservative). */
export function threshold(lg: League, tid: string, user = false) {
  const t = lg.teams[tid];
  // in the summer market GMs are more open to reshaping their rosters
  const summer = lg.phase === 'freeagency' && !user ? 0.55 : 1;
  // during the season GMs deal too, most of all in the days before the trade deadline
  const dl = deadlineDay(lg);
  const season = lg.phase === 'regular' && !user ? (lg.day >= dl - 12 ? 0.45 : 0.6) : 1;
  const eager = t.mode === 'allin' ? 0.5 : t.mode === 'tank' ? 0.7 : t.mode === 'capclear' ? 0.5 : t.mode === 'retool' ? 0.72 : 1;
  // a sellers' market: the more teams are all in, the more sellers can ask
  let market = 1;
  if (t.mode === 'tank' || t.strategy === 'rebuild') {
    const buyers = Object.values(lg.teams).filter(x => x.active && x.mode === 'allin').length;
    market = Math.max(0.8, Math.min(1.6, 1 + 0.15 * (buyers - 2)));
  }
  return ((user ? 1.4 : 0.8) + 0.9 * (1 - t.gm.risk)) * summer * season * eager * market;
}

// ------------------------------------------------------------------ execution
export function describeRight(lg: League, r: PickRight) {
  const ab = (t: string) => lg.teams[t]?.abbr ?? t, rd = r.round === 1 ? '1st' : '2nd';
  return r.kind === 'swap' ? `right to swap ${r.season} ${rd}-rounders (${ab(r.a)} ↔ ${ab(r.b)})` : `less favourable of the ${r.season} ${rd}-rounders (${ab(r.a)}, ${ab(r.b)})`;
}
export function describeAssets(lg: League, xs: TradeAsset[]) {
  if (!xs.length) return 'nothing';
  return xs.map(x => x.pid ? tagOf(lg.players[x.pid], lg.season) : x.right ? describeRight(lg, x.right) : `${x.pick!.season} ${x.pick!.round === 1 ? '1st' : '2nd'}-round pick${x.pick!.orig !== '' ? ` (${lg.teams[x.pick!.orig]?.abbr ?? x.pick!.orig})` : ''}`).join(', ');
}

export function executeTrade(lg: League, a: string, b: string, aGets: TradeAsset[], bGets: TradeAsset[], user = false): TradeRec {
  const move = (xs: TradeAsset[], to: string, from: string) => {
    for (const x of xs) {
      if (x.pid) {
        const p = lg.players[x.pid];
        (p as any).acq = { s: lg.season, ph: lg.phase, day: lg.day, from };
        lg.teams[from].roster = lg.teams[from].roster.filter(id => id !== p.id);
        lg.teams[to].roster.push(p.id);
        p.tid = to;
      } else if (x.pick) {
        const pk = lg.picks!.find(p => pkKey(p) === pkKey(x.pick!));
        if (pk) pk.owner = to;
      } else if (x.right) {
        (lg.pickRights ??= []).push({ ...x.right, holder: to, from });
      }
    }
  };
  // OVR and age at the time of the trade, for the trade history
  const info: Record<string, [number, number]> = {};
  for (const x of [...aGets, ...bGets]) if (x.pid) { const p = lg.players[x.pid]; info[x.pid] = [shownOvr(p.z), ageIn(p, lg.season)]; }
  move(aGets, a, b);
  move(bGets, b, a);
  const desc = `${lg.teams[a].abbr} get ${describeAssets(lg, aGets)}; ${lg.teams[b].abbr} get ${describeAssets(lg, bGets)}.`;
  const rec: TradeRec = { s: lg.season, day: lg.day, phase: lg.phase, a, b, aGets, bGets, user, desc, info };
  (lg.trades ??= []).push(rec);
  lg.news.push({ s: lg.season, t: `Trade: ${desc}` });
  return rec;
}

/** After a trade, a short-handed team signs the best free agent at the minimum; a team over the limit waives its last men. */
export function fillRoster(lg: League, tid: string) {
  const t = lg.teams[tid];
  faCache = null;
  while (t.roster.length > ROSTER_MAX && tid !== lg.userTid) {
    const cut = t.roster.map(pid => lg.players[pid])
      // the least valuable player for his salary goes (half of it comes off the books)
      .sort((x, y) => (playerValue(x, lg.season, t.strategy) - x.contract.sal * 10) - (playerValue(y, lg.season, t.strategy) - y.contract.sal * 10))[0];
    t.roster = t.roster.filter(pid => pid !== cut.id);
    releaseDead(lg, tid, cut);
    cut.tid = null;
    cut.contract = { sal: MIN_SAL, exp: lg.season };
    lg.news.push({ s: lg.season, t: `The ${t.name} waived ${cut.name} to make room on the roster.` });
  }
  while (t.roster.length < ROSTER_MIN) {
    const fa = Object.values(lg.players).filter(p => isFreeAgent(lg, p))
      .sort((x, y) => playerValue(y, lg.season, t.strategy) - playerValue(x, lg.season, t.strategy))[0];
    if (!fa) break;
    // a good player signed late still costs most of his market value (within the hard cap)
    const sal = Math.max(MIN_SAL, Math.min(askingSalary(fa, lg.season) * 0.7, hardCap(lg) - payroll(lg, tid)));
    let from = fa.bird ?? fa.rfa ?? '';
    for (let i = fa.career.length - 1; i >= 0 && !from; i--) from = fa.career[i].tid ?? '';
    fa.tid = tid; t.roster.push(fa.id);
    fa.contract = { sal, exp: lg.season };
    delete fa.bird; delete fa.rfa; delete fa.qo;
    if (lg.phase === 'regular' || lg.phase === 'playoffs') {
      lg.fa?.log.push({ st: 5, kind: 'sign', pid: fa.id, tid, from, sal, exp: lg.season, desc: 'in-season signing' });
      lg.news.push({ s: lg.season, t: `The ${t.name} signed free agent ${tagOf(fa, lg.season)} (1 yr) to fill the roster.` });
    }
  }
}

// ------------------------------------------------------------------ AI trade search
/**
 * One round of AI trade talks. Each GM may look for a deal: it lists players
 * on other teams it values more than their owners do, then builds a package of
 * its own assets the other side values more than it does, until both sides gain.
 */
export function aiTradeRound(lg: League, rng: Rng, intensity = 1): TradeRec[] {
  ensurePicks(lg);
  const done: TradeRec[] = [];
  const teams = Object.values(lg.teams).filter(t => t.active && t.tid !== lg.userTid);
  rng.shuffle(teams);
  const busy = new Set<string>();
  for (const A of teams) {
    if (busy.has(A.tid)) continue;
    const urge = A.mode === 'allin' ? 2.6 : A.mode === 'tank' ? 2.4 : A.mode === 'capclear' ? 2 : A.mode === 'retool' ? 1.9 : 1;
    if (!rng.chance(Math.min(0.95, (0.1 + 0.2 * A.gm.risk) * intensity * urge))) continue;
    const others = teams.filter(t => t !== A && !busy.has(t.tid));
    // at the deadline every losing team is a seller
    const g = A.w + A.l, losing = lg.phase === 'regular' && g >= 20 && A.w / g < 0.42;
    const rush = lg.phase === 'regular' && lg.day >= deadlineDay(lg) - 14;
    const deal = A.mode === 'tank' || (rush && (losing || A.strategy === 'rebuild')) ? (findSale(lg, A, others, rng) ?? findDeal(lg, A, others, rng))
      : A.mode === 'capclear' ? (findDump(lg, A, others) ?? findDeal(lg, A, others, rng))
      : findDeal(lg, A, others, rng);
    // every deal passes the market check, whatever path found it
    if (!deal || !looksFair(lg, deal.aGets, deal.bGets)) continue;
    const rec = executeTrade(lg, A.tid, deal.b, deal.aGets, deal.bGets);
    fillRoster(lg, A.tid); fillRoster(lg, deal.b);
    busy.add(A.tid); busy.add(deal.b);
    done.push(rec);
  }
  return done;
}

/**
 * Market sanity check for AI-to-AI deals: no side adds picks when the players it
 * gives are already worth at least what it gets, and no package is far richer
 * than the other in neutral (market) value, whatever one GM's taste.
 */
export function looksFair(lg: League, aGets: TradeAsset[], bGets: TradeAsset[], loose = false) {
  for (const [give, get] of [[bGets, aGets], [aGets, bGets]] as const) {
    const pl = give.filter(x => x.pid), pk = give.filter(x => x.pick);
    // market value of each side; a bad contract counts below zero, so a pick attached to dump it is fair
    const vGet = marketValue(lg, get), vGive = marketValue(lg, give);
    // no sweetener when the players alone already cover it (small margin for taste), no clearly lopsided package
    if (pk.length && marketValue(lg, pl) >= vGet + 0.6) return false;
    if (!loose && vGive > Math.max(0, vGet) * 1.25 + 0.6) return false;
  }
  return true;
}
/** Neutral market value of a package, bad contracts below zero. */
function marketValue(lg: League, xs: TradeAsset[]) {
  let v = 0;
  for (const x of xs) v += x.pid ? pv(lg, lg.players[x.pid], 'middle') : x.right ? rightValue(lg, x.right, 'middle', 0.45) : pickValue(lg, x.pick!, 'middle', 0.45);
  return v;
}

function findDeal(lg: League, A: Team, others: Team[], rng: Rng) {
  const S = lg.season;
  fresh(lg);
  const hA = horizonOf(A);
  const playerValue = (p: Player, _s: number, st: Horizon) => pv(lg, p, st, st === hA ? A.tid : undefined);
  const myPlayers = A.roster.map(pid => lg.players[pid]).filter(p => !tradeLocked(lg, p) && !justTraded(lg, p));
  const myPicks = (lg.picks ?? []).filter(p => p.owner === A.tid && !pickUsed(lg, p));
  const myCore = new Set([...myPlayers].sort((x, y) => playerValue(y, S, hA) - playerValue(x, S, hA)).slice(0, hA === 'rebuild' || hA === 'tank' ? 1 : 2).map(p => p.id));
  // what adding a player does for A's roster as a whole (fills a hole, or just more of the same)
  const wA = moneyWeight(lg, A.tid);
  const baseSide = sideOf(lg, A.tid);
  const baseVal = teamValue(lg, A, baseSide, wA);
  const fit = (p: Player) => teamValue(lg, A, { players: [...baseSide.players, p], picks: baseSide.picks }, wA) - baseVal;
  // targets: players A values more than their own team does
  const targets: { p: Player; B: Team; edge: number }[] = [];
  for (const B of others) {
    for (const pid of B.roster) {
      const p = lg.players[pid];
      if (tradeLocked(lg, p) || justTraded(lg, p) || soldBy(lg, p, A.tid)) continue;
      const hB = horizonOf(B);
      const va = playerValue(p, S, hA), vb = playerValue(p, S, hB);
      if (va < 2.5) continue;
      // tanking teams do not buy veterans for now; rising teams buy players who fit their timeline
      if (hA === 'tank' && ageIn(p, S) > 25) continue;
      if (hA === 'rising' && ageIn(p, S) > 28) continue;
      // a team keeps its franchise player unless it is rebuilding or tanking
      const bestB = Math.max(...B.roster.map(id => playerValue(lg.players[id], S, hB)));
      // ... though an all-in team sometimes pries the star loose from a team going nowhere
      if (vb >= bestB && hB !== 'rebuild' && hB !== 'tank' && !(hA === 'allin' && (hB === 'middle' || B.mode === 'retool') && rng.chance(0.3))) continue;
      // rebuilding and tanking teams keep their young players and prime-age stars
      if ((hB === 'tank' || hB === 'rebuild' || hB === 'rising') && (ageIn(p, S) <= 25 || (ageIn(p, S) <= 27 && (vb >= bestB || shownOvr(p.z) >= 86)))) continue;
      // contenders look for the piece that improves the roster most (fit), others for value
      // contenders and retooling teams look for the piece that improves the roster most (fit), others for value
      if (A.mode === 'retool' && ageIn(p, S) > 31) continue;
      const gain = hA === 'allin' || hA === 'contend' || A.mode === 'retool' ? fit(p) : va;
      // all-in teams hunt stars first, not just any value gap
      const star = hA === 'allin' ? 0.6 * Math.max(0, bpmOf(p.z) - 2) : 0;
      targets.push({ p, B, edge: gain - vb + star + rng.normal() * 1.5 + (hB === 'tank' ? 1 : 0) });
    }
  }
  targets.sort((x, y) => y.edge - x.edge);
  for (const tgt of targets.slice(0, lg.phase === 'freeagency' ? 14 : 8)) {
    const B = tgt.B;
    const aGets: TradeAsset[] = [{ pid: tgt.p.id }];
    // candidate assets A could give, ordered by how much more B values them than A
    const cands: { a: TradeAsset; edge: number; sal: number; back?: boolean }[] = [];
    for (const p of myPlayers) {
      if (myCore.has(p.id)) continue;
      cands.push({ a: { pid: p.id }, edge: playerValue(p, S, horizonOf(B)) - playerValue(p, S, hA), sal: p.contract.sal });
    }
    for (const pk of myPicks) {
      if (pickTied(lg, pk)) continue;
      cands.push({ a: { pick: { season: pk.season, round: pk.round, orig: pk.orig } }, edge: pickValue(lg, pk, horizonOf(B), moneyWeight(lg, B.tid)) - pickValue(lg, pk, hA, wA), sal: 0 });
    }
    // softer currency than a whole pick: a swap right, or the less favourable of two firsts
    for (const r of rightOptions(lg, A.tid, B.tid)) {
      cands.push({ a: { right: r }, edge: rightValue(lg, r, horizonOf(B), moneyWeight(lg, B.tid)) - rightValue(lg, r, hA, wA), sal: 0 });
    }
    // B can balance too: a lesser player or a pick coming back to A
    const hB = horizonOf(B);
    const bCore = new Set(B.roster.map(pid => lg.players[pid]).sort((x, y) => playerValue(y, S, hB) - playerValue(x, S, hB)).slice(0, 3).map(p => p.id));
    for (const pid of B.roster) {
      const p = lg.players[pid];
      if (pid === tgt.p.id || bCore.has(pid) || tradeLocked(lg, p) || justTraded(lg, p) || soldBy(lg, p, A.tid)) continue;
      cands.push({ a: { pid }, edge: playerValue(p, S, hA) - playerValue(p, S, hB) - 0.5, sal: p.contract.sal, back: true });
    }
    for (const pk of (lg.picks ?? []).filter(p => p.owner === B.tid && p.round === 2 && !pickUsed(lg, p))) {
      cands.push({ a: { pick: { season: pk.season, round: pk.round, orig: pk.orig } }, edge: pickValue(lg, pk, hA, wA) - pickValue(lg, pk, hB, moneyWeight(lg, B.tid)) - 0.5, sal: 0, back: true });
    }
    cands.sort((x, y) => y.edge - x.edge);
    const bGets: TradeAsset[] = [];
    const maxFirsts = hA === 'allin' ? 4 : 2;            // going all in: the future is for sale
    for (let i = 0; i < (hA === 'allin' ? 6 : 4) && cands.length; i++) {
      // choose the candidate that brings B's gain closest to its threshold without wrecking A
      let best: typeof cands[0] | null = null, bestScore = -1e9;
      for (const c of cands.slice(0, 12)) {
        const ta = c.back ? [...aGets, c.a] : aGets, tb = c.back ? bGets : [...bGets, c.a];
        const e = evaluateTrade(lg, A.tid, B.tid, ta, tb);
        const score = Math.min(e.gainA - threshold(lg, A.tid), e.gainB - threshold(lg, B.tid)) + (e.ok ? 0 : -3) + (looksFair(lg, ta, tb, true) ? 0 : -2);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (!best) break;
      if (best.a.pick && !best.back && bGets.filter(x => x.pick?.round === 1).length >= maxFirsts && best.a.pick.round === 1) { cands.splice(cands.indexOf(best), 1); i--; continue; }
      if (best.back) aGets.push(best.a); else bGets.push(best.a);
      cands.splice(cands.indexOf(best), 1);
      if (!bGets.length) continue;
      const e = evaluateTrade(lg, A.tid, B.tid, aGets, bGets);
      if (e.ok && e.gainA >= threshold(lg, A.tid) && e.gainB >= threshold(lg, B.tid) && looksFair(lg, aGets, bGets)) return { b: B.tid, aGets, bGets };
      if (e.gainA < threshold(lg, A.tid) - 1) break; // already overpaying
    }
  }
  return null;
}

/**
 * A tanking team sells: each veteran who helps now goes to the team that values
 * him most (usually a contender), for picks and young players it values at
 * least as much – it gets worse this season without losing value.
 */
function findSale(lg: League, A: Team, others: Team[], rng: Rng) {
  const S = lg.season;
  fresh(lg);
  // a tanking team sells anyone who helps now and will not be part of the next good team (26+)
  const minAge = A.mode === 'tank' ? 26 : 28;
  // ... but never the young cornerstone: a star under 30 (or the team's best player under 28) is who the rebuild is built around
  const S2 = S, best = Math.max(...A.roster.map(pid => bpmOf(lg.players[pid].z)));
  const cornerstone = (p: Player) => (shownOvr(p.z) >= 86 && ageIn(p, S2) < 30) || (bpmOf(p.z) >= best && ageIn(p, S2) < 28);
  const vets = A.roster.map(pid => lg.players[pid]).filter(p => !tradeLocked(lg, p) && !justTraded(lg, p) && !cornerstone(p) && ageIn(p, S) >= minAge && bpmOf(p.z) > 0).sort((x, y) => bpmOf(y.z) - bpmOf(x.z)).slice(0, 5);
  for (const p of rng.shuffle([...vets])) {
    const buyers = others.filter(B => (B.mode === 'allin' || B.strategy === 'contend' || B.strategy === 'middle') && !soldBy(lg, p, B.tid))
      .map(B => ({ B, v: pv(lg, p, horizonOf(B), B.tid) })).sort((x, y) => y.v - x.v).slice(0, 4);
    for (const { B } of buyers) {
      const bGets: TradeAsset[] = [{ pid: p.id }];
      // B pays with picks and young players first, salary filler if needed
      const cands: TradeAsset[] = [
        ...(lg.picks ?? []).filter(pk => pk.owner === B.tid && !pickUsed(lg, pk)).sort((x, y) => x.round - y.round).map(pk => ({ pick: { season: pk.season, round: pk.round, orig: pk.orig } })),
        ...B.roster.map(pid => lg.players[pid]).filter(q => ageIn(q, S) <= 24).sort((x, y) => pv(lg, y, 'tank', A.tid) - pv(lg, x, 'tank', A.tid)).map(q => ({ pid: q.id })),
        ...B.roster.map(pid => lg.players[pid]).filter(q => ageIn(q, S) > 24).sort((x, y) => y.contract.sal - x.contract.sal).map(q => ({ pid: q.id })),
      ];
      const aGets: TradeAsset[] = [];
      for (let i = 0; i < 5 && cands.length; i++) {
        let best = -1, bestScore = -1e9;
        cands.slice(0, 12).forEach((c, k) => {
          const e = evaluateTrade(lg, A.tid, B.tid, [...aGets, c], bGets);
          const score = Math.min(e.gainA - threshold(lg, A.tid), e.gainB - threshold(lg, B.tid)) + (e.ok ? 0 : -3);
          if (score > bestScore) { bestScore = score; best = k; }
        });
        if (best < 0) break;
        aGets.push(cands.splice(best, 1)[0]);
        const e = evaluateTrade(lg, A.tid, B.tid, aGets, bGets);
        // the buyer's package must also look sane on the open market (no two firsts and a prospect for a 37-year-old)
        if (e.ok && e.gainA >= threshold(lg, A.tid) && e.gainB >= threshold(lg, B.tid) && looksFair(lg, aGets, bGets)) return { b: B.tid, aGets, bGets };
        if (e.gainB < threshold(lg, B.tid) - 1) break;
      }
    }
  }
  return null;
}

/**
 * Salary dump: a team over (or right at) the hard cap sends a contract to a
 * team with room, adding picks as a sweetener if the receiver wants them.
 */
function findDump(lg: League, A: Team, others: Team[], force = false) {
  const S = lg.season;
  fresh(lg);
  const hc = hardCap(lg);
  const hA = horizonOf(A);
  const over = payroll(lg, A.tid) - (hc - 0.03);
  if (over <= 0 && !force) return null;
  const mine = A.roster.map(pid => lg.players[pid]).filter(p => p.contract.sal >= Math.min(0.04, Math.max(0.015, over)))
    .sort((x, y) => (pv(lg, x, hA, A.tid) / x.contract.sal) - (pv(lg, y, hA, A.tid) / y.contract.sal)).slice(0, 5);
  const picks = (lg.picks ?? []).filter(pk => pk.owner === A.tid && !pickUsed(lg, pk)).sort((x, y) => y.round - x.round || y.season - x.season)
    .map(pk => ({ pick: { season: pk.season, round: pk.round, orig: pk.orig } }));
  for (const p of mine) {
    const takers = others.filter(B => B.roster.length < ROSTER_MAX && payroll(lg, B.tid) + p.contract.sal <= Math.min(hc - 0.05, 1.05))
      .sort((x, y) => payroll(lg, x.tid) - payroll(lg, y.tid)).slice(0, 5);
    for (const B of takers) {
      const bGets: TradeAsset[] = [{ pid: p.id }];
      for (let k = 0; k <= Math.min(3, picks.length); k++) {
        const e = evaluateTrade(lg, A.tid, B.tid, [], bGets);
        if (e.ok && e.gainB >= threshold(lg, B.tid) && (e.gainA >= 0 || force) && looksFair(lg, [], bGets)) return { b: B.tid, aGets: [] as TradeAsset[], bGets };
        if (k < picks.length) bGets.push(picks[k]);
      }
    }
  }
  return null;
}

/** AI teams over the hard cap get under it: salary dumps, and as a last resort buyouts. */
export function complyHardCap(lg: League, rng: Rng, buyouts = false) {
  const hc = hardCap(lg);
  if (hc === Infinity) return;
  // the season after a fantasy draft is exempt: teams have until the next season starts to get under the cap
  if (lg.capGrace === lg.season) return;
  for (const A of Object.values(lg.teams)) {
    if (!A.active) continue;
    for (let tries = 0; tries < 3 && payroll(lg, A.tid) > hc + 1e-9; tries++) {
      if (A.tid === lg.userTid) break;
      const others = Object.values(lg.teams).filter(t => t.active && t !== A && t.tid !== lg.userTid);
      const deal = findDump(lg, A, others, true);
      if (!deal) break;
      executeTrade(lg, A.tid, deal.b, deal.aGets, deal.bGets);
      fillRoster(lg, A.tid); fillRoster(lg, deal.b);
    }
    // last resort: the worst contract for the money is released (half of it stays on the books)
    while (buyouts && payroll(lg, A.tid) > hc + 1e-9) {
      const h = horizonOf(A);
      const p = A.roster.map(pid => lg.players[pid]).filter(x => x.contract.sal > MIN_SAL * 1.5)
        .sort((x, y) => pv(lg, x, h, A.tid) / x.contract.sal - pv(lg, y, h, A.tid) / y.contract.sal)[0];
      if (!p) break;
      A.roster = A.roster.filter(x => x !== p.id);
      releaseDead(lg, A.tid, p);
      p.tid = null;
      lg.news.push({ s: lg.season, t: `${A.name} release ${tagOf(p, lg.season)} to get under the hard cap (half his salary stays on the books).` });
      p.contract = { sal: MIN_SAL, exp: lg.season };
    }
  }
}

/** AI reply to a user proposal, in words. */
export function aiResponse(lg: League, a: string, b: string, aGets: TradeAsset[], bGets: TradeAsset[]) {
  const e = evaluateTrade(lg, a, b, aGets, bGets);
  const th = threshold(lg, b, true);
  const t = lg.teams[b];
  if (!e.ok) return { accept: false, e, text: e.reason! };
  // the AI does not give away clearly more market value than it gets, however well the package fits its plans
  if (marketValue(lg, aGets) > Math.max(0, marketValue(lg, bGets)) * 1.25 + 0.6) return { accept: false, e, text: `${t.name} decline: on the open market they would be giving away far more than they get.` };
  if (e.gainB >= th) return { accept: true, e, text: `${t.name} accept.` };
  const gap = th - e.gainB;
  const inB = bGets.filter(x => x.pid).map(x => lg.players[x.pid!]), outB = aGets.filter(x => x.pid).map(x => lg.players[x.pid!]);
  const why: string[] = [];
  if (coreReluctance(lg, b, outB) > 0.5) why.push('won\'t give up one of their leaders');
  if (afterPay(lg, b, inB, outB) > hardCap(lg) - 0.15 && sal(lg, inB) > sal(lg, outB) + 0.02) why.push('don\'t want to take on more salary');
  if (afterPay(lg, b, inB, outB) > hardCap(lg) - 0.03 && sal(lg, inB) > sal(lg, outB)) why.push('getting close to the hard cap');
  if (inB.length >= 2 && outB.length === 1) why.push('several average players don\'t replace one good one');
  const strat = t.mode === 'capclear' ? 'They are near the hard cap – every dollar saved matters.' : t.mode === 'retool' ? 'They are stuck in the middle and open to side moves – a better fit matters more to them than raw value.' : t.mode === 'rising' ? 'A young rising team – they won\'t part with youth and want players who fit a few years out.' : t.mode === 'allin' ? 'They are all-in – only what helps them win now matters.' : t.mode === 'tank' ? 'They are tanking – wins don\'t matter this season, picks and youth do.' : t.strategy === 'rebuild' ? 'They are rebuilding, so they value young players and picks more.' : t.strategy === 'contend' ? 'They are contending and don\'t want to weaken the current roster.' : '';
  return { accept: false, e, text: `${t.name} decline: ${gap < 3 ? 'close, but they need a little more' : gap < 10 ? 'not enough value' : 'the offer is far from acceptable'}${why.length ? ` (${why.join('; ')})` : ''}. ${strat}`.trim() };
}

/** What a player is worth to a team in a trade (for the trade screen). */
export function tradeableValue(lg: League, p: Player, tid: string) {
  fresh(lg);
  return pv(lg, p, horizonOf(lg.teams[tid]), tid);
}
/** What a pick right is worth to a team (for the trade screen). */
export function rightTradeValue(lg: League, r: PickRight, tid: string) {
  return rightValue(lg, r, horizonOf(lg.teams[tid]), moneyWeight(lg, tid));
}
/** What a pick is worth to a team (for the trade screen). */
export function pickTradeValue(lg: League, pk: { season: number; round: number; orig: string }, tid: string) {
  return pickValue(lg, pk, horizonOf(lg.teams[tid]), moneyWeight(lg, tid), lg.teams[tid]);
}
export { ovrOf, bpmOf, seasonInfo };

// ------------------------------------------------------------------ draft-day trades
const peakCache = new Map<string, number>();
const posGroup = (pos: string) => { const n = posNum(pos); return n <= 2 ? 0 : n >= 4 ? 2 : 1; };
/** How much a team needs a player of this position group: few good ones in its rotation = a hole. */
function draftNeed(lg: League, t: Team, p: Player) {
  const g = posGroup(p.pos);
  const rot = t.roster.map(pid => lg.players[pid]).filter(q => q && !q.retired).sort((a, b) => bpmOf(b.z) - bpmOf(a.z)).slice(0, 9);
  const have = rot.filter(q => posGroup(q.pos) === g && bpmOf(q.z) > -1).length;
  return have <= 1 ? 1 : have === 2 ? 0.5 : have === 3 ? 0.15 : -0.15;
}
/**
 * A team's own (hidden) board: consensus, its scouts' projection – noisier the worse its scouting – and its
 * needs. Contenders lean toward a player who fills a hole now, rebuilding teams take the best talent.
 */
export function boardScore(lg: League, p: Player, t: Team, Y: number) {
  const consensus = 6 - 3.0 * Math.log(Math.max(1, p.draft!.realPick));
  const key = p.id + '|' + Y;
  let proj = peakCache.get(key);
  if (proj === undefined) { proj = peakBpm(p, Y + 1); peakCache.set(key, proj); if (peakCache.size > 5000) peakCache.clear(); }
  const h = hash01(t.tid + '|' + p.id) * 2 - 1;
  const noise = (1.1 - t.gm.scouting) * ((p as any).scout * 1.5 + h * 1.2);
  const hz = horizonOf(t);
  const needW = hz === 'allin' || hz === 'contend' ? 0.8 : hz === 'tank' || hz === 'rebuild' ? 0.25 : 0.5;
  return 0.5 * consensus + 0.5 * proj + noise + needW * draftNeed(lg, t, p);
}

/**
 * During the draft a pick is worth the player the team plans to take with it: the others are assumed to
 * pick by consensus until then, and of those left the team takes the best on its own board. A team whose
 * favourite will still be there two picks later gains little by moving up.
 */
function draftPickWorth(lg: League, pk: { season: number; round: number; orig: string }, t: Team, h: Horizon, moneyW: number): number | null {
  const d = lg.draftDay;
  if (!d || d.done || d.year !== pk.season || (d.stage ?? 'draft') !== 'draft') return null;
  const j = d.order.findIndex(o => o.round === pk.round && o.orig === pk.orig);
  if (j < d.idx) return null;
  const cons = d.pool.map(id => lg.players[id]).sort((a, b) => a.draft!.realPick - b.draft!.realPick);
  const left = cons.slice(Math.min(j - d.idx, Math.max(0, cons.length - 1)));
  if (!left.length) return prospectValue(j + 1, h, moneyW);
  let best = -1e9;
  for (const p of left.slice(0, 25)) best = Math.max(best, boardScore(lg, p, t, d.year));
  const typical = boardScore(lg, left[0], t, d.year);
  return Math.max(0.05, prospectValue(j + 1, h, moneyW) + 0.9 * (best - typical));
}

/**
 * Trade up / trade down while a pick is on the clock. Every team values the picks by the player it plans
 * to take with them (its own board), so a deal happens when another team wants the player available now
 * more than the team on the clock does – paid with its later pick plus a sweetener of other picks.
 */
export function aiDraftTrade(lg: League, rng: Rng): TradeRec | null {
  const d = lg.draftDay;
  if (!d || d.done || (d.stage ?? 'draft') !== 'draft' || d.idx >= d.order.length || d.pool.length < 3) return null;
  const i = d.idx, Y = d.year, cur = d.order[i];
  const xid = pickOwner(lg, Y, cur.round, cur.orig);
  const X = lg.teams[xid];
  if (!X || xid === lg.userTid) return null;
  if (!rng.chance(cur.round === 1 ? 0.3 : 0.12)) return null;
  const curPk = { season: Y, round: cur.round, orig: cur.orig };
  const hX = horizonOf(X), wX = moneyWeight(lg, X.tid);
  const xCur = pickValue(lg, curPk, hX, wX, X);
  let best: { Yt: Team; j: number; aGets: TradeAsset[]; surplus: number } | null = null;
  const seen = new Set<string>();
  for (let j = i + 1; j < Math.min(d.order.length, i + 16); j++) {
    const o = d.order[j];
    const yid = pickOwner(lg, Y, o.round, o.orig);
    if (yid === xid || yid === lg.userTid || seen.has(yid) || !lg.teams[yid]?.active) continue;
    seen.add(yid);
    const Yt = lg.teams[yid], hY = horizonOf(Yt), wY = moneyWeight(lg, yid);
    const laterPk = { season: Y, round: o.round, orig: o.orig };
    const gainY = pickValue(lg, curPk, hY, wY, Yt) - pickValue(lg, laterPk, hY, wY, Yt);
    // moving down always costs the buyer something (at least about a future second-rounder)
    const needX = Math.max(0.2, xCur * 1.03 - pickValue(lg, laterPk, hX, wX, X));
    if (gainY <= 0.2) continue;
    const aGets: TradeAsset[] = [{ pick: laterPk }];
    let paidX = 0, costY = 0;
    const sweet = (lg.picks ?? []).filter(pk => pk.owner === yid && !pickUsed(lg, pk) && !(pk.season === Y && pk.round === o.round && pk.orig === o.orig) && !(pk.season === Y && d.order.findIndex(q => q.round === pk.round && q.orig === pk.orig) <= i))
      .filter(pk => !pickTied(lg, pk))
      .map(pk => ({ asset: { pick: { season: pk.season, round: pk.round, orig: pk.orig } } as TradeAsset, vx: pickValue(lg, pk, hX, wX, X), vy: pickValue(lg, pk, hY, wY, Yt) }))
      .concat(rightOptions(lg, yid, xid).map(r => ({ asset: { right: r } as TradeAsset, vx: rightValue(lg, r, hX, wX), vy: rightValue(lg, r, hY, wY) })))
      .sort((a, b) => a.vx - b.vx);
    while (paidX < needX && sweet.length && aGets.length < 4) {
      const k = sweet.findIndex(s => paidX + s.vx >= needX);
      const s = sweet.splice(k >= 0 ? k : sweet.length - 1, 1)[0];
      // a right on a pick already in the package would clash: skip it
      if (s.asset.right && aGets.some(g => g.pick && g.pick.season === s.asset.right!.season && (g.pick.orig === s.asset.right!.a || g.pick.orig === s.asset.right!.b))) continue;
      if (s.asset.pick && aGets.some(g => g.right && g.right.season === s.asset.pick!.season && (g.right.a === s.asset.pick!.orig || g.right.b === s.asset.pick!.orig))) continue;
      aGets.push(s.asset);
      paidX += s.vx; costY += s.vy;
    }
    if (paidX < needX) continue;
    const surplus = gainY - costY;
    if (surplus <= 0.05) continue;
    if (!best || surplus > best.surplus) best = { Yt, j, aGets, surplus };
  }
  if (!best) return null;
  if (tradeRules(lg, X.tid, best.Yt.tid, best.aGets, [{ pick: curPk }])) return null;
  // a board can be wrong: no deal the market would call a giveaway
  if (!looksFair(lg, best.aGets, [{ pick: curPk }])) return null;
  const rec = executeTrade(lg, X.tid, best.Yt.tid, best.aGets, [{ pick: curPk }]);
  lg.news.push({ s: Y, t: `Draft-day trade: ${best.Yt.name} move up to No. ${i + 1}; ${X.name} move down to No. ${best.j + 1}${best.aGets.length > 1 ? ` and add ${describeAssets(lg, best.aGets.slice(1))}` : ''}.` });
  return rec;
}
