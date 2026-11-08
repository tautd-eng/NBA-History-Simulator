// What players want. Every player has hidden priorities (money, winning, role,
// loyalty, market), shaped by age: young players want minutes and money,
// veterans chase rings and security. A team's appeal (how good it is, what role
// he would get, whether it is his own team, the market) turns into a discount
// he accepts – or a premium a bad team has to pay. Used for free-agent choices,
// demands to the user, and contract extensions.
import { hash01 } from '../rng';
import { League, Player } from '../types';
import { ageIn } from '../players';
import { bpmOf, shownOvr } from '../data';
import { peakShown } from '../ai/plan';
import { teamStrength, askingSalary, maxSalary, askAtBpm, peakBpm } from '../ai/value';

export interface Traits { money: number; win: number; role: number; loyal: number; market: number }

/** Hidden priorities, 0–1 each (stable per player, shifted by age). */
export function traits(p: Player, season: number): Traits {
  const h = (k: string) => hash01(p.id + k);
  const age = ageIn(p, season);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    money: clamp(0.35 + 0.6 * h('m') - (age >= 33 ? 0.1 : 0)),
    win: clamp(0.2 + 0.6 * h('w') + (age >= 30 ? 0.15 : 0) + (age >= 33 ? 0.1 : 0)),
    role: clamp(0.3 + 0.55 * h('r') + (age <= 25 ? 0.2 : 0) - (age >= 33 ? 0.25 : 0)),
    loyal: clamp(0.8 * h('l') * h('l2') + (age >= 31 ? 0.1 : 0)),
    market: clamp(0.6 * h('k')),
  };
}

/** Market appeal of a franchise (size, climate, tradition), 0–1. */
const MARKET: Record<string, number> = {
  LAL: 1, NYK: 1, CHI: 0.85, BOS: 0.75, GSW: 0.7, LAC: 0.65, MIA: 0.75, BRK: 0.7, NJN: 0.45, PHI: 0.6, DAL: 0.6, HOU: 0.6,
  ATL: 0.5, PHO: 0.55, SAS: 0.45, WAS: 0.5, WSB: 0.5, TOR: 0.5, DEN: 0.45, POR: 0.4, SEA: 0.5, OKC: 0.3, DET: 0.45,
  ORL: 0.5, SAC: 0.35, KCK: 0.3, SDC: 0.55, UTA: 0.25, MIL: 0.3, MIN: 0.3, IND: 0.35, CLE: 0.35, CHA: 0.4, CHH: 0.4,
  CHO: 0.4, NOP: 0.45, NOH: 0.45, NOK: 0.4, MEM: 0.3, VAN: 0.3, BUF: 0.3,
};
export const marketOf = (tid: string) => MARKET[tid] ?? 0.45;

export interface Appeal { win: number; role: number; loyal: number; market: number }

/** How attractive a team is for this player (each 0–1). */
export function appeal(lg: League, p: Player, tid: string): Appeal {
  const t = lg.teams[tid];
  const teams = Object.values(lg.teams).filter(x => x.active);
  // quality: projected strength with him in it, and how the team did
  const strengths = strengthTable(lg);
  const mine = (strengths.get(tid) ?? 0) + (p.tid === tid ? 0 : Math.max(0, bpmOf(p.z)) * 0.12);
  const better = [...strengths.values()].filter(s => s > mine).length;
  const rankScore = 1 - better / Math.max(1, teams.length - 1);
  const games = t.w + t.l;
  const win = games ? 0.5 * rankScore + 0.5 * (t.w / games) : rankScore;
  // role: where he would rank in the rotation
  const others = t.roster.filter(pid => pid !== p.id).map(pid => bpmOf(lg.players[pid].z));
  const ahead = others.filter(b => b > bpmOf(p.z)).length;
  const role = ahead < 3 ? 1 : ahead < 5 ? 0.8 : ahead < 7 ? 0.5 : ahead < 9 ? 0.25 : 0.05;
  const own = p.tid === tid || p.bird === tid || p.rfa === tid || lastTeam(p) === tid;
  return { win, role, loyal: own ? 1 : 0, market: marketOf(tid) };
}
// team strengths change only when rosters do: cache them by a cheap fingerprint
let sCache: { key: string; map: Map<string, number> } | null = null;
function strengthTable(lg: League) {
  const key = `${lg.seed}|${lg.season}|${lg.phase}|${lg.day}|${lg.trades?.length ?? 0}|${lg.fa?.log.length ?? 0}|${Object.values(lg.teams).reduce((a, t) => a + t.roster.length, 0)}`;
  if (sCache?.key === key) return sCache.map;
  const map = new Map(Object.values(lg.teams).filter(t => t.active).map(t => [t.tid, teamStrength(lg, t.tid)]));
  sCache = { key, map };
  return map;
}
function lastTeam(p: Player) {
  const c = [...p.career].reverse().find(x => !x.po);
  return c?.tid;
}

