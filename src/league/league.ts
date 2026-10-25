import { H, seasonInfo, LAST_SEASON, bpmOf, ovrOf } from '../data';
import { trackGame, playoffFinish } from './records';
import { Rng } from '../rng';
import { simGame, gameGen, PbpEv, GameState, Decision } from '../engine/game';
import { aiTradeRound, ensurePicks, pastDeadline, deadlineDay, complyHardCap } from '../ai/trades';
import {
  Settings, League, Team, Player, Game, Series, PlayInGame, GameResult, StatLine, emptyLine, addLine, SeasonSummary, CareerSeason,
} from '../types';
import { newPlayer, ageIn, realTarget, prospectZ, tagOf } from '../players';
import { buildClasses, ClassMode } from './classes';
import { nextCal, fatigueAt, addLoad, fatigueExcess, calDay } from './fatigue';
import { rollGameInjury, injure, refreshInjuries, offDayInjuries } from './injuries';
import { aiExtensions } from './extensions';
import { aiRecallStash } from './offseason';
import { makeSchedule } from './schedule';
import { recordHealth } from './health';
import { computeAwards, applyAwardChips, finalsMvp } from './awards';
import { askingSalary, contractYears, teamStrength, peakBpm, payroll, hardCap } from '../ai/value';

export const VERSION = 1;

export function rngOf(lg: League) { return new Rng(lg.rng); }
function saveRng(lg: League, r: Rng) { lg.rng = [...r.s] as any; }

// ---------------------------------------------------------------- creation
export function newLeague(destiny: number, seed: number, settings: Settings = { games: null, series: null }, opts: { fantasy?: boolean; start?: number; classMode?: ClassMode } = {}): League {
  const rng = new Rng(seed);
  const season = Math.max(1980, Math.min(LAST_SEASON - 1, opts.start ?? 1980));
  const si = seasonInfo(season);
  const lg: League = {
    version: VERSION, seed, rng: [...rng.s] as any, destiny, userTid: null, season, phase: 'regular', day: 0,
    teams: {}, players: {}, schedule: [], playIn: [], series: [], history: [], recent: [], news: [], nextGameId: 1,
    settings, start: season,
  };
  for (const [tid, t] of Object.entries(si.teams)) {
    lg.teams[tid] = makeTeam(tid, t.abbr, t.name, t.conf, rng, (t.pace / si.league.pace - 1) / 0.03);
  }
  const sign = (p: Player) => {
    p.contract = { sal: askingSalary(p, season), exp: season + rng.int(Math.max(1, contractYears(p, season, () => rng.next()))) };
    if (season - p.entered <= 3) p.contract.rookie = true; // still on his first contract: restricted when it ends
    const d = p.draft;
    if (season >= 2000 && d && d.round === 1 && d.year >= season - 4 && d.year < season) {
      // rookie scale: two guaranteed years, team options for years 3 and 4
      p.contract.exp = d.year + 4; p.contract.rookie = true;
      p.contract.opts = [d.year + 3, d.year + 4].filter(y => y > season).map(y => ({ s: y, k: 'team' as const }));
    } else if (season >= 1990 && p.contract.exp - season >= 2 && rng.chance(0.25)) {
      p.contract.opts = [{ s: p.contract.exp, k: rng.chance(0.7) ? 'player' : 'team' }];
    }
  };
  const withDraft = (p: Player) => {
    const hp = H.players[p.id];
    if (hp.d) p.draft = { year: hp.d[0], pick: hp.d[1], round: hp.d[2], tid: hp.d[3], realPick: hp.d[1], realTid: hp.d[3] };
  };
  const rosters: Record<string, string[]> = {};
  if (season === 1980) Object.assign(rosters, H.roster1980);
  else {
    for (const [pid, hp] of Object.entries(H.players)) {
      const row = hp.s.find(r => r[0] === season);
      if (row && lg.teams[row[1]]) (rosters[row[1]] ??= []).push(pid);
    }
    for (const tid in rosters) rosters[tid].sort((a, b) => H.players[b].s.find(r => r[0] === season)![3] - H.players[a].s.find(r => r[0] === season)![3]);
  }
  for (const [tid, pids] of Object.entries(rosters)) {
    pids.forEach((pid, i) => {
      const hp = H.players[pid];
      const rs = hp.s.find(r => r[0] === season)!;
      const p = newPlayer(pid, rs[7], i < 15 ? tid : null, season);
      p.entered = season === 1980 ? (hp.f === 1980 ? 1980 : 1979) : Math.min(season, hp.s[0][0]);
      withDraft(p);
      sign(p);
      lg.players[pid] = p;
      if (p.tid) lg.teams[tid].roster.push(pid);
    });
  }
  if (season > 1980) {
    for (const [pid, hp] of Object.entries(H.players)) {
      if (lg.players[pid] || !hp.s.length) continue;
      const first = hp.s[0][0], last = hp.s[hp.s.length - 1][0];
      if (first < season && last > season) {
        // sat out this season in reality: a free agent
        const tgt = realTarget(pid, season)!;
        const p = newPlayer(pid, tgt.z, null, season);
        p.entered = first; withDraft(p); sign(p);
        lg.players[pid] = p;
      } else if (first > season && hp.d && hp.d[0] >= 1980 && hp.d[0] < season) {
        // drafted before the league starts, still playing abroad: his rights stay with the drafting team
        const p = newPlayer(pid, prospectZ(pid, hp.d[0], destiny, rng), null, season);
        p.entered = first; withDraft(p);
        (p as any).stash = first; (p as any).rights = hp.d[3];
        lg.players[pid] = p;
      }
    }
  }
  // starting payrolls must fit under the hard cap: trim every contract of a team that is over it
  const hc = hardCap(lg);
  for (const t of Object.values(lg.teams)) {
    const pay = payroll(lg, t.tid);
    if (pay > hc - 0.02) for (const pid of t.roster) lg.players[pid].contract.sal *= (hc - 0.02) / pay;
  }
  buildClasses(lg, opts.classMode ?? 'real', rng);
  const label = `${season - 1}–${String(season).slice(2)}`;
  if (opts.fantasy) {
    // everybody goes into one pool; teams draft new rosters (snake order)
    for (const t of Object.values(lg.teams)) t.roster = [];
    for (const p of Object.values(lg.players)) if (!(p as any).stash) p.tid = null;
    lg.phase = 'fantasy';
    lg.fantasy = { order: rng.shuffle(Object.keys(lg.teams)), rounds: 13, picks: [], done: false };
    saveRng(lg, rng);
    lg.news.push({ s: season, t: `Fantasy draft: all ${label} players go into one pool and teams pick in snake order.` });
    return lg;
  }
  beginFirstSeason(lg, rng);
  lg.news.push({ s: season, t: `The ${label} season begins. Destiny slider: ${Math.round(destiny * 100)}%.` });
  return lg;
}

