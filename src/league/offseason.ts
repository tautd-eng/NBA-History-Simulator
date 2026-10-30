// Off-season: expansion, lottery and draft, retirements, development, contracts,
// arrivals and free agency.
import { H, seasonInfo, LAST_SEASON, bpmOf, ovrOf, agingIndex, NK, shownOvr, shownFromRaw } from '../data';
import { rosterFit, GMFIT } from '../archetypes';
import { Rng } from '../rng';
import { League, Player, Team, emptyLine, ExpansionDraft, Lottery, FreeAgency } from '../types';
import { newPlayer, prospectZ, realTarget, lastRealSeason, ageIn, firstRealSeason, snapRatings, tagOf, addTx } from '../players';
import { activeTeams, makeTeam, rngOf, standings, updateStrategies, playoffFormat, seasonGames } from './league';
import { makeSchedule } from './schedule';
import { develop, normalizeLeague, youngFloor } from './health';
import { classFor, shiftFor } from './classes';
import { resetFatigue } from './fatigue';
import { carryInjuries } from './injuries';
import { rookieContract, vetContract, rfaEligible, qoAmount, worthKeeping, optsOut, lockTrade } from './contracts';
import { discount, offerUtility } from './prefs';
import { pickOwner, ensurePicks, aiTradeRound, isFreeAgent, complyHardCap } from '../ai/trades';
import {
  askingSalary, contractYears, payroll, playerValue, peakBpm, MIN_SAL, zClamp, projectBpm, maxSalary, hardCap, vetMin,
} from '../ai/value';

const save = (lg: League, r: Rng) => { lg.rng = [...r.s] as any; };
const ROSTER_MAX = 15, ROSTER_MIN = 13;

// ------------------------------------------------------------ draft day
/**
 * Draft day in stages: (expansion draft, if new teams join) → lottery (odds
 * first, then the draw) → the draft itself, one pick at a time. Every stage
 * can be stepped through by the user or run automatically.
 */
export function initDraft(lg: League) {
  const rng = rngOf(lg);
  const Y = lg.season;
  const next = seasonInfo(Y + 1);
  const newTeams: string[] = [];
  if (Y + 1 <= LAST_SEASON) {
    for (const [tid, t] of Object.entries(next.teams)) {
      if (!lg.teams[tid]) {
        lg.teams[tid] = makeTeam(tid, t.abbr, t.name, t.conf, rng);
        newTeams.push(tid);
      }
    }
  }
  ensurePicks(lg);
  const classIds = classFor(lg, Y).filter(pid => !lg.players[pid]);
  const pool: string[] = [];
  for (const pid of classIds) {
    const shift = shiftFor(pid, Y);
    const p = newPlayer(pid, prospectZ(pid, Y - shift, lg.destiny, rng), null, Y + 1);
    if (shift) { p.shift = shift; p.born += shift; }
    p.entered = Y + 1;
    const d = H.players[pid].d!;
    p.draft = { year: Y, pick: 0, round: 0, tid: '', realPick: d[1], realTid: d[3] };
    zClamp(p.z);
    p.ovrHist = []; p.rh = []; snapRatings(p, Y + 1);
    p.prospect = true;
    lg.players[pid] = p;
    pool.push(pid);
  }
  lg.draftDay = {
    year: Y, order: [], idx: 0, pool, picks: [], newTeams, done: false,
    stage: newTeams.length ? 'expansion' : 'lottery',
    exp: newTeams.length ? setupExpansion(lg, newTeams, rng) : undefined,
    lotto: setupLottery(lg, newTeams),
  };
  lg.draftDay.lottery = lg.draftDay.lotto!.text;
  if (newTeams.length) lg.news.push({ s: Y, t: `The league expands: ${newTeams.map(t => lg.teams[t].name).join(', ')}. An expansion draft comes before the draft.` });
  save(lg, rng);
}

// ---- expansion draft
function setupExpansion(lg: League, newTeams: string[], rng: Rng): ExpansionDraft {
  const Y = lg.season;
  const old = activeTeams(lg).filter(t => !newTeams.includes(t.tid));
  const protect: Record<string, string[]> = {};
  for (const t of old) protect[t.tid] = aiProtect(lg, t, Y);
  const rounds = Math.min(12, Math.floor(old.length / newTeams.length));
  const base = rng.shuffle([...newTeams]);
  const order: string[] = [];
  for (let r = 0; r < rounds; r++) order.push(...(r % 2 ? [...base].reverse() : base));
  return { teams: newTeams, protect, confirmed: false, order, idx: 0, picks: [], lost: [], done: false };
}
function aiProtect(lg: League, t: Team, Y: number) {
  return t.roster.map(pid => lg.players[pid]).sort((a, b) => playerValue(b, Y + 1, t.strategy) - playerValue(a, Y + 1, t.strategy)).slice(0, 8).map(p => p.id);
}
export const PROTECT_N = 8;

/** The user toggles protection of one of his players (at most 8). */
export function expToggleProtect(lg: League, pid: string) {
  const e = lg.draftDay?.exp;
  const tid = lg.userTid;
  if (!e || e.confirmed || !tid || !e.protect[tid]) return false;
  const list = e.protect[tid];
  if (list.includes(pid)) e.protect[tid] = list.filter(x => x !== pid);
  else if (list.length < PROTECT_N) list.push(pid);
  else return false;
  return true;
}
export function expConfirm(lg: League) {
  const e = lg.draftDay?.exp;
  if (e) e.confirmed = true;
}
/** Unprotected players still available: from teams that have not lost anyone yet. */
export function expAvailable(lg: League) {
  const e = lg.draftDay?.exp;
  if (!e) return [];
  const out: { p: Player; from: string }[] = [];
  for (const [tid, prot] of Object.entries(e.protect)) {
    if (e.lost.includes(tid)) continue;
    for (const pid of lg.teams[tid].roster) if (!prot.includes(pid)) out.push({ p: lg.players[pid], from: tid });
  }
  return out;
}
export function expOnClock(lg: League) {
  const e = lg.draftDay?.exp;
  if (!e || !e.confirmed || e.done || e.idx >= e.order.length) return null;
  if (!expAvailable(lg).length) return null;
  const per = e.teams.length;
  return { nt: e.order[e.idx], n: e.idx + 1, round: Math.floor(e.idx / per) + 1 };
}
export function expPick(lg: League, pid?: string) {
  const e = lg.draftDay?.exp;
  const on = expOnClock(lg);
  if (!e || !on) return;
  const Y = lg.season;
  const avail = expAvailable(lg);
  const choice = (pid && avail.find(x => x.p.id === pid)) || avail.sort((a, b) => playerValue(b.p, Y + 1, 'rebuild') - playerValue(a.p, Y + 1, 'rebuild'))[0];
  const from = lg.teams[choice.from];
  from.roster = from.roster.filter(x => x !== choice.p.id);
  e.lost.push(from.tid);
  choice.p.tid = on.nt;
  lg.teams[on.nt].roster.push(choice.p.id);
  e.picks.push({ nt: on.nt, pid: choice.p.id, from: from.tid, n: on.n });
  addTx(choice.p, lg.season, `Taken in the expansion draft: ${from.name} → ${lg.teams[on.nt].name}`, 998);
  e.idx++;
  if (!expOnClock(lg)) expFinish(lg);
}
export function expAdvance(lg: League, mode: 'one' | 'all') {
  const e = lg.draftDay?.exp;
  if (!e) return;
  if (!e.confirmed) e.confirmed = true;
  while (expOnClock(lg)) {
    const on = expOnClock(lg)!;
    if (mode !== 'all' && on.nt === lg.userTid) break;
    expPick(lg);
    if (mode === 'one') break;
  }
  if (!expOnClock(lg)) expFinish(lg);
}
function expFinish(lg: League) {
  const d = lg.draftDay!, e = d.exp!;
  if (e.done) return;
  e.done = true;
  const Y = lg.season;
  const sum = lg.history[lg.history.length - 1];
  for (const nt of e.teams) {
    sum.notes.push(`New team: ${lg.teams[nt].name} (expansion draft: ${lg.teams[nt].roster.length} players, one per team).`);
    lg.news.push({ s: Y, t: `The league expands: ${lg.teams[nt].name} join from the ${Y}–${String(Y + 1).slice(2)} season.` });
  }
  d.stage = 'lottery';
}

// ---- lottery
/** Where expansion teams picked in their first draft (real history); otherwise right after the lottery picks. */
const EXP_SLOT: Record<string, number> = { DAL: 11, NOP: 8, MIA: 9, MIN: 10, ORL: 11, MEM: 6, TOR: 7, CHA: 4 };
const LOTTO_1994 = [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6, 5];
const LOTTO_2019 = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];

