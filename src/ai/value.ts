// Player valuation shared by every AI decision (draft, contracts, free agency,
// expansion protection, roster cuts) so the GMs act consistently.
import { H, NK, bpmOf, agingIndex } from '../data';
import { Player, Team, League } from '../types';
import { ageIn } from '../players';

const REPL = -2.5; // replacement level, BPM

/** BPM projection for the next `years` seasons using the mean aging curves. */
export function projectBpm(z: number[], age: number, years: number): number[] {
  const out: number[] = [];
  let cur = z.slice();
  for (let y = 0; y < years; y++) {
    out.push(bpmOf(cur));
    const ai = agingIndex(age + y);
    cur = cur.map((v, i) => v + H.aging[H.keys[i]].mean[ai]);
  }
  return out;
}

/** Peak BPM expected over the next years (used for prospects). */
export function peakBpm(p: Player, season: number) {
  const proj = projectBpm(p.z, ageIn(p, season), 8);
  return Math.max(...proj);
}

/**
 * Value of a player to a team in "wins-above-replacement-ish" units.
 * horizon weights depend on the team's strategy: contenders care about now,
 * rebuilding teams about the future.
 */
export function playerValue(p: Player, season: number, strategy: Team['strategy'] = 'middle') {
  return valueFromZ(p.z, ageIn(p, season), strategy);
}
export function valueFromZ(z: number[], age: number, strategy: Team['strategy'] = 'middle') {
  const proj = projectBpm(z, age, 5);
  const w = strategy === 'contend' ? [1.6, 0.8, 0.45, 0.25, 0.15] : strategy === 'rebuild' ? [0.5, 0.8, 0.9, 0.85, 0.75] : [1.1, 0.85, 0.65, 0.45, 0.3];
  let v = 0;
  for (let i = 0; i < 5; i++) v += w[i] * Math.max(0, proj[i] - REPL);
  return v;
}

export const MIN_SAL = 0.012;
/** Market salary curve: share of the cap = SAL_K × (BPM above replacement)^SAL_EXP, capped by the maximum. */
export let SAL_K = 0.040;
export const SAL_EXP = 1.3;
export function setSalK(k: number) { SAL_K = k; }
export const MAX_SAL = 0.3;
/**
 * Maximum salary. From the 1999 agreement it depends on years in the league:
 * 25% of the cap (0–6 years), 30% (7–9), 35% (10+), or 105% of his previous
 * salary if that is more. Before it there was no individual maximum; 40% of
 * the cap is used as a practical ceiling.
 */
export function maxSalary(p: Player, season: number) {
  if (season < 2000) return 0.4;
  const yos = season - p.entered;
  const tier = yos <= 6 ? 0.25 : yos <= 9 ? 0.3 : 0.35;
  return Math.max(tier, Math.min(0.45, (p.contract?.sal ?? 0) * 1.05));
}

/** Veteran minimum: grows with years in the league (rookie minimum 1.2% of the cap, 10+ years 2.2%). */
export function vetMin(p: Player, season: number) {
  return MIN_SAL + 0.001 * Math.max(0, Math.min(10, season - p.entered));
}

/** Asking salary as a share of the salary cap. */
export function askingSalary(p: Player, season: number) {
  const age = ageIn(p, season);
  const proj = projectBpm(p.z, age, 2);
  const b = Math.max(0, (proj[0] + proj[1]) / 2 - REPL);
  return Math.min(maxSalary(p, season), Math.max(vetMin(p, season), SAL_K * Math.pow(b, SAL_EXP)));
}

export function contractYears(p: Player, season: number, rnd: () => number) {
  const age = ageIn(p, season);
  if (age <= 24) return 3 + Math.floor(rnd() * 2);
  if (age <= 29) return 2 + Math.floor(rnd() * 4);
  if (age <= 32) return 1 + Math.floor(rnd() * 3);
  return 1 + Math.floor(rnd() * 2);
}

/** Hard payroll limit (share of the cap) every team must stay under. */
export function hardCap(lg: League) {
  const h = lg.settings?.hardCap;
  return h === null ? Infinity : (h ?? 1.35);
}

export function payroll(lg: League, tid: string) {
  const dead = (lg.dead ?? []).reduce((a, d) => a + (d.tid === tid && d.exp >= lg.season ? d.sal : 0), 0);
  return lg.teams[tid].roster.reduce((a, pid) => a + lg.players[pid].contract.sal, 0) + dead;
}

/** Team strength = minutes-weighted BPM of its best eight. */
export function teamStrength(lg: League, tid: string, season = lg.season) {
  const b = lg.teams[tid].roster.map(pid => bpmOf(lg.players[pid].z)).sort((a, c) => c - a).slice(0, 8);
  const w = [36, 34, 32, 30, 28, 24, 20, 16];
  return b.reduce((a, x, i) => a + x * w[i], 0) / 240 * 5;
}

export function zClamp(z: number[]) {
  for (let i = 0; i < NK; i++) z[i] = Math.max(-4, Math.min(4, z[i]));
  return z;
}
