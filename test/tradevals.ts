// Trade valuation probe: player and pick values, classic trade questions.
import { boot } from './harness';
import { newLeague } from '../src/league/league';
import { setEraCal } from '../src/engine/game';
import { shownOvr } from '../src/data';
import { ageIn } from '../src/players';
import { playerParts, moneyWeight, prospectValue } from '../src/ai/tradevalue';
import { evaluateTrade, pickTradeValue, threshold, ensurePicks } from '../src/ai/trades';
import cal from '../src/engine/eracal.json';
boot(); setEraCal(cal as any);
const start = +(process.argv[2] ?? 2010);
const lg = newLeague(0, 3, undefined, { start });
ensurePicks(lg);
const ps = Object.values(lg.players).filter(p => p.tid).sort((a, b) => shownOvr(b.z) - shownOvr(a.z));
const row = (p: any) => {
  const c = playerParts(lg, p, 'contend'), r = playerParts(lg, p, 'rebuild');
  return `${p.name.padEnd(22)} OVR ${shownOvr(p.z)} age ${ageIn(p, lg.season)} sal ${(p.contract.sal * 100).toFixed(0)}%→${p.contract.exp} | contend net ${(c.prod - 0.4 * c.cost).toFixed(1)} (prod ${c.prod.toFixed(1)} cost ${c.cost.toFixed(1)}) | rebuild net ${(r.prod - 0.55 * r.cost).toFixed(1)}`;
};
console.log('--- top players'); ps.slice(0, 8).forEach(p => console.log(row(p)));
console.log('--- around OVR 85'); ps.filter(p => shownOvr(p.z) === 85).slice(0, 4).forEach(p => console.log(row(p)));
console.log('--- around OVR 78'); ps.filter(p => shownOvr(p.z) === 78).slice(0, 4).forEach(p => console.log(row(p)));
console.log('--- young (≤22)'); ps.filter(p => ageIn(p, lg.season) <= 22).slice(0, 5).forEach(p => console.log(row(p)));
console.log('--- overpaid'); ps.filter(p => p.contract.sal > 0.15 && shownOvr(p.z) < 80).slice(0, 4).forEach(p => console.log(row(p)));
console.log('--- picks (prospect value, middle strategy, money 0.45): ' + [1, 3, 5, 10, 15, 20, 30, 45].map(s => `#${s} ${prospectValue(s, 'middle', 0.45).toFixed(1)}`).join('  '));
console.log('    rebuild: ' + [1, 5, 15, 30].map(s => `#${s} ${prospectValue(s, 'rebuild', 0.55).toFixed(1)}`).join('  ') + ' | contend: ' + [1, 5, 15, 30].map(s => `#${s} ${prospectValue(s, 'contend', 0.37).toFixed(1)}`).join('  '));
// classic: best player of team X for two good players of team Y
const teams = Object.values(lg.teams).filter(t => t.active);
const star = ps[0]; const X = star.tid!;
const Y = teams.find(t => t.tid !== X && t.roster.length >= 13)!;
const goods = Y.roster.map(pid => lg.players[pid]).sort((a, b) => shownOvr(b.z) - shownOvr(a.z)).slice(0, 2);
const e = evaluateTrade(lg, X, Y.tid, goods.map(p => ({ pid: p.id })), [{ pid: star.id }]);
console.log(`--- ${star.name} (${lg.teams[X].abbr}) for ${goods.map(p => `${p.name} ${shownOvr(p.z)}`).join(' + ')} (${Y.abbr}): gain ${X} ${e.gainA.toFixed(1)} (th ${threshold(lg, X).toFixed(1)}), gain ${Y.tid} ${e.gainB.toFixed(1)} ${e.reason ?? ''}`);
const myPicks = (lg.picks ?? []).filter(p => p.owner === Y.tid && p.round === 1).map(p => ({ pick: { season: p.season, round: p.round, orig: p.orig } }));
const e2 = evaluateTrade(lg, X, Y.tid, [...goods.slice(0, 1).map(p => ({ pid: p.id })), ...myPicks], [{ pid: star.id }]);
console.log(`--- ${star.name} for ${goods[0].name} + all ${myPicks.length} firsts: gain ${X} ${e2.gainA.toFixed(1)}, gain ${Y.tid} ${e2.gainB.toFixed(1)} | pick values to ${X}: ${myPicks.map(x => pickTradeValue(lg, x.pick, X).toFixed(1)).join(', ')}`);
