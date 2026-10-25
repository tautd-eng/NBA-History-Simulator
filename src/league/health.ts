// Player development with variety, and a league-level guard against rating
// inflation or deflation over the decades.
//
// Variety: every player has hidden traits (potential, early/late peak,
// volatility). Year-to-year noise is mean-reverting (an AR(1) process), so a
// lucky season does not compound into a permanent random walk.
//
// Guard: after each off-season the league's rotation players are compared with
// the real league of that season (same measure on real data). Systematic drift
// in any skill, or a talent spread that is too wide or too flat, is pulled back
// part of the way. With the destiny slider at 100% the sim already follows the
// real careers, so the guard does almost nothing there.
import { H, NK, K, agingIndex, bpmOf, ovrOf, LAST_SEASON, FIRST_SEASON, era } from '../data';
import { Rng } from '../rng';
import { League, Player, StatLine, emptyLine, addLine } from '../types';
import { ageIn, realTarget, snapRatings } from '../players';
import { zClamp } from '../ai/value';

export const DEV = { noise: 0.32, ar: 0.55, maxOvrStep: 8, soft: 2.7, maxSkillStep: 0.5, primeDrop: 2.5 };
/**
 * Leniency for young players: up to maxAge, a season slightly below expectations
 * (performance signal above -deadZone OVR) does not hurt, a flop (below `flop`)
 * hurts only negFactor as much, and without a flop one summer costs at most
 * maxDrop OVR (≤22, 23–24, 25).
 */
export const YOUNG = { maxAge: 25, deadZone: 2.5, flop: -3, negFactor: 0.5, maxDrop: [1, 2, 3] };

export function ensureDev(p: Player, rng: Rng) {
  if (p.dev) return p.dev;
  const vol = Math.exp(rng.normal() * 0.3);
  p.dev = { pot: rng.normal(), peak: Math.round(rng.normal() * 1.3), vol, e: new Array(NK).fill(0) };
  return p.dev;
}

const TENDENCY = new Set<number>([K.usg, K.tpr]);
let OVR_DIR: number[] = [];
/** unit change in BPM along the skills the overall rating rewards (tendencies excluded) */
export function initDev() {
  const w = H.keys.map((k, i) => (TENDENCY.has(i) ? 0 : H.ovr[k]));
  const n2 = w.reduce((a, x) => a + x * x, 0);
  OVR_DIR = w.map(x => x / n2);
}

// ------------------------------------------------------------------ performance
// How a player actually played moves his ratings: each skill with a box-score
// trace (shooting, rebounding, passing, ...) is compared with the league that
// season and pulled toward what he showed, more so the more he played. A role
// player who catches fire in big minutes comes back next season much better.
type Obs = { k: number; log: boolean; num: (l: StatLine) => number; den: (l: StatLine) => number; prior: number };
const OBS: Obs[] = [
  { k: K.ins, log: false, num: l => l.fgm - l.tpm, den: l => l.fga - l.tpa, prior: 180 },
  { k: K.tp, log: false, num: l => l.tpm, den: l => l.tpa, prior: 200 },
  { k: K.ft, log: false, num: l => l.ftm, den: l => l.fta, prior: 90 },
  { k: K.drw, log: true, num: l => l.fta, den: l => l.fga, prior: 250 },
  { k: K.tpr, log: false, num: l => l.tpa, den: l => l.fga, prior: 150 },
  { k: K.tov, log: false, num: l => l.tov, den: l => l.fga + 0.44 * l.fta + l.tov, prior: 400 },
  { k: K.usg, log: true, num: l => l.fga + 0.44 * l.fta + l.tov, den: l => l.min, prior: 500 },
  { k: K.ast, log: true, num: l => l.ast, den: l => l.min, prior: 450 },
  { k: K.orb, log: true, num: l => l.orb, den: l => l.min, prior: 450 },
  { k: K.drb, log: true, num: l => l.drb, den: l => l.min, prior: 450 },
  { k: K.stl, log: true, num: l => l.stl, den: l => l.min, prior: 600 },
  { k: K.blk, log: true, num: l => l.blk, den: l => l.min, prior: 600 },
  { k: K.pf, log: true, num: l => l.pf, den: l => l.min, prior: 600 },
];
export const PERF = { alpha: 1, skill: 0.32, overall: 0.9, maxStep: 12 };
const lgt = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));