/**
 * Share of his asking salary he gives up to play for this team: positive =
 * discount, negative = premium the team must pay. Money-minded players move
 * little either way.
 */
export function discount(lg: League, p: Player, tid: string): number {
  const tr = traits(p, lg.season);
  const a = appeal(lg, p, tid);
  const raw = 0.22 * tr.win * (a.win - 0.5) * 2
    + 0.14 * tr.role * (a.role - 0.55) * 2
    + 0.14 * tr.loyal * a.loyal
    + 0.08 * tr.market * (a.market - 0.45) * 2;
  return Math.max(-0.2, Math.min(0.35, raw * (1 - 0.65 * tr.money)));
}

/** How much he likes an offer (money relative to his ask plus the team's appeal). */
export function offerUtility(lg: League, p: Player, tid: string, sal: number, ask: number, years: number) {
  const age = ageIn(p, lg.season);
  const money = Math.min(1.3, sal / Math.max(1e-6, ask));
  const security = age >= 30 ? 0.02 * Math.min(4, years) : 0;
  return money + discount(lg, p, tid) + security;
}

/** Words for the UI: what drives him towards or away from a team. */
export function reasons(lg: League, p: Player, tid: string): { t: string; s: number }[] {
  const tr = traits(p, lg.season);
  const a = appeal(lg, p, tid);
  const out: { t: string; s: number }[] = [];
  const mul = 1 - 0.65 * tr.money;
  const w = 0.22 * tr.win * (a.win - 0.5) * 2 * mul;
  if (Math.abs(w) > 0.015) out.push({ t: w > 0 ? 'wants to win – strong team' : 'wants to win – team too weak', s: w });
  const r = 0.14 * tr.role * (a.role - 0.55) * 2 * mul;
  if (Math.abs(r) > 0.015) out.push({ t: r > 0 ? 'would get a big role' : 'would play too little here', s: r });
  const l = 0.14 * tr.loyal * a.loyal * mul;
  if (l > 0.015) out.push({ t: 'feels at home on this team', s: l });
  const m = 0.08 * tr.market * (a.market - 0.45) * 2 * mul;
  if (Math.abs(m) > 0.015) out.push({ t: m > 0 ? 'likes the city and market' : 'not drawn to the city', s: m });
  if (tr.money > 0.75) out.push({ t: 'money comes first', s: 0 });
  return out.sort((x, y) => Math.abs(y.s) - Math.abs(x.s));
}

export const TRAIT_LABELS: [keyof Traits, string][] = [['money', 'Money'], ['win', 'Winning'], ['role', 'Role'], ['loyal', 'Loyalty'], ['market', 'City / market']];

// ---------------------------------------------------------------- extensions
/**
 * Would he extend now (contract ending this season) at this salary and length?
 * Beyond money: how this season goes for him and the team, security for
 * veterans, and young players who expect to improve betting on themselves.
 */
