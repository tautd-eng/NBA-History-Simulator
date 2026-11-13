// A front office's view of its own team: who it builds around, which young players could grow into that,
// where its own picks are likely to land and what the coming draft offers – and from that, whether this
// is the time to act (push for a title, add a piece) or to wait (develop, keep the picks, let the young play).
// Re-assessed at the start of each season, through the season and after every trade the team makes.
import { League, Player, Team } from '../types';
import { shownOvr, shownFromBpm, OVR_VOLUME, K } from '../data';
import { peakBpm, teamStrength } from './value';
import { ageIn } from '../players';
import { expectedSlot, youngCore, pickUsed } from './trades';
import { slotPeak } from './tradevalue';

export interface TeamPlan {
  s: number; ph: string; day: number;
  stage: 'contend' | 'push' | 'build' | 'rebuild';
  act: boolean;                  // time to use future assets to get better now
  core: string[];                // the players the team is built around: kept through cap trouble, not sold cheaply
  rising: string[];              // young players who could become core: they play, and they are not shopped
  ownFirst: number | null;       // projected slot of the team's own first-round pick in the coming draft (null = traded away)
  extraFirsts: number;           // other teams' firsts it holds (coming two drafts)
  classStrong: number;           // coming class against an average one at the top (-1 … +1)
  tankOk: boolean;               // losing pays off: it owns its pick and it should be high
  why: string[];
}

/** Displayed overall he is projected to peak at. */
export function peakShown(p: Player, S: number) {
  return shownFromBpm(-0.35 + (peakBpm(p, S) + OVR_VOLUME * p.z[K.usg] + 0.35) * 0.753);
}

function classStrength(lg: League, season: number) {
  const c = lg.draftClass;
  if (!c || c.year !== season) return 0;
  const top = c.pool.map(id => lg.players[id]).filter(p => p?.prospect)
    .map(p => peakBpm(p, c.year + 1)).sort((a, b) => b - a).slice(0, 6);
  if (!top.length) return 0;
  let d = 0;
  top.forEach((v, i) => { d += v - slotPeak(i + 1); });
  return Math.max(-1, Math.min(1, d / top.length / 1.5));
}

/** The team's own players, plus (in free agency) its own free agents it still holds the rights to. */
function people(lg: League, t: Team) {
  const ros = t.roster.map(pid => lg.players[pid]);
  if (lg.phase !== 'freeagency') return ros;
  const own = Object.values(lg.players).filter(p => !p.tid && !p.retired && (p.bird === t.tid || p.rfa === t.tid));
  return [...ros, ...own];
}