export function beginFirstSeason(lg: League, rng = rngOf(lg)) {
  updateStrategies(lg);
  ensurePicks(lg);
  recordHealth(lg);
  lg.phase = 'regular';
  lg.day = 0;
  lg.schedule = makeSchedule(activeTeams(lg), seasonGames(lg, lg.season), rng, lg.nextGameId);
  lg.nextGameId += lg.schedule.length;
  saveRng(lg, rng);
}

export function makeTeam(tid: string, abbr: string, name: string, conf: 'E' | 'W', rng: Rng, paceZ = 0): Team {
  return {
    tid, abbr, name, conf, roster: [], w: 0, l: 0, homeW: 0, homeL: 0, pf: 0, pa: 0, confW: 0, confL: 0,
    strategy: 'middle', gm: { risk: rng.next(), patience: rng.next(), scouting: 0.4 + rng.next() * 0.6 }, paceZ, active: true,
  };
}

export function activeTeams(lg: League) { return Object.values(lg.teams).filter(t => t.active); }

export function updateStrategies(lg: League) {
  const ts = activeTeams(lg).map(t => ({ t, s: teamStrength(lg, t.tid) })).sort((a, b) => b.s - a.s);
  ts.forEach(({ t }, i) => {
    const ages = t.roster.map(pid => lg.players[pid]).sort((a, b) => bpmOf(b.z) - bpmOf(a.z)).slice(0, 4).map(p => ageIn(p, lg.season));
    const core = ages.reduce((a, b) => a + b, 0) / Math.max(1, ages.length);
    if (i < Math.max(4, ts.length / 5)) t.strategy = 'contend';
    else if (i >= ts.length - Math.max(5, ts.length / 4) || (core > 31 && i > ts.length / 3)) t.strategy = 'rebuild';
    else t.strategy = 'middle';
  });
  updateModes(lg, false);
}

/**
 * All-in and tanking. A contender near the top – or with a core whose window
 * is closing – goes all in: the future is for sale for missing pieces. A bad
 * team without a young core to build around tanks: it sells what helps now for
 * picks and youth, and the worse it finishes the better its lottery odds.
 */
export function updateModes(lg: League, announce = true) {
  const teams = activeTeams(lg);
  const inSeason = lg.phase === 'regular';
  const strength = teams.map(t => ({ t, s: teamStrength(lg, t.tid) })).sort((a, b) => b.s - a.s);
  const score = new Map(strength.map(({ t }, i) => {
    const sRank = 1 - i / Math.max(1, teams.length - 1);
    const g = t.w + t.l;
    const wt = inSeason && g >= 5 ? Math.min(0.75, g / 40) : 0; // the record matters more as the season goes on
    return [t.tid, (1 - wt) * sRank + wt * (g ? t.w / g : 0.5)];
  }));
  const order = [...teams].sort((a, b) => score.get(b.tid)! - score.get(a.tid)!);
  const n = teams.length;
  order.forEach((t, i) => {
    const top = t.roster.map(pid => lg.players[pid]).sort((a, b) => bpmOf(b.z) - bpmOf(a.z));
    const core = top.slice(0, 4).map(p => ageIn(p, lg.season));
    const coreAge = core.reduce((a, b) => a + b, 0) / Math.max(1, core.length);
    const young = top.filter(p => ageIn(p, lg.season) <= 24 && peakBpm(p, lg.season) >= 2).length;
    const g = t.w + t.l, wp = g ? t.w / g : 0.5;
    let mode: Team['mode'] = undefined;
    const pay = payroll(lg, t.tid), hc = hardCap(lg);
    // the standings count as soon as there are a few games: nobody tanks with a winning record, nobody goes all-in while losing
    // (with some hysteresis, so a team does not flip in and out every two weeks)
    const winning = t.mode === 'tank' ? inSeason && g >= 10 && wp > 0.5 : inSeason && g >= 6 && wp > 0.4;
    const losing = t.mode === 'allin' ? inSeason && g >= 15 && wp < 0.42 : inSeason && g >= 10 && wp < 0.5;
    if (t.strategy === 'contend' && !losing && (i < 3 || (i < 6 && coreAge >= 29) || (inSeason && g >= 20 && wp >= 0.65))) mode = 'allin';
    else if (i >= n - Math.max(2, Math.round(n * 0.17)) && (young <= 1 || coreAge >= 27) && !winning) mode = 'tank';
    else if (pay > hc - 0.02) mode = 'capclear';
    else if (young >= 2 && coreAge <= 25.5 && i >= 3) mode = 'rising';
    // stuck in the middle: not good enough to contend, too good to tank – the GM keeps making side moves
    else if (t.mode === 'retool' ? (i >= Math.round(n * 0.15) && i < n - 2 && (!inSeason || g < 15 || (wp >= 0.33 && wp <= 0.67)))
      : (i >= Math.round(n * 0.25) && i < n - Math.max(2, Math.round(n * 0.2)) && (!inSeason || g < 15 || (wp >= 0.38 && wp <= 0.62)) && (t.gm.risk >= 0.35 || (inSeason && g >= 25 && Math.abs(wp - 0.5) < 0.07)))) mode = 'retool';
    if (t.tid === lg.userTid) mode = undefined; // the user decides for his own team
    if (announce && mode !== t.mode && mode) {
      const txt = { allin: 'goes all-in – hunting the missing pieces for a title, at the cost of the future', tank: 'starts tanking – will sell veterans for picks and young players', retool: 'is stuck in the middle – shopping for side moves to break out', rising: 'is rising with a young core – adding to it without selling the future', capclear: 'is close to the hard cap – will look to shed salary' }[mode];
      lg.news.push({ s: lg.season, t: `${t.name} ${txt}.` });
    }
    if (announce && t.mode === 'tank' && mode !== 'tank') lg.news.push({ s: lg.season, t: `${t.name} are playing too well to tank – the sell-off is off.` });
    if (announce && t.mode === 'allin' && mode !== 'allin' && losing) lg.news.push({ s: lg.season, t: `${t.name} are losing – the all-in push is off.` });
    t.mode = mode;
    if (mode === 'tank') t.strategy = 'rebuild';
  });
}

