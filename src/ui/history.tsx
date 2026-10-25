// @ts-nocheck
// Franchise history (season by season), franchise and league record books.
import { TL } from './nav';
import { useMemo, useState } from 'react';
import { GAME_CATS, TEAM_CATS, finishLabel, ensureRecords, gmsc } from '../league/records';
import { TLogo } from './art';
import { SortTable } from './sorttable';
import { shownFromRaw } from '../data';

const sl = (s: number) => `${s - 1}–${String(s).slice(2)}`;
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const reb = (l: any) => l.orb + l.drb;

/** Per-game and total categories for seasons and careers. */
const AVG: [string, string, (l: any) => number][] = [
  ['ppg', 'Points per game', l => l.pts / l.gp], ['rpg', 'Rebounds per game', l => reb(l) / l.gp], ['apg', 'Assists per game', l => l.ast / l.gp],
  ['spg', 'Steals per game', l => l.stl / l.gp], ['bpg', 'Blocks per game', l => l.blk / l.gp], ['gsg', 'Game Score per game', l => gmsc(l) / l.gp],
];
const TOT: [string, string, (l: any) => number][] = [
  ['pts', 'Points', l => l.pts], ['reb', 'Rebounds', l => reb(l)], ['ast', 'Assists', l => l.ast], ['stl', 'Steals', l => l.stl],
  ['blk', 'Blocks', l => l.blk], ['tpm', 'Threes made', l => l.tpm], ['gp', 'Games played', l => l.gp],
];

/** Regular-season lines (finished seasons plus the one in progress). */
function seasonLines(lg: any) {
  const out: { p: any; l: any; s: number; tid: string }[] = [];
  const live = lg.phase === 'regular' || lg.phase === 'playoffs';
  for (const p of Object.values(lg.players) as any[]) {
    for (const c of p.career) if (!c.po && c.tid && c.gp) out.push({ p, l: c, s: c.s, tid: c.tid });
    if (live && p.tid && p.cur.gp) out.push({ p, l: p.cur, s: lg.season, tid: p.tid });
  }
  return out;
}
function teamGames(lg: any, tid: string, s: number) {
  const h = lg.history.find((x: any) => x.season === s);
  const t = h?.standings.find((x: any) => x.tid === tid);
  if (t) return t.w + t.l;
  const cur = lg.teams[tid];
  return s === lg.season ? Math.max(1, cur.w + cur.l) : 82;
}
const qualifies = (lg: any, x: any) => x.l.gp >= Math.max(10, 0.55 * teamGames(lg, x.tid, x.s));
function sumBy(lines: any[]) {
  const m = new Map<string, any>();
  for (const x of lines) {
    const a = m.get(x.p.id) ?? { p: x.p, l: { gp: 0, pts: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tpm: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, tov: 0, pf: 0 }, first: x.s, last: x.s, tids: new Set() };
    for (const k of Object.keys(a.l)) a.l[k] += x.l[k] ?? 0;
    a.first = Math.min(a.first, x.s); a.last = Math.max(a.last, x.s); a.tids.add(x.tid);
    m.set(x.p.id, a);
  }
  return [...m.values()];
}
const top = <T,>(xs: T[], f: (x: T) => number, n: number) => xs.map(x => ({ x, v: f(x) })).filter(o => isFinite(o.v) && o.v > 0).sort((a, b) => b.v - a.v).slice(0, n);

function Card({ title, children }: any) {
  return <div className="rec-card"><h3>{title}</h3>{children}</div>;
}
function PName({ lg, pid, name, openPlayer }: any) {
  return <button className="link" onClick={() => openPlayer(pid)}>{lg.players[pid]?.name ?? name ?? pid}</button>;
}

