// @ts-nocheck
// Statistics: league leaders, sortable player stats and team stats, for any season played.
import { useMemo, useState } from 'react';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm } from '../data';
import { ageIn } from '../players';
import { seasonGames } from '../league/league';
import { SortTable, f1, f0, pctf, div } from './sorttable';

const seasonLabel = (s: number) => `${s - 1}–${String(s).slice(2)}`;

/** Player lines for a season (current or archived), regular season or playoffs. */
function playerLines(lg: any, season: number, po: boolean) {
  const out: any[] = [];
  for (const p of Object.values(lg.players) as any[]) {
    let l: any = null, tid = '';
    if (season === lg.season && (lg.phase === 'regular' || lg.phase === 'playoffs' || lg.phase === 'fantasy')) { l = po ? p.curPo : p.cur; tid = p.tid ?? ''; }
    else { const c = p.career.find((x: any) => x.s === season && x.po === po); if (c) { l = c; tid = c.tid; } }
    if (!l || !l.gp) continue;
    out.push({ key: p.id, p, l, tid, age: ageIn(p, season) });
  }
  return out;
}

function teamLines(lg: any, season: number, po: boolean) {
  if (season === lg.season && (lg.phase === 'regular' || lg.phase === 'playoffs')) {
    return Object.values(lg.teams).filter((t: any) => t.active && (po ? t.gpPo : t.gp)).map((t: any) => ({ key: t.tid, tid: t.tid, w: t.w, l: t.l, st: po ? t.stPo : t.st, opp: po ? t.oppPo : t.opp, gp: po ? t.gpPo : t.gp }));
  }
  const h = lg.history.find((x: any) => x.season === season);
  if (!h?.teamStats) return [];
  return Object.entries(h.teamStats).filter(([, v]: any) => (po ? v.gpPo : v.gp)).map(([tid, v]: any) => ({ key: tid, tid, w: v.w, l: v.l, st: po ? v.stPo : v.st, opp: po ? v.oppPo : v.opp, gp: po ? v.gpPo : v.gp }));
}

const poss = (s: any) => s.fga + 0.44 * s.fta - s.orb + s.tov;
const gmsc = (l: any) => l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;
const ts = (l: any) => div(l.pts, 2 * (l.fga + 0.44 * l.fta));