/** Lottery rules of the era and every team's odds, before anything is drawn. */
function setupLottery(lg: League, newTeams: string[]): Lottery {
  const Y = lg.season;
  const nt = new Set(newTeams);
  const st = standings(lg).filter(t => !nt.has(t.tid)).reverse(); // worst first
  const playoffTeams = new Set(lg.series.flatMap(s => [s.hi, s.lo]).filter(Boolean));
  const lot = st.filter(t => !playoffTeams.has(t.tid));
  const lottery = lot.map(t => t.tid);
  const rest = st.filter(t => playoffTeams.has(t.tid)).map(t => t.tid);
  let entrants = [...lottery], weights: number[] = [], draws = 0, text = '', kind: Lottery['kind'] = 'draw';
  const w = (tab: number[]) => lottery.map((_, i) => tab[i] ?? Math.max(1, tab[tab.length - 1] ?? 1));
  if (Y < 1985) {
    const worstE = st.find(t => t.conf === 'E')?.tid, worstW = st.find(t => t.conf === 'W')?.tid;
    kind = 'coin';
    entrants = [worstE, worstW].filter(Boolean) as string[];
    weights = entrants.map(() => 1); draws = entrants.length;
    text = entrants.length === 2 ? `Coin flip between the worst teams of each conference: ${lg.teams[entrants[0]].abbr} and ${lg.teams[entrants[1]].abbr}. The winner picks first, the loser second.` : 'Coin flip.';
  } else if (Y < 1987) {
    weights = lottery.map(() => 1); draws = lottery.length;
    text = `Lottery: all ${lottery.length} non-playoff teams have equal odds for every spot.`;
  } else if (Y < 1990) {
    weights = lottery.map(() => 1); draws = 3;
    text = 'Lottery: the top 3 picks are drawn with equal odds, the rest go by record.';
  } else if (Y < 1994) {
    weights = lottery.map((_, i) => lottery.length - i); draws = 3;
    text = 'Weighted lottery: top 3 picks, the worst team has the most balls.';
  } else if (Y < 2019) {
    weights = w(LOTTO_1994); draws = 3;
    text = 'Weighted lottery: the top 3 picks are drawn, the rest go by record (a team can drop at most 3 spots).';
  } else {
    weights = w(LOTTO_2019); draws = 4;
    text = 'Flattened lottery: the top 4 picks are drawn, the three worst teams each have a 14% chance at No. 1.';
  }
  // odds of every final slot, by simulation (separate generator: does not touch the league's randomness)
  const n = lottery.length;
  const odds = lottery.map(() => new Array(n).fill(0));
  const sim = new Rng(Y * 7919 + n);
  const N = 20000;
  for (let k = 0; k < N; k++) {
    const res = drawOrder(lottery, entrants, weights, draws, sim);
    res.forEach((tid, pos) => { odds[lottery.indexOf(tid)][pos] += 1 / N; });
  }
  return { kind, text, teams: lot.map(t => ({ tid: t.tid, w: t.w, l: t.l })), entrants, weights, draws, odds, rest, drawn: false };
}
function drawOrder(lottery: string[], entrants: string[], weights: number[], draws: number, rng: Rng) {
  const pool = [...entrants], w = [...weights];
  const top: string[] = [];
  for (let i = 0; i < draws && pool.length; i++) {
    const idx = rng.weighted(w);
    top.push(pool[idx]); pool.splice(idx, 1); w.splice(idx, 1);
  }
  return [...top, ...lottery.filter(t => !top.includes(t))];
}

/** Draw the lottery and fix the draft order. */
export function lotteryDraw(lg: League) {
  const d = lg.draftDay;
  if (!d || !d.lotto || d.lotto.drawn) return;
  if (d.exp && !d.exp.done) expAdvance(lg, 'all');
  const rng = rngOf(lg);
  const L = d.lotto;
  const lottery = L.teams.map(t => t.tid);
  const res = drawOrder(lottery, L.entrants, L.weights, L.draws, rng);
  L.drawn = true; L.result = res;
  const sum = lg.history[lg.history.length - 1];
  const r1 = [...res, ...L.rest];
  const r2 = [...lottery, ...L.rest];
  const insert = (order: string[], afterLotto: number) => {
    const out = [...order];
    [...d.newTeams].sort((a, b) => (EXP_SLOT[a] ?? 99) - (EXP_SLOT[b] ?? 99)).forEach(t => {
      const slot = Math.min(out.length, (EXP_SLOT[t] ?? afterLotto + 1) - 1);
      out.splice(slot, 0, t);
    });
    return out;
  };
  const o1 = insert(r1, Math.min(L.draws, res.length)), o2 = insert(r2, 0);
  d.order = [...o1.map(orig => ({ orig, round: 1 })), ...o2.map(orig => ({ orig, round: 2 }))].slice(0, d.pool.length);
  // summary text
  const moved = res.slice(0, L.draws).map((tid, i) => ({ tid, from: lottery.indexOf(tid) + 1, to: i + 1 }));
  const jump = moved.filter(m => m.from > m.to).sort((a, b) => (b.from - b.to) - (a.from - a.to))[0];
  sum.lottery = !res.length ? L.text : L.kind === 'coin' && res.length >= 2
    ? `Coin flip: ${lg.teams[L.entrants[0]].abbr} vs ${lg.teams[L.entrants[1]].abbr}, won by ${lg.teams[res[0]].abbr} (No. 1), ${lg.teams[res[1]].abbr} – No. 2.`
    : `${L.text} The ${lg.teams[res[0]].name} won No. 1 (${ord(lottery.indexOf(res[0]) + 1)}-worst team)${jump && jump.tid !== res[0] ? `; ${lg.teams[jump.tid].abbr} jumped from ${jump.from} to ${jump.to}` : ''}.`;
  d.lottery = sum.lottery;
  if (res[0]) sum.notes.push(`First pick: ${lg.teams[res[0]].name} (${ord(lottery.indexOf(res[0]) + 1)}-worst team).`);
  lg.news.push({ s: d.year, t: `${d.year} draft lottery. ${sum.lottery}` });
  d.stage = 'draft';
  save(lg, rng);
  if (!d.order.length) finishDraft(lg);
}

/** The pick on the clock, or null when the draft is over. */
export function draftOnClock(lg: League) {
  const d = lg.draftDay;
  if (!d || d.done || (d.stage ?? 'draft') !== 'draft' || d.idx >= d.order.length || !d.pool.length) return null;
  const o = d.order[d.idx];
  return { pick: d.idx + 1, round: o.round, orig: o.orig, tid: pickOwner(lg, d.year, o.round, o.orig) };
}

/** AI's choice for a team from the current board. */
export function draftSuggest(lg: League, tid: string) {
  const d = lg.draftDay!;
  const rng = rngOf(lg);
  const best = pickBest(d.pool.map(pid => lg.players[pid]), lg.teams[tid], d.year, rng);
  return best?.id;
}

/** Make the pick on the clock: pid chosen by hand, otherwise the team's own board. */
export function draftPick(lg: League, pid?: string) {
  const d = lg.draftDay;
  const on = draftOnClock(lg);
  if (!d || !on) return;
  const rng = rngOf(lg);
  const Y = d.year;
  const team = lg.teams[on.tid];
  const best = pid && d.pool.includes(pid) ? lg.players[pid] : pickBest(d.pool.map(x => lg.players[x]), team, Y, rng);
  d.pool = d.pool.filter(x => x !== best.id);
  delete best.prospect;
  best.draft!.pick = on.pick; best.draft!.round = on.round; best.draft!.tid = on.tid;
  best.tid = on.tid;
  best.contract = rookieContract(on.pick, on.round, Y);
  // draft-and-stash: real debut years later
  const fr = firstRealSeason(best.id);
  const debut = fr !== undefined ? fr + (best.shift ?? 0) : undefined;
  if (debut && debut > Y + 1 && lg.destiny >= 0.5) {
    (best as any).stash = debut;
    best.tid = null;
    (best as any).rights = on.tid;
  } else team.roster.push(best.id);
  addTx(best, Y, `Drafted in ${Y}: No. ${on.pick} (round ${on.round}), ${team.name}${on.tid !== on.orig ? ` (pick via ${lg.teams[on.orig].abbr})` : ''}${(best as any).stash ? ' – stays overseas for now' : ''}`, 999);
  d.picks.push({ pick: on.pick, round: on.round, pid: best.id, tid: on.tid, realPick: best.draft!.realPick, realTid: best.draft!.realTid, ...(on.tid !== on.orig ? { via: on.orig } : {}) });
  d.idx++;
  save(lg, rng);
  if (!draftOnClock(lg)) finishDraft(lg);
}

