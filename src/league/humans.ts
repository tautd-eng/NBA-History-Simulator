// Teams run by people. In a hot-seat league several people share one league on one computer: each runs a
// team, and lg.userTid is the one being played right now (the screens show that team; "Playing as" switches).
// The AI never makes decisions for any of them.
import { League } from '../types';

/** All human-run teams (an older save has just the one). */
export function humans(lg: League): string[] {
  const h = (lg.humans ?? []).filter(t => lg.teams[t]);
  if (lg.userTid && !h.includes(lg.userTid)) h.unshift(lg.userTid);
  return h;
}
export function isHuman(lg: League, tid: string | null | undefined): boolean {
  return !!tid && (tid === lg.userTid || (lg.humans ?? []).includes(tid));
}
/** Hand the controls to another human team (hot seat). */
export function playAs(lg: League, tid: string) {
  if (!isHuman(lg, tid)) return;
  lg.userTid = tid;
}
/** Add or remove a team from the human ones (at least one stays human if any was). */
export function setHuman(lg: League, tid: string, on: boolean) {
  const h = new Set(humans(lg));
  if (on) h.add(tid); else h.delete(tid);
  lg.humans = [...h];
  if (on && !lg.userTid) lg.userTid = tid;
  if (!on && lg.userTid === tid) lg.userTid = lg.humans[0] ?? null;
}
