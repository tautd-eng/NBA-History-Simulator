// @ts-nocheck
// League-wide rankings: every player in the league sortable by any rating,
// and power rankings of the teams (roster strength plus how they actually play).
import { TLogo, PFace } from './art';
import { useMemo, useState } from 'react';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm, bpmOf, RATING_LABELS, ratingOf } from '../data';
import { ageIn } from '../players';
import { teamStrength, payroll } from '../ai/value';
import { isFreeAgent } from '../ai/trades';
import { SortTable, f1 } from './sorttable';
import { posNum } from '../engine/game';
import { potOf, moneyOf } from './offseason';

const R = (p: any, i: number) => ratingOf(p.z[RATING_LABELS[i].k], RATING_LABELS[i].inv);
const OFF = [0, 1, 2, 3, 4, 5, 6];   // shooting, creation, ball security, offensive boards
const DEF = [7, 8, 9, 10, 11];       // defensive boards, steals, blocks, defence, discipline
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
/** Attribute average (50 = league-average player) shown on the same 0–100 scale as OVR: average ~70, the best in the 90s. */
const toScale = (raw: number) => {
  const lin = 70 + 1.4 * (raw - 48);
  return Math.max(30, Math.min(99, Math.round(lin <= 88 ? lin : 88 + 0.6 * (lin - 88))));
};
export const offRating = (p: any) => toScale(avg(OFF.map(i => R(p, i))));
export const defRating = (p: any) => toScale(avg(DEF.map(i => R(p, i))));
function Ovr({ v }: any) {
  const tier = v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low';
  return <span className={`ovr ${tier} sm`}>{v}</span>;
}
const POS = [['all', 'All'], ['g', 'Guards'], ['f', 'Forwards'], ['c', 'Centers']] as const;
const posOk = (p: any, pos: string) => pos === 'all' || (pos === 'g' ? posNum(p.pos) <= 2.5 : pos === 'c' ? posNum(p.pos) >= 4.5 : posNum(p.pos) > 2.5 && posNum(p.pos) < 4.5);

export function Rankings({ lg, openPlayer, openTeam }: any) {
  const [view, setView] = useState<'players' | 'power' | 'prog'>('players');
  return (
    <div className="col">
      <div className="seg" role="group" aria-label="Rankings">
        <button className={view === 'players' ? 'on' : ''} onClick={() => setView('players')}>All league players</button>
        <button className={view === 'power' ? 'on' : ''} onClick={() => setView('power')}>Power rankings</button>
        <button className={view === 'prog' ? 'on' : ''} onClick={() => setView('prog')}>Progression & regression</button>
      </div>
      {view === 'players' ? <AllPlayers lg={lg} openPlayer={openPlayer} openTeam={openTeam} />
        : view === 'power' ? <PowerRankings lg={lg} openTeam={openTeam} openPlayer={openPlayer} />
        : <Progression lg={lg} openTeam={openTeam} openPlayer={openPlayer} />}
    </div>
  );
}

