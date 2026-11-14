// @ts-nocheck
// Fantasy draft room.
import { useMemo, useState } from 'react';
import { canRun } from '../league/humans';
import { run } from '../league/commands';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm, RATING_LABELS, ratingOf } from '../data';
import { ageIn } from '../players';
import { fantasyTidAt, fantasyOnClock, fantasyPool, fantasyUserPick, fantasyAdvance, fantasyStep } from '../league/fantasy';
import { AutoControls, useAutoPlay } from './draftday';
import { posNum } from '../engine/game';
import { PickBoard, OnClock } from './pickboard';

const POS = [['all', 'All'], ['g', 'Guards'], ['f', 'Forwards'], ['c', 'Centers']] as const;

export function FantasyRoom({ lg, onChange, onTick = () => {}, openPlayer }: any) {
  const [pos, setPos] = useState('all');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  useAutoPlay(playing, speed, () => {
    if (!fantasyStep(lg)) return false;
    onTick();
    const nx = fantasyOnClock(lg);
    return !!nx && nx.tid !== lg.userTid;
  }, () => { setPlaying(false); onChange(); });
  const [q, setQ] = useState('');
  const on = fantasyOnClock(lg);
  const f = lg.fantasy;
  const myTurn = on && on.tid === lg.userTid;
  const pool = useMemo(() => fantasyPool(lg)
    .filter((p: any) => pos === 'all' || (pos === 'g' ? posNum(p.pos) <= 2.5 : pos === 'c' ? posNum(p.pos) >= 4.5 : posNum(p.pos) > 2.5 && posNum(p.pos) < 4.5))
    .filter((p: any) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a: any, b: any) => ovrOf(b.z, b.id) - ovrOf(a.z, a.id)).slice(0, 120), [f.picks.length, pos, q]);
  const R = (p: any, i: number) => ratingOf(p.z[RATING_LABELS[i].k], RATING_LABELS[i].inv);
  const SHOW = [0, 1, 4, 6, 7, 10];
  const act = (fn: () => void) => { fn(); onChange(); };
  const mine = lg.userTid ? lg.teams[lg.userTid].roster.map((pid: string) => lg.players[pid]) : [];
  const recent = f.picks.slice().reverse().slice(0, 30);

  return (
    <div className="grid-2">
      <section className="panel">
        <div className="team-head">
          <h2>Fantasy draft</h2>
          {!on && <span className="dim">Draft complete</span>}
        </div>
        {on && <OnClock lg={lg} tid={on.tid} pick={on.pick} round={on.round} mine={myTurn} />}
        <p className="note">All players from the {(lg.start ?? 1980) - 1}–{String(lg.start ?? 1980).slice(2)} season go into one pool. {f.rounds} rounds in snake order (the last pick of a round picks first in the next){f.rr ? `, and from round ${f.rr} the order turns again (${f.rr}RR)` : ''}. Undrafted players become free agents.</p>
        <div className="def-row">
          {myTurn ? <span className="chip on-clock">You're on the clock – pick from the list!</span> : on && canRun(lg) ? <button className="primary" disabled={playing} onClick={() => act(() => fantasyStep(lg))}>Next pick</button> : on ? <span className="hint">Waiting for the host to move the draft on.</span> : null}
          {on && canRun(lg) && <AutoControls playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} disabled={myTurn} />}
          {!myTurn && lg.userTid && on && canRun(lg) && <button disabled={playing} onClick={() => act(() => fantasyAdvance(lg))}>{(lg.humans?.length ?? 0) > 1 ? 'To the next user pick' : 'To my pick'}</button>}
          {on && canRun(lg) && <button onClick={() => { setPlaying(false); act(() => fantasyAdvance(lg, true)); }}>{lg.userTid ? 'Auto-finish (AI picks for me too)' : 'Run the whole draft'}</button>}
        </div>
        <div className="def-row">
          <div className="seg" role="group" aria-label="Position">{POS.map(([k, l]) => <button key={k} className={pos === k ? 'on' : ''} onClick={() => setPos(k)}>{l}</button>)}</div>
          <input id="fan-q" className="search" placeholder="Search player" value={q} onChange={e => setQ(e.target.value)} aria-label="Search player" />
        </div>
        <div className="tbl-wrap pool">
          <table className="tbl">
            <thead><tr><th className="l">Player</th><th>Pos</th><th>Age</th><th>OVR</th>{SHOW.map(i => <th key={i} title={RATING_LABELS[i].name}>{RATING_LABELS[i].short}</th>)}<th></th></tr></thead>
            <tbody>
              {pool.map((p: any) => {
                return (
                  <tr key={p.id}>
                    <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button></td>
                    <td className="dim">{p.pos}</td><td>{ageIn(p, lg.season)}</td><td><b>{ovrOf(p.z, p.id)}</b></td>
                    {SHOW.map(i => <td key={i}>{R(p, i)}</td>)}
                    <td>{myTurn && <button className="small primary" onClick={() => act(() => { run(lg, { t: 'fantasyPick', pid: p.id }); })}>Pick</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="col">
        {lg.userTid && (
          <div className="panel">
            <h2>{lg.teams[lg.userTid].name}</h2>
            {mine.length ? (
              <ul className="news">{mine.map((p: any, i: number) => <li key={p.id}><span className="yr">{f.picks.find((x: any) => x.pid === p.id)?.pick}</span><span>{p.name} <span className="dim">{p.pos} · OVR {ovrOf(p.z, p.id)}</span></span></li>)}</ul>
            ) : <p className="note">You haven't picked anyone yet.</p>}
          </div>
        )}
        <PickBoard lg={lg} at={on ? on.pick - 1 : -1} openPlayer={openPlayer}
          slots={Array.from({ length: f.order.length * f.rounds }, (_, i) => {
            const round = Math.floor(i / f.order.length) + 1, tid = fantasyTidAt(f, i);
            const made = f.picks[i];
            return { n: i + 1, round, tid: made?.tid ?? tid, pid: made?.pid };
          })} />
      </section>
    </div>
  );
}
