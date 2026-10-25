import { Rng } from '../rng';
import { Game, Team } from '../types';

/**
 * Balanced schedule: every pair of teams meets at least floor(G/(n-1)) times,
 * the remaining games go to same-conference opponents first. Then games are
 * packed into days so no team plays twice on one day.
 */
export function makeSchedule(teams: Team[], G: number, rng: Rng, startId: number): Game[] {
  const n = teams.length;
  const ids = teams.map(t => t.tid);
  const conf = Object.fromEntries(teams.map(t => [t.tid, t.conf]));
  const base = Math.floor(G / (n - 1));
  const count: Record<string, number> = {};
  const need: Record<string, number> = {};
  const key = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);
  for (const a of ids) need[a] = G - base * (n - 1);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) count[key(ids[i], ids[j])] = base;

  let guard = 0;
  while (guard++ < 100000) {
    const left = ids.filter(a => need[a] > 0);
    if (!left.length) break;
    left.sort((a, b) => need[b] - need[a] || rng.next() - 0.5);
    const a = left[0];
    const cands = left.filter(b => b !== a);
    if (!cands.length) break;
    cands.sort((b, c) => {
      const sb = (conf[b] === conf[a] ? 0 : 2) + count[key(a, b)] * 0.7 + rng.next();
      const sc = (conf[c] === conf[a] ? 0 : 2) + count[key(a, c)] * 0.7 + rng.next();
      return sb - sc;
    });
    const b = cands[0];
    count[key(a, b)]++; need[a]--; need[b]--;
  }

  const games: { home: string; away: string }[] = [];
  for (const [k, c] of Object.entries(count)) {
    const [a, b] = k.split('|');
    // odd number of meetings: the extra home game follows a parity rule so
    // every team gets (almost) as many home games as away games
    const ia = ids.indexOf(a), ib = ids.indexOf(b);
    const flip = c % 2 === 1 ? ((ia + ib) % 2 === 0) === (ia < ib) : rng.chance(0.5);
    for (let i = 0; i < c; i++) {
      const h = (i % 2 === 0) !== flip ? a : b;
      games.push({ home: h, away: h === a ? b : a });
    }
  }
  return packDays(games, ids, G, rng, startId);
}

/**
 * Day-by-day calendar: every day the teams furthest behind the season's pace
 * play first, so games played stay level across the league (within about two
 * games). Back-to-backs happen, three days in a row never; the season lasts
 * about two days per game per team.
 */
/** Chance per day that a team which played yesterday may play again (≈15 back-to-backs in 82 games). */
const B2B_CHANCE = 0.3;

function packDays(games: { home: string; away: string }[], ids: string[], G: number, rng: Rng, startId: number): Game[] {
  const n = ids.length;
  const D = Math.max(G + 2, Math.round(G * 2.0));        // calendar days for the regular season
  const left = rng.shuffle([...games]);
  const played: Record<string, number> = Object.fromEntries(ids.map(t => [t, 0]));
  const lastDay: Record<string, number> = Object.fromEntries(ids.map(t => [t, -9]));
  const streak: Record<string, number> = Object.fromEntries(ids.map(t => [t, 0])); // consecutive days with a game
  const out: Game[] = [];
  let id = startId;
  for (let d = 0; left.length; d++) {
    const pace = Math.min(G, ((d + 1) * G) / D);                  // games each team "should" have after today
    const due = (t: string) => pace - played[t];                  // > 0: behind schedule
    const busy = new Set<string>();
    const lucky = new Set(ids.filter(() => rng.chance(B2B_CHANCE)));  // teams that may play the 2nd night of a back-to-back today
    const can = (t: string) => {
      if (busy.has(t)) return false;
      const b2b = lastDay[t] === d - 1;
      if (b2b && streak[t] >= 2) return false;                      // never three days in a row
      if (b2b) return (lucky.has(t) && due(t) > -1.1) || due(t) > 1.2 || d >= D;
      return due(t) > -0.8 || d >= D;
    };
    // most urgent games first (both teams behind), some noise so days differ
    const order = left.map((g, i) => ({ i, s: due(g.home) + due(g.away) + rng.next() * 0.8 })).sort((x, y) => y.s - x.s);
    const take: number[] = [];
    for (const { i } of order) {
      const g = left[i];
      if (!can(g.home) || !can(g.away)) continue;
      busy.add(g.home); busy.add(g.away);
      take.push(i);
      if (busy.size >= n - 1) break;
    }
    for (const i of take) {
      const g = left[i];
      out.push({ id: id++, day: d, home: g.home, away: g.away });
      for (const t of [g.home, g.away]) {
        streak[t] = lastDay[t] === d - 1 ? streak[t] + 1 : 1;
        lastDay[t] = d; played[t]++;
      }
    }
    for (const i of take.sort((x, y) => y - x)) left.splice(i, 1);
    if (d > D * 3) { // safety: should never happen
      for (const g of left) out.push({ id: id++, day: ++d, home: g.home, away: g.away });
      break;
    }
  }
  // day indexes are calendar days: days without games stay (rest days count for fatigue)
  out.sort((a, b) => a.day - b.day || a.id - b.id);
  return out;
}
