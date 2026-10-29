// @ts-nocheck
// League history explorers: standings of past seasons, team statistics across seasons, free-agency moves.
import { useMemo, useState } from 'react';
import { TL } from './nav';
import { TLogo } from './art';
import { SortTable } from './sorttable';
import { seasonInfo, shownOvr } from '../data';
import { ageIn } from '../players';
import { finishLabel } from '../league/records';

const sl = (s: number) => `${s - 1}–${String(s).slice(2)}`;
const f1 = (v: number | null) => (v == null || !isFinite(v) ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const pctf = (v: number | null) => (v == null || !isFinite(v) ? '–' : v.toFixed(3).replace(/^0/, ''));
const div = (a: number, b: number) => (b ? a / b : null);
const abbrOf = (lg: any, tid: string) => lg.teams[tid]?.abbr ?? tid;
const teamsSorted = (lg: any) => Object.values(lg.teams).filter((t: any) => t.active || lg.history.some((h: any) => h.standings.some((x: any) => x.tid === t.tid))).sort((a: any, b: any) => a.name.localeCompare(b.name));

/** How far a team went: from the season summary's playoff map. */
function finish(h: any, tid: string) {
  const r = h.po?.[tid];
  return r == null ? '' : finishLabel(r, h.poRounds ?? 4);
}

// ---------------------------------------------------------------- standings history
export function StandingsHistory({ lg, openTeam }: any) {
  const seasons = lg.history.map((h: any) => h.season).reverse();
  const [y, setY] = useState<number>(seasons[0]);
  const [tid, setTid] = useState('');
  const h = lg.history.find((x: any) => x.season === y);
  if (!seasons.length) return <div className="panel"><h2>Standings history</h2><p className="note">Final standings appear here after the first season.</p></div>;
  if (tid) {
    // one team, every season
    const rows = lg.history.map((h: any) => {
      const t = h.standings.find((x: any) => x.tid === tid);
      if (!t) return null;
      const conf = h.standings.filter((x: any) => x.conf === t.conf);
      return { key: h.season, s: h.season, t, seed: conf.indexOf(t) + 1, rank: h.standings.indexOf(t) + 1, n: h.standings.length, fin: finish(h, tid), h };
    }).filter(Boolean);
    const cols = [
      { key: 's', label: 'Season', get: (r: any) => r.s, fmt: (s: any) => sl(s) },
      { key: 'w', label: 'W', get: (r: any) => r.t.w },
      { key: 'l', label: 'L', asc: true, get: (r: any) => r.t.l },
      { key: 'p', label: '%', get: (r: any) => div(r.t.w, r.t.w + r.t.l), fmt: pctf },
      { key: 'seed', label: 'Conf.', title: 'Place in the conference', asc: true, get: (r: any) => r.seed },
      { key: 'rank', label: 'League', title: 'Place in the league', asc: true, get: (r: any) => r.rank, fmt: (v: any, r: any) => <>{v}<span className="dim">/{r.n}</span></> },
      { key: 'fin', label: 'Playoffs', left: true, get: (r: any) => r.h.po?.[tid] ?? -2, fmt: (_: any, r: any) => r.fin || <span className="dim">–</span> },
    ];
    const tot = rows.reduce((a: any, r: any) => ({ w: a.w + r.t.w, l: a.l + r.t.l }), { w: 0, l: 0 });
    return (
      <div className="panel">
        <StandHead lg={lg} seasons={seasons} y={y} setY={setY} tid={tid} setTid={setTid} />
        <SortTable cols={cols} rows={rows} initial="s" />
        <p className="note">{lg.teams[tid]?.name}: {tot.w}–{tot.l} ({pctf(div(tot.w, tot.w + tot.l))}) over {rows.length} seasons, {rows.filter((r: any) => r.h.po?.[tid] > 0).length} playoff trips, {rows.filter((r: any) => r.h.champion === tid).length} titles.</p>
      </div>
    );
  }
  const confs = [...new Set(h.standings.map((x: any) => x.conf))] as string[];
  return (
    <div className="panel">
      <StandHead lg={lg} seasons={seasons} y={y} setY={setY} tid={tid} setTid={setTid} />
      <div className="conf-wrap">
        {confs.map(c => {
          const rows = h.standings.filter((x: any) => x.conf === c);
          const lead = rows[0];
          return (
            <div key={c} className="tbl-wrap">
              <table className="tbl">
                <caption>{c === 'E' ? 'Eastern Conference' : 'Western Conference'}</caption>
                <thead><tr><th>#</th><th className="l">Team</th><th>W</th><th>L</th><th>%</th><th>GB</th><th className="l">Playoffs</th></tr></thead>
                <tbody>{rows.map((t: any, i: number) => {
                  const gb = ((lead.w - t.w) + (t.l - lead.l)) / 2;
                  return (
                    <tr key={t.tid} className={t.tid === lg.userTid ? 'mine' : ''}>
                      <td className="dim">{i + 1}</td>
                      <td className="l"><TLogo lg={lg} tid={t.tid} /><button className="link" onClick={() => openTeam(t.tid)}>{t.name}</button></td>
                      <td>{t.w}</td><td>{t.l}</td><td>{pctf(div(t.w, t.w + t.l))}</td>
                      <td className="dim">{gb ? gb.toFixed(1).replace('.0', '') : '–'}</td>
                      <td className="l">{finish(h, t.tid) || <span className="dim">–</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function StandHead({ lg, seasons, y, setY, tid, setTid }: any) {
  return (
    <div className="team-head prog-head">
      <h2>Standings history</h2>
      {!tid && <select aria-label="Season" value={y} onChange={e => setY(+e.target.value)}>{seasons.map((s: number) => <option key={s} value={s}>{sl(s)}</option>)}</select>}
      <select aria-label="Team" value={tid} onChange={e => setTid(e.target.value)}>
        <option value="">Whole league, one season</option>
        {teamsSorted(lg).map((t: any) => <option key={t.tid} value={t.tid}>{t.name} – every season</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- team stats explorer
const ZERO = () => ({ gp: 0, w: 0, l: 0, st: { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 }, opp: { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 } });
function addTo(a: any, st: any, opp: any, gp: number, w: number, l: number) {
  a.gp += gp; a.w += w; a.l += l;
  for (const k of Object.keys(a.st)) { a.st[k] += st?.[k] ?? 0; a.opp[k] += opp?.[k] ?? 0; }
}

export function TeamStatsExplorer({ lg, openTeam }: any) {
  const all = useMemo(() => {
    const out: any[] = [];
    for (const h of lg.history) for (const [tid, x] of Object.entries(h.teamStats ?? {}) as any) out.push({ s: h.season, tid, x, h });
    if ((lg.phase === 'regular' || lg.phase === 'playoffs') && !lg.history.some((h: any) => h.season === lg.season))
      for (const t of Object.values(lg.teams) as any[]) if (t.active && t.gp) out.push({ s: lg.season, tid: t.tid, x: { st: t.st, opp: t.opp, gp: t.gp, w: t.w, l: t.l, stPo: t.stPo, oppPo: t.oppPo, gpPo: t.gpPo }, live: true });
    return out;
  }, [lg, lg.day, lg.phase]);
  const seasons = [...new Set(all.map(r => r.s))].sort((a, b) => a - b);
  const [tid, setTid] = useState('all');
  const [from, setFrom] = useState<number>(seasons[0]);
  const [to, setTo] = useState<number>(seasons[seasons.length - 1]);
  const [po, setPo] = useState(false);
  const [agg, setAgg] = useState(true);
  const [pg, setPg] = useState(true);
  if (!seasons.length) return <div className="panel"><h2>Team stats explorer</h2><p className="note">Team statistics appear here once games are played.</p></div>;
  const lo = Math.min(from ?? seasons[0], to ?? seasons[seasons.length - 1]), hi = Math.max(from ?? seasons[0], to ?? seasons[seasons.length - 1]);
  const sel = all.filter(r => r.s >= lo && r.s <= hi && (tid === 'all' || r.tid === tid));
  const lines: any[] = [];
  const grab = (r: any) => po ? { st: r.x.stPo, opp: r.x.oppPo, gp: r.x.gpPo ?? 0, w: 0, l: 0 } : { st: r.x.st, opp: r.x.opp, gp: r.x.gp, w: r.x.w, l: r.x.l };
  if (agg) {
    const m = new Map<string, any>();
    for (const r of sel) {
      const g = grab(r); if (!g.gp) continue;
      let a = m.get(r.tid); if (!a) m.set(r.tid, a = { ...ZERO(), tid: r.tid, n: 0, first: r.s, last: r.s, titles: 0, poW: 0 });
      addTo(a, g.st, g.opp, g.gp, g.w, g.l); a.n++; a.first = Math.min(a.first, r.s); a.last = Math.max(a.last, r.s);
      if (r.h?.champion === r.tid) a.titles++;
    }
    for (const a of m.values()) lines.push({ key: a.tid, ...a });
  } else {
    for (const r of sel) {
      const g = grab(r); if (!g.gp) continue;
      const a = { ...ZERO(), tid: r.tid, n: 1, first: r.s, last: r.s, titles: r.h?.champion === r.tid ? 1 : 0, live: r.live };
      addTo(a, g.st, g.opp, g.gp, g.w, g.l);
      lines.push({ key: r.tid + r.s, ...a });
    }
  }
  const per = (v: number, r: any) => (pg ? v / r.gp : v);
  const S = (k: string) => (r: any) => per(r.st[k], r);
  const fmtN = pg ? f1 : (v: any) => (v == null ? '–' : Math.round(v).toLocaleString());
  const cols = [
    { key: 'team', label: 'Team', left: true, asc: true, get: (r: any) => abbrOf(lg, r.tid), fmt: (v: any, r: any) => <><TLogo lg={lg} tid={r.tid} /><button className="link" onClick={() => openTeam(r.tid)}>{v}</button></> },
    agg ? { key: 'n', label: 'Seasons', get: (r: any) => r.n, fmt: (v: any, r: any) => <>{v}<span className="dim"> ({r.first === r.last ? sl(r.first) : `${r.first - 1}–${String(r.last).slice(2)}`})</span></> }
      : { key: 's', label: 'Season', get: (r: any) => r.first, fmt: (v: any, r: any) => <>{sl(v)}{r.live ? ' *' : ''}</> },
    { key: 'gp', label: 'GP', get: (r: any) => r.gp },
    ...(!po ? [
      { key: 'w', label: 'W', get: (r: any) => r.w },
      { key: 'l', label: 'L', asc: true, get: (r: any) => r.l },
      { key: 'wp', label: '%', get: (r: any) => div(r.w, r.w + r.l), fmt: pctf },
    ] : []),
    ...(agg ? [{ key: 'ti', label: '🏆', title: 'Titles', get: (r: any) => r.titles }] : []),
    { key: 'pts', label: 'Pts', get: S('pts'), fmt: fmtN },
    { key: 'opp', label: 'Opp', asc: true, get: (r: any) => per(r.opp.pts, r), fmt: fmtN },
    { key: 'diff', label: '+/−', get: (r: any) => (r.st.pts - r.opp.pts) / r.gp, fmt: (v: any) => <span className={v >= 0 ? 'pos' : 'neg'}>{v > 0 ? '+' : ''}{f1(v)}</span> },
    { key: 'fg', label: 'FG%', get: (r: any) => div(r.st.fgm, r.st.fga), fmt: pctf },
    { key: 'tp', label: '3P%', get: (r: any) => div(r.st.tpm, r.st.tpa), fmt: pctf },
    { key: 'tpm', label: '3PM', get: S('tpm'), fmt: fmtN },
    { key: 'ft', label: 'FT%', get: (r: any) => div(r.st.ftm, r.st.fta), fmt: pctf },
    { key: 'reb', label: 'Reb', get: (r: any) => per(r.st.orb + r.st.drb, r), fmt: fmtN },
    { key: 'ast', label: 'Ast', get: S('ast'), fmt: fmtN },
    { key: 'stl', label: 'Stl', get: S('stl'), fmt: fmtN },
    { key: 'blk', label: 'Blk', get: S('blk'), fmt: fmtN },
    { key: 'tov', label: 'TOV', asc: true, get: S('tov'), fmt: fmtN },
    { key: 'ofg', label: 'Opp FG%', asc: true, get: (r: any) => div(r.opp.fgm, r.opp.fga), fmt: pctf },
  ];
  return (
    <div className="panel">
      <div className="team-head prog-head">
        <h2>Team stats explorer</h2>
        <select aria-label="Team" value={tid} onChange={e => setTid(e.target.value)}>
          <option value="all">All teams</option>
          {teamsSorted(lg).map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
        </select>
        <select aria-label="From season" value={lo} onChange={e => setFrom(+e.target.value)}>{seasons.map(s => <option key={s} value={s}>from {sl(s)}</option>)}</select>
        <select aria-label="To season" value={hi} onChange={e => setTo(+e.target.value)}>{seasons.map(s => <option key={s} value={s}>to {sl(s)}</option>)}</select>
      </div>
      <div className="stats-head">
        <div className="seg" role="group" aria-label="Rows">
          <button className={agg ? 'on' : ''} onClick={() => setAgg(true)}>All-time (summed)</button>
          <button className={!agg ? 'on' : ''} onClick={() => setAgg(false)}>Each season</button>
        </div>
        <div className="seg" role="group" aria-label="Part of season">
          <button className={!po ? 'on' : ''} onClick={() => setPo(false)}>Regular season</button>
          <button className={po ? 'on' : ''} onClick={() => setPo(true)}>Playoffs</button>
        </div>
        <div className="seg" role="group" aria-label="Show">
          <button className={pg ? 'on' : ''} onClick={() => setPg(true)}>Per game</button>
          <button className={!pg ? 'on' : ''} onClick={() => setPg(false)}>Totals</button>
        </div>
      </div>
      {lines.length ? <SortTable cols={cols} rows={lines} initial={agg ? 'wp' : 'diff'} limit={400} rowClass={(r: any) => (r.tid === lg.userTid ? 'mine' : '')} /> : <p className="note">No games in this range.</p>}
      <p className="note">{lines.length} rows. Pick a team and a span of seasons; “All-time” sums every season in the span, “Each season” lists them one by one (sort by any column for the best and worst team-seasons). * – season in progress.</p>
    </div>
  );
}

// ---------------------------------------------------------------- free-agency moves
const KIND: Record<string, string> = { sign: 'Signed', resign: 'Re-signed', match: 'Matched (RFA)', sheet: 'Offer sheet', qo: 'Qualifying offer' };
export function faMovesOf(lg: any, S: number) {
  if (lg.faHist?.[S]) return lg.faHist[S].map((r: any) => ({ pid: r[0], kind: r[1], tid: r[2], from: r[3], sal: r[4], exp: r[5], ovr: r[6], age: r[7] }));
  // the summer in progress (or the season it led into)
  if (lg.fa && S === lg.season) {
    return lg.fa.log.filter((x: any) => x.pid && x.tid && KIND[x.kind] && !(x.kind === 'sheet' && x.desc?.includes('awaiting')) && lg.players[x.pid]).map((x: any) => {
      const p = lg.players[x.pid];
      return { pid: x.pid, kind: x.kind, tid: x.tid, from: x.from ?? '', sal: x.sal ?? 0, exp: x.exp ?? S, ovr: shownOvr(p.z), age: ageIn(p, S), st: x.st };
    });
  }
  return [];
}

export function FaMoves({ lg, openPlayer, openTeam }: any) {
  const seasons = useMemo(() => {
    const s = new Set<number>(Object.keys(lg.faHist ?? {}).map(Number));
    if (lg.fa) s.add(lg.season);
    return [...s].sort((a, b) => b - a);
  }, [lg, lg.phase]);
  const [S, setS] = useState<number>(seasons[0]);
  const [tid, setTid] = useState('all');
  const [kind, setKind] = useState('moved');
  const [minOvr, setMinOvr] = useState(0);
  const rows = useMemo(() => faMovesOf(lg, S ?? lg.season), [lg, S, lg.day, lg.phase, lg.fa?.log.length]);
  if (!seasons.length) return <div className="panel"><h2>Free-agency moves</h2><p className="note">Every signing is recorded here from the first free agency on.</p></div>;
  const cap = seasonInfo(S).cap;
  const moved = (r: any) => r.kind === 'sign' && r.from !== r.tid || r.kind === 'sheet';
  const shown = rows.filter((r: any) => (tid === 'all' || r.tid === tid || r.from === tid) && r.ovr >= minOvr && (kind === 'all' || (kind === 'moved' ? moved(r) : !moved(r))));
  const T = (t: string) => t && lg.teams[t] ? <button className="link" onClick={() => openTeam(t)}>{lg.teams[t].abbr}</button> : <span className="dim">{t ? t : '—'}</span>;
  const cols = [
    { key: 'name', label: 'Player', left: true, asc: true, get: (r: any) => lg.players[r.pid]?.name ?? r.pid, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.pid)}>{v}</button> },
    { key: 'ovr', label: 'OVR', get: (r: any) => r.ovr },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => r.age },
    { key: 'from', label: 'From', left: true, asc: true, get: (r: any) => (r.from ? abbrOf(lg, r.from) : ''), fmt: (_: any, r: any) => T(r.from) },
    { key: 'to', label: 'To', left: true, asc: true, get: (r: any) => abbrOf(lg, r.tid), fmt: (_: any, r: any) => <>{moved(r) ? '→ ' : ''}{T(r.tid)}</> },
    { key: 'kind', label: 'Move', left: true, asc: true, get: (r: any) => KIND[r.kind] ?? r.kind, fmt: (v: any, r: any) => <>{v}{r.st === 5 ? <span className="dim"> · in season</span> : r.st === 4 ? <span className="dim"> · late</span> : null}</> },
    { key: 'sal', label: '$M/yr', get: (r: any) => r.sal * cap, fmt: (v: any) => v.toFixed(2) },
    { key: 'pct', label: '% cap', get: (r: any) => r.sal * 100, fmt: f1 },
    { key: 'yrs', label: 'Yrs', get: (r: any) => r.exp - S + 1 },
  ];
  const teams = Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name));
  return (
    <div className="panel">
      <div className="team-head prog-head">
        <h2>Free-agency moves</h2>
        <select aria-label="Season" value={S} onChange={e => setS(+e.target.value)}>{seasons.map(s => <option key={s} value={s}>Summer before {sl(s)}</option>)}</select>
        <select aria-label="Team" value={tid} onChange={e => setTid(e.target.value)}>
          <option value="all">All teams</option>
          {teams.map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
        </select>
        <select aria-label="Kind" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="moved">Changed teams</option>
          <option value="stayed">Re-signed / matched</option>
          <option value="all">All moves</option>
        </select>
        <select aria-label="Minimum OVR" value={minOvr} onChange={e => setMinOvr(+e.target.value)}>
          {[0, 65, 70, 75, 80].map(v => <option key={v} value={v}>{v ? `OVR ${v}+` : 'All players'}</option>)}
        </select>
      </div>
      {shown.length ? <SortTable cols={cols} rows={shown.map((r: any, i: number) => ({ key: r.pid + i, ...r }))} initial="ovr" rowClass={(r: any) => (r.tid === lg.userTid || r.from === lg.userTid ? 'mine' : '')} /> : <p className="note">No moves match.</p>}
      <p className="note">{shown.length} of {rows.length} moves. OVR and age at the time of the move. A team filter shows players who joined <i>or</i> left that team.</p>
    </div>
  );
}