// ---------------------------------------------------------------- simulation
function availablePlayers(lg: League, tid: string, rng: Rng) {
  const cal = nextCal(lg, todayIndex(lg));
  refreshInjuries(lg, cal, lg.teams[tid].roster.map(pid => lg.players[pid]));
  let ps = lg.teams[tid].roster.map(pid => lg.players[pid]).filter(p => p.injury <= 0);
  // tanking after the deadline: veterans "rest" in some games
  const t = lg.teams[tid];
  if (t.mode === 'tank' && lg.phase === 'regular' && pastDeadline(lg)) {
    const vets = [...ps].sort((a, b) => bpmOf(b.z) - bpmOf(a.z)).slice(0, 6).filter(p => ageIn(p, lg.season) >= 28);
    for (const v of vets) if (ps.length > 9 && rng.chance(0.4)) ps = ps.filter(p => p !== v);
  }
  for (const p of ps) {
    p.fatNow = fatigueAt(lg, p, cal);
    rollGameInjury(lg, p, rng, fatigueExcess(p.fatNow));
  }
  return ps;
}

function applyBox(lg: League, res: GameResult) {
  for (const b of [res.home, res.away]) for (const pl of b.players) {
    const p = lg.players[pl.pid];
    addLine(res.po ? p.curPo : p.cur, pl.st);
  }
  // team totals (own and opponents')
  for (const [b, o] of [[res.home, res.away], [res.away, res.home]] as const) {
    const t = lg.teams[b.tid];
    const own = emptyLine(), opp = emptyLine();
    for (const pl of b.players) addLine(own, pl.st);
    for (const pl of o.players) addLine(opp, pl.st);
    own.min = own.min / 5; opp.min = opp.min / 5;
    if (res.po) { addLine(t.stPo ??= emptyLine(), own); addLine(t.oppPo ??= emptyLine(), opp); t.gpPo = (t.gpPo ?? 0) + 1; }
    else { addLine(t.st ??= emptyLine(), own); addLine(t.opp ??= emptyLine(), opp); t.gp = (t.gp ?? 0) + 1; }
  }
}

/** Players who got hurt during the game (the engine took them off the floor). */
function injuries(lg: League, res: GameResult, rng: Rng) {
  const cal = calDay(lg, res.day, res.po);
  for (const b of [res.home, res.away]) for (const pl of b.players) {
    const p = lg.players[pl.pid];
    delete p.injAt;
    if (pl.hurt) injure(lg, p, cal, rng, 'game');
  }
}

// ---- single games: watching one game (or coaching its last 5 minutes) plays
// only that game; the rest of the day stays unplayed until the user moves on.
type Deferred = { kind: 'reg'; g: Game } | { kind: 'series'; s: Series; home: string } | { kind: 'playin'; p: PlayInGame };
export interface ClutchSession {
  gen: Generator<GameState, any, Decision>;
  home: string; away: string; po: boolean; side: 'h' | 'a';
  state: GameState | null; result: any; deferred: Deferred | null; day: number;
}
export const CLUTCH_FROM = 300;
export let pendingClutch = false;
export function hasPendingClutch() { return pendingClutch; }

/** The scheduled game between these teams that can be played now. */
function findTodayGame(lg: League, home: string, away: string): Deferred | null {
  if (lg.phase === 'regular') {
    const g = lg.schedule.find(x => !x.done && x.home === home && x.away === away && x.day === todayIndex(lg));
    return g ? { kind: 'reg', g } : null;
  }
  if (lg.phase === 'playoffs') {
    const p = lg.playIn.find(x => !x.winner && x.a === home && x.b === away);
    if (p) return { kind: 'playin', p };
    if (lg.playIn.some(x => !x.winner)) return null;
    const s = lg.series.find(x => !x.winner && x.lastDay !== lg.day && ((x.hi === home && x.lo === away) || (x.hi === away && x.lo === home)));
    return s ? { kind: 'series', s, home } : null;
  }
  return null;
}