export function StatsView({ lg, openPlayer, openTeam }: any) {
  const seasons = useMemo(() => {
    const s = new Set<number>(lg.history.map((h: any) => h.season));
    if (lg.phase === 'regular' || lg.phase === 'playoffs') s.add(lg.season);
    return [...s].sort((a, b) => b - a);
  }, [lg.history.length, lg.season, lg.phase]);
  const [view, setView] = useState<'leaders' | 'players' | 'teams'>('leaders');
  const [season, setSeason] = useState<number>(seasons[0] ?? lg.season);
  const [po, setPo] = useState(false);
  const [mode, setMode] = useState<'pg' | 'tot'>('pg');
  const [team, setTeam] = useState('');
  const [minGp, setMinGp] = useState(0);
  const S = seasons.includes(season) ? season : seasons[0] ?? lg.season;

  const P = useMemo(() => playerLines(lg, S, po), [lg, S, po, lg.day, lg.phase]);
  const T = useMemo(() => teamLines(lg, S, po), [lg, S, po, lg.day, lg.phase]);
  const maxGp = Math.max(1, ...P.map(r => r.l.gp));
  const qualGp = po ? 1 : Math.max(1, Math.round(maxGp * 0.6));
  const tAbbr = (tid: string) => lg.teams[tid]?.abbr ?? tid;
  const name = (r: any) => <button className="link" onClick={() => openPlayer(r.p.id)}>{r.p.name}</button>;

  const header = (
    <div className="stats-head">
      <div className="seg" role="group" aria-label="Section">
        {[['leaders', 'Leaders'], ['players', 'Players'], ['teams', 'Teams']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k as any)}>{l}</button>)}
      </div>
      <select aria-label="Season" value={S} onChange={e => setSeason(+e.target.value)}>
        {seasons.map(s => <option key={s} value={s}>{seasonLabel(s)}{s === lg.season && (lg.phase === 'regular' || lg.phase === 'playoffs') ? ' (current)' : ''}</option>)}
      </select>
      <div className="seg" role="group" aria-label="Part of season">
        <button className={!po ? 'on' : ''} onClick={() => setPo(false)}>Regular season</button>
        <button className={po ? 'on' : ''} onClick={() => setPo(true)}>Playoffs</button>
      </div>
      {view !== 'leaders' && (
        <div className="seg" role="group" aria-label="Show">
          <button className={mode === 'pg' ? 'on' : ''} onClick={() => setMode('pg')}>Per game</button>
          <button className={mode === 'tot' ? 'on' : ''} onClick={() => setMode('tot')}>Totals</button>
        </div>
      )}
    </div>
  );

  if (view === 'leaders') {
    const q = P.filter(r => r.l.gp >= qualGp);
    const cats: [string, (l: any) => number, (v: number) => string, ((l: any) => boolean)?][] = [
      ['Points', l => l.pts / l.gp, f1], ['Rebounds', l => (l.orb + l.drb) / l.gp, f1], ['Assists', l => l.ast / l.gp, f1],
      ['Steals', l => l.stl / l.gp, f1], ['Blocks', l => l.blk / l.gp, f1], ['Threes made', l => l.tpm / l.gp, f1],
      ['Field goal %', l => l.fgm / l.fga, pctf, l => l.fga >= l.gp * 6], ['Three-point %', l => l.tpm / l.tpa, pctf, l => l.tpa >= l.gp * 1.5],
      ['Free throw %', l => l.ftm / l.fta, pctf, l => l.fta >= l.gp * 2], ['True shooting %', l => ts(l), pctf, l => l.fga >= l.gp * 8],
      ['Minutes', l => l.min / l.gp, f1], ['Game Score', l => gmsc(l) / l.gp, f1],
      ['+/−', l => l.pm / l.gp, v => (v > 0 ? '+' : '') + v.toFixed(1)], ['Turnovers', l => l.tov / l.gp, f1],
    ];
    return (
      <div className="panel">
        {header}
        <p className="note">{po ? 'Playoffs, at least 1 game.' : `At least ${qualGp} games${S === lg.season ? ` (${seasonGames(lg)} in the season)` : ''}. Shooting categories require a minimum number of attempts per game.`}</p>
        {!q.length ? <p className="note">No stats for this period yet.</p> : (
          <div className="leaders">
            {cats.map(([n, f, fmt, ok]) => {
              const top = q.filter(r => !ok || ok(r.l)).map(r => ({ r, v: f(r.l) })).filter(x => !Number.isNaN(x.v)).sort((a, b) => b.v - a.v).slice(0, 10);
              return (
                <div key={n} className="leader-col">
                  <h3>{n}</h3>
                  <ol>{top.map(x => <li key={x.r.key}>{name(x.r)} <span className="dim">{tAbbr(x.r.tid)}</span><span className="v">{fmt(x.v)}</span></li>)}</ol>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (view === 'players') {
    const pg = mode === 'pg';
    const v = (k: string) => (r: any) => (pg ? r.l[k] / r.l.gp : r.l[k]);
    const rows = P.filter(r => (!team || r.tid === team) && r.l.gp >= minGp);
    const cols = [
      { key: 'name', label: 'Player', left: true, asc: true, get: (r: any) => r.p.name, fmt: (_: any, r: any) => name(r) },
      { key: 'tid', label: 'Team', left: true, asc: true, get: (r: any) => tAbbr(r.tid) },
      { key: 'age', label: 'Age', get: (r: any) => r.age },
      { key: 'ovr', label: 'OVR', get: (r: any) => (S === lg.season ? ovrOf(r.p.z) : (r.l.ovr != null ? shownFromRaw(r.l.ovr) : null)) },
      { key: 'gp', label: 'GP', get: (r: any) => r.l.gp },
      { key: 'min', label: 'Min', get: v('min'), fmt: pg ? f1 : f0 },
      { key: 'pts', label: 'Pts', get: v('pts'), fmt: pg ? f1 : f0 },
      { key: 'reb', label: 'Reb', get: (r: any) => (pg ? (r.l.orb + r.l.drb) / r.l.gp : r.l.orb + r.l.drb), fmt: pg ? f1 : f0 },
      { key: 'ast', label: 'Ast', get: v('ast'), fmt: pg ? f1 : f0 },
      { key: 'stl', label: 'Stl', get: v('stl'), fmt: pg ? f1 : f0 },
      { key: 'blk', label: 'Blk', get: v('blk'), fmt: pg ? f1 : f0 },
      { key: 'tov', label: 'TOV', get: v('tov'), fmt: pg ? f1 : f0 },
      { key: 'fgp', label: 'FG%', get: (r: any) => div(r.l.fgm, r.l.fga), fmt: pctf },
      { key: 'tpp', label: '3P%', get: (r: any) => div(r.l.tpm, r.l.tpa), fmt: pctf },
      { key: 'tpm', label: '3PM', title: 'Threes made', get: v('tpm'), fmt: pg ? f1 : f0 },
      { key: 'ftp', label: 'FT%', get: (r: any) => div(r.l.ftm, r.l.fta), fmt: pctf },
      { key: 'ts', label: 'TS%', title: 'True shooting', get: (r: any) => ts(r.l), fmt: pctf },
      { key: 'pm', label: '+/−', get: v('pm'), fmt: (x: any) => (x > 0 ? '+' : '') + (pg ? f1(x) : f0(x)) },
      { key: 'gs', label: 'GmSc', title: 'Game Score per game', get: (r: any) => gmsc(r.l) / (pg ? r.l.gp : 1), fmt: pg ? f1 : f0 },
    ];
    const teams = [...new Set(P.map(r => r.tid))].filter(Boolean).sort((a, b) => tAbbr(a).localeCompare(tAbbr(b)));
    return (
      <div className="panel">
        {header}
        <div className="stats-head">
          <select aria-label="Team" value={team} onChange={e => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.map(t => <option key={t} value={t}>{lg.teams[t]?.name ?? t}</option>)}
          </select>
          <label className="chk" htmlFor="mingp">Min <input id="mingp" type="number" min="0" max="100" value={minGp} onChange={e => setMinGp(+e.target.value || 0)} /> GP</label>
          <span className="dim">{rows.length} players · click a column header to sort</span>
        </div>
        <SortTable cols={cols} rows={rows} initial="pts" limit={300} rowClass={(r: any) => (r.tid === lg.userTid ? 'mine' : '')} />
      </div>
    );
  }

  // teams
  const pg = mode === 'pg';
  const tv = (k: string, opp = false) => (r: any) => (pg ? (opp ? r.opp : r.st)[k] / r.gp : (opp ? r.opp : r.st)[k]);
  const cols = [
    { key: 'name', label: 'Team', left: true, asc: true, get: (r: any) => lg.teams[r.tid]?.name ?? r.tid, fmt: (v: any, r: any) => <button className="link" onClick={() => openTeam(r.tid)}>{v}</button> },
    { key: 'w', label: 'W', get: (r: any) => (po ? null : r.w) },
    { key: 'l', label: 'L', asc: true, get: (r: any) => (po ? null : r.l) },
    { key: 'pts', label: 'Pts', get: tv('pts'), fmt: pg ? f1 : f0 },
    { key: 'opts', label: 'Opp', title: 'Points allowed', asc: true, get: tv('pts', true), fmt: pg ? f1 : f0 },
    { key: 'diff', label: '+/−', get: (r: any) => (r.st.pts - r.opp.pts) / (pg ? r.gp : 1), fmt: (x: any) => (x > 0 ? '+' : '') + (pg ? f1(x) : f0(x)) },
    { key: 'fgp', label: 'FG%', get: (r: any) => div(r.st.fgm, r.st.fga), fmt: pctf },
    { key: 'tpp', label: '3P%', get: (r: any) => div(r.st.tpm, r.st.tpa), fmt: pctf },
    { key: 'tpa', label: '3PA', title: 'Three-point attempts', get: tv('tpa'), fmt: pg ? f1 : f0 },
    { key: 'ftp', label: 'FT%', get: (r: any) => div(r.st.ftm, r.st.fta), fmt: pctf },
    { key: 'reb', label: 'Reb', get: (r: any) => (r.st.orb + r.st.drb) / (pg ? r.gp : 1), fmt: pg ? f1 : f0 },
    { key: 'orb', label: 'ORB', title: 'Offensive rebounds', get: tv('orb'), fmt: pg ? f1 : f0 },
    { key: 'ast', label: 'Ast', get: tv('ast'), fmt: pg ? f1 : f0 },
    { key: 'tov', label: 'TOV', asc: true, get: tv('tov'), fmt: pg ? f1 : f0 },
    { key: 'stl', label: 'Stl', get: tv('stl'), fmt: pg ? f1 : f0 },
    { key: 'blk', label: 'Blk', get: tv('blk'), fmt: pg ? f1 : f0 },
    { key: 'ofg', label: 'Opp FG%', asc: true, title: 'Opponent field goal %', get: (r: any) => div(r.opp.fgm, r.opp.fga), fmt: pctf },
    { key: 'pace', label: 'Pace', title: 'Possessions per 48 min', get: (r: any) => ((poss(r.st) + poss(r.opp)) / 2 / r.gp) * (48 / Math.max(1, r.st.min / r.gp)), fmt: f1 },
    { key: 'ortg', label: 'ORtg', title: 'Points per 100 possessions', get: (r: any) => 100 * r.st.pts / poss(r.st), fmt: f1 },
    { key: 'drtg', label: 'DRtg', title: 'Points allowed per 100 possessions', asc: true, get: (r: any) => 100 * r.opp.pts / poss(r.opp), fmt: f1 },
  ];
  return (
    <div className="panel">
      {header}
      {!T.length ? <p className="note">No team stats for this period yet.</p>
        : <SortTable cols={cols} rows={T} initial={po ? 'pts' : 'w'} rowClass={(r: any) => (r.tid === lg.userTid ? 'mine' : '')} />}
      <p className="note">Offensive and defensive ratings – points per 100 possessions; pace – possessions per 48 minutes.</p>
    </div>
  );
}