/** Season line (regular season + playoffs) the player produced in season Y. */
function seasonLine(p: Player, Y: number): StatLine | null {
  const ls = p.career.filter(c => c.s === Y);
  if (!ls.length) return null;
  const out = emptyLine();
  for (const l of ls) addLine(out, l);
  return out.min > 0 ? out : null;
}

/** Weighted least squares y = a + b·x + c·x²; returns the fitted value and local slope at x. */
function wls(xs: number[], ys: number[], ws: number[]) {
  // normal equations for [1, x, x^2]
  const S = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < xs.length; i++) {
    const v = [1, xs[i], xs[i] * xs[i]];
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) S[r][c] += ws[i] * v[r] * v[c]; S[r][3] += ws[i] * v[r] * ys[i]; }
  }
  for (let r = 0; r < 3; r++) S[r][r] += 1e-6;
  for (let c = 0; c < 3; c++) {
    let piv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(S[r][c]) > Math.abs(S[piv][c])) piv = r;
    [S[c], S[piv]] = [S[piv], S[c]];
    if (Math.abs(S[c][c]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) if (r !== c) { const f = S[r][c] / S[c][c]; for (let k = c; k < 4; k++) S[r][k] -= f * S[c][k]; }
  }
  const [a, b, c] = [S[0][3] / S[0][0], S[1][3] / S[1][1], S[2][3] / S[2][2]];
  if (![a, b, c].every(Number.isFinite)) return null;
  return { fit: (x: number) => a + b * x + c * x * x, slope: (x: number) => b + 2 * c * x };
}

/**
 * Rating change suggested by last season's play (before aging), and the OVR it implies.
 * For every skill the league-wide relation "rating → observed stat" is fitted on
 * that season; only what a player did above or below that line counts. So the
 * signal is pure over/under-performance and cannot feed on itself.
 */
export function performanceShift(lg: League, Y: number) {
  const lines: { p: Player; l: StatLine }[] = [];
  for (const p of Object.values(lg.players)) { const l = seasonLine(p, Y); if (l && l.min >= 60) lines.push({ p, l }); }
  const out = new Map<string, { dz: number[]; ovrGain: number }>();
  for (const { p } of lines) out.set(p.id, { dz: new Array(NK).fill(0), ovrGain: 0 });
  // 1) skill by skill
  for (const o of OBS) {
    const xs: number[] = [], ys: number[] = [], ws: number[] = [], who: { p: Player; n: number }[] = [];
    for (const { p, l } of lines) {
      const n = o.den(l);
      if (n <= 0) continue;
      const r = o.num(l) / n;
      xs.push(p.z[o.k]); ys.push(o.log ? Math.log(Math.max(r, 1e-3)) : lgt(r)); ws.push(n / (n + o.prior)); who.push({ p, n });
    }
    const f = wls(xs, ys, ws);
    if (!f) continue;
    who.forEach((x, i) => {
      const sl = f.slope(xs[i]);
      if (sl < 0.03) return;
      const resid = ys[i] - f.fit(xs[i]);
      const dz = Math.max(-0.7, Math.min(0.7, (resid / sl) * ws[i]));
      out.get(x.p.id)!.dz[o.k] += PERF.skill * dz;
    });
  }
  // 2) overall production per 36 minutes against what his overall rating predicts
  const xs = lines.map(x => bpmOf(x.p.z)), ys = lines.map(x => gameScore(x.l) / x.l.min * 36), ws = lines.map(x => x.l.min);
  const f = wls(xs, ys, ws);
  if (f) lines.forEach(({ p, l }, i) => {
    const sl = Math.max(0.3, f.slope(xs[i]));
    const bpmShift = Math.max(-4, Math.min(4, (ys[i] - f.fit(xs[i])) / sl));
    const w = l.min / (l.min + 900);
    const d = out.get(p.id)!.dz;
    for (let k = 0; k < NK; k++) d[k] += PERF.overall * bpmShift * w * OVR_DIR[k];
  });
  for (const { p } of lines) {
    const d = out.get(p.id)!;
    d.dz[K.def] += 0.3 * (d.dz[K.stl] + d.dz[K.blk] + d.dz[K.drb]) / 3;
    d.ovrGain = ovrOf(p.z.map((v, i) => v + d.dz[i])) - ovrOf(p.z);
  }
  return out;
}
const gameScore = (l: StatLine) => l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;