/** Day of the next unplayed regular-season games. */
export function todayIndex(lg: League) {
  const left = lg.schedule.filter(g => !g.done);
  if (!left.length) return lg.day;
  return left.some(g => g.day === lg.day) ? lg.day : Math.min(...left.map(g => g.day));
}

function recordResult(lg: League, res: GameResult, rng: Rng) {
  applyBox(lg, res);
  injuries(lg, res, rng);
  addLoad(lg, res);
  lg.recent.push(res);
  trackGame(lg, res);
  // keep the latest 400 games, and every game of the user's team this season
  if (lg.recent.length > 400) {
    const u = lg.userTid;
    const i = lg.recent.findIndex(r => !u || (r.home.tid !== u && r.away.tid !== u) || r.season !== lg.season);
    lg.recent.splice(i >= 0 ? i : 0, 1);
  }
}

function applyDeferred(lg: League, d: Deferred, res: GameResult, rng: Rng) {
  if (d.kind === 'reg') {
    applyRegular(lg, d.g, res);
    d.g.rid = res.id;
    regularDayEnd(lg, d.g.day, rng);
  } else if (d.kind === 'series') {
    applySeries(lg, d.s, d.home, res);
    (d.s.games ??= []).push(res.id);
    d.s.lastDay = lg.day;
    const live = lg.series.filter(x => !x.winner && x.hi && x.lo);
    if (live.length) {
      const round = Math.min(...live.map(x => x.round));
      if (live.filter(x => x.round === round).every(x => x.lastDay === lg.day)) lg.day++;
    }
    if (lg.series.length && lg.series.every(x => x.winner) && lg.series.some(x => x.conf === 'F')) finishSeason(lg, rng);
  } else {
    d.p.winner = res.home.pts > res.away.pts ? d.p.a : d.p.b;
    d.p.rid = res.id;
    playInPost(lg);
  }
}

/** End of a regular-season day once all its games are played. */
function regularDayEnd(lg: League, day: number, rng: Rng) {
  if (lg.schedule.some(g => !g.done && g.day === day)) return;
  if (day % 4 === 3 && !pastDeadline(lg)) aiTradeRound(lg, rng, 0.75);
  if (day % 10 === 5) aiExtensions(lg, rng);
  // GMs settle on a plan early and take a last look three weeks before the deadline, so buyers and sellers are set for the rush
  const dlDay = deadlineDay(lg);
  if ((day % 12 === 8 && day < dlDay - 20) || day === dlDay - 20) updateModes(lg);
  if (day % 30 === 20 && !pastDeadline(lg)) aiRecallStash(lg, rng, 0.25);
  if (day % 10 === 3 && !pastDeadline(lg)) complyHardCap(lg, rng);
  // the trade deadline rush: the last ten days before it bring more talks
  const dl = deadlineDay(lg);
  if (day >= dl - 14 && day <= dl) aiTradeRound(lg, rng, 1.2);
  lg.day = Math.max(lg.day, day + 1);
  if (!lg.schedule.some(g => !g.done)) startPlayoffs(lg, rng);
}

/** Play one game now and return it with its play-by-play. */
/**
 * Play one of today's games for watching. With `defer` the result is not recorded yet: the viewer
 * calls commit() when it closes, so nothing (box scores, series, a title) is known before it is seen.
 */
export function playSingle(lg: League, home: string, away: string, opts: { defer?: boolean } = {}): { res: GameResult; pbp: PbpEv[]; before?: string; commit: () => void } | null {
  const d = findTodayGame(lg, home, away);
  if (!d) return null;
  const rng = rngOf(lg);
  const po = lg.phase === 'playoffs';
  const h = lg.teams[home], a = lg.teams[away];
  const r = simGame(
    { tid: h.tid, players: availablePlayers(lg, h.tid, rng), paceZ: h.paceZ },
    { tid: a.tid, players: availablePlayers(lg, a.tid, rng), paceZ: a.paceZ },
    { season: lg.season, po, rng, pbp: true },
  );
  const res: GameResult = { id: lg.nextGameId++, season: lg.season, day: d.kind === 'reg' ? d.g.day : lg.day, po, home: r.home, away: r.away, ot: r.ot };
  const before = d.kind === 'series' ? `Game ${d.s.hw + d.s.lw + 1} · ${seriesText(lg, d.s)}` : d.kind === 'playin' ? 'Play-in' : undefined;
  if (d.kind === 'series') {
    // how the series stands after this game (shown at the final buzzer)
    const homeWon = res.home.pts > res.away.pts;
    const hiWon = (d.home === d.s.hi) === homeWon;
    const t = { ...d.s, hw: d.s.hw + (hiWon ? 1 : 0), lw: d.s.lw + (hiWon ? 0 : 1) };
    const need = Math.ceil(t.bestOf / 2);
    if (t.hw >= need) t.winner = t.hi; else if (t.lw >= need) t.winner = t.lo;
    res.ser = `Game ${t.hw + t.lw} · ${seriesText(lg, t)}`;
  }
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    recordResult(lg, res, rng);
    applyDeferred(lg, d, res, rng);
    saveRng(lg, rng);
  };
  if (!opts.defer) commit();
  return { res, pbp: r.pbp!, before, commit };
}
export const simDayWatching = (lg: League, home: string, away: string, opts: { defer?: boolean } = {}) => playSingle(lg, home, away, opts);

/** "BOS leads 2–1", "Series tied 1–1", "BOS wins 4–2" */
export function seriesText(lg: League, s: Series) {
  const ab = (t: string) => lg.teams[t]?.abbr ?? t;
  const hi = Math.max(s.hw, s.lw), lo = Math.min(s.hw, s.lw);
  const lead = s.hw > s.lw ? s.hi : s.lo;
  if (s.winner) return `${ab(s.winner)} wins ${hi}–${lo}`;
  if (s.hw === s.lw) return `Series tied ${hi}–${lo}`;
  return `${ab(lead)} leads ${hi}–${lo}`;
}