/** Skip ahead: 'one' pick, 'user' = until the user's team is on the clock, 'all' = to the end (AI picks for everyone). */
export function draftAdvance(lg: League, mode: 'one' | 'user' | 'all') {
  let n = 0;
  const d = lg.draftDay;
  if (d && mode === 'all') {
    if (d.exp && !d.exp.done) expAdvance(lg, 'all');
    if (d.lotto && !d.lotto.drawn) lotteryDraw(lg);
  }
  while (true) {
    const on = draftOnClock(lg);
    if (!on) break;
    if (mode !== 'all' && on.tid === lg.userTid && lg.userTid) break;
    draftPick(lg);
    n++;
    if (mode === 'one') break;
  }
  return n;
}

export function finishDraft(lg: League) {
  const d = lg.draftDay!;
  if (d.done) return;
  const Y = d.year;
  const sum = lg.history[lg.history.length - 1];
  // undrafted prospects who played in the NBA in reality join the free-agent pool
  for (const pid of d.pool) {
    const p = lg.players[pid];
    if (H.players[pid].s.length) { delete p.prospect; p.tid = null; }
    else delete lg.players[pid];
  }
  d.pool = [];
  d.done = true;
  sum.draft = d.picks.map(({ round, ...x }) => x);
  if (d.picks.length) {
    const first = lg.players[d.picks[0].pid];
    lg.news.push({ s: Y, t: `${Y} draft: No. 1 – ${tagOf(first, Y + 1)}, ${lg.teams[d.picks[0].tid].abbr}.` });
  }
  ensurePicks(lg);
}

/** The whole draft at once (simulations and tests). */
export function runDraftPhase(lg: League) {
  if (!lg.draftDay || lg.draftDay.year !== lg.season) initDraft(lg);
  draftAdvance(lg, 'all');
  finishDraft(lg);
}


/** Draft board: blend of consensus (the real draft slot) and the team's own projection. */
function pickBest(pool: Player[], team: Team, Y: number, rng: Rng) {
  let best = pool[0], bestV = -1e9;
  for (const p of pool) {
    const consensus = 6 - 3.0 * Math.log(Math.max(1, p.draft!.realPick));
    const proj = peakBpm(p, Y + 1);
    const noise = (1.1 - team.gm.scouting) * (p.scout * 1.5 + rng.normal() * 0.9);
    const v = 0.5 * consensus + 0.5 * proj + noise;
    if (v > bestV) { bestV = v; best = p; }
  }
  return best;
}

// ------------------------------------------------------------ free agency
/** Asking price falls as free agency goes on (stage 1 → 3; in season like stage 3). */
const STAGE_MULT = [1, 1, 0.85, 0.7, 0.7];
const STAGE_SIGN = [0, 0.4, 0.7, 1, 1];      // chance a player with an offer signs in this stage's wave
const STAGE_TRADE = [0, 2.4, 2.0, 1.6, 1.0];  // AI trade-talk intensity
const capLimit = (N: number) => (N < 1985 ? 1.3 : 1.0);
/** Mid-level exception (from 1995): what a team over the cap may pay one free agent per summer. */
const MLE = 0.1;
/** Salary floor: teams below it spend more freely in free agency and fill the gap with one-year deals. */
const FLOOR = 0.9;

/**
 * After the draft: retirements, development, re-signings, arrivals, the new
 * season number, and free agency opens (stage 1). The user's expiring players
 * get an exclusive re-signing window during stage 1.
 */
export function enterFreeAgency(lg: League) {
  const rng = rngOf(lg);
  const Y = lg.season;
  const N = Y + 1;
  if (lg.draftDay && !lg.draftDay.done) { draftAdvance(lg, 'all'); finishDraft(lg); }
  if (N > LAST_SEASON) {
    lg.ended = true;
    lg.news.push({ s: Y, t: `The historical data ends with the ${LAST_SEASON} season – the league stops here.` });
    save(lg, rng);
    return;
  }
  const notes = lg.history[lg.history.length - 1].notes;
  flushFaLog(lg); // in-season signings and releases of the season that just ended
  carryInjuries(lg, lg.endCal ?? 0);
  retirements(lg, rng, notes);
  develop(lg, rng);
  // extensions signed during the season replace the old contracts now
  for (const p of Object.values(lg.players)) {
    if (p.ext && p.tid && p.contract.exp <= Y) { p.contract = { sal: p.ext.sal, exp: p.ext.exp }; addTx(p, N, `Extension with ${lg.teams[p.tid].name} kicks in: ${pct(p.ext.sal)} per season through ${p.ext.exp}`, -2); }
    delete p.ext;
  }
  const optLog: FreeAgency['log'] = [];
  const decisions: NonNullable<FreeAgency['decisions']> = [];
  processOptions(lg, rng, optLog, decisions);
  const pending = contracts(lg, rng, optLog, decisions);
  arrivals(lg, rng);
  lg.season = N;
  updateStrategies(lg);
  // team names / conferences follow history (relocations, renames, realignment)
  const si = seasonInfo(N);
  for (const [tid, t] of Object.entries(si.teams)) {
    const team = lg.teams[tid];
    if (!team) continue;
    if (team.name !== t.name) lg.news.push({ s: N, t: `The ${team.name} are now the ${t.name}.` });
    team.name = t.name; team.abbr = t.abbr; team.conf = t.conf;
  }
  lg.dead = (lg.dead ?? []).filter(d => d.exp >= N);
  lg.phase = 'freeagency';
  archiveFa(lg, N - 1);
  lg.fa = { stage: 0, pending, mle: [], log: optLog, decisions, sheets: [] };
  ensurePicks(lg);
  lg.news.push({ s: N, t: `Free agency opens (for the ${seasonLabelOf(N)} season).` });
  const kept = optLog.filter(x => x.kind === 'resign' && !x.user && x.pid && bpmOf(lg.players[x.pid].z) > 1).sort((a, b) => bpmOf(lg.players[b.pid!].z) - bpmOf(lg.players[a.pid!].z));
  for (let i = 0; i < kept.length; i += 10) lg.news.push({ s: N, t: `Re-signed before free agency: ${kept.slice(i, i + 10).map(x => `${tagOf(lg.players[x.pid!], N)} (${lg.teams[x.tid!].abbr}, ${Math.round((x.exp! - N + 1))} yr)`).join(', ')}.` });
  save(lg, rng);
}

/** The team a free agent comes from: the club holding his rights, or the last one he played for. */
export function prevTeam(p: Player): string {
  if (p.bird) return p.bird;
  if (p.rfa) return p.rfa;
  if (p.tid) return p.tid;
  for (let i = p.career.length - 1; i >= 0; i--) if (p.career[i].tid) return p.career[i].tid!;
  return '';
}
/** Keep last summer's free-agency moves in a compact form for the history screens. */
function archiveFa(lg: League, S: number) {
  const fa = lg.fa;
  if (!fa) return;
  const KEEP = new Set(['sign', 'resign', 'match', 'sheet']);
  const rows: NonNullable<League['faHist']>[number] = [];
  for (const x of fa.log) {
    if (!x.pid || !x.tid || !KEEP.has(x.kind) || (x.kind === 'sheet' && x.desc?.includes('awaiting'))) continue;
    const p = lg.players[x.pid]; if (!p) continue;
    const o = p.ovrHist.find(h => h[0] === S) ?? p.ovrHist[p.ovrHist.length - 1];
    rows.push([x.pid, x.kind, x.tid, x.from ?? '', Math.round((x.sal ?? 0) * 1000) / 1000, x.exp ?? S, o ? shownFromRaw(o[1]) : 0, ageIn(p, S)]);
  }
  (lg.faHist ??= {})[S] = rows;
}

const seasonLabelOf = (s: number) => `${s - 1}–${String(s).slice(2)}`;

/** The salary a free agent wants from a team right now. */
export function faDemand(lg: League, p: Player, tid: string) {
  const N = lg.season;
  const stage = lg.phase === 'freeagency' ? Math.max(1, Math.min(3, lg.fa?.stage ?? 3)) : 4;
  const ask = askingSalary(p, N) * STAGE_MULT[stage];
  return Math.max(MIN_SAL, Math.min(maxSalary(p, N), ask * (1 - discount(lg, p, tid))));
}