export function develop(lg: League, rng: Rng) {
  if (!OVR_DIR.length) initDev();
  const Y = lg.season, d = lg.destiny;
  if (!OVR_DIR.length) initDev();
  const perf = performanceShift(lg, Y);
  for (const p of Object.values(lg.players)) {
    if (p.retired) continue;
    if (p.entered === Y + 1) { ensureDev(p, rng); continue; } // just drafted: ratings already set
    const dev = ensureDev(p, rng);
    const age = ageIn(p, Y);
    const ai = agingIndex(age - dev.peak);
    const z0 = p.z.slice();
    // 1) what he showed on the court
    const pf = perf.get(p.id);
    const flop = !!pf && pf.ovrGain < YOUNG.flop;
    (dev as any).flop = flop;
    if (pf) {
      const ageF = age <= 24 ? 1 : age <= 28 ? 0.85 : age <= 31 ? 0.6 : 0.4;
      // young players: playing close to their rating costs nothing, a real flop costs less than for veterans
      const young = age <= YOUNG.maxAge;
      if (young && pf.ovrGain < 0 && pf.ovrGain > -YOUNG.deadZone) pf.dz.fill(0), pf.ovrGain = 0;
      const neg = young ? YOUNG.negFactor : 0.7;
      const a = PERF.alpha * ageF * (pf.ovrGain < 0 ? neg : 1);
      const gain = pf.ovrGain * a;
      const cap = Math.abs(gain) > PERF.maxStep ? PERF.maxStep / Math.abs(gain) : 1;
      for (let i = 0; i < NK; i++) p.z[i] += pf.dz[i] * a * cap;
    }
    // 2) age, potential and year-to-year noise
    const before = ovrOf(p.z);
    const potBoost = age <= 24 ? 0.05 : age <= 27 ? 0.025 : 0;
    const nat = new Array(NK).fill(0);
    const eNew = new Array(NK).fill(0);
    for (let i = 0; i < NK; i++) {
      const a = H.aging[H.keys[i]];
      const pot = (TENDENCY.has(i) ? 0.4 : 1) * potBoost * dev.pot * (i === K.tov || i === K.pf ? -1 : 1);
      eNew[i] = DEV.ar * dev.e[i] + rng.normal() * a.sd[ai] * DEV.noise * dev.vol;
      // trend moves with the aging curve; the noise component is replaced, not added on top
      nat[i] = a.mean[ai] + pot + (eNew[i] - dev.e[i]);
    }
    // veterans: the data's aging curve only sees survivors, so enforce a minimum
    // expected decline after 30 (in BPM per year) along the overall-rating direction
    const minDrop = age < 30 ? 0 : Math.min(1.8, 0.25 + 0.17 * (age - 30));
    if (minDrop > 0) {
      const meanOnly = p.z.map((v, i) => v + H.aging[H.keys[i]].mean[ai]);
      const drift = bpmOf(meanOnly) - bpmOf(p.z);
      const extra = Math.max(0, drift + minDrop);
      if (extra > 0) for (let i = 0; i < NK; i++) nat[i] -= extra * OVR_DIR[i];
    }
    // no single off-season moves a player more than DEV.maxOvrStep overall points
    const trial = p.z.map((v, i) => v + nat[i]);
    const step = ovrOf(trial) - before;
    const scale = Math.abs(step) > DEV.maxOvrStep ? DEV.maxOvrStep / Math.abs(step) : 1;
    for (let i = 0; i < NK; i++) p.z[i] += nat[i] * scale;
    dev.e = eNew;
    // young players who did not flop lose at most a little in one summer
    const maxDrop = age <= 22 ? YOUNG.maxDrop[0] : age <= 24 ? YOUNG.maxDrop[1] : age <= YOUNG.maxAge ? YOUNG.maxDrop[2] : Infinity;
    // grown players don't swing wildly: one summer moves a single skill by at most maxSkillStep (≈7 rating points)
    if (age >= 24) for (let i = 0; i < NK; i++) { const dv = p.z[i] - z0[i]; if (Math.abs(dv) > DEV.maxSkillStep) p.z[i] = z0[i] + Math.sign(dv) * DEV.maxSkillStep; }
    // and in his prime (26–29) a player who did not flop loses at most a few points in one summer
    // (a bad season – a flop – may cost a little more; serious injuries are handled separately)
    const primeCap = age >= 25 && age <= 29 ? (flop ? DEV.primeDrop + 1.5 : DEV.primeDrop) : Infinity;
    if ((flop || maxDrop === Infinity) && primeCap < Infinity) {
      const o0 = ovrOf(z0), drop = ovrOf(p.z) - o0;
      if (drop < -primeCap) {
        let lo = 0, hi = 1;
        for (let it = 0; it < 12; it++) { const t = (lo + hi) / 2; if (ovrOf(z0.map((v, i) => v + t * (p.z[i] - v))) - o0 >= -primeCap) lo = t; else hi = t; }
        for (let i = 0; i < NK; i++) p.z[i] = z0[i] + lo * (p.z[i] - z0[i]);
      }
    }
    if (!flop && maxDrop < Infinity) {
      const o0 = ovrOf(z0), drop = ovrOf(p.z) - o0;
      if (drop < -maxDrop) {
        let lo = 0, hi = 1; // largest share of this summer's change that keeps the drop within the limit
        for (let it = 0; it < 12; it++) { const t = (lo + hi) / 2; if (ovrOf(z0.map((v, i) => v + t * (p.z[i] - v))) - o0 >= -maxDrop) lo = t; else hi = t; }
        for (let i = 0; i < NK; i++) p.z[i] = z0[i] + lo * (p.z[i] - z0[i]);
      }
    }
    // destiny: pull toward the real career
    const tgt = realTarget(p.id, Y + 1 - (p.shift ?? 0));
    if (tgt) for (let i = 0; i < NK; i++) p.z[i] += d * (tgt.z[i] - p.z[i]);
    // soft ceiling on single skills (not applied to real values under full destiny)
    const s = 1 - (tgt ? d : 0);
    for (let i = 0; i < NK; i++) {
      const v = p.z[i];
      if (v > DEV.soft) p.z[i] = v - s * 0.5 * (v - DEV.soft);
      else if (v < -DEV.soft - 0.5) p.z[i] = v - s * 0.5 * (v + DEV.soft + 0.5);
    }
    zClamp(p.z);
    snapRatings(p, Y + 1);
  }
}