/** Start coaching the last five minutes of one game; nothing else is played. */
export function startClutch(lg: League, home: string, away: string, side: 'h' | 'a'): ClutchSession | null {
  const d = findTodayGame(lg, home, away);
  if (!d || d.kind === 'playin') return null;
  const rng = rngOf(lg);
  const h = lg.teams[home], a = lg.teams[away];
  const po = lg.phase === 'playoffs';
  const gen = gameGen(
    { tid: h.tid, players: availablePlayers(lg, h.tid, rng), paceZ: h.paceZ },
    { tid: a.tid, players: availablePlayers(lg, a.tid, rng), paceZ: a.paceZ },
    { season: lg.season, po, rng: new Rng(Math.floor(rng.next() * 2 ** 31)), ctl: { side, fromRem: CLUTCH_FROM, timeouts: 3 } },
  );
  saveRng(lg, rng);
  const cs: ClutchSession = { gen, home, away, po, side, state: null, result: null, deferred: d, day: d.kind === 'reg' ? d.g.day : lg.day };
  pendingClutch = true;
  const r = cs.gen.next();
  if (r.done) cs.result = r.value; else cs.state = r.value;
  return cs;
}

/** Advance the clutch game by one possession with the coach's decision. */
export function clutchStep(cs: ClutchSession, dec: Decision) {
  if (cs.result) return;
  const r = cs.gen.next(dec);
  if (r.done) { cs.result = r.value; cs.state = null; } else cs.state = r.value;
}

/** Play the rest of the clutch game without the user (e.g. the viewer was closed). */
export function clutchAuto(cs: ClutchSession) {
  while (!cs.result) clutchStep(cs, {});
}

/** Record the finished clutch game in the league. */
export function finishClutch(lg: League, cs: ClutchSession): GameResult {
  clutchAuto(cs);
  const rng = rngOf(lg);
  const r = cs.result;
  const res: GameResult = { id: lg.nextGameId++, season: lg.season, day: cs.day, po: cs.po, home: r.home, away: r.away, ot: r.ot };
  recordResult(lg, res, rng);
  applyDeferred(lg, cs.deferred!, res, rng);
  saveRng(lg, rng);
  pendingClutch = false;
  return res;
}

function applyRegular(lg: League, g: Game, res: GameResult) {
  g.done = true; g.hs = res.home.pts; g.as = res.away.pts;
  const h = lg.teams[g.home], a = lg.teams[g.away];
  const hw = res.home.pts > res.away.pts;
  if (hw) { h.w++; a.l++; h.homeW++; } else { a.w++; h.l++; h.homeL++; }
  h.pf += res.home.pts; h.pa += res.away.pts; a.pf += res.away.pts; a.pa += res.home.pts;
  if (h.conf === a.conf) { if (hw) { h.confW++; a.confL++; } else { a.confW++; h.confL++; } }
}
function applySeries(lg: League, s: Series, home: string, res: GameResult) {
  const hiWon = (res.home.pts > res.away.pts) === (home === s.hi);
  if (hiWon) s.hw++; else s.lw++;
  res.ser = `Game ${s.hw + s.lw} · ${seriesText(lg, s)}`;
  const need = Math.ceil(s.bestOf / 2);
  if (s.hw >= need || s.lw >= need) {
    s.winner = s.hw >= need ? s.hi : s.lo;
    advance(lg, s);
  }
}

export function playGame(lg: League, g: { home: string; away: string }, po: boolean, rng: Rng): GameResult {
  const h = lg.teams[g.home], a = lg.teams[g.away];
  const r = simGame(
    { tid: h.tid, players: availablePlayers(lg, h.tid, rng), paceZ: h.paceZ },
    { tid: a.tid, players: availablePlayers(lg, a.tid, rng), paceZ: a.paceZ },
    { season: lg.season, po, rng },
  );
  const res: GameResult = { id: lg.nextGameId++, season: lg.season, day: lg.day, po, home: r.home, away: r.away, ot: r.ot };
  recordResult(lg, res, rng);
  return res;
}

/** Games that can still be played today (regular season, or the next playoff games). */
export function watchableToday(lg: League): { home: string; away: string; label?: string; day?: number }[] {
  if (lg.phase === 'regular') {
    const d = todayIndex(lg);
    return lg.schedule.filter(g => !g.done && g.day === d).map(g => ({ home: g.home, away: g.away, day: g.day }));
  }
  if (lg.phase === 'playoffs') {
    if (lg.playIn.length && lg.playIn.some(g => !g.winner)) return lg.playIn.filter(g => !g.winner && g.a && g.b).map(g => ({ home: g.a, away: g.b, label: 'Play-in' }));
    const live = lg.series.filter(s => !s.winner && s.hi && s.lo);
    if (!live.length) return [];
    const round = Math.min(...live.map(s => s.round));
    return live.filter(s => s.round === round && s.lastDay !== lg.day).map(s => {
      const gnum = s.hw + s.lw + 1;
      const hiHome = homeOfGame(s.bestOf, gnum);
      return { home: hiHome ? s.hi : s.lo, away: hiHome ? s.lo : s.hi, label: `Game ${gnum} · ${seriesText(lg, s)}` };
    });
  }
  return [];
}

