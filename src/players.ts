import { H, NK, K, ovrOf, bpmOf, RealSeason, RATING_LABELS, ratingOf, shownOvr, agingIndex } from './data';
import { Player, emptyLine } from './types';
import { hash01, Rng } from './rng';

export function birthYear(b: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(b || '');
  if (!m) return 1960;
  return +m[1] + (+m[2] - 1) / 12 + (+m[3] - 1) / 365;
}
/** Age during a season (season = year it ends; age on Feb 1 like Basketball-Reference). */
export function ageIn(p: { born: number }, season: number) {
  return Math.floor(season + 1 / 12 - p.born);
}

export function realSeason(pid: string, season: number): RealSeason | undefined {
  const hp = H.players[pid];
  if (!hp) return undefined;
  return hp.s.find(s => s[0] === season);
}

/**
 * Real-career z for a season. When the player missed that season in reality
 * but played before and after, interpolate. Returns undefined after the real
 * career ended (or before it started).
 */
export function realTarget(pid: string, season: number): { z: number[]; mp: number; interp: boolean } | undefined {
  const hp = H.players[pid];
  if (!hp || !hp.s.length) return undefined;
  const s = hp.s;
  const exact = s.find(x => x[0] === season);
  if (exact) return { z: smoothZ(pid, season), mp: exact[3], interp: false };
  const before = [...s].reverse().find(x => x[0] < season);
  const after = s.find(x => x[0] > season);
  if (before && after) {
    const t = (season - before[0]) / (after[0] - before[0]);
    return { z: before[7].map((v, i) => v + (after[7][i] - v) * t), mp: 0, interp: true };
  }
  return undefined;
}

/**
 * A season's ratings evened out with the seasons around it: the neighbours (aged to this season with the mean
 * aging curve) count at NEIGHBOUR_W of their minutes, so a one-off career year or a short, hot stretch is
 * softened while a real step up or down (it shows in the next season too) stays.
 */
export const NEIGHBOUR_W = 0.5;
const smoothCache = new Map<string, number[]>();
export function smoothZ(pid: string, season: number): number[] {
  const key = pid + '|' + season;
  const hit = smoothCache.get(key); if (hit) return hit;
  const hp = H.players[pid];
  const own = hp.s.find(x => x[0] === season)!;
  const born = birthYear(hp.b);
  const age = Math.floor(season + 1 / 12 - born);
  const z = own[7].map(v => v * own[3]);
  let w = own[3];
  for (const dy of [-1, 1]) {
    const r = hp.s.find(x => x[0] === season + dy);
    if (!r || r[3] <= 0) continue;
    const ww = NEIGHBOUR_W * Math.min(r[3], Math.max(own[3], 500) * 1.5);
    const ai = agingIndex(dy < 0 ? age - 1 : age);
    for (let i = 0; i < NK; i++) { const m = H.aging[H.keys[i]].mean[ai]; z[i] += ww * (r[7][i] + (dy < 0 ? m : -m)); }
    w += ww;
  }
  const out = w > 0 ? z.map(v => v / w) : own[7].slice();
  smoothCache.set(key, out);
  return out;
}

export function lastRealSeason(pid: string): number | undefined {
  const hp = H.players[pid];
  if (!hp || !hp.s.length) return undefined;
  return hp.s[hp.s.length - 1][0];
}
export function firstRealSeason(pid: string): number | undefined {
  const hp = H.players[pid];
  if (!hp || !hp.s.length) return undefined;
  return hp.s[0][0];
}

export function newPlayer(pid: string, z: number[], tid: string | null, season: number): Player {
  const p = makePlayer(pid, z, tid, season);
  snapRatings(p, season);
  return p;
}
function makePlayer(pid: string, z: number[], tid: string | null, season: number): Player {
  const hp = H.players[pid];
  return {
    id: pid,
    name: hp?.n ?? pid,
    born: birthYear(hp?.b ?? ''),
    ht: hp?.h ?? 78,
    pos: hp?.p ?? 'F',
    z: z.slice(),
    tid,
    contract: { sal: 0.02, exp: season },
    injury: 0,
    endur: (hash01(pid + 'e') - 0.5) * 3.2,
    cur: emptyLine(),
    curPo: emptyLine(),
    career: [],
    ovrHist: [],
    awards: [],
    real: !!hp && hp.s.length > 0,
    entered: season,
    scout: hash01(pid + 's') * 2 - 1,
  };
}

/** Draft-slot prior bucket (same buckets as prep). */
export function bucket(pick: number) {
  const hi = [3, 10, 20, 30, 45, 60];
  for (let i = 0; i < hi.length; i++) if (pick <= hi[i]) return i;
  return 6;
}

/**
 * Starting ratings for a draft prospect. destiny=1: his real rookie season.
 * destiny=0: an average player of his draft slot plus noise.
 */
export function prospectZ(pid: string, draftYear: number, destiny: number, rng: Rng): number[] {
  const hp = H.players[pid];
  const pick = hp?.d?.[1] ?? 60;
  const prior = H.draftPrior[bucket(pick)].z;
  const base = prior.map(v => v + rng.normal() * 0.55);
  const tgt = realTarget(pid, draftYear + 1) ?? (hp?.s.length ? { z: hp.s[0][7], mp: hp.s[0][3], interp: true } : undefined);
  if (tgt) return base.map((v, i) => v + destiny * (tgt.z[i] - v));
  // never played in the NBA: in the destiny world he was below his slot
  const z = base.map((v, i) => v - destiny * (i === K.tov || i === K.pf ? -0.6 : 0.6));
  // a prospect nobody has seen in the NBA yet can't enter as a finished star: a ceiling by draft slot
  const cap = pick <= 3 ? 80 : pick <= 10 ? 78 : pick <= 30 ? 76 : 73;
  if (shownOvr(z) > cap) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 14; it++) { const t = (lo + hi) / 2; if (shownOvr(z.map((v, i) => prior[i] + t * (v - prior[i]))) <= cap) lo = t; else hi = t; }
    return z.map((v, i) => prior[i] + lo * (v - prior[i]));
  }
  return z;
}

export function playerBpm(p: Player) { return bpmOf(p.z); }
export function playerOvr(p: Player) { return ovrOf(p.z); }

export function zeros() { return new Array(NK).fill(0); }

/** Record (or update) this season's overall and skill ratings for the progression view. */
export function snapRatings(p: Player, season: number) {
  const ovr = ovrOf(p.z);
  const last = p.ovrHist[p.ovrHist.length - 1];
  // [season, simulation overall, displayed overall]
  const sh = shownOvr(p.z);
  if (last && last[0] === season) { last[1] = ovr; (last as any)[2] = sh; } else p.ovrHist.push([season, ovr, sh] as any);
  const row = [season, ...RATING_LABELS.map(r => ratingOf(p.z[r.k], r.inv))];
  p.rh ??= [];
  const lr = p.rh[p.rh.length - 1];
  if (lr && lr[0] === season) p.rh[p.rh.length - 1] = row; else p.rh.push(row);
}

/** "Name (OVR 85, age 27)" for news and trade texts (displayed overall scale). */
export function tagOf(p: Player, season: number, ageOffset = 0) {
  return `${p.name} (OVR ${shownOvr(p.z)}, age ${ageIn(p, season) + ageOffset})`;
}

/** Add an entry to a player's career history. */
export function addTx(p: Player, season: number, t: string, d?: number) {
  (p.tx ??= []).push({ s: season, t, ...(d !== undefined ? { d } : {}) });
  if (p.tx.length > 80) p.tx.shift();
}