/** Why the team cannot pay this salary, or null. Sets which exception is used. */
function capCheck(lg: League, tid: string, p: Player, sal: number): { err: string | null; mle?: boolean } {
  const N = lg.season;
  const t = lg.teams[tid];
  if (t.roster.length >= ROSTER_MAX) return { err: `Roster is full (${ROSTER_MAX}) – release a player first.` };
  const pay = payroll(lg, tid);
  const room = capLimit(N) - pay;
  const hc = hardCap(lg);
  if (pay + sal > hc + 1e-9 && !(sal <= MIN_SAL * 1.0001 && t.roster.length < ROSTER_MIN)) {
    return { err: `You would exceed the hard cap (${Math.round(hc * 100)}% of the cap): payroll would be ${Math.round((pay + sal) * 100)}%. Shed salary first (trades, releases).` };
  }
  if (sal <= room + 1e-9) return { err: null };
  if (sal <= MIN_SAL * 1.0001) return { err: null };
  const birdMax = Math.min(hc, N < 1985 ? 1.6 : 1.45);
  if (p.bird === tid && pay + sal <= birdMax) return { err: null };
  if (N >= 1995 && !(lg.fa?.mle ?? []).includes(tid) && sal <= MLE + 1e-9 && pay + sal <= hardCap(lg)) return { err: null, mle: true };
  const parts = [`Cap space left: ${Math.max(0, Math.round(room * 1000) / 10)}% of the cap.`];
  parts.push('Over the cap you can only offer a minimum contract' + (N >= 1995 ? `, the mid-level exception (up to ${Math.round(MLE * 100)}% of the cap, once per summer)` : '') + (p.bird === tid ? ` or re-sign your own player (up to ${Math.round(birdMax * 100)}% of the cap)` : '') + '.');
  return { err: parts.join(' ') };
}

/** The user offers a contract. Returns whether he signed and a message. */
export function faOffer(lg: League, pid: string, sal: number): { ok: boolean; msg: string } {
  const tid = lg.userTid;
  const p = lg.players[pid];
  if (!tid || !p) return { ok: false, msg: 'You have no team.' };
  if (lg.phase !== 'freeagency' && lg.phase !== 'regular') return { ok: false, msg: 'You can sign players in free agency or during the regular season.' };
  if (p.tid || p.retired || p.prospect || (p as any).stash) return { ok: false, msg: `${p.name} is not a free agent.` };
  if (lg.fa?.stage === 0) return { ok: false, msg: 'Finish the contract decisions first – then the market opens.' };
  if (lg.fa?.sheets?.some(x => x.pid === pid)) return { ok: false, msg: `${p.name} already signed an offer sheet – waiting to see if it gets matched.` };
  if (sal > maxSalary(p, lg.season) + 1e-9) return { ok: false, msg: `The most you can offer is a max contract: ${(maxSalary(p, lg.season) * 100).toFixed(1)}% of the cap.` };
  sal = Math.max(MIN_SAL, sal);
  const cc = capCheck(lg, tid, p, sal);
  if (cc.err) return { ok: false, msg: cc.err };
  const need = faDemand(lg, p, tid);
  if (sal + 1e-9 < need) {
    const rng = rngOf(lg);
    // close offers sometimes get through
    const close = sal >= need * 0.93 && rng.chance(0.35);
    save(lg, rng);
    if (!close) return { ok: false, msg: `${p.name} declined: he wants at least ${(need * 100).toFixed(1)}% of the cap.` };
  }
  const rng = rngOf(lg);
  const yrs = contractYears(p, lg.season, () => rng.next());
  save(lg, rng);
  const N = lg.season;
  // another team's restricted free agent: they may match
  if (p.rfa && p.rfa !== tid) {
    const R = p.rfa;
    if (aiMatches(lg, p, R, sal)) {
      signWith(lg, p, R, sal, N - 1 + yrs);
      lg.fa?.log.push({ st: lg.fa.stage, kind: 'match', pid, tid: R, sal, exp: N - 1 + yrs, desc: `matched your offer` });
      lg.news.push({ s: N, t: `The ${lg.teams[R].name} matched the ${lg.teams[tid].abbr} offer and keep ${tagOf(p, N)}.` });
      return { ok: false, msg: `${p.name} signed your offer sheet, but the ${lg.teams[R].name} matched it – he stays with them.` };
    }
  }
  const from = prevTeam(p);
  p.tid = tid; lg.teams[tid].roster.push(pid);
  p.contract = { sal, exp: N - 1 + yrs };
  lockTrade(lg, p);
  delete p.rfa; delete p.qo;
  if (cc.mle && lg.fa) lg.fa.mle.push(tid);
  const resign = p.bird === tid;
  delete p.bird;
  if (lg.fa) {
    lg.fa.pending = lg.fa.pending.filter(x => x !== pid);
    lg.fa.log.push({ st: lg.fa.stage, kind: resign ? 'resign' : 'sign', pid, tid, from, sal, exp: p.contract.exp, user: true });
  }
  lg.news.push({ s: N, t: `The ${lg.teams[tid].name} ${resign ? 're-signed' : 'signed'} ${tagOf(p, N)}: ${yrs}-year deal.` });
  return { ok: true, msg: `${p.name} ${resign ? 're-signed' : 'signed'}: ${yrs} yrs, ${(sal * 100).toFixed(1)}% of the cap per season.` };
}

/** Give up the re-signing rights to one of the user's expiring players. */
export function faRenounce(lg: League, pid: string) {
  if (!lg.fa) return;
  lg.fa.pending = lg.fa.pending.filter(x => x !== pid);
  const p = lg.players[pid];
  if (p) { delete p.bird; lg.fa.log.push({ st: lg.fa.stage, kind: 'leave', pid, tid: lg.userTid ?? undefined, user: true }); }
}