/** Games already played on the current day. */
export function playedToday(lg: League): GameResult[] {
  if (lg.phase === 'regular') {
    const d = todayIndex(lg);
    return lg.recent.filter(r => r.season === lg.season && !r.po && r.day === d);
  }
  if (lg.phase === 'playoffs') return lg.recent.filter(r => r.season === lg.season && r.po && r.day === lg.day);
  return [];
}

/** Simulate one day. Returns false when nothing was left to play in the current phase. */
export function simDay(lg: League): boolean {
  const rng = rngOf(lg);
  let played = false;
  if (lg.phase === 'regular' || lg.phase === 'playoffs') offDayInjuries(lg, nextCal(lg, todayIndex(lg)), rng);
  if (lg.phase === 'regular') {
    const d = todayIndex(lg);
    lg.day = d;
    const today = lg.schedule.filter(g => !g.done && g.day === d);
    for (const g of today) {
      played = true;
      const res = playGame(lg, g, false, rng);
      applyRegular(lg, g, res);
      g.rid = res.id;
    }
    if (played) regularDayEnd(lg, d, rng);
    else { lg.day++; if (!lg.schedule.some(g => !g.done)) startPlayoffs(lg, rng); }
    played = true;
  } else if (lg.phase === 'playoffs') {
    played = playoffDay(lg, rng);
  }
  saveRng(lg, rng);
  return played;
}

// ---------------------------------------------------------------- standings & playoffs
export function standings(lg: League, conf?: string) {
  return activeTeams(lg)
    .filter(t => !conf || t.conf === conf)
    .sort((a, b) => b.w / Math.max(1, b.w + b.l) - a.w / Math.max(1, a.w + a.l) || (b.pf - b.pa) - (a.pf - a.pa));
}

interface Format { perConf: number; bestOf: number[]; playIn: boolean }
/** Higher seed hosts 2-2-1-1-1 (best of 7), 2-2-1 (5), 1-1-1 (3). */
export function homeOfGame(bestOf: number, g: number) {
  if (bestOf <= 1) return true;
  if (bestOf === 3) return g !== 2;
  if (bestOf === 5) return [1, 2, 5].includes(g);
  if (bestOf === 7) return [1, 2, 5, 7].includes(g);
  return g % 2 === 1;
}

/** Regular-season games per team: the league setting, or the real count for that season. */
export function seasonGames(lg: League, season = lg.season) {
  const rr = lg.settings?.rr;
  if (rr) return rr * (activeTeams(lg).length - 1);
  return lg.settings?.games ?? seasonInfo(season).games;
}

const ROUNDS_FOR: Record<number, number> = { 2: 2, 4: 3, 6: 4, 8: 4 };

/**
 * Playoff format for a season: the era's real format, overridden by any league
 * settings (teams per conference, play-in, length of each round).
 */
export function playoffFormat(season: number, lg?: League): Format {
  const h = histFormat(season);
  const st = lg?.settings;
  let perConf = st?.poTeams ?? h.perConf;
  if (lg) {
    const confSize = Math.min(...['E', 'W'].map(c => activeTeams(lg).filter(t => t.conf === c).length));
    while (perConf > 2 && perConf > confSize) perConf -= 2;
  }
  const R = ROUNDS_FOR[perConf] ?? 4;
  const histFromEnd = [...h.bestOf].reverse();
  const bestOf: number[] = [];
  const named = st?.poRounds ?? [null, null, null, null]; // [first round, second round, conference finals, finals]
  for (let i = 0; i < R; i++) {
    const fromEnd = R - 1 - i;              // 0 = finals
    const setting = named[3 - fromEnd] ?? st?.series ?? null;
    bestOf.push(setting ?? histFromEnd[fromEnd] ?? 7);
  }
  let playIn = st?.playIn ?? h.playIn;
  if (lg && playIn) {
    const confSize = Math.min(...['E', 'W'].map(c => activeTeams(lg).filter(t => t.conf === c).length));
    if (confSize < perConf + 2) playIn = false;
  }
  return { perConf, bestOf, playIn };
}
function histFormat(season: number): Format {
  if (season <= 1983) return { perConf: 6, bestOf: [3, 7, 7, 7], playIn: false };
  if (season <= 2002) return { perConf: 8, bestOf: [5, 7, 7, 7], playIn: false };
  if (season >= 2021) return { perConf: 8, bestOf: [7, 7, 7, 7], playIn: true };
  return { perConf: 8, bestOf: [7, 7, 7, 7], playIn: false };
}

/** Regular-season awards are handed out the moment the regular season ends. */
function regularSeasonAwards(lg: League) {
  const S = lg.season;
  const aw = computeAwards(lg, S, seasonGames(lg, S));
  applyAwardChips(lg, S, aw);
  lg.seasonAwards = aw;
  const n = (pid?: string) => (pid ? tagOf(lg.players[pid], S) : '–');
  lg.news.push({ s: S, t: `Season awards: MVP – ${n(aw.mvp)}, Defensive Player – ${n(aw.dpoy)}, Rookie – ${n(aw.roy)}, Sixth Man – ${n(aw.smoy)}${aw.mip ? `, Most Improved – ${n(aw.mip)}` : ''}.` });
}

function startPlayoffs(lg: League, rng: Rng) {
  regularSeasonAwards(lg);
  lg.phase = 'playoffs';
  lg.series = [];
  lg.playIn = [];
  const f = playoffFormat(lg.season, lg);
  if (f.playIn) {
    const N = f.perConf;
    for (const c of ['E', 'W']) {
      const st = standings(lg, c);
      lg.playIn.push(
        { a: st[N - 2].tid, b: st[N - 1].tid, label: `${c}7`, txt: `${c}${N - 1}–${N}` },
        { a: st[N].tid, b: st[N + 1].tid, label: `${c}9`, txt: `${c}${N + 1}–${N + 2}` },
      );
    }
    lg.news.push({ s: lg.season, t: 'The regular season is over. The play-in tournament begins.' });
    return;
  }
  seedFirstRound(lg);
  lg.news.push({ s: lg.season, t: 'The regular season is over. The playoffs begin.' });
}