// ------------------------------------------------------------------ league profile
export interface Profile { mean: number[]; bpmMean: number; bpmSd: number; top10: number; rotOvr: number; n80: number }
const W = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];

function profileOf(teams: number[][][]): Profile {
  // teams: list of rosters, each a list of z vectors
  const mean = new Array(NK).fill(0);
  let sw = 0;
  const bp: [number, number][] = [];
  const all: number[] = [];
  for (const roster of teams) {
    const sorted = roster.map(z => ({ z, b: bpmOf(z) })).sort((a, b) => b.b - a.b);
    for (const x of sorted) all.push(x.b);
    sorted.slice(0, 10).forEach((x, i) => {
      const w = W[i];
      for (let k = 0; k < NK; k++) mean[k] += w * x.z[k];
      bp.push([x.b, w]);
      sw += w;
    });
  }
  for (let k = 0; k < NK; k++) mean[k] /= sw;
  const bm = bp.reduce((a, [b, w]) => a + b * w, 0) / sw;
  const bsd = Math.sqrt(bp.reduce((a, [b, w]) => a + w * (b - bm) ** 2, 0) / sw);
  all.sort((a, b) => b - a);
  const top10 = all.slice(0, 10).reduce((a, b) => a + ovrOf0(b), 0) / Math.min(10, all.length);
  return { mean, bpmMean: bm, bpmSd: bsd, top10, rotOvr: ovrOf0(bm), n80: all.filter(b => ovrOf0(b) >= 80).length };
}
const ovrOf0 = (b: number) => Math.max(25, Math.min(99, 48 + 5.5 * b));