/** Release a player: his salary stays on the books until the contract ends. */
export function faRelease(lg: League, pid: string): { ok: boolean; msg: string } {
  const tid = lg.userTid;
  const p = lg.players[pid];
  if (!tid || !p || p.tid !== tid) return { ok: false, msg: 'This player is not on your team.' };
  if (lg.phase === 'playoffs' || lg.phase === 'draft') return { ok: false, msg: 'You can\'t release players right now.' };
  const t = lg.teams[tid];
  if (lg.phase === 'regular' && t.roster.length <= ROSTER_MIN - 1) return { ok: false, msg: `During the season you must keep at least ${ROSTER_MIN - 1} players.` };
  t.roster = t.roster.filter(x => x !== pid);
  p.tid = null;
  if (p.contract.exp >= lg.season) (lg.dead ??= []).push({ tid, sal: p.contract.sal, exp: p.contract.exp, pid });
  p.contract = { sal: MIN_SAL, exp: lg.season };
  lg.fa?.log.push({ st: lg.fa.stage, kind: 'release', pid, tid, user: true });
  lg.news.push({ s: lg.season, t: `The ${t.name} released ${tagOf(p, lg.season)}.` });
  return { ok: true, msg: `${p.name} released. His salary stays on the books until the contract ends.` };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}% of the cap`;
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
/** One free-agency log line as a sentence for the player's history. */
function describeLog(lg: League, x: FreeAgency['log'][number]) {
  const tn = x.tid ? lg.teams[x.tid]?.name ?? x.tid : '';
  const money = x.sal ? `: ${pct(x.sal)}${x.exp ? ` per season through ${x.exp}` : ''}` : '';
  switch (x.kind) {
    case 'sign': return `Signed with ${tn}${money}${x.desc ? ` (${x.desc})` : ''}`;
    case 'resign': return `Re-signed with ${tn}${money}`;
    case 'release': return `Released by ${tn}`;
    case 'leave': return `Became a free agent (${tn}${x.desc ? `, ${x.desc}` : ''})`;
    case 'option': return `${tn}: ${x.desc ?? 'option'}`;
    case 'qo': return x.desc ? `${tn}: ${x.desc}${money}` : `${tn} extended a qualifying offer – restricted free agent${money}`;
    case 'match': return `${tn} ${x.desc ?? 'matched the offer'}${money}`;
    case 'sheet': return `Signed an offer sheet with ${tn}${money}${x.desc ? ` (${x.desc})` : ''}`;
    default: return x.desc ?? '';
  }
}
/** Copy new free-agency log lines into the players' histories. */
export function flushFaLog(lg: League) {
  const fa = lg.fa;
  if (!fa) return;
  for (const x of fa.log.slice(fa.flushed ?? 0)) {
    if (!x.pid || !lg.players[x.pid]) continue;
    if (x.kind === 'sheet' && x.desc?.includes('awaiting')) continue;
    // summer lines are filed under the coming season, before its games; in-season ones by their stage marker
    addTx(lg.players[x.pid], lg.season, describeLog(lg, x), lg.phase === 'freeagency' ? -1 : 500);
  }
  fa.flushed = fa.log.length;
}
export { describeLog };

/** Stage 0: the user's choice on a team option or qualifying offer (true = keep / tender). */
export function faDecide(lg: League, pid: string, choice: boolean) {
  const d = lg.fa?.decisions?.find(x => x.pid === pid);
  if (d && lg.fa!.stage === 0) d.choice = choice;
}

/** End of stage 0: apply the user's decisions (the GM's recommendation where he made none). */
function applyDecisions(lg: League) {
  const fa = lg.fa!;
  const tid = lg.userTid;
  const N = lg.season;
  for (const d of fa.decisions ?? []) {
    const p = lg.players[d.pid];
    const keep = d.choice ?? d.rec;
    if (d.kind === 'team') {
      if (keep) {
        p.contract.opts = (p.contract.opts ?? []).filter(o => o.s !== N);
        fa.log.push({ st: 0, kind: 'option', pid: p.id, tid: tid!, desc: 'you exercised the team option', user: true });
      } else if (tid && p.tid === tid) {
        // declined: unrestricted, but the exclusive re-signing window of stage 1 still applies
        lg.teams[tid].roster = lg.teams[tid].roster.filter(x => x !== p.id);
        p.tid = null; p.bird = tid; p.noRfa = true;
        p.contract = { sal: p.contract.sal, exp: N - 1 };
        fa.pending.push(p.id);
        fa.log.push({ st: 0, kind: 'option', pid: p.id, tid, desc: 'you declined the team option', user: true });
      }
    } else if (keep) {
      p.rfa = tid!; p.qo = d.sal;
      fa.log.push({ st: 0, kind: 'qo', pid: p.id, tid: tid!, sal: d.sal, user: true });
    } else {
      delete p.bird;
      fa.log.push({ st: 0, kind: 'leave', pid: p.id, tid: tid!, desc: 'no qualifying offer', user: true });
    }
  }
  fa.decisions = [];
}

const NEWS_BPM = -0.5; // every rotation-level signing makes the news

function signWith(lg: League, p: Player, tid: string, sal: number, exp: number, rng?: Rng) {
  p.tid = tid; lg.teams[tid].roster.push(p.id);
  p.contract = rng ? vetContract(p, lg.season, sal, exp - lg.season + 1, rng) : { sal, exp };
  lockTrade(lg, p);
  delete p.bird; delete p.rfa; delete p.qo;
}

/** Does the team holding his rights match an offer sheet? */
function aiMatches(lg: League, p: Player, tid: string, sal: number) {
  const t = lg.teams[tid];
  return t.roster.length < ROSTER_MAX && worthKeeping(lg, p, sal, lg.season, t.strategy) && payroll(lg, tid) + sal <= Math.min(hardCap(lg), lg.season < 1985 ? 1.6 : 1.45);
}

/** The user answers an offer sheet for his restricted free agent. */
export function faMatch(lg: League, pid: string, match: boolean): { ok: boolean; msg: string } {
  const fa = lg.fa;
  const sh = fa?.sheets?.find(x => x.pid === pid);
  const tid = lg.userTid;
  if (!fa || !sh || !tid) return { ok: false, msg: 'The offer is gone.' };
  const p = lg.players[pid];
  if (match && lg.teams[tid].roster.length >= ROSTER_MAX) return { ok: false, msg: `Roster is full (${ROSTER_MAX}) – release a player first.` };
  if (match && payroll(lg, tid) + sh.sal > hardCap(lg) + 1e-9) return { ok: false, msg: `Matching would put you over the hard cap (${Math.round(hardCap(lg) * 100)}% of the cap).` };
  fa.sheets = fa.sheets!.filter(x => x !== sh);
  if (match) {
    signWith(lg, p, tid, sh.sal, sh.exp);
    fa.log.push({ st: fa.stage, kind: 'match', pid, tid, sal: sh.sal, exp: sh.exp, desc: `you matched the ${lg.teams[sh.tid].abbr} offer`, user: true });
    lg.news.push({ s: lg.season, t: `The ${lg.teams[tid].name} matched the ${lg.teams[sh.tid].abbr} offer and keep ${tagOf(p, lg.season)}.` });
    return { ok: true, msg: `${p.name} stays: ${(sh.sal * 100).toFixed(1)}% of the cap through ${sh.exp}.` };
  }
  signWith(lg, p, sh.tid, sh.sal, sh.exp);
  fa.log.push({ st: fa.stage, kind: 'sheet', pid, tid: sh.tid, sal: sh.sal, exp: sh.exp, desc: 'you did not match the offer' });
  lg.news.push({ s: lg.season, t: `${tagOf(p, lg.season)} joins the ${lg.teams[sh.tid].name} – ${lg.teams[tid].abbr} did not match.` });
  return { ok: true, msg: `${p.name} joins the ${lg.teams[sh.tid].name}.` };
}

/** Offer sheets the user left unanswered: the GM decides. */
function resolveSheets(lg: League) {
  for (const sh of [...(lg.fa?.sheets ?? [])]) {
    const p = lg.players[sh.pid];
    faMatch(lg, sh.pid, !!lg.userTid && aiMatches(lg, p, lg.userTid, sh.sal));
  }
}

/** End the current stage: the AI signs and trades, then the next stage opens. */
export function faStage(lg: League) {
  const fa = lg.fa;
  if (!fa || fa.stage > 3) return;
  const rng = rngOf(lg);
  const st = fa.stage;
  if (st === 0) { applyDecisions(lg); fa.stage = 1; save(lg, rng); return; }
  if (st === 1) { resolvePending(lg, rng); aiRecallStash(lg, rng); }
  aiSignings(lg, rng, st);
  if (st === 3) reachFloor(lg, rng);
  resolveSheets(lg);
  complyHardCap(lg, rng);
  const before = lg.trades?.length ?? 0;
  aiTradeRound(lg, rng, STAGE_TRADE[st]);
  aiTradeRound(lg, rng, STAGE_TRADE[st] * 0.7);
  for (const rec of (lg.trades ?? []).slice(before)) fa.log.push({ st, kind: 'trade', desc: rec.desc });
  fa.stage = st + 1;
  save(lg, rng);
}

/** The user's unhandled expiring players: the GM decides, as for AI teams. */
function resolvePending(lg: League, rng: Rng) {
  const fa = lg.fa!;
  const tid = lg.userTid;
  if (!tid || !fa.pending.length) { fa.pending = []; return; }
  const t = lg.teams[tid];
  const N = lg.season;
  let pay = payroll(lg, tid);
  const ranked = [...t.roster, ...fa.pending].map(pid => lg.players[pid]).sort((a, b) => playerValue(b, N, t.strategy) - playerValue(a, N, t.strategy));
  for (const pid of [...fa.pending].sort((a, b) => playerValue(lg.players[b], N, t.strategy) - playerValue(lg.players[a], N, t.strategy))) {
    const p = lg.players[pid];
    const ask = askingSalary(p, N);
    const rank = ranked.indexOf(p);
    const worth = playerValue(p, N, t.strategy) / Math.max(MIN_SAL, ask);
    const budget = hardCap(lg); // every team wants to win: own players can be kept up to the hard cap
    if (rank < 9 && worth > 12 && pay + ask <= budget && t.roster.length < ROSTER_MAX && (rank < 3 || rng.chance(0.85))) {
      p.tid = tid; t.roster.push(pid);
      p.contract = vetContract(p, N, ask, contractYears(p, N, () => rng.next()), rng);
      lockTrade(lg, p);
      pay += ask;
      fa.log.push({ st: 1, kind: 'resign', pid, tid, from: tid, sal: ask, exp: p.contract.exp, desc: 'GM decision' });
    } else fa.log.push({ st: 1, kind: 'leave', pid, tid });
    delete p.bird;
  }
  fa.pending = [];
}

/**
 * Salary floor: at the end of free agency, AI teams still under it spend the
 * difference on one-year deals with the best remaining free agents (as real
 * teams far below the cap do, rather than paying the shortfall for nothing).
 */
function reachFloor(lg: League, rng: Rng) {
  const N = lg.season;
  const fa = lg.fa!;
  for (const t of activeTeams(lg)) {
    if (t.tid === lg.userTid) continue;
    let pay = payroll(lg, t.tid);
    for (let guard = 0; pay < FLOOR - 0.01 && guard < 6; guard++) {
      const p = Object.values(lg.players).filter(x => isFreeAgent(lg, x) && !x.rfa).sort((a, b) => playerValue(b, N, t.strategy) - playerValue(a, N, t.strategy))[0];
      if (!p) break;
      if (t.roster.length >= ROSTER_MAX) {
        // full roster of cheap players: cut the weakest minimum deal to make room (his salary stays on the books)
        const cut = t.roster.map(pid => lg.players[pid]).filter(x => x.contract.sal <= vetMin(x, N) + 0.006 && !x.contract.rookie)
          .sort((a, b) => playerValue(a, N, t.strategy) - playerValue(b, N, t.strategy))[0];
        if (!cut || playerValue(cut, N, t.strategy) >= playerValue(p, N, t.strategy)) break;
        t.roster = t.roster.filter(x => x !== cut.id); cut.tid = null;
        if (cut.contract.exp >= N) (lg.dead ??= []).push({ tid: t.tid, sal: cut.contract.sal, exp: cut.contract.exp, pid: cut.id });
        pay = payroll(lg, t.tid); // dead money still counts
        cut.contract = { sal: MIN_SAL, exp: N };
        fa.log.push({ st: 3, kind: 'release', pid: cut.id, tid: t.tid });
      }
      const sal = Math.min(maxSalary(p, N), FLOOR - pay, Math.max(askingSalary(p, N), (FLOOR - pay) / 2));
      const from = prevTeam(p);
      signWith(lg, p, t.tid, sal, N);
      fa.log.push({ st: 3, kind: 'sign', pid: p.id, tid: t.tid, from, sal, exp: N, desc: '1-year deal to reach the salary floor' });
      pay += sal;
    }
  }
}

/** How much a player would improve the fit of a team's rotation (−0.3 … +0.3). */
const fitBase = new Map<string, number>();
function teamFitGain(lg: League, tid: string, p: Player) {
  const ros = lg.teams[tid].roster.map(pid => lg.players[pid]);
  const key = tid + ros.length + lg.season + (lg.fa?.log.length ?? 0);
  const byB = (a: Player, b: Player) => bpmOf(b.z) - bpmOf(a.z);
  let base = fitBase.get(key);
  if (base === undefined) { if (fitBase.size > 500) fitBase.clear(); base = rosterFit([...ros].sort(byB)); fitBase.set(key, base); }
  const withP = [...ros, p].sort(byB);
  if (!GMFIT.on || withP.indexOf(p) >= 8) return 0;               // not in the rotation: fit does not matter
  return Math.max(-0.3, Math.min(0.3, 0.6 * (rosterFit(withP) - base)));
}

/** One wave of AI signings. Later stages: lower demands, everyone with an offer signs. */
function aiSignings(lg: League, rng: Rng, stage: number) {
  const N = lg.season;
  const pre = N < 1985;
  const teams = activeTeams(lg).filter(t => t.tid !== lg.userTid);
  const fa = lg.fa!;
  const signed: string[] = [];
  const pool = Object.values(lg.players).filter(p => isFreeAgent(lg, p)).sort((a, b) => playerValue(b, N) - playerValue(a, N));
  for (const p of pool) {
    const ask = askingSalary(p, N) * STAGE_MULT[stage];
    const max = maxSalary(p, N);
    const yrsOffer = contractYears(p, N, () => rng.next());
    const offers: { t: Team; sal: number; score: number; mle: boolean }[] = [];
    for (const t of teams) {
      if (t.roster.length >= ROSTER_MAX) continue;
      const pay = payroll(lg, t.tid);
      const room = capLimit(N) - pay;
      let sal = 0, mle = false;
      // a team pays what he asks of it: less where he wants to play, more where he does not
      const askT = Math.min(max, ask * (1 - discount(lg, p, t.tid)));
      const underFloor = pay < FLOOR;
      if (room >= askT) sal = Math.min(room, max, askT * (1 + (underFloor ? 0.3 : 0.15) * rng.next()));
      else if (ask <= MIN_SAL * 2.5) sal = Math.max(MIN_SAL, ask);
      else if (!pre && N >= 1995 && !fa.mle.includes(t.tid) && askT <= MLE * 1.35 && pay + MLE <= hardCap(lg)) { sal = Math.min(MLE, askT); mle = true; }
      else continue;
      if (pay + sal > hardCap(lg) + 1e-9 && !(t.roster.length < ROSTER_MIN && sal <= MIN_SAL * 1.0001)) continue;
      // a player who fills a hole in the rotation (shooting, a ball-handler, rim protection) is worth more to this team
      const fitD = teamFitGain(lg, t.tid, p);
      const v = playerValue(p, N, t.strategy) * (1 + fitD);
      if (fitD > 0 && room >= askT) sal = Math.min(max, room, sal * (1 + 0.5 * fitD));
      // only if he would be one of the team's twelve most valuable players
      const vals = t.roster.map(pid => playerValue(lg.players[pid], N, t.strategy)).sort((a, b) => b - a);
      const twelfth = vals[Math.min(vals.length, 12) - 1] ?? 0;
      if (t.roster.length >= ROSTER_MIN && v <= twelfth && !(underFloor && t.roster.length < ROSTER_MAX)) continue;
      if (t.strategy === 'rebuild' && ageIn(p, N) > 30 && sal > MIN_SAL * 2.5) continue;
      // the player picks the offer he likes best: money against his ask, plus the team's appeal to him
      const score = offerUtility(lg, p, t.tid, sal, ask, yrsOffer) + 0.06 * rng.normal();
      offers.push({ t, sal, score, mle });
    }
    if (!offers.length) continue;
    // early on, some players wait for a better market
    if (!rng.chance(STAGE_SIGN[stage] + (offers.length >= 3 ? 0.1 : 0))) continue;
    offers.sort((a, b) => b.score - a.score);
    const o = offers[0];
    const yrs = yrsOffer;
    const rights = p.rfa;
    if (rights && rights !== o.t.tid) {
      // restricted free agent: an offer sheet the rights team may match
      if (rights === lg.userTid) {
        if (!(fa.sheets ??= []).some(x => x.pid === p.id)) {
          fa.sheets.push({ pid: p.id, tid: o.t.tid, sal: o.sal, exp: N - 1 + yrs });
          fa.log.push({ st: stage, kind: 'sheet', pid: p.id, tid: o.t.tid, sal: o.sal, desc: `offer sheet for your RFA – awaiting your decision` });
        }
        continue;
      }
      if (aiMatches(lg, p, rights, o.sal)) {
        signWith(lg, p, rights, o.sal, N - 1 + yrs);
        fa.log.push({ st: stage, kind: 'match', pid: p.id, tid: rights, from: rights, sal: o.sal, exp: p.contract.exp, desc: `matched the ${o.t.abbr} offer` });
        if (bpmOf(p.z) > NEWS_BPM) signed.push(`${tagOf(p, N)} stays with ${lg.teams[rights].abbr} (matched the ${o.t.abbr} offer)`);
        continue;
      }
    }
    if (o.mle) fa.mle.push(o.t.tid);
    const wasRfa = !!rights && rights !== o.t.tid;
    const from = prevTeam(p);
    signWith(lg, p, o.t.tid, o.sal, N - 1 + yrs, rng);
    fa.log.push({ st: stage, kind: 'sign', pid: p.id, tid: o.t.tid, from, sal: o.sal, exp: p.contract.exp, ...(wasRfa ? { desc: `${lg.teams[rights!].abbr} did not match` } : {}) });
    if (bpmOf(p.z) > NEWS_BPM) signed.push(`${tagOf(p, N)} → ${o.t.abbr}${from && from !== o.t.tid && lg.teams[from] ? ` (from ${lg.teams[from].abbr})` : from === o.t.tid ? ' (re-signed)' : ''}`);
  }
  for (let i = 0; i < signed.length; i += 10) lg.news.push({ s: N, t: `Free agency (wave ${stage}${i ? ', cont.' : ''}): ${signed.slice(i, i + 10).join(', ')}.` });
}

/** Free agency is over: rosters filled and trimmed, schedule made, season begins. */
export function startSeason(lg: League) {
  const rng = rngOf(lg);
  const N = lg.season;
  if (lg.fa && lg.fa.stage <= 3) { while (lg.fa.stage <= 3) faStage(lg); }
  // everyone under the hard cap before the season: dumps, then buyouts (the user's team too)
  complyHardCap(lg, rng, true);
  // unsigned restricted free agents play next season on their qualifying offer
  for (const p of Object.values(lg.players)) {
    if (!p.rfa || p.tid || p.retired) continue;
    const t = lg.teams[p.rfa];
    if (t?.active && t.roster.length < ROSTER_MAX) {
      // nobody sent an offer sheet: an AI team that wants him signs him to a market deal (he has nowhere else to go);
      // only if it won't pay that does he play the year on the qualifying offer
      if (t.tid !== lg.userTid) {
        const ask = Math.min(maxSalary(p, N), askingSalary(p, N) * 0.92);
        if (ask > (p.qo ?? MIN_SAL) && worthKeeping(lg, p, ask, N, t.strategy) && payroll(lg, t.tid) + ask <= hardCap(lg)) {
          signWith(lg, p, t.tid, ask, N - 1 + contractYears(p, N, () => rng.next()), rng);
          lg.fa?.log.push({ st: 3, kind: 'resign', pid: p.id, tid: t.tid, from: t.tid, sal: ask, exp: p.contract.exp, desc: 're-signed his restricted free agent' });
          addTx(p, N, `Re-signed with ${t.name} as a restricted free agent: ${Math.round(ask * 1000) / 10}% of the cap through ${p.contract.exp}`, -1);
          continue;
        }
      }
      const qo = p.qo ?? MIN_SAL;
      signWith(lg, p, t.tid, qo, N);
      lg.fa?.log.push({ st: 3, kind: 'qo', pid: p.id, tid: t.tid, from: t.tid, sal: qo, exp: N, desc: 'accepted the qualifying offer (1 yr)' });
      if (t.tid === lg.userTid) lg.news.push({ s: N, t: `${tagOf(p, N)} accepted the ${t.abbr} qualifying offer (1 yr).` });
    }
  }
  const aiFill: string[] = [];
  for (const t of activeTeams(lg)) {
    const filled: string[] = [];
    while (t.roster.length < ROSTER_MIN) {
      const best = Object.values(lg.players).filter(p => isFreeAgent(lg, p)).sort((a, b) => playerValue(b, N, t.strategy) - playerValue(a, N, t.strategy))[0];
      if (!best) break;
      best.tid = t.tid; t.roster.push(best.id);
      const fair = fillSalary(lg, best, t.tid, N);
      best.contract = { sal: fair, exp: N };
      lockTrade(lg, best);
      filled.push(tagOf(best, N));
      lg.fa?.log.push({ st: 4, kind: 'sign', pid: best.id, tid: t.tid, from: prevTeam({ ...best, tid: null } as Player), sal: fair, exp: N, desc: 'to fill the roster' });
      if (t.tid !== lg.userTid && bpmOf(best.z) > NEWS_BPM) aiFill.push(`${tagOf(best, N)} → ${t.abbr}`);
      if (!lg.fa) addTx(best, N, fair > MIN_SAL + 1e-9 ? `Signed with ${t.name}: 1 yr, ${Math.round(fair * 1000) / 10}% of the cap` : `Signed with ${t.name}: minimum deal (1 yr)`, -1);
    }
    const cut: string[] = [];
    while (t.roster.length > ROSTER_MAX) {
      const worst = t.roster.map(pid => lg.players[pid]).sort((a, b) => playerValue(a, N, t.strategy) - playerValue(b, N, t.strategy))[0];
      t.roster = t.roster.filter(pid => pid !== worst.id);
      worst.tid = null;
      cut.push(tagOf(worst, N));
      addTx(worst, N, `Released by ${t.name} before the season`, -1);
    }
    if (t.tid === lg.userTid && (filled.length || cut.length)) {
      lg.news.push({ s: N, t: `${t.name}: ${filled.length ? `roster filled to ${ROSTER_MIN} with ${filled.join(', ')}` : ''}${filled.length && cut.length ? '; ' : ''}${cut.length ? `released ${cut.join(', ')}` : ''}.` });
    }
  }
  for (let i = 0; i < aiFill.length; i += 10) lg.news.push({ s: N, t: `Late signings to fill rosters: ${aiFill.slice(i, i + 10).join(', ')}.` });
  // salary floor: a team still below it pays the shortfall to its players (counts on the books this season)
  for (const t of activeTeams(lg)) {
    const short = FLOOR - payroll(lg, t.tid);
    if (short <= 0.001) continue;
    (lg.dead ??= []).push({ tid: t.tid, sal: short, exp: N, pid: '' });
    if (t.tid === lg.userTid) lg.news.push({ s: N, t: `The ${t.name} missed the salary floor (${Math.round(FLOOR * 100)}% of the cap) – the ${pct(short)} shortfall is paid to the players and counts toward this season's payroll.` });
  }
  flushFaLog(lg);
  for (const p of Object.values(lg.players)) { delete p.bird; delete p.rfa; delete p.qo; delete p.noRfa; }
  resetFatigue(lg);
  for (const t of Object.values(lg.teams)) {
    t.w = t.l = t.homeW = t.homeL = t.pf = t.pa = t.confW = t.confL = 0;
    t.st = emptyLine(); t.opp = emptyLine(); t.gp = 0; t.stPo = emptyLine(); t.oppPo = emptyLine(); t.gpPo = 0;
  }
  lg.phase = 'regular';
  lg.day = 0;
  lg.series = []; lg.playIn = [];
  lg.schedule = makeSchedule(activeTeams(lg), seasonGames(lg, N), rng, lg.nextGameId);
  lg.nextGameId += lg.schedule.length;
  lg.recent = [];
  lg.seasonAwards = undefined;
  ensurePicks(lg);
  // keep league-wide ratings in a realistic range
  normalizeLeague(lg);
  youngFloor(lg);
  if (lg.news.length > 400) lg.news.splice(0, lg.news.length - 400);
  save(lg, rng);
}