const PAIRS: Record<number, number[][]> = { 8: [[1, 8], [4, 5], [3, 6], [2, 7]], 6: [[3, 6], [4, 5]], 4: [[1, 4], [2, 3]], 2: [[1, 2]] };

function seedFirstRound(lg: League, seeded?: Record<string, string[]>) {
  const f = playoffFormat(lg.season, lg);
  for (const c of ['E', 'W']) {
    const seeds = seeded?.[c] ?? standings(lg, c).slice(0, f.perConf).map(t => t.tid);
    for (const [a, b] of PAIRS[f.perConf]) {
      lg.series.push({ round: 1, conf: c, hi: seeds[a - 1], lo: seeds[b - 1], hiSeed: a, loSeed: b, hw: 0, lw: 0, bestOf: f.bestOf[0] });
    }
    if (f.perConf === 6) {
      // seeds 1 and 2 wait in round 2
      lg.series.push({ round: 2, conf: c, hi: seeds[0], lo: '', hiSeed: 1, loSeed: 0, hw: 0, lw: 0, bestOf: f.bestOf[1] });
      lg.series.push({ round: 2, conf: c, hi: seeds[1], lo: '', hiSeed: 2, loSeed: 0, hw: 0, lw: 0, bestOf: f.bestOf[1] });
    }
  }
}

function playoffDay(lg: League, rng: Rng): boolean {
  // play-in
  if (lg.playIn.length && lg.playIn.some(g => !g.winner)) {
    const todo = lg.playIn.filter(g => !g.winner && g.a && g.b);
    for (const g of todo) {
      const res = playGame(lg, { home: g.a, away: g.b }, true, rng);
      g.winner = res.home.pts > res.away.pts ? g.a : g.b;
      g.rid = res.id;
    }
    playInPost(lg);
    lg.day++;
    return true;
  }
  const live = lg.series.filter(s => !s.winner && s.hi && s.lo);
  if (!live.length) return false;
  const round = Math.min(...live.map(s => s.round));
  for (const s of live.filter(x => x.round === round)) {
    if (s.lastDay === lg.day) continue;
    const gnum = s.hw + s.lw + 1;
    const hiHome = homeOfGame(s.bestOf, gnum);
    const home = hiHome ? s.hi : s.lo, away = hiHome ? s.lo : s.hi;
    const res = playGame(lg, { home, away }, true, rng);
    applySeries(lg, s, home, res);
    (s.games ??= []).push(res.id);
    s.lastDay = lg.day;
  }
  lg.day++;
  if (lg.series.length && lg.series.every(s => s.winner) && lg.series.some(s => s.conf === 'F')) finishSeason(lg, rng);
  return true;
}

/** After play-in games: schedule the game for the last seed, then seed the first round. */
function playInPost(lg: League) {
  {
    for (const c of ['E', 'W']) {
      const g7 = lg.playIn.find(g => g.label === `${c}7`)!, g9 = lg.playIn.find(g => g.label === `${c}9`)!;
      if (g7.winner && g9.winner && !lg.playIn.find(g => g.label === `${c}8`)) {
        const loser7 = g7.winner === g7.a ? g7.b : g7.a;
        const N = playoffFormat(lg.season, lg).perConf;
        lg.playIn.push({ a: loser7, b: g9.winner, label: `${c}8`, txt: `${c} seed ${N}` });
      }
    }
    if (lg.playIn.every(g => g.winner) && lg.playIn.length === 6) {
      const seeded: Record<string, string[]> = {};
      for (const c of ['E', 'W']) {
        const st = standings(lg, c).slice(0, playoffFormat(lg.season, lg).perConf - 2).map(t => t.tid);
        seeded[c] = [...st, lg.playIn.find(g => g.label === `${c}7`)!.winner!, lg.playIn.find(g => g.label === `${c}8`)!.winner!];
      }
      seedFirstRound(lg, seeded);
    }
  }
}

function advance(lg: League, s: Series) {
  const f = playoffFormat(lg.season, lg);
  const nextRound = s.round + 1;
  const seedOf = (tid: string, x: Series) => (tid === x.hi ? x.hiSeed : x.loSeed);
  if (s.conf !== 'F') {
    const sameConf = lg.series.filter(x => x.conf === s.conf && x.round === s.round);
    if (f.perConf === 6 && s.round === 1) {
      // winner of 4/5 meets seed 1, winner of 3/6 meets seed 2
      const target = lg.series.find(x => x.conf === s.conf && x.round === 2 && x.hiSeed === (s.hiSeed === 4 ? 1 : 2))!;
      target.lo = s.winner!; target.loSeed = seedOf(s.winner!, s);
      return;
    }
    if (sameConf.every(x => x.winner)) {
      if (sameConf.length === 1) {
        // conference champion → finals
        const other = lg.series.find(x => x.conf !== s.conf && x.conf !== 'F' && x.round === s.round);
        if (other?.winner) {
          const a = lg.teams[s.winner!], b = lg.teams[other.winner];
          const aBetter = a.w / (a.w + a.l) >= b.w / (b.w + b.l);
          lg.series.push({ round: nextRound, conf: 'F', hi: aBetter ? a.tid : b.tid, lo: aBetter ? b.tid : a.tid, hiSeed: 1, loSeed: 1, hw: 0, lw: 0, bestOf: f.bestOf[f.bestOf.length - 1] });
        }
        return;
      }
      // bracket order is preserved in the series list
      for (let i = 0; i < sameConf.length; i += 2) {
        const x = sameConf[i], y = sameConf[i + 1];
        const wx = x.winner!, wy = y.winner!;
        const sx = seedOf(wx, x), sy = seedOf(wy, y);
        lg.series.push({ round: nextRound, conf: s.conf, hi: sx <= sy ? wx : wy, lo: sx <= sy ? wy : wx, hiSeed: Math.min(sx, sy), loSeed: Math.max(sx, sy), hw: 0, lw: 0, bestOf: f.bestOf[nextRound - 1] });
      }
    }
  }
}