const realCache: Record<number, Profile> = {};
export function realProfile(season: number): Profile {
  const S = Math.min(Math.max(season, FIRST_SEASON), LAST_SEASON);
  if (realCache[S]) return realCache[S];
  const byTeam: Record<string, number[][]> = {};
  for (const hp of Object.values(H.players)) {
    const r = hp.s.find(x => x[0] === S);
    if (!r || r[3] < 300) continue;
    (byTeam[r[1]] ??= []).push(r[7]);
  }
  return (realCache[S] = profileOf(Object.values(byTeam)));
}

export function simProfile(lg: League): Profile {
  const rosters = Object.values(lg.teams).filter(t => t.active).map(t => t.roster.map(pid => lg.players[pid].z));
  return profileOf(rosters);
}

export interface HealthRec { s: number; sim: Profile; real: Profile; shift: number; spread: number }

/** Pull league-wide drift back toward the real league of this season. */
/**
 * After the league-wide recalibration: young players who did not flop end the
 * summer at most YOUNG.maxDrop below last season's rating (the recalibration
 * moves everyone and could otherwise undo the leniency).
 */
export function youngFloor(lg: League) {
  if (!OVR_DIR.length) initDev();
  const S = lg.season;
  for (const p of Object.values(lg.players)) {
    if (p.retired || !p.dev || (p.dev as any).flop) continue;
    const age = ageIn(p, S - 1);
    const maxDrop = age <= 22 ? YOUNG.maxDrop[0] : age <= 24 ? YOUNG.maxDrop[1] : age <= YOUNG.maxAge ? YOUNG.maxDrop[2] : Infinity;
    if (maxDrop === Infinity) continue;
    const prev = p.ovrHist.find(h => h[0] === S - 1)?.[1];
    if (prev === undefined) continue;
    const target = prev - maxDrop;
    if (ovrOf(p.z) >= target) continue;
    let lo = 0, hi = 3;
    for (let it = 0; it < 14; it++) { const t = (lo + hi) / 2; if (ovrOf(p.z.map((v, i) => v + t * OVR_DIR[i])) >= target) hi = t; else lo = t; }
    for (let i = 0; i < NK; i++) p.z[i] += hi * OVR_DIR[i];
    zClamp(p.z);
    snapRatings(p, S);
  }
}

export function normalizeLeague(lg: League) {
  const S = lg.season;
  const real = realProfile(S);
  const before = simProfile(lg);
  const str = 0.8 * (1 - lg.destiny);
  const players = Object.values(lg.players).filter(p => !p.retired);
  let shiftSize = 0;
  if (str > 0) {
    const shift = before.mean.map((m, k) => {
      const diff = real.mean[k] - m;
      return Math.abs(diff) > 0.03 ? str * diff : 0;
    });
    shiftSize = Math.sqrt(shift.reduce((a, x) => a + x * x, 0));
    for (const p of players) for (let k = 0; k < NK; k++) p.z[k] += shift[k];
  }
  let spread = 1;
  const mid = simProfile(lg);
  const r = real.bpmSd / Math.max(0.1, mid.bpmSd);
  if (str > 0 && (r < 0.94 || r > 1.1)) {
    spread = 1 + str * (r - 1);
    for (const p of players) for (let k = 0; k < NK; k++) p.z[k] = mid.mean[k] + (p.z[k] - mid.mean[k]) * spread;
  }
  for (const p of players) {
    zClamp(p.z);
    if (p.ovrHist.length && p.ovrHist[p.ovrHist.length - 1][0] === S) snapRatings(p, S);
  }
  const rec: HealthRec = { s: S, sim: simProfile(lg), real, shift: Math.round(shiftSize * 1000) / 1000, spread: Math.round(spread * 1000) / 1000 };
  (lg.health ??= []).push(rec);
  if (lg.health.length > 80) lg.health.shift();
  return rec;
}

export function recordHealth(lg: League) {
  const rec: HealthRec = { s: lg.season, sim: simProfile(lg), real: realProfile(lg.season), shift: 0, spread: 1 };
  (lg.health ??= []).push(rec);
}