/** The whole off-season after the draft at once (simulations and tests). */
export function startNewSeason(lg: League) {
  if (lg.phase !== 'freeagency') enterFreeAgency(lg);
  if (lg.ended) return;
  while (lg.fa!.stage <= 3) faStage(lg);
  startSeason(lg);
}

function retirePlayer(lg: League, p: Player, Y: number) {
  if (p.tid) lg.teams[p.tid].roster = lg.teams[p.tid].roster.filter(pid => pid !== p.id);
  if (p.tid) addTx(p, Y, `Retired (${lg.teams[p.tid]?.name ?? ''})`, 1000); else addTx(p, Y, 'Retired', 1000);
  p.tid = null;
  p.retired = Y;
}

function retirements(lg: League, rng: Rng, notes: string[]) {
  const Y = lg.season, d = lg.destiny;
  const famous: string[] = [];
  for (const p of Object.values(lg.players)) {
    if (p.retired || (p as any).stash) continue;
    const age = ageIn(p, Y + 1);
    const ovr = ovrOf(p.z);
    const base = 1 / (1 + Math.exp(-((age - 35.5) * 0.9 + (46 - ovr) * 0.09)));
    let pr = base, hist = 0, uns = 0;
    const lr = lastRealSeason(p.id);
    const last = lr !== undefined ? lr + (p.shift ?? 0) : undefined;
    if (p.real && last !== undefined) {
      const endedInReality = last <= Y;
      // destiny ends real careers on time, but a young player who is good enough in this league to keep
      // a job rarely walks away: the pull of history fades with youth and quality
      const sh = shownOvr(p.z);
      const w = age < 30 ? (sh >= 78 ? 0.06 : sh >= 74 ? 0.15 : sh >= 70 ? 0.4 : 0.8)
        : age < 33 ? (sh >= 78 ? 0.25 : sh >= 74 ? 0.45 : 0.8) : 1;
      hist = endedInReality ? d * w : 0;
      pr = endedInReality ? hist + (1 - hist) * base : (1 - d) * base;
    }
    // unsigned for a long time → leaves the league
    if (!p.tid && p.cur.gp === 0 && !p.career.some(c => c.s === Y)) {
      const lastPlayed = Math.max(p.entered, ...p.career.map(c => c.s));
      if (Y - lastPlayed >= 1) { uns = age >= 30 ? 0.7 : 0.35; pr = Math.max(pr, uns); }
    }
    if (rng.chance(pr)) {
      (p as any).retWhy = uns >= Math.max(hist, base) ? 'unsigned' : hist > base ? 'history' : 'age';
      if (bpmOf(p.z) > 3 || p.awards.some(a => a.includes('MVP'))) famous.push(tagOf(p, Y));
      retirePlayer(lg, p, Y);
    }
  }
  if (famous.length) {
    notes.push(`Retired: ${famous.slice(0, 8).join(', ')}.`);
    lg.news.push({ s: Y, t: `Retirements: ${famous.slice(0, 6).join(', ')}.` });
  }
}