// ---------------------------------------------------------------- season end
function gmSc(l: StatLine) {
  return l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;
}

function finishSeason(lg: League, rng: Rng) {
  lg.endCal = calDay(lg, lg.day, true);
  const finals = lg.series.find(s => s.conf === 'F')!;
  const champ = finals.winner!, runner = finals.winner === finals.hi ? finals.lo : finals.hi;
  const S = lg.season;
  const games = seasonGames(lg, S);
  const all = Object.values(lg.players).filter(p => p.tid && p.cur.gp > 0);
  const winPct = (tid: string) => { const t = lg.teams[tid]; return t.w / Math.max(1, t.w + t.l); };
  const fresh = !lg.seasonAwards;
  const aw = lg.seasonAwards ?? computeAwards(lg, S, games);
  if (fresh) applyAwardChips(lg, S, aw);
  aw.fmvp = finalsMvp(lg, champ);
  if (aw.fmvp) lg.players[aw.fmvp].awards.push(`${S} Finals MVP`);
  lg.seasonAwards = undefined;
  const P = (pid?: string) => (pid ? lg.players[pid] : undefined);
  const mvp = P(aw.mvp), roy = P(aw.roy), fmvp = P(aw.fmvp);
  void winPct;
  const qual = all.filter(p => p.cur.gp >= games * 0.7);
  const leader = (f: (l: StatLine) => number) => {
    const best = [...qual].sort((a, b) => f(b.cur) / b.cur.gp - f(a.cur) / a.cur.gp)[0];
    return best ? { pid: best.id, v: Math.round(10 * f(best.cur) / best.cur.gp) / 10 } : undefined;
  };
  const leaders: Record<string, { pid: string; v: number }> = {};
  for (const [k, f] of [['pts', (l: StatLine) => l.pts], ['reb', (l: StatLine) => l.orb + l.drb], ['ast', (l: StatLine) => l.ast], ['stl', (l: StatLine) => l.stl], ['blk', (l: StatLine) => l.blk]] as const) {
    const x = leader(f); if (x) leaders[k] = x;
  }
  for (const pid of lg.teams[champ].roster) lg.players[pid].awards.push(`${S} Champion`);

  const finish = playoffFinish(lg);
  const sum: SeasonSummary = {
    season: S, champion: champ, runnerUp: runner, mvp: mvp?.id, roy: roy?.id, fmvp: fmvp?.id, awards: aw,
    standings: standings(lg).map(t => ({ tid: t.tid, name: t.name, abbr: t.abbr, w: t.w, l: t.l, conf: t.conf })),
    leaders, notes: [], po: finish.by, poRounds: finish.n,
    bracket: { series: lg.series.map(x => ({ round: x.round, conf: x.conf, hi: x.hi!, lo: x.lo!, hiSeed: x.hiSeed, loSeed: x.loSeed, hw: x.hw, lw: x.lw, winner: x.winner, bestOf: x.bestOf })), playIn: (lg.playIn ?? []).map((g: any) => ({ label: g.label, txt: g.txt, a: g.a, b: g.b, winner: g.winner })) },
    teamStats: Object.fromEntries(activeTeams(lg).filter(t => t.st).map(t => [t.tid, { st: t.st!, opp: t.opp!, gp: t.gp ?? 0, w: t.w, l: t.l, stPo: t.stPo, oppPo: t.oppPo, gpPo: t.gpPo }])),
  };
  lg.history.push(sum);
  // archive stats into careers
  for (const p of Object.values(lg.players)) {
    if (p.cur.gp > 0 || p.curPo.gp > 0) {
      const base = { s: S, tid: p.tid ?? '', age: ageIn(p, S), ovr: ovrOf(p.z) };
      if (p.cur.gp > 0) p.career.push({ ...p.cur, ...base, po: false } as CareerSeason);
      if (p.curPo.gp > 0) p.career.push({ ...p.curPo, ...base, po: true } as CareerSeason);
    }
    p.cur = emptyLine(); p.curPo = emptyLine();
  }
  lg.news.push({ s: S, t: `${lg.teams[champ].name} are the ${S} champions! They beat the ${lg.teams[runner].name} in the Finals (${Math.max(finals.hw, finals.lw)}–${Math.min(finals.hw, finals.lw)}).` });
  lg.phase = 'draft';
}

export function realChampion(season: number) { return H.champions[String(season)]; }
export { LAST_SEASON };

/**
 * Change season settings. A season that has not started yet gets a new
 * schedule right away; otherwise the regular-season length applies from next
 * season. A new series length applies to playoff rounds that have not started.
 */
export function applySettings(lg: League, st: Settings): 'now' | 'next' {
  lg.settings = { ...st };
  if (lg.phase === 'regular' && !lg.schedule.some(g => g.done)) {
    const rng = rngOf(lg);
    lg.schedule = makeSchedule(activeTeams(lg), seasonGames(lg), rng, lg.nextGameId);
    lg.nextGameId += lg.schedule.length;
    lg.day = 0;
    saveRng(lg, rng);
    return 'now';
  }
  return 'next';
}