// ---------------------------------------------------------------- all players
function AllPlayers({ lg, openPlayer, openTeam }: any) {
  const [pos, setPos] = useState('all');
  const [who, setWho] = useState<'league' | 'fa' | 'all'>('league');
  const [team, setTeam] = useState('all');
  const [q, setQ] = useState('');
  const [age, setAge] = useState('all');
  const S = lg.season;
  const inSeason = lg.phase === 'regular' || lg.phase === 'playoffs';
  const teams = Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const rows = useMemo(() => Object.values(lg.players)
    .filter((p: any) => !p.retired && !p.prospect && !(p as any).stash)
    .filter((p: any) => who === 'all' ? (p.tid || isFreeAgent(lg, p)) : who === 'fa' ? !p.tid && isFreeAgent(lg, p) : !!p.tid)
    .filter((p: any) => team === 'all' || p.tid === team)
    .filter((p: any) => posOk(p, pos))
    .filter((p: any) => { const a = ageIn(p, S); return age === 'all' || (age === 'u23' ? a <= 23 : age === '24' ? a >= 24 && a <= 29 : a >= 30); })
    .filter((p: any) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .map((p: any) => ({ key: p.id, p, l: inSeason ? p.cur : [...p.career].reverse().find((c: any) => !c.po) })),
  [lg, who, team, pos, q, age, S, lg.trades?.length, lg.fa?.log.length, lg.day, lg.phase]);
  const cols = [
    { key: 'rank', label: '#', get: (r: any) => -ovrOf(r.p.z), fmt: () => '' },
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><PFace lg={lg} p={r.p} /><button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button></> },
    { key: 'team', label: 'Team', left: true, get: (r: any) => (r.p.tid ? lg.teams[r.p.tid].abbr : 'FA'), title: 'FA – free agent', fmt: (v: any, r: any) => r.p.tid ? <button className="link" onClick={() => openTeam(r.p.tid)}>{v}</button> : <span className="dim">FA</span> },
    { key: 'pos', label: 'Pos', get: (r: any) => posNum(r.p.pos), fmt: (_: any, r: any) => <span className="dim">{r.p.pos}</span> },
    { key: 'ht', label: 'Ht', title: 'Height, cm', get: (r: any) => Math.round(r.p.ht * 2.54) },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, S) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', title: 'Potential – the level he can reach', get: (r: any) => potOf(r.p, S) },
    { key: 'off', label: 'Off', title: 'Offensive attribute rating (0–100, like OVR)', get: (r: any) => offRating(r.p) },
    { key: 'def', label: 'Def', title: 'Defensive attribute rating (0–100, like OVR)', get: (r: any) => defRating(r.p) },
    ...RATING_LABELS.slice(0, 12).map((L, i) => ({ key: 'r' + i, label: L.short, title: L.name, get: (r: any) => R(r.p, i) })),
    { key: 'pts', label: 'Pts', title: inSeason ? 'This season, per game' : 'Last season, per game', get: (r: any) => (r.l?.gp ? r.l.pts / r.l.gp : null), fmt: f1 },
    { key: 'sal', label: 'Salary', get: (r: any) => (r.p.tid ? r.p.contract.sal : null), fmt: (v: any) => (v == null ? '–' : moneyOf(v, S)) },
  ];
  // rank column: position by OVR within the filtered list
  const order = [...rows].sort((a: any, b: any) => ovrOf(b.p.z) - ovrOf(a.p.z));
  const rankOf = new Map(order.map((r: any, i: number) => [r.key, i + 1]));
  cols[0].fmt = (_: any, r: any) => <span className="dim">{rankOf.get(r.key)}</span>;
  return (
    <div className="panel">
      <div className="team-head">
        <h2>All league players</h2>
        <span className="dim">{rows.length} players</span>
      </div>
      <div className="def-row">
        <div className="seg" role="group" aria-label="Which players">
          {[['league', 'On teams'], ['fa', 'Free agents'], ['all', 'All']].map(([k, l]) => <button key={k} className={who === k ? 'on' : ''} onClick={() => setWho(k as any)}>{l}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Position">{POS.map(([k, l]) => <button key={k} className={pos === k ? 'on' : ''} onClick={() => setPos(k)}>{l}</button>)}</div>
        <select aria-label="Age" value={age} onChange={e => setAge(e.target.value)}>
          <option value="all">All ages</option><option value="u23">23 and under</option><option value="24">24–29</option><option value="30">30+</option>
        </select>
        <select aria-label="Team" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="all">All teams</option>
          {teams.map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
        </select>
        <input className="search" placeholder="Search player" aria-label="Search player" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <SortTable cols={cols} rows={rows} initial="ovr" limit={250} rowClass={(r: any) => (r.p.tid && r.p.tid === lg.userTid ? 'mine' : '')} />
      <p className="note">Click a column header to sort by it (click again to reverse). Up to 250 players shown. Off and Def – offensive and defensive attribute ratings on the 0–100 OVR scale.</p>
    </div>
  );
}

// ---------------------------------------------------------------- power rankings
const W8 = [36, 34, 32, 30, 28, 24, 20, 16];
function teamRows(lg: any) {
  const S = lg.season;
  const inSeason = lg.phase === 'regular' || lg.phase === 'playoffs';
  const act = Object.values(lg.teams).filter((t: any) => t.active);
  const rows = act.map((t: any) => {
    const ps = t.roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
    const top = ps.slice(0, 8);
    const wsum = W8.slice(0, top.length).reduce((a, b) => a + b, 0) || 1;
    const wavg = (f: (p: any) => number) => top.reduce((a: number, p: any, i: number) => a + f(p) * W8[i], 0) / wsum;
    const st = inSeason ? t.st : null, op = inSeason ? t.opp : null, gp = inSeason ? t.gp ?? 0 : 0;
    const poss = (x: any) => x.fga - x.orb + x.tov + 0.44 * x.fta;
    let ortg = null, drtg = null, pace = null;
    if (st && op && gp > 0) {
      const pp = (poss(st) + poss(op)) / 2;
      ortg = (st.pts / pp) * 100; drtg = (op.pts / pp) * 100; pace = (pp / gp) * (48 / ((st.min / gp) / 5 || 48));
    }
    const strength = teamStrength(lg, t.tid);
    const net = ortg != null ? ortg - drtg : null;
    const w = Math.min(0.75, gp / 30);
    const power = net != null ? (1 - w) * strength + w * net : strength;
    return {
      key: t.tid, t, star: ps[0], ovr: wavg(p => ovrOf(p.z)), off: wavg(offRating), def: wavg(defRating),
      ortg, drtg, net, pace, power, strength, gp, w: t.w, l: t.l, pay: payroll(lg, t.tid), age: wavg(p => ageIn(p, S)),
      depth: ps.slice(5, 10).reduce((a: number, p: any) => a + ovrOf(p.z), 0) / Math.max(1, Math.min(5, ps.length - 5)),
    };
  });
  const rank = (k: string, asc = false) => {
    const s = rows.filter((r: any) => r[k] != null).sort((a: any, b: any) => asc ? a[k] - b[k] : b[k] - a[k]);
    s.forEach((r: any, i: number) => (r[k + 'Rk'] = i + 1));
  };
  rank('power'); rank('ovr'); rank('off'); rank('def'); rank('ortg'); rank('drtg', true); rank('net');
  return { rows, inSeason };
}

function PowerRankings({ lg, openTeam, openPlayer }: any) {
  const { rows, inSeason } = useMemo(() => teamRows(lg), [lg, lg.day, lg.phase, lg.trades?.length, lg.fa?.log.length, lg.season]);
  const S = lg.season;
  const hasGames = rows.some((r: any) => r.gp > 0);
  const maxP = Math.max(...rows.map((r: any) => r.power)), minP = Math.min(...rows.map((r: any) => r.power));
  const rk = (r: any, k: string) => r[k + 'Rk'] ? <span className="dim"> ({r[k + 'Rk']})</span> : null;
  const cols = [
    { key: 'power', label: '#', title: 'Power ranking', get: (r: any) => r.power, fmt: (_: any, r: any) => <b>{r.powerRk}</b> },
    { key: 'team', label: 'Team', left: true, get: (r: any) => r.t.name, fmt: (v: any, r: any) => <><span className="pr-bar" style={{ width: `${8 + 50 * (r.power - minP) / Math.max(0.01, maxP - minP)}px` }}></span><TLogo lg={lg} tid={r.t.tid} /><button className="link" onClick={() => openTeam(r.t.tid)}>{v}</button>{r.t.mode === 'allin' ? <span className="chip tiny allin" title="Going all-in: buying missing pieces with future picks">all-in</span> : r.t.mode === 'tank' ? <span className="chip tiny tank" title="Tanking: selling veterans for picks and young players">tanking</span> : r.t.mode === 'rising' ? <span className="chip tiny rising" title="Rising young team: building on its core, not selling youth">rising</span> : r.t.mode === 'capclear' ? <span className="chip tiny tank" title="Near the hard cap: looking to shed salary">clearing salary</span> : null}</> },
    ...(hasGames ? [{ key: 'w', label: 'Record', get: (r: any) => (r.w + r.l ? r.w / (r.w + r.l) : 0), fmt: (_: any, r: any) => `${r.w}–${r.l}` }] : []),
    { key: 'ovr', label: 'OVR', title: 'Team OVR: top 8, weighted by minutes', get: (r: any) => r.ovr, fmt: (v: any, r: any) => <><b>{Math.round(v)}</b>{rk(r, 'ovr')}</> },
    { key: 'off', label: 'Off OVR', title: 'Offensive attribute rating 0–100 (top 8 players)', get: (r: any) => r.off, fmt: (v: any, r: any) => <>{Math.round(v)}{rk(r, 'off')}</> },
    { key: 'def', label: 'Def OVR', title: 'Defensive attribute rating 0–100 (top 8 players)', get: (r: any) => r.def, fmt: (v: any, r: any) => <>{Math.round(v)}{rk(r, 'def')}</> },
    ...(hasGames ? [
      { key: 'ortg', label: 'ORtg', title: 'Points per 100 possessions', get: (r: any) => r.ortg, fmt: (v: any, r: any) => <>{f1(v)}{rk(r, 'ortg')}</> },
      { key: 'drtg', label: 'DRtg', title: 'Points allowed per 100 possessions (lower is better)', asc: true, get: (r: any) => r.drtg, fmt: (v: any, r: any) => <>{f1(v)}{rk(r, 'drtg')}</> },
      { key: 'net', label: 'Net', title: 'Offensive minus defensive rating', get: (r: any) => r.net, fmt: (v: any) => (v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(1)) },
      { key: 'pace', label: 'Pace', title: 'Possessions per 48 min', get: (r: any) => r.pace, fmt: f1 },
    ] : []),
    { key: 'depth', label: 'Depth', title: 'Average OVR of players 6–10', get: (r: any) => r.depth, fmt: (v: any) => Math.round(v) },
    { key: 'age', label: 'Age', title: 'Average age (by minutes)', asc: true, get: (r: any) => r.age, fmt: f1 },
    { key: 'star', label: 'Best player', left: true, get: (r: any) => (r.star ? ovrOf(r.star.z) : 0), fmt: (_: any, r: any) => r.star ? <><button className="link" onClick={() => openPlayer(r.star.id)}>{r.star.name}</button> <span className="dim">{ovrOf(r.star.z)}</span></> : '–' },
    { key: 'pay', label: 'Payroll', get: (r: any) => r.pay, fmt: (v: any) => `${Math.round(v * 100)}%` },
  ];
  return (
    <div className="panel">
      <div className="team-head">
        <h2>Power rankings · {S - 1}–{String(S).slice(2)}</h2>
      </div>
      <p className="note">
        {hasGames
          ? 'The ranking blends roster strength with how the team actually plays (point margin per 100 possessions). The more games played, the more results count.'
          : 'The season hasn\'t started – the ranking is based on roster strength only.'} Small numbers show the league rank in that stat. Click a column to sort.
      </p>
      <SortTable cols={cols} rows={rows} initial="power" rowClass={(r: any) => (r.t.tid === lg.userTid ? 'mine' : '')} />
    </div>
  );
}

// ---------------------------------------------------------------- progression
const sgn = (v: number) => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');
const AGE_GROUPS: [string, (a: number) => boolean][] = [['23 and under', a => a <= 23], ['24–27', a => a >= 24 && a <= 27], ['28–31', a => a >= 28 && a <= 31], ['32+', a => a >= 32]];

/** Rating changes over the summer before season S: snapshot S against snapshot S-1. */
function changes(lg: any, S: number) {
  const out: any[] = [];
  for (const p of Object.values(lg.players) as any[]) {
    if (p.prospect) continue;
    const now = p.ovrHist?.find((h: any) => h[0] === S), prev = p.ovrHist?.find((h: any) => h[0] === S - 1);
    if (!now || !prev) continue;
    const rn = p.rh?.find((r: any) => r[0] === S), rp = p.rh?.find((r: any) => r[0] === S - 1);
    const attr = rn && rp ? RATING_LABELS.map((L, i) => ({ i, L, d: rn[i + 1] - rp[i + 1] })).filter(x => !x.L.tendency && x.d !== 0) : [];
    attr.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const l = p.career.find((c: any) => c.s === S - 1 && !c.po);
    const gms = l && l.min > 0 ? ((l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov) / l.min) * 36 : null;
    // team: where he plays now (current season) or where he ended up
    const tid = S === lg.season ? p.tid : (p.career.find((c: any) => c.s === S && !c.po)?.tid ?? null);
    out.push({ key: p.id, p, tid, age: ageIn(p, S), before: shownFromRaw(prev[1]), after: shownFromRaw(now[1]), d: shownFromRaw(now[1]) - shownFromRaw(prev[1]), attr, l, gms, retired: !!p.retired && p.retired < S });
  }
  return out;
}

function Progression({ lg, openPlayer, openTeam }: any) {
  const last = lg.season; // changes for a season happen when free agency opens before it
  const first = Math.min(...Object.values(lg.players).flatMap((p: any) => (p.ovrHist ?? []).map((h: any) => h[0]))) + 1;
  const seasons: number[] = [];
  for (let y = last; y >= first; y--) seasons.push(y);
  const [S, setS] = useState(seasons[0]);
  const [team, setTeam] = useState('all');
  const [minOvr, setMinOvr] = useState(70);
  const all = useMemo(() => changes(lg, S), [lg, S, lg.phase, lg.season]);
  const teams = Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const rows = all.filter(r => (team === 'all' || r.tid === team) && Math.max(r.before, r.after) >= minOvr && !r.retired);
  const up = [...rows].sort((a, b) => b.d - a.d).slice(0, 10).filter(r => r.d > 0);
  const down = [...rows].sort((a, b) => a.d - b.d).slice(0, 10).filter(r => r.d < 0);
  const groups = AGE_GROUPS.map(([label, f]) => { const g = all.filter(r => !r.retired && f(r.age)); return { label, n: g.length, avg: g.length ? g.reduce((a, r) => a + r.d, 0) / g.length : 0, up: g.filter(r => r.d >= 3).length, down: g.filter(r => r.d <= -3).length }; });
  const attrTxt = (r: any, n = 3) => r.attr.slice(0, n).map((x: any) => `${x.L.short} ${sgn(x.d)}`).join(', ');
  const nm = (r: any) => <><button className="link" onClick={() => openPlayer(r.p.id)}>{r.p.name}</button> <span className="dim">{r.tid ? lg.teams[r.tid]?.abbr : 'FA'} · age {r.age}</span></>;
  const dCls = (d: number) => (d > 0 ? 'pos' : d < 0 ? 'neg' : 'dim');
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><PFace lg={lg} p={r.p} /><button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button></> },
    { key: 'team', label: 'Team', left: true, get: (r: any) => (r.tid ? lg.teams[r.tid]?.abbr ?? r.tid : 'FA'), fmt: (v: any, r: any) => r.tid ? <button className="link" onClick={() => openTeam(r.tid)}>{v}</button> : <span className="dim">FA</span> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => r.age },
    { key: 'before', label: 'Before', title: `OVR in ${S - 1}`, get: (r: any) => r.before },
    { key: 'after', label: 'Now', title: `OVR in ${S}`, get: (r: any) => r.after, fmt: (v: any) => <Ovr v={v} /> },
    { key: 'd', label: 'Change', get: (r: any) => r.d, fmt: (v: any) => <b className={dCls(v)}>{sgn(v)}</b> },
    { key: 'pot', label: 'Pot.', title: 'Current potential estimate', get: (r: any) => potOf(r.p, S) },
    { key: 'attr', label: 'Biggest attribute changes', left: true, get: (r: any) => (r.attr[0] ? Math.abs(r.attr[0].d) : 0), fmt: (_: any, r: any) => <span className="attr-d">{r.attr.slice(0, 4).map((x: any) => <span key={x.i} className={dCls(x.d)} title={x.L.name}>{x.L.short} {sgn(x.d)}</span>)}</span> },
    { key: 'gp', label: 'GP', title: 'Games last season', get: (r: any) => r.l?.gp ?? null, fmt: (v: any) => v ?? '–' },
    { key: 'min', label: 'Min', title: 'Minutes per game last season', get: (r: any) => (r.l?.gp ? r.l.min / r.l.gp : null), fmt: f1 },
    { key: 'pts', label: 'Pts', title: 'Points per game last season', get: (r: any) => (r.l?.gp ? r.l.pts / r.l.gp : null), fmt: f1 },
    { key: 'gms', label: 'GmSc/36', title: 'Last season\'s Game Score per 36 min – a good season pushes progression up', get: (r: any) => r.gms, fmt: f1 },
  ];
  if (!seasons.length) return <div className="panel"><h2>Progression & regression</h2><p className="note">Changes appear after the first offseason – players improve or decline every summer, when free agency opens.</p></div>;
  return (
    <div className="col">
      <div className="panel">
        <div className="team-head prog-head">
          <h2>Progression & regression</h2>
          <select aria-label="Season" value={S} onChange={e => setS(+e.target.value)}>
            {seasons.map(y => <option key={y} value={y}>Summer before {y - 1}–{String(y).slice(2)}</option>)}
          </select>
          <select aria-label="Team" value={team} onChange={e => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {lg.userTid && <option value={lg.userTid}>My team</option>}
            {teams.map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
          </select>
          <select aria-label="Minimum OVR" value={minOvr} onChange={e => setMinOvr(+e.target.value)}>
            {[0, 70, 75, 80, 85].map(v => <option key={v} value={v}>{v ? `OVR ${v}+` : 'All players'}</option>)}
          </select>
        </div>
        <p className="note">Players change once a year – in the summer, when free agency opens. The change depends on age, hidden talent, luck and how the player played last season: a great season pushes him up, a poor one pulls him down. Young players get leniency: a player 25 or younger who played roughly at his level loses at most 1 (22 and under), 2 (23–24) or 3 (25) OVR points over the summer, and a real flop costs him half as much as a veteran.</p>
        <div className="prog-grid">
          <div>
            <h3>Biggest jumps</h3>
            <ol className="prog-list">{up.map(r => <li key={r.key}><span>{nm(r)}<br /><span className="dim small-t">{r.before} → {r.after} · {attrTxt(r)}</span></span><b className="pos">{sgn(r.d)}</b></li>)}</ol>
            {!up.length && <p className="note">None.</p>}
          </div>
          <div>
            <h3>Biggest drops</h3>
            <ol className="prog-list">{down.map(r => <li key={r.key}><span>{nm(r)}<br /><span className="dim small-t">{r.before} → {r.after} · {attrTxt(r)}</span></span><b className="neg">{sgn(r.d)}</b></li>)}</ol>
            {!down.length && <p className="note">None.</p>}
          </div>
          <div>
            <h3>By age (whole league)</h3>
            <table className="tbl compact">
              <thead><tr><th className="l">Age</th><th>Players</th><th>Avg. change</th><th title="Improved by 3+ OVR">↑3+</th><th title="Declined by 3+ OVR">↓3+</th></tr></thead>
              <tbody>{groups.map(g => <tr key={g.label}><td className="l">{g.label}</td><td>{g.n}</td><td className={dCls(Math.round(g.avg * 10))}>{g.avg > 0 ? '+' : ''}{g.avg.toFixed(1)}</td><td>{g.up}</td><td>{g.down}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="panel">
        <SortTable cols={cols} rows={rows} initial="d" limit={300} rowClass={(r: any) => (r.tid && r.tid === lg.userTid ? 'mine' : '')} />
        <p className="note">{rows.length} players. Before / Now – OVR before and after the summer. Stats are from last season. Sort by any column (e.g. click “Change” again to put the biggest drops on top).</p>
      </div>
    </div>
  );
}