/**
 * Option years for next season: players decide on player options (opting out
 * when the market pays clearly more), AI teams on team options; the user's team
 * options wait for his decision (stage 0).
 */
function processOptions(lg: League, rng: Rng, log: FreeAgency['log'], decisions: NonNullable<FreeAgency['decisions']>) {
  const Y = lg.season, N = Y + 1;
  for (const t of activeTeams(lg)) for (const pid of [...t.roster]) {
    const p = lg.players[pid];
    const o = p.contract.opts?.find(x => x.s === N);
    if (!o) continue;
    if (o.k === 'player') {
      if (optsOut(p, N)) {
        p.contract = { sal: p.contract.sal, exp: Y }; p.noRfa = true;
        log.push({ st: 0, kind: 'option', pid, tid: t.tid, desc: 'declined his player option and became a free agent' });
      } else {
        p.contract.opts = p.contract.opts!.filter(x => x !== o);
        log.push({ st: 0, kind: 'option', pid, tid: t.tid, desc: 'exercised his player option and stays' });
      }
    } else if (t.tid === lg.userTid) {
      decisions.push({ pid, kind: 'team', rec: worthKeeping(lg, p, p.contract.sal, N, t.strategy), sal: p.contract.sal });
    } else if (worthKeeping(lg, p, p.contract.sal, N, t.strategy) && payroll(lg, t.tid) <= hardCap(lg)) {
      p.contract.opts = p.contract.opts!.filter(x => x !== o);
      log.push({ st: 0, kind: 'option', pid, tid: t.tid, desc: 'team exercised the option' });
    } else {
      p.contract = { sal: p.contract.sal, exp: Y }; p.noRfa = true;
      log.push({ st: 0, kind: 'option', pid, tid: t.tid, desc: 'team declined the option – free agent' });
    }
  }
}

