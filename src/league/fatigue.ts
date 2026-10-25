// Fatigue between games. Every game adds load (minutes, less for players with
// good endurance, more for veterans); every calendar day some of it wears off
// (more slowly with age). Playoff days are spaced like the real playoffs (a
// rest day between games). The engine turns tip-off fatigue into weaker legs:
// rebounding, defence, steals, blocks and getting to the line suffer most,
// finishing a little, shooting barely; tired players also start with less
// energy and the coach trims their minutes.
import { League, Player, GameResult } from '../types';
import { ageIn } from '../players';

export const FAT = {
  load: 0.6,          // per minute played
  decay: 0.55,        // share left after one day (age ≤ 28)
  decayAge: 0.015,    // slower recovery per year over 28
  decayMax: 0.7,
  free: 6,            // fatigue up to this level has no effect
};

const lastRegDay = (lg: League) => (lg.schedule.length ? Math.max(...lg.schedule.map(g => g.day)) : 0);

/** Calendar day of a game day index (playoff days count double: a rest day between games). */
export function calDay(lg: League, day: number, po: boolean) {
  if (!po) return day;
  const base = lastRegDay(lg) + 1;
  return base + 2 * Math.max(0, day - base);
}

function decayOf(p: Player, season: number) {
  const age = ageIn(p, season);
  return Math.min(FAT.decayMax, FAT.decay + Math.max(0, age - 28) * FAT.decayAge);
}

/** Fatigue a player carries into a game on calendar day `cal`. */
export function fatigueAt(lg: League, p: Player, cal: number) {
  if (!p.fat || p.fatDay === undefined) return 0;
  const days = Math.max(0, cal - p.fatDay);
  return p.fat * Math.pow(decayOf(p, lg.season), days);
}

/** Calendar day of the next game (regular season or playoffs). */
export function nextCal(lg: League, todayIndex: number) {
  return lg.phase === 'playoffs' ? calDay(lg, lg.day, true) : calDay(lg, todayIndex, false);
}

/** After a game: the load each player who played takes home. */
export function addLoad(lg: League, res: GameResult) {
  const cal = calDay(lg, res.day, res.po);
  for (const b of [res.home, res.away]) for (const pl of b.players) {
    if (pl.st.min <= 0) continue;
    const p = lg.players[pl.pid];
    const age = ageIn(p, lg.season);
    const before = p.fatNow ?? fatigueAt(lg, p, cal);
    const load = FAT.load * pl.st.min * (1 - 0.1 * p.endur) * (1 + Math.max(0, age - 30) * 0.04);
    p.fat = before + load;
    p.fatDay = cal;
    p.fatNow = undefined;
  }
}

/** Effective fatigue beyond the free level (what the engine and injuries use). */
export const fatigueExcess = (f: number | undefined) => Math.max(0, (f ?? 0) - FAT.free);

/** Words for the UI. */
export function fatigueLabel(f: number) {
  const s = fatigueExcess(f);
  return s < 2 ? 'Fresh' : s < 8 ? 'Slightly tired' : s < 15 ? 'Tired' : 'Exhausted';
}

export function resetFatigue(lg: League) {
  for (const p of Object.values(lg.players)) { delete p.fat; delete p.fatDay; delete p.fatNow; }
}
