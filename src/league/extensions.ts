// Contract extensions during the regular season: a player in the last year of
// his contract may sign on for more years with his team. Whether he does
// depends on the money and on how things are going for him (role, winning,
// age, ambition), see prefs.extensionNeed.
import { Rng } from '../rng';
import { League, Player } from '../types';
import { tagOf, ageIn, addTx } from '../players';
import { playerValue, maxSalary, MIN_SAL, contractYears, hardCap } from '../ai/value';
import { extensionNeed, extensionChance } from './prefs';
import { rngOf } from './league';
const save = (lg: League, r: Rng) => { lg.rng = [...r.s] as any; };
import { shownOvr } from '../data';
import { isHuman } from './humans';

/** Next season's payroll: contracts that run on, signed extensions, dead money. */
export function nextPayroll(lg: League, tid: string) {
  const S = lg.season;
  let v = 0;
  for (const d of lg.dead ?? []) if (d.tid === tid && d.exp > S) v += d.sal;
  for (const pid of lg.teams[tid].roster) {
    const p = lg.players[pid];
    if (p.ext) v += p.ext.sal;
    else if (p.contract.exp > S) v += p.contract.sal;
  }
  return v;
}

export function extendable(lg: League, p: Player) {
  return lg.phase === 'regular' && !!p.tid && p.contract.exp === lg.season && !p.ext;
}

/** The user offers an extension (salary as share of the cap, years from next season). */
export function userExtend(lg: League, pid: string, sal: number, years: number): { ok: boolean; msg: string } {
  const p = lg.players[pid];
  const tid = lg.userTid;
  if (!p || !tid || p.tid !== tid) return { ok: false, msg: 'This player is not on your team.' };
  if (!extendable(lg, p)) return { ok: false, msg: 'Extensions are possible during the regular season for players whose contract ends this season.' };
  const N = lg.season + 1;
  const max = maxSalary(p, N);
  if (sal > max + 1e-9) return { ok: false, msg: `The most you can offer is a max contract: ${(max * 100).toFixed(1)}% of the cap.` };
  sal = Math.max(MIN_SAL, sal);
  const hc = hardCap(lg);
  if (nextPayroll(lg, tid) + sal > hc + 1e-9) return { ok: false, msg: `You would exceed the hard cap next season (${Math.round(hc * 100)}% of the cap): ${Math.round(nextPayroll(lg, tid) * 100)}% is already committed.` };
  if ((p.extNo ?? -1) > lg.day) return { ok: false, msg: `${p.name} turned down your last offer and is not talking for now – try again in ${p.extNo! - lg.day} days.` };
  const { need, why, chance } = extensionChance(lg, p, tid, sal, years);
  if (chance <= 0) return { ok: false, msg: extensionChance(lg, p, tid, sal, years).out ? `${p.name} wants out – no contract would keep him; he is going to free agency.` : `${p.name} says no: he wants at least ${(need * 100).toFixed(1)}% of the cap for ${years} yrs${why.length ? ` (${why.join(', ')})` : ''}.` };
  if (chance < 1) {
    // below his number: a gamble – and a refusal ends the talks for a while
    const rng = rngOf(lg);
    const yes = rng.chance(chance);
    save(lg, rng);
    if (!yes) {
      p.extNo = lg.day + 10;
      return { ok: false, msg: `${p.name} turned it down (${Math.round(chance * 100)}% chance) – he wanted ${(need * 100).toFixed(1)}% of the cap. No more talks for 10 days.` };
    }
  }
  p.ext = { sal, exp: lg.season + years };
  addTx(p, lg.season, `Signed an in-season extension with ${lg.teams[tid].name}: ${years} yrs, ${(sal * 100).toFixed(1)}% of the cap per season`, lg.day);
  lg.news.push({ s: lg.season, t: `${lg.teams[tid].name} extended ${tagOf(p, lg.season)}: ${years} yrs, ${(sal * 100).toFixed(1)}% of the cap per season.` });
  return { ok: true, msg: `${p.name} agreed: ${years} yrs from the ${N - 1}–${String(N).slice(2)} season, ${(sal * 100).toFixed(1)}% of the cap per season${why.length ? ` (${why.join(', ')})` : ''}.` };
}

/** AI teams try to extend the players they want to keep, a few at a time through the season. */
export function aiExtensions(lg: League, rng: Rng) {
  const N = lg.season + 1;
  for (const t of Object.values(lg.teams)) {
    if (!t.active || isHuman(lg, t.tid)) continue;
    const ranked = t.roster.map(pid => lg.players[pid]).sort((a, b) => playerValue(b, N, t.strategy) - playerValue(a, N, t.strategy));
    for (const p of ranked) {
      if (!extendable(lg, p) || !rng.chance(0.12)) continue;
      const rank = ranked.indexOf(p);
      if (rank >= 7) continue;
      if (t.strategy === 'rebuild' && ageIn(p, N) >= 30) continue;
      const years = contractYears(p, N, () => rng.next());
      const { need } = extensionNeed(lg, p, t.tid, years);
      const worth = playerValue(p, N, t.strategy) / Math.max(MIN_SAL, need);
      if (worth < 12) continue;
      // the team offers a little under his number and meets him if he insists
      const offer = rng.chance(0.5) ? need * 0.95 : need;
      if (offer + 1e-9 < need) continue;
      if (nextPayroll(lg, t.tid) + offer > hardCap(lg)) continue;
      p.ext = { sal: offer, exp: lg.season + years };
      addTx(p, lg.season, `Signed an in-season extension with ${t.name}: ${years} yrs, ${(offer * 100).toFixed(1)}% of the cap per season`, lg.day);
      if (shownOvr(p.z) >= 85) lg.news.push({ s: lg.season, t: `${t.name} extended ${tagOf(p, lg.season)}: ${years} yrs.` });
    }
  }
}