/** AI teams decide on their expiring contracts; the user's expiring players are returned (re-signing window). */
function contracts(lg: League, rng: Rng, log: FreeAgency['log'], decisions: NonNullable<FreeAgency['decisions']>): string[] {
  const Y = lg.season, N = Y + 1;
  const cap = 1;
  const pending: string[] = [];
  for (const t of activeTeams(lg)) {
    if (t.tid === lg.userTid) {
      for (const p of t.roster.map(pid => lg.players[pid]).filter(p => p.contract.exp <= Y)) {
        t.roster = t.roster.filter(pid => pid !== p.id);
        p.tid = null; p.bird = t.tid;
        // restricted: the user decides on a qualifying offer; otherwise an exclusive re-signing window
        if (rfaEligible(p, N, lg)) decisions.push({ pid: p.id, kind: 'qo', rec: worthKeeping(lg, p, qoAmount(p), N, t.strategy), sal: qoAmount(p) });
        else pending.push(p.id);
      }
      continue;
    }
    const expiring = t.roster.map(pid => lg.players[pid]).filter(p => p.contract.exp <= Y);
    if (!expiring.length) continue;
    const keepers = t.roster.map(pid => lg.players[pid]).filter(p => p.contract.exp > Y);
    let pay = keepers.reduce((a, p) => a + p.contract.sal, 0);
    // re-sign the most valuable first
    expiring.sort((a, b) => playerValue(b, Y + 1, t.strategy) - playerValue(a, Y + 1, t.strategy));
    const ranked = t.roster.map(pid => lg.players[pid]).sort((a, b) => playerValue(b, Y + 1, t.strategy) - playerValue(a, Y + 1, t.strategy));
    for (const p of expiring) {
      const own = discount(lg, p, t.tid);
      const ask = Math.min(maxSalary(p, N), askingSalary(p, N) * (1 - own));
      const rank = ranked.indexOf(p);
      const v = playerValue(p, Y + 1, t.strategy);
      const worth = v / Math.max(MIN_SAL, ask);
      const budget = hardCap(lg); // own-player (Bird) rights allow going over the cap – every team up to the hard cap
      const wants = rank < 9 && worth > 12 && pay + ask <= budget;
      // will he stay? the more he likes the team (winning, role, loyalty), the likelier
      const accepts = rng.chance(Math.max(0.15, Math.min(0.95, 0.6 + 2 * own)));
      if (wants && accepts) {
        p.contract = vetContract(p, N, ask, contractYears(p, N, () => rng.next()), rng);
        lockTrade(lg, p);
        pay += ask;
        log.push({ st: 0, kind: 'resign', pid: p.id, tid: t.tid, from: t.tid, sal: p.contract.sal, exp: p.contract.exp });
      } else {
        t.roster = t.roster.filter(pid => pid !== p.id);
        p.tid = null;
        // restricted free agent: a qualifying offer keeps the right to match
        if (rfaEligible(p, N, lg) && worthKeeping(lg, p, qoAmount(p), N, t.strategy)) {
          p.rfa = t.tid; p.qo = qoAmount(p);
          log.push({ st: 0, kind: 'qo', pid: p.id, tid: t.tid, sal: p.qo });
        }
      }
    }
  }
  return pending;
}

function arrivals(lg: League, rng: Rng) {
  const N = lg.season + 1, d = lg.destiny;
  for (const pid of H.arrivals[String(N)] ?? []) {
    if (lg.players[pid]) continue;
    const tgt = realTarget(pid, N)!;
    const prior = H.draftPrior[6].z;
    const z = prior.map((v, i) => v + rng.normal() * 0.5 + d * (tgt.z[i] - (v)));
    const p = newPlayer(pid, z, null, N);
    p.entered = N;
    zClamp(p.z);
    p.contract = { sal: MIN_SAL, exp: N };
    lg.players[pid] = p;
  }
  // draft-and-stash players come over
  for (const p of Object.values(lg.players)) {
    const st = (p as any).stash;
    if (st && st <= N) {
      const rights = (p as any).rights as string;
      delete (p as any).stash; delete (p as any).rights;
      if (lg.teams[rights] && lg.teams[rights].roster.length < ROSTER_MAX) {
        p.tid = rights; lg.teams[rights].roster.push(p.id);
        p.contract = { sal: askingSalary(p, N), exp: N + 2 };
      }
    }
  }
}

/**
 * Bring a draft-and-stash player over now instead of waiting for his real debut year
 * (the team holding his rights; he signs a rookie-scale deal or his market salary, whichever is higher).
 */
export function recallStash(lg: League, pid: string): { ok: boolean; msg: string } {
  const p = lg.players[pid] as any;
  if (!p || !p.stash) return { ok: false, msg: 'He is not playing overseas.' };
  const tid = p.rights as string, t = lg.teams[tid];
  if (!t) return { ok: false, msg: 'Nobody holds his rights.' };
  if (lg.phase === 'playoffs' || lg.phase === 'draft') return { ok: false, msg: 'Players can be brought over in free agency or during the regular season.' };
  if (t.roster.length >= ROSTER_MAX) return { ok: false, msg: `${t.name} have a full roster (${ROSTER_MAX}) – release someone first.` };
  const N = lg.phase === 'regular' ? lg.season : lg.season + 1;
  const rookie = p.draft && p.draft.year >= N - 2 ? rookieContract(p.draft.pick, p.draft.round, N - 1) : null;
  const sal = Math.max(rookie?.sal ?? 0, askingSalary(p, N) * 0.8, MIN_SAL);
  const hc = hardCap(lg);
  if (payroll(lg, tid) + sal > hc + 1e-9) return { ok: false, msg: `His salary (${Math.round(sal * 100)}% of the cap) would put ${t.name} over the hard cap.` };
  delete p.stash; delete p.rights;
  p.tid = tid; t.roster.push(pid);
  p.contract = rookie ? { ...rookie, sal } : { sal, exp: N + 2, rookie: true };
  lockTrade(lg, p);
  addTx(p, N, `Came over from overseas early to join the ${t.name}`, 5);
  lg.news.push({ s: lg.season, t: `The ${t.name} brought ${p.name} over from overseas.` });
  return { ok: true, msg: `${p.name} joins the ${t.name}.` };
}

/**
 * AI teams bring their overseas draft picks over early when the player would help:
 * good enough for the rotation now (contenders), or a young talent worth developing (rebuilders).
 */
export function aiRecallStash(lg: League, rng: Rng, chance = 1) {
  const S = lg.phase === 'regular' ? lg.season : lg.season + 1;
  for (const p of Object.values(lg.players) as any[]) {
    if (!p.stash || p.retired || p.rights === lg.userTid) continue;
    const t = lg.teams[p.rights];
    if (!t?.active || t.roster.length >= ROSTER_MAX) continue;
    const ovr = ovrOf(p.z);
    const rot = t.roster.map(pid => ovrOf(lg.players[pid].z)).sort((a, b) => b - a);
    const ninth = rot[8] ?? 0, sixth = rot[5] ?? 0;
    const age = ageIn(p, S);
    const helpsNow = ovr >= ninth + 1;
    const prospect = age <= 23 && peakBpm(p, S) >= 1.5;
    const want = t.mode === 'allin' || t.strategy === 'contend' ? (ovr >= sixth ? 0.9 : helpsNow ? 0.6 : 0)
      : t.mode === 'tank' || t.strategy === 'rebuild' ? (prospect ? 0.7 : helpsNow ? 0.35 : 0)
      : helpsNow ? 0.55 : prospect ? 0.3 : 0;
    if (!want || !rng.chance(want * chance)) continue;
    recallStash(lg, p.id);
  }
}

/** A late signing to fill a roster: a good player still costs most of his market value (within the hard cap). */
export function fillSalary(lg: League, p: Player, tid: string, N: number) {
  const room = hardCap(lg) - payroll(lg, tid);
  return Math.max(MIN_SAL, Math.min(askingSalary(p, N) * 0.7, room));
}