export function assessTeam(lg: League, t: Team, rankFrac?: number): TeamPlan {
  const S = lg.season;
  if (rankFrac === undefined) {
    const ts = Object.values(lg.teams).filter(x => x.active).map(x => ({ x, s: teamStrength(lg, x.tid) })).sort((a, b) => a.s - b.s);
    rankFrac = ts.findIndex(r => r.x === t) / Math.max(1, ts.length - 1);
  }
  const all = people(lg, t);
  const ovr = new Map(all.map(p => [p.id, shownOvr(p.z, p.id)]));
  const sorted = [...all].sort((a, b) => ovr.get(b.id)! - ovr.get(a.id)!);
  const third = sorted[2] ? ovr.get(sorted[2].id)! : 0;
  // core: the stars, and the best players of a team that is good enough to build around them
  const core = sorted.filter(p => {
    const o = ovr.get(p.id)!, a = ageIn(p, S);
    return (o >= 85 && a <= 33) || (o >= 80 && o >= third && a <= 31) || (o >= 78 && a <= 25 && o >= third);
  }).slice(0, 4);
  // rising: young players with a starter's ceiling, and the recent high picks
  const rising = all.filter(p => !core.includes(p) && ageIn(p, S) <= 23 && (peakShown(p, S) >= 83 || youngCore(lg, p)))
    .sort((a, b) => peakShown(b, S) - peakShown(a, S)).slice(0, 3);
  const picks = (lg.picks ?? []).filter(pk => pk.round === 1 && pk.owner === t.tid && pk.season >= S && pk.season <= S + 1 && !pickUsed(lg, pk));
  const own = picks.find(pk => pk.season === S && pk.orig === t.tid);
  const ownFirst = own ? Math.round(expectedSlot(lg, own)) : null;
  const extraFirsts = picks.filter(pk => pk.orig !== t.tid).length;
  const classStrong = classStrength(lg, S);
  const coreAge = core.length ? core.reduce((a, p) => a + ageIn(p, S), 0) / core.length : 0;
  const bestRise = rising.length ? peakShown(rising[0], S) : 0;
  const why: string[] = [];
  let stage: TeamPlan['stage'];
  if (rankFrac >= 0.75 && core.length >= 2) { stage = 'contend'; why.push('a top team with a core to win with'); }
  else if (rankFrac >= 0.5 && core.length >= 1 && coreAge <= 31) { stage = 'push'; why.push('a playoff team – one more piece could make it a contender'); }
  else if (rising.length >= 2 || bestRise >= 88 || (rising.length && core.length && coreAge <= 26)) { stage = 'build'; why.push('young players worth building around – they need minutes, not to be traded'); }
  else if (rankFrac >= 0.5) { stage = 'push'; why.push('good enough for the playoffs, no real core yet'); }
  else { stage = 'rebuild'; why.push('no core to build around yet'); }
  if (coreAge >= 30 && stage === 'contend') why.push('the core is ageing – the window is now');
  const tankOk = ownFirst !== null && ownFirst <= 8 && stage !== 'contend';
  if (ownFirst === null && stage !== 'contend' && rankFrac < 0.4) why.push('does not own its own first – losing would only help someone else');
  else if (tankOk) why.push(`own pick projected around #${ownFirst}${classStrong > 0.25 ? ' in a strong class' : classStrong < -0.25 ? ' in a thin class' : ''}`);
  if (extraFirsts) why.push(`holds ${extraFirsts} extra first${extraFirsts > 1 ? 's' : ''} to deal with`);
  const act = stage === 'contend' || (stage === 'push' && (coreAge >= 27 || extraFirsts > 0));
  return { s: S, ph: lg.phase, day: lg.day, stage, act, core: core.map(p => p.id), rising: rising.map(p => p.id), ownFirst, extraFirsts, classStrong, tankOk, why };
}

/** Plans for every AI team (and the user's, for display), ranked by strength once. */
export function refreshPlans(lg: League, strength?: Map<string, number>) {
  const ts = Object.values(lg.teams).filter(x => x.active).map(x => ({ x, s: strength?.get(x.tid) ?? teamStrength(lg, x.tid) })).sort((a, b) => a.s - b.s);
  ts.forEach((r, i) => { r.x.plan = assessTeam(lg, r.x, i / Math.max(1, ts.length - 1)); });
}

/** The team's plan (assessed now if it has none for this season). */
export function planOf(lg: League, tid: string | null | undefined): TeamPlan | null {
  if (!tid) return null;
  const t = lg.teams[tid];
  if (!t) return null;
  if (!t.plan || t.plan.s !== lg.season) t.plan = assessTeam(lg, t);
  return t.plan;
}
export const isCore = (lg: League, p: Player) => !!planOf(lg, p.tid ?? p.bird ?? p.rfa)?.core.includes(p.id);
export const isRising = (lg: League, p: Player) => !!planOf(lg, p.tid ?? p.bird ?? p.rfa)?.rising.includes(p.id);
/** Core or rising for this team: the players it keeps through cap trouble. */
export const keeps = (lg: League, tid: string, p: Player) => { const pl = planOf(lg, tid); return !!pl && (pl.core.includes(p.id) || pl.rising.includes(p.id)); };