/** Single-game list. */
function GameList({ lg, list, openPlayer, team }: any) {
  if (!list?.length) return <p className="note">None yet.</p>;
  return <ol className="rec-list">{list.map((r: any, i: number) => (
    <li key={i}><b className="rv">{r.v}</b>
      <span>{r.pid ? <PName lg={lg} pid={r.pid} name={r.name} openPlayer={openPlayer} /> : <TL tid={r.tid} abbr />}
        <span className="dim"> {r.pid && !team ? <><TL tid={r.tid} abbr />{' '}</> : ''}vs <TL tid={r.opp} abbr /> · {sl(r.s)}{r.po ? ' PO' : ''}{r.score ? ` · ${r.score}` : ''}</span></span></li>
  ))}</ol>;
}
function LineList({ lg, rows, openPlayer, fmt, sub }: any) {
  if (!rows.length) return <p className="note">None yet.</p>;
  return <ol className="rec-list">{rows.map((o: any, i: number) => (
    <li key={i}><b className="rv">{fmt(o.v)}</b><span><PName lg={lg} pid={o.x.p.id} openPlayer={openPlayer} /> <span className="dim">{sub(o.x)}</span></span></li>
  ))}</ol>;
}

// ---------------------------------------------------------------- team
export function TeamHistory({ lg, tid, openPlayer }: any) {
  const lines = useMemo(() => seasonLines(lg).filter(x => x.tid === tid), [lg, tid, lg.history.length, lg.day]);
  const seasons = lg.history.map((h: any) => ({ h, st: h.standings.find((x: any) => x.tid === tid), rank: h.standings.filter((x: any) => x.conf === h.standings.find((y: any) => y.tid === tid)?.conf).findIndex((x: any) => x.tid === tid) + 1 })).filter((x: any) => x.st).reverse();
  const best = (s: number) => {
    const xs = lines.filter(x => x.s === s && x.l.gp >= 10);
    return xs.sort((a, b) => gmsc(b.l) / b.l.gp - gmsc(a.l) / a.l.gp)[0];
  };
  const W = seasons.reduce((a, x) => a + x.st.w, 0), L = seasons.reduce((a, x) => a + x.st.l, 0);
  const titles = seasons.filter((x: any) => x.h.champion === tid).length;
  const finals = seasons.filter((x: any) => x.h.champion === tid || x.h.runnerUp === tid).length;
  const poApps = seasons.filter((x: any) => (x.h.po?.[tid] ?? 0) > 0).length;
  if (!seasons.length) return <p className="note">The franchise history starts filling in after the first season.</p>;
  return (
    <>
      <div className="kv">
        <div><span className="dim">All-time record</span> {W}–{L} ({(W / Math.max(1, W + L)).toFixed(3).replace(/^0/, '')})</div>
        <div><span className="dim">Titles</span> {titles ? `🏆 ${titles}` : 0} · Finals {finals} · Playoff seasons {poApps}/{seasons.length}</div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Season</th><th className="l">Team</th><th>W</th><th>L</th><th>%</th><th>Conf.</th><th className="l">Playoffs</th><th className="l">Best player</th></tr></thead>
        <tbody>{seasons.map(({ h, st, rank }: any) => {
          const b = best(h.season);
          return <tr key={h.season} className={h.champion === tid ? 'mine' : ''}>
            <td>{sl(h.season)}</td><td className="l">{st.name}</td><td>{st.w}</td><td>{st.l}</td><td>{(st.w / Math.max(1, st.w + st.l)).toFixed(3).replace(/^0/, '')}</td>
            <td>{rank || '–'}</td>
            <td className="l">{h.po ? finishLabel(h.po[tid], h.poRounds) : h.champion === tid ? '🏆 Champion' : h.runnerUp === tid ? 'Finals' : '–'}</td>
            <td className="l">{b ? <><PName lg={lg} pid={b.p.id} openPlayer={openPlayer} /> <span className="dim">{f1(b.l.pts / b.l.gp)} ppg</span></> : '–'}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </>
  );
}

export function TeamRecords({ lg, tid, openPlayer }: any) {
  ensureRecords(lg);
  const lines = useMemo(() => seasonLines(lg).filter(x => x.tid === tid), [lg, tid, lg.history.length, lg.day]);
  const careers = useMemo(() => sumBy(lines), [lines]);
  const R = lg.records?.t?.[tid] ?? {};
  const q = lines.filter(x => qualifies(lg, x));
  return (
    <>
      <h3>Single game</h3>
      <div className="rec-grid">
        {GAME_CATS.map(([k, n]) => <Card key={k} title={n}><GameList lg={lg} list={R[k]} openPlayer={openPlayer} team /></Card>)}
        {TEAM_CATS.map(([k, n]) => <Card key={k} title={n}><GameList lg={lg} list={R[k]} openPlayer={openPlayer} team /></Card>)}
      </div>
      <h3>Franchise leaders (career with the team)</h3>
      <div className="rec-grid">
        {TOT.map(([k, n, f]) => <Card key={k} title={n}><LineList lg={lg} rows={top(careers, c => f(c.l), 10)} openPlayer={openPlayer} fmt={(v: number) => Math.round(v)} sub={(c: any) => `${c.first === c.last ? sl(c.first) : `${c.first - 1}–${String(c.last).slice(2)}`}`} /></Card>)}
      </div>
      <h3>Best seasons with the team</h3>
      <div className="rec-grid">
        {AVG.map(([k, n, f]) => <Card key={k} title={n}><LineList lg={lg} rows={top(q, x => f(x.l), 5)} openPlayer={openPlayer} fmt={f1} sub={(x: any) => sl(x.s)} /></Card>)}
      </div>
      <p className="note">Single-game records are kept from the moment a game is played in this league (regular season and playoffs, PO). Season and career records count the regular season; per-game records need at least 55% of the team's games.</p>
    </>
  );
}

// ---------------------------------------------------------------- league
export function LeagueRecords({ lg, openPlayer }: any) {
  ensureRecords(lg);
  const [view, setView] = useState<'game' | 'season' | 'career' | 'team' | 'fr'>('game');
  const [ft, setFt] = useState<string>(lg.userTid ?? Object.keys(lg.teams).filter(t => lg.teams[t].active).sort()[0]);
  const lines = useMemo(() => seasonLines(lg), [lg, lg.history.length, lg.day]);
  const careers = useMemo(() => sumBy(lines), [lines]);
  const q = useMemo(() => lines.filter(x => qualifies(lg, x)), [lines]);
  const G = lg.records?.g ?? {};
  // team seasons
  const teamSeasons = lg.history.flatMap((h: any) => h.standings.map((t: any) => ({ ...t, s: h.season, champ: h.champion === t.tid })));
  const pct = (t: any) => t.w / Math.max(1, t.w + t.l);
  const titles: Record<string, number> = {};
  for (const h of lg.history) if (h.champion) titles[h.champion] = (titles[h.champion] ?? 0) + 1;
  const tsub = (x: any) => <>{x.tids.size === 1 ? <TL tid={[...x.tids][0]} abbr /> : `${x.tids.size} teams`} · {x.first === x.last ? sl(x.first) : `${x.first - 1}–${String(x.last).slice(2)}`}</>;
  return (
    <div className="panel">
      <div className="team-head">
        <h2>League records</h2>
        <div className="seg" role="group" aria-label="Record type">
          {[['game', 'Single game'], ['season', 'Single season'], ['career', 'Career'], ['team', 'Teams'], ['fr', 'By franchise']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k as any)}>{l}</button>)}
        </div>
      </div>
      {view === 'game' && <div className="rec-grid">
        {GAME_CATS.map(([k, n]) => <Card key={k} title={n}><GameList lg={lg} list={G[k]} openPlayer={openPlayer} /></Card>)}
        {TEAM_CATS.map(([k, n]) => <Card key={k} title={n}><GameList lg={lg} list={G[k]} openPlayer={openPlayer} /></Card>)}
      </div>}
      {view === 'season' && <div className="rec-grid">
        {AVG.map(([k, n, f]) => <Card key={k} title={n}><LineList lg={lg} rows={top(q, x => f(x.l), 10)} openPlayer={openPlayer} fmt={f1} sub={(x: any) => <><TL tid={x.tid} abbr /> · {sl(x.s)}</>} /></Card>)}
        {TOT.slice(0, 3).map(([k, n, f]) => <Card key={k} title={`${n} (season total)`}><LineList lg={lg} rows={top(lines, x => f(x.l), 10)} openPlayer={openPlayer} fmt={(v: number) => Math.round(v)} sub={(x: any) => <><TL tid={x.tid} abbr /> · {sl(x.s)}</>} /></Card>)}
      </div>}
      {view === 'career' && <div className="rec-grid">
        {TOT.map(([k, n, f]) => <Card key={k} title={n}><LineList lg={lg} rows={top(careers, c => f(c.l), 10)} openPlayer={openPlayer} fmt={(v: number) => Math.round(v)} sub={tsub} /></Card>)}
        <Card title="Points per game (300+ games)"><LineList lg={lg} rows={top(careers.filter(c => c.l.gp >= 300), c => c.l.pts / c.l.gp, 10)} openPlayer={openPlayer} fmt={f1} sub={tsub} /></Card>
      </div>}
      {view === 'team' && <div className="rec-grid">
        <Card title="Best records"><ol className="rec-list">{[...teamSeasons].sort((a, b) => pct(b) - pct(a)).slice(0, 10).map((t: any, i: number) => <li key={i}><b className="rv">{t.w}–{t.l}</b><span><TLogo lg={lg} tid={t.tid} size={16} /><TL tid={t.tid}>{t.name}</TL> <span className="dim">{sl(t.s)}{t.champ ? ' · 🏆' : ''}</span></span></li>)}</ol></Card>
        <Card title="Worst records"><ol className="rec-list">{[...teamSeasons].sort((a, b) => pct(a) - pct(b)).slice(0, 10).map((t: any, i: number) => <li key={i}><b className="rv">{t.w}–{t.l}</b><span><TLogo lg={lg} tid={t.tid} size={16} /><TL tid={t.tid}>{t.name}</TL> <span className="dim">{sl(t.s)}</span></span></li>)}</ol></Card>
        <Card title="Most titles"><ol className="rec-list">{Object.entries(titles).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tid, n]) => <li key={tid}><b className="rv">{n}</b><span><TLogo lg={lg} tid={tid} size={16} /><TL tid={tid} /></span></li>)}</ol>{!Object.keys(titles).length && <p className="note">None yet.</p>}</Card>
      </div>}
      {view === 'fr' && <>
        <div className="def-row">
          <TLogo lg={lg} tid={ft} size={28} />
          <select aria-label="Franchise" value={ft} onChange={e => setFt(e.target.value)}>
            {Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
          </select>
        </div>
        <TeamRecords lg={lg} tid={ft} openPlayer={openPlayer} />
      </>}
      {view !== 'fr' && <p className="note">Single-game records are kept from the moment a game is played in this league (PO – playoffs). Season and career records count the regular season, including the season in progress; per-game season records need at least 55% of the team's games.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- retirements
/** Players who retired, by offseason: who they were and where they played. */
export function Retirements({ lg, openPlayer }: any) {
  const years = useMemo(() => [...new Set((Object.values(lg.players) as any[]).filter(p => p.retired && p.career.length).map(p => p.retired))].sort((a: any, b: any) => b - a), [lg, lg.history.length]);
  const [y, setY] = useState<number | 'all'>(years[0] ?? 'all');
  const [min, setMin] = useState(0);
  if (!years.length) return (
    <div className="panel"><h2>Retirements</h2><p className="note">Players retire in the offseason, right after the draft, when free agency opens. The first retirements will show up here after the first season.</p></div>
  );
  const rows = (Object.values(lg.players) as any[]).filter(p => p.retired && p.career.length && (y === 'all' || p.retired === y)).map(p => {
    const reg = p.career.filter((c: any) => !c.po);
    const sum = (k: string) => reg.reduce((a: number, c: any) => a + (c[k] ?? 0), 0);
    const gp = sum('gp');
    const stints: string[] = [];
    for (const c of reg) { if (c.tid && stints[stints.length - 1] !== c.tid) stints.push(c.tid); }
    const peak = p.ovrHist?.length ? Math.max(...p.ovrHist.map((o: any) => o[1])) : null;
    const aw = p.awards.filter((a: string) => !/(Champion|čempionas)/.test(a));
    return {
      key: p.id, p, gp, seasons: new Set(reg.map((c: any) => c.s)).size, stints,
      first: reg.length ? Math.min(...reg.map((c: any) => c.s)) : p.retired, age: Math.floor(p.retired + 0.5 - p.born),
      ppg: gp ? sum('pts') / gp : null, rpg: gp ? (sum('orb') + sum('drb')) / gp : null, apg: gp ? sum('ast') / gp : null,
      pts: sum('pts'), peak: peak == null ? null : shownFromRaw(peak),
      mvp: aw.filter((a: string) => / MVP$/.test(a) && !/Finals/.test(a)).length, allLg: aw.filter((a: string) => /All-League/.test(a)).length,
      titles: p.awards.filter((a: string) => /(Champion|čempionas)/.test(a)).length,
    };
  }).filter(r => (r.peak ?? 0) >= min);
  const cols = [
    { key: 'name', label: 'Player', left: true, asc: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button> },
    ...(y === 'all' ? [{ key: 'ret', label: 'Retired', get: (r: any) => r.p.retired }] : []),
    { key: 'age', label: 'Age', get: (r: any) => r.age },
    { key: 'yrs', label: 'Years', get: (r: any) => r.first, fmt: (_: any, r: any) => `${r.first - 1}–${String(r.p.retired).slice(2)}` },
    { key: 'teams', label: 'Teams', left: true, get: (r: any) => r.stints.length, fmt: (_: any, r: any) => <span className="dim">{r.stints.length ? r.stints.map((t: string, i: number) => <span key={i}>{i ? ' → ' : ''}<TL tid={t} abbr /></span>) : '–'}</span> },
    { key: 'peak', label: 'Peak OVR', get: (r: any) => r.peak ?? 0, fmt: (v: any) => v || '–' },
    { key: 'gp', label: 'GP', get: (r: any) => r.gp },
    { key: 'pts', label: 'Pts', title: 'Career points', get: (r: any) => r.pts },
    { key: 'ppg', label: 'PPG', get: (r: any) => r.ppg, fmt: (v: any) => (v == null ? '–' : f1(v)) },
    { key: 'rpg', label: 'RPG', get: (r: any) => r.rpg, fmt: (v: any) => (v == null ? '–' : f1(v)) },
    { key: 'apg', label: 'APG', get: (r: any) => r.apg, fmt: (v: any) => (v == null ? '–' : f1(v)) },
    { key: 'titles', label: 'Titles', get: (r: any) => r.titles, fmt: (v: any) => (v ? `🏆 ${v}` : '') },
    { key: 'hon', label: 'Honors', title: 'MVPs and All-League selections', get: (r: any) => r.mvp * 10 + r.allLg, fmt: (_: any, r: any) => <span className="dim">{[r.mvp ? `${r.mvp}× MVP` : '', r.allLg ? `${r.allLg}× All-League` : ''].filter(Boolean).join(', ')}</span> },
  ];
  return (
    <div className="panel">
      <div className="team-head">
        <h2>Retirements</h2>
        <select className="small-sel" aria-label="Offseason" value={String(y)} onChange={e => setY(e.target.value === 'all' ? 'all' : +e.target.value)}>
          {years.map((x: any) => <option key={x} value={x}>Summer {x}</option>)}
          <option value="all">All years</option>
        </select>
        <select className="small-sel" aria-label="Minimum peak OVR" value={min} onChange={e => setMin(+e.target.value)}>
          {[0, 70, 75, 80, 85].map(v => <option key={v} value={v}>{v ? `Peak OVR ${v}+` : 'All players'}</option>)}
        </select>
        <span className="dim">{rows.length} players</span>
      </div>
      <SortTable cols={cols} rows={rows} initial="peak" limit={300} />
      <p className="note">Players retire in the offseason, right after the draft. Age, a fading game and – with the destiny slider up – the end of their real careers decide it; players left unsigned for a year may also call it a career. Career numbers are this league's regular seasons. Click a name for the full career: draft, teams, trades, awards.</p>
    </div>
  );
}
