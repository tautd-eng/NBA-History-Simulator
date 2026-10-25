// Schedule check: games-played spread during the season, length, back-to-backs, home/away balance.
import { boot } from './harness';
import { makeSchedule } from '../src/league/schedule';
import { makeTeam } from '../src/league/league';
import { seasonInfo } from '../src/data';
import { Rng } from '../src/rng';
boot();
for (const [Y, G] of [[1980, 82], [1995, 82], [2024, 82], [2024, 29], [1999, 50], [2020, 72]] as const) {
  const rng = new Rng(Y + G);
  const teams = Object.entries(seasonInfo(Y).teams).map(([tid, t]) => makeTeam(tid, t.abbr, t.name, t.conf, rng));
  const s = makeSchedule(teams, G, rng, 1);
  const days = Math.max(...s.map(g => g.day)) + 1;
  const gp: Record<string, number> = Object.fromEntries(teams.map(t => [t.tid, 0]));
  const home: Record<string, number> = { ...gp };
  let worst = 0;
  const last: Record<string, number> = {}; const b2b: Record<string, number> = { ...gp }; let three = 0;
  const prevStreak: Record<string, number> = {};
  for (let d = 0; d < days; d++) {
    for (const g of s.filter(x => x.day === d)) for (const t of [g.home, g.away]) {
      gp[t]++; if (t === g.home) home[t]++;
      if (last[t] === d - 1) { b2b[t]++; prevStreak[t] = (prevStreak[t] ?? 1) + 1; if (prevStreak[t] >= 3) three++; } else prevStreak[t] = 1;
      last[t] = d;
    }
    const v = Object.values(gp); worst = Math.max(worst, Math.max(...v) - Math.min(...v));
  }
  const b = Object.values(b2b); const h = Object.values(home);
  const perDay = s.length / days;
  console.log(`${Y} G=${G} teams ${teams.length}: games ${s.length}, days ${days}, ~${perDay.toFixed(1)}/day | max GP gap during season ${worst} | final GP ${Math.min(...Object.values(gp))}-${Math.max(...Object.values(gp))} | B2B per team ${Math.min(...b)}-${Math.max(...b)} (avg ${(b.reduce((x, y) => x + y, 0) / b.length).toFixed(1)}) | 3-in-a-row ${three} | home ${Math.min(...h)}-${Math.max(...h)}`);
}