export interface ExtNeed { need: number; why: string[]; interest: number; ask: number; parts: { t: string; pct: number }[]; out?: boolean }
export function extensionNeed(lg: League, p: Player, tid: string, years: number): ExtNeed {
  const N = lg.season + 1;
  const tr = traits(p, lg.season);
  const age = ageIn(p, N);
  const max = maxSalary(p, N);
  // his market value: what he would ask a team in free agency
  const ask = Math.min(max, askingSalary(p, N));
  let d = discount(lg, p, tid);
  const why: string[] = reasons(lg, p, tid).filter(r => r.s !== 0).slice(0, 2).map(r => r.t);
  // this season: playing time against what a player of his level expects
  const gp = p.cur.gp;
  if (gp >= 10) {
    const mpg = p.cur.min / gp;
    const expected = Math.max(8, Math.min(36, 22 + 3.2 * bpmOf(p.z)));
    if (mpg < expected - 6) { d -= 0.08 * (0.5 + tr.role); why.push('unhappy with his minutes'); }
    else if (mpg > expected + 3) { d += 0.03; why.push('happy with his role'); }
    const wp = lg.teams[tid].w / Math.max(1, lg.teams[tid].w + lg.teams[tid].l);
    if (wp < 0.35 && tr.win > 0.5) { d -= 0.06; why.push('team is losing this season'); }
    if (wp > 0.6) { d += 0.03; why.push('team is winning'); }
  }
  // money-first stars want the full max or will test free agency
  if (tr.money > 0.7 && ask >= max * 0.9) { d = Math.min(d, 0); why.push('wants a max contract'); }
  // 1) wanting to stay: the more he likes it here, the bigger the hometown discount (or the premium, if he does not)
  // a hometown discount is small (history: rarely more than ~10%); a player who does not want to stay asks
  // a lot more – up to twice his market value
  const stay = d >= 0 ? Math.min(0.1, 0.45 * d) : -Math.min(1, 4 * -d);
  const interest = Math.round(Math.max(0, Math.min(100, 50 + 160 * d)));
  // 2) length
  const L = lengthPrice(p, N, years, ask);
  const len = L.len, young = L.young;
  if (L.why) why.push(L.why);
  const raw = ask * (1 - stay) * (1 - len) * young;
  const need = Math.max(0.012, Math.min(max, raw));
  const parts = [
    { t: interest >= 50 ? 'wants to stay – hometown discount' : 'not keen on staying – wants more', pct: -stay },
    { t: age >= 30 ? 'contract length (security for a veteran)' : 'contract length', pct: -len },
    { t: 'priced on his expected growth (long deal, young)', pct: young - 1 },
  ].filter(x => Math.abs(x.pct) >= 0.005);
  // he wants more than any team may pay: no extension – he goes to free agency
  return { need, why, interest, ask, parts, out: raw > max * 1.0001 && stay < 0 };
}

/**
 * Will he sign an extension at this salary? At his number (or above) yes. Below it, it is a gamble, and the
 * room for a discount depends on how much he wants to stay: a player who is not sold on the team does not
 * take less at all.
 */
export function extensionChance(lg: League, p: Player, tid: string, sal: number, years: number) {
  const e = extensionNeed(lg, p, tid, years);
  if (e.out) return { ...e, chance: 0 };
  if (sal + 1e-9 >= e.need) return { ...e, chance: 1 };
  const room = e.interest < 40 ? 0 : 0.01 + 0.06 * (e.interest - 40) / 60; // how far under his number he could go
  const x = (e.need - sal) / e.need;
  const chance = room <= 0 ? 0 : Math.max(0, Math.pow(1 - x / room, 1.5));
  return { ...e, chance };
}

/**
 * What the length of a deal does to his price (any contract: extension or free agency).
 * A veteran pays for security (each year up to four is worth ~2.5% to him); a deal too long for his age costs;
 * a long deal for a young player is priced on what he is expected to become over the deal: his projected path
 * from today toward his peak (around 27), year by year, averaged – the team buys some of the upside and takes
 * the risk that he never gets there; the player gives a little of it back for the security.
 * Returns len (share off the price) and young (multiplier), price = ask × (1 − len) × young.
 */
export function lengthPrice(p: Player, N: number, years: number, ask: number) {
  const age = ageIn(p, N);
  let len = 0, why = '';
  if (age >= 30) len += 0.025 * (Math.min(years, 4) - 1);
  if (years > (age >= 32 ? 3 : 5)) len -= 0.1;
  let young = 1;
  if (age <= 25 && years >= 2) {
    const now = bpmOf(p.z), peak = Math.max(now, peakBpm(p, N));
    const toPeak = Math.max(1, 27 - age);
    let sum = 0;
    for (let y = 1; y <= years; y++) sum += askAtBpm(p, N, now + (peak - now) * Math.min(1, y / toPeak));
    const price = (sum / years) * (1 - 0.02 * (years - 1));
    young = Math.max(1, price / Math.max(ask, 1e-6));
    if (young > 1.03) why = `a ${years}-year deal is priced on his expected growth (peak ~${peakShown(p, N)} OVR) – a bet that he gets there`;
  } else if (age >= 30 && years >= 3) why = 'values a long contract';
  return { len, young, mult: (1 - len) * young, why };
}

/** The length he would pick himself: young players keep their next free agency close, veterans want security. */
export function preferredYears(p: Player, N: number) {
  const a = ageIn(p, N);
  return a <= 24 ? 2 : a <= 29 ? 3 : a <= 32 ? 3 : 2;
}
