// @ts-nocheck
// The end of the regular season: awards revealed one place at a time (3rd, 2nd, then the winner) or all at
// once, with every candidate's season numbers, then the All-League teams – and only then the playoffs.
import { useState } from 'react';
import { TL } from './nav';
import { shownOvr as ovrOf } from '../data';
import { ageIn } from '../players';
import { simDay } from '../league/league';
import { PFace } from './art';

const AW = [
  { k: 'mip', t: 'Most Improved Player' },
  { k: 'smoy', t: 'Sixth Man of the Year' },
  { k: 'roy', t: 'Rookie of the Year' },
  { k: 'dpoy', t: 'Defensive Player of the Year' },
  { k: 'mvp', t: 'Most Valuable Player' },
];
const pg = (l: any, k: string) => (l?.gp ? (k === 'reb' ? (l.orb + l.drb) / l.gp : l[k] / l.gp) : 0);
const pct = (m: number, a: number) => (a ? (100 * m / a).toFixed(1) : '–');

function Line({ lg, p, k }: any) {
  const l = p.cur;
  const prev = p.career.find((c: any) => c.s === lg.season - 1 && !c.po);
  const t = p.tid ? lg.teams[p.tid] : null;
  return (
    <span className="aw-line">
      <b>{pg(l, 'pts').toFixed(1)}</b> pts · <b>{pg(l, 'reb').toFixed(1)}</b> reb · <b>{pg(l, 'ast').toFixed(1)}</b> ast
      {k === 'dpoy' ? <> · <b>{pg(l, 'stl').toFixed(1)}</b> stl · <b>{pg(l, 'blk').toFixed(1)}</b> blk</> : null}
      {' '}· {pct(l.fgm, l.fga)} FG% · {l.gp} GP{k === 'smoy' ? ` (${l.gs} starts)` : ''}
      {k === 'mip' && prev?.gp ? <> · <span className="pos">last season {(prev.pts / prev.gp).toFixed(1)} pts</span></> : null}
      {t ? <span className="dim"> · team {t.w}–{t.l}</span> : null}
    </span>
  );
}

function AwardCard({ lg, a, k, t, rev, setRev, openPlayer }: any) {
  const c = (a.votes?.[k] ?? []).slice(0, 3);
  if (!c.length) return null;
  const n = rev ?? 0;
  // places shown from the bottom: 3rd, then 2nd, then the winner
  const order = [...c].map((x: any, i: number) => ({ ...x, place: i + 1 })).reverse();
  const done = n >= c.length;
  return (
    <div className={`panel aw-card ${done ? 'done' : ''}`}>
      <div className="aw-head">
        <h3>{t}</h3>
        {!done && <button className="small primary" onClick={() => setRev(n + 1)}>{n === c.length - 1 ? 'Reveal the winner' : n === 0 ? `Reveal No. ${c.length}` : `Reveal No. ${c.length - n}`}</button>}
      </div>
      <ol className="aw-list">
        {order.map((x: any, i: number) => {
          const p = lg.players[x.pid];
          const on = i < n;
          return (
            <li key={x.pid} className={`aw-row ${on ? 'pop-in' : 'hidden'} ${x.place === 1 && on ? 'win' : ''}`}>
              <span className="aw-place">{x.place === 1 ? '🏆' : x.place}</span>
              {on ? <span className="aw-who">
                <PFace lg={lg} p={p} />
                <span><button className="link aw-name" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos} · age {ageIn(p, lg.season)} · OVR {ovrOf(p.z)} · {p.tid ? <TL tid={p.tid} abbr /> : 'FA'}</span><br /><Line lg={lg} p={p} k={k} /></span>
              </span> : <span className="dim aw-who">?</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TeamTable({ lg, title, pids, openPlayer, def }: any) {
  return (
    <div className="aw-team">
      <h3>{title}</h3>
      <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th className="l">Player</th><th>Pos</th><th>Team</th><th>PTS</th><th>REB</th><th>AST</th>{def ? <><th>STL</th><th>BLK</th></> : <th>FG%</th>}<th>GP</th></tr></thead>
        <tbody>{pids.map((pid: string) => { const p = lg.players[pid]; if (!p) return null; const l = p.cur; return (
          <tr key={pid} className={p.tid === lg.userTid ? 'mine' : ''}>
            <td className="l"><button className="link" onClick={() => openPlayer(pid)}>{p.name}</button></td><td className="dim">{p.pos}</td><td>{p.tid ? <TL tid={p.tid} abbr /> : '–'}</td>
            <td>{pg(l, 'pts').toFixed(1)}</td><td>{pg(l, 'reb').toFixed(1)}</td><td>{pg(l, 'ast').toFixed(1)}</td>
            {def ? <><td>{pg(l, 'stl').toFixed(1)}</td><td>{pg(l, 'blk').toFixed(1)}</td></> : <td>{pct(l.fgm, l.fga)}</td>}<td>{l.gp}</td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}

export function AwardsStep({ lg, onChange, openPlayer }: any) {
  const a = lg.seasonAwards;
  const st = lg.awardsShow?.s === lg.season ? lg.awardsShow : (lg.awardsShow = { s: lg.season, rev: {} });
  const [, setTick] = useState(0);
  const bump = () => setTick(x => x + 1);
  if (!a) return null;
  const setRev = (k: string, v: number) => { st.rev[k] = v; bump(); };
  const allOut = st.all || AW.every(x => !(a.votes?.[x.k]?.length) || (st.rev[x.k] ?? 0) >= Math.min(3, a.votes[x.k].length));
  const showAll = () => { for (const x of AW) st.rev[x.k] = 3; st.all = true; bump(); onChange(); };
  const go = () => { simDay(lg); onChange(); try { window.scrollTo({ top: 0 }); } catch { /* */ } };
  const ord = ['1st', '2nd', '3rd'];
  return (
    <div className="col">
      <div className="panel accent step-head">
        <div className="team-head">
          <h2>The {lg.season - 1}–{String(lg.season).slice(2)} regular season is over</h2>
          <span className="def-row">
            {!allOut && <button onClick={showAll}>Show all winners</button>}
            <button className="primary" onClick={go}>Start the playoffs →</button>
          </span>
        </div>
        <p className="note">Awards night. Reveal each award from third place up – or show everything at once. The All-League teams follow once the individual awards are out.</p>
      </div>
      <div className="aw-grid">
        {AW.map(x => <AwardCard key={x.k} lg={lg} a={a} k={x.k} t={x.t} rev={st.rev[x.k]} setRev={(v: number) => setRev(x.k, v)} openPlayer={openPlayer} />)}
      </div>
      {allOut ? (
        <div className="panel">
          <h2>All-League teams</h2>
          <div className="aw-teams">
            {a.allNba.map((t: string[], i: number) => <TeamTable key={'n' + i} lg={lg} title={`All-League ${ord[i]} team`} pids={t} openPlayer={openPlayer} />)}
            {a.allDef.map((t: string[], i: number) => <TeamTable key={'d' + i} lg={lg} title={`All-Defensive ${ord[i]} team`} pids={t} openPlayer={openPlayer} def />)}
            {a.allRookie.map((t: string[], i: number) => <TeamTable key={'r' + i} lg={lg} title={`All-Rookie ${ord[i]} team`} pids={t} openPlayer={openPlayer} />)}
          </div>
        </div>
      ) : <div className="panel"><h2>All-League teams</h2><p className="note">Revealed after the individual awards.</p><div className="def-row"><button onClick={showAll}>Show all winners</button></div></div>}
    </div>
  );
}
