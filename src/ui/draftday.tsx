// @ts-nocheck
// Draft-day shows: autoplay for watching picks, the expansion draft
// (protection lists, then the new teams picking) and the lottery (odds, then
// the draw revealed slot by slot).
import { Linkify, PL, TL, nav } from './nav';
import { useEffect, useRef, useState } from 'react';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm } from '../data';
import { ageIn } from '../players';
import {
  expAvailable, expOnClock, expPick, expAdvance, expConfirm, expToggleProtect, PROTECT_N, lotteryDraw,
} from '../league/offseason';
import { SortTable } from './sorttable';
import { posNum } from '../engine/game';
import { teamColor } from './pixel';
import { pickOwner } from '../ai/trades';

function Ovr({ v }: any) {
  const tier = v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low';
  return <span className={`ovr ${tier} sm`}>{v}</span>;
}
const pct = (x: number) => (x >= 0.995 ? '100%' : x < 0.0005 ? '–' : x < 0.01 ? '<1%' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

// ---------------------------------------------------------------- autoplay
export const SPEEDS = [[1400, 'Slow'], [600, 'Medium'], [180, 'Fast']] as const;

/** Calls step() every `delay` ms while `on`; step returns false to stop. */
export function useAutoPlay(on: boolean, delay: number, step: () => boolean, stop: () => void) {
  const ref = useRef(step); ref.current = step;
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => { if (!ref.current()) { clearInterval(id); stopRef.current(); } }, delay);
    return () => clearInterval(id);
  }, [on, delay]);
}

export function AutoControls({ playing, setPlaying, speed, setSpeed, label = 'Watch', disabled }: any) {
  return (
    <span className="auto-ctl">
      <button className={playing ? 'primary' : ''} disabled={disabled && !playing} onClick={() => setPlaying(!playing)}>{playing ? '⏸ Pause' : `▶ ${label}`}</button>
      <span className="seg" role="group" aria-label="Speed">
        {SPEEDS.map(([v, l]) => <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>{l}</button>)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- expansion draft
export function ExpansionRoom({ lg, onChange, onTick, openPlayer, openTeam }: any) {
  const d = lg.draftDay, e = d.exp;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  const [view, setView] = useState<'open' | 'mine'>('open');
  const act = (fn: () => void) => { fn(); onChange(); };
  const on = expOnClock(lg);
  const myTurn = on && on.nt === lg.userTid;
  useAutoPlay(playing, speed, () => {
    const c = expOnClock(lg);
    if (!c || c.nt === lg.userTid) return false;
    expPick(lg); onTick();
    return !!expOnClock(lg);
  }, () => { setPlaying(false); onChange(); });
  const Y = lg.season;
  const avail = expAvailable(lg);
  const userOld = lg.userTid && e.protect[lg.userTid];
  const mine = userOld ? lg.teams[lg.userTid].roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)) : [];
  const protectedN = userOld ? e.protect[lg.userTid].length : 0;
  const rounds = Math.round(e.order.length / e.teams.length);
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button> },
    { key: 'from', label: 'Team', left: true, get: (r: any) => lg.teams[r.from].abbr, fmt: (v: any, r: any) => <button className="link" onClick={() => openTeam(r.from)}>{v}</button> },
    { key: 'pos', label: 'Pos', get: (r: any) => posNum(r.p.pos), fmt: (_: any, r: any) => <span className="dim">{r.p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, Y + 1) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'sal', label: 'Salary', title: 'Salary as a share of the cap', get: (r: any) => r.p.contract.sal, fmt: (v: any, r: any) => `${Math.round(v * 100)}% through ${r.p.contract.exp}` },
    ...(myTurn ? [{ key: 'act', label: '', get: () => 0, fmt: (_: any, r: any) => <button className="small" onClick={() => act(() => expPick(lg, r.p.id))}>Pick</button> }] : []),
  ];
  return (
    <div className="grid-2">
      <section className="panel accent">
        <div className="team-head">
          <h2>{Y} expansion draft</h2>
          {on && <span className={`chip ${myTurn ? 'on-clock' : ''}`}>Round {on.round} · {lg.teams[on.nt].name} on the clock</span>}
        </div>
        <p className="note">Joining the league: {e.teams.map((t: string) => lg.teams[t].name).join(' and ')}. Every existing team protects {PROTECT_N} players, and the new teams take turns picking from the rest ({rounds} rounds). Only one player can be taken from each team – once a team loses one, its other players are safe.</p>
        {!e.confirmed ? (
          <>
            {userOld ? (
              <div className="offer">
                <div><b>Your protected list: {protectedN}/{PROTECT_N}</b> <span className="dim">Your GM already marked the most valuable – you can change it. Unprotected players can be taken.</span></div>
              </div>
            ) : <p className="hint">All teams have set their protected lists.</p>}
            <div className="def-row">
              <button className="primary" onClick={() => act(() => expConfirm(lg))}>Confirm lists and start</button>
              <button onClick={() => act(() => expAdvance(lg, 'all'))}>To the end</button>
            </div>
            {userOld && (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th className="l">Protect</th><th className="l">Player</th><th>Pos</th><th>Age</th><th>OVR</th><th className="l">Contract</th></tr></thead>
                <tbody>{mine.map((p: any) => {
                  const prot = e.protect[lg.userTid].includes(p.id);
                  return <tr key={p.id} className={prot ? 'mine' : ''}>
                    <td className="l"><input type="checkbox" aria-label={`Protect ${p.name}`} checked={prot} disabled={!prot && protectedN >= PROTECT_N} onChange={() => act(() => expToggleProtect(lg, p.id))} /></td>
                    <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button></td>
                    <td className="dim">{p.pos}</td><td>{ageIn(p, Y + 1)}</td><td><Ovr v={ovrOf(p.z)} /></td>
                    <td className="l dim">{Math.round(p.contract.sal * 100)}% through {p.contract.exp}</td>
                  </tr>;
                })}</tbody>
              </table></div>
            )}
            <h3>Available players ({avail.length})</h3>
            <SortTable cols={cols} rows={avail.map((r: any) => ({ ...r, key: r.p.id }))} initial="ovr" limit={60} />
          </>
        ) : (
          <>
            <div className="def-row">
              {myTurn ? <span className="hint">You're on the clock – pick from the list.</span>
                : <button className="primary" disabled={!on || playing} onClick={() => act(() => expAdvance(lg, 'one'))}>Next pick</button>}
              <AutoControls playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} disabled={!on || myTurn} />
              <button onClick={() => { setPlaying(false); act(() => expAdvance(lg, 'all')); }}>To the end</button>
            </div>
            <h3>Available players ({avail.length}) <span className="dim">– from {new Set(avail.map((a: any) => a.from)).size} teams that haven't lost anyone yet</span></h3>
            <SortTable cols={cols} rows={avail.map((r: any) => ({ ...r, key: r.p.id }))} initial="ovr" limit={60} />
          </>
        )}
      </section>
      <section className="col">
        {e.teams.map((nt: string) => (
          <div className="panel" key={nt}>
            <h2><span className="swatch" style={{ background: teamColor(nt)[0] }}></span>{lg.teams[nt].name}</h2>
            {lg.teams[nt].roster.length ? (
              <ul className="news">{e.picks.filter((x: any) => x.nt === nt).slice().reverse().map((x: any) => (
                <li key={x.pid} className="pop-in"><span className="yr">{x.n}</span><span><button className="link" onClick={() => openPlayer(x.pid)}>{lg.players[x.pid].name}</button> <span className="dim">from {lg.teams[x.from].abbr} · {lg.players[x.pid].pos} · OVR {ovrOf(lg.players[x.pid].z)}</span></span></li>
              ))}</ul>
            ) : <p className="note">Roster is empty – waiting for the expansion draft.</p>}
          </div>
        ))}
        {e.lost.length > 0 && <div className="panel"><h3>Already lost a player</h3><p className="note">{e.lost.map((t: string) => lg.teams[t].abbr).join(', ')}</p></div>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- lottery
export function LotteryRoom({ lg, onChange, onDrawn }: any) {
  const d = lg.draftDay, L = d.lotto;
  const n = L.teams.length;
  const topN = Math.min(L.draws, n);
  const exp = (o: number[]) => o.reduce((a, p, i) => a + p * (i + 1), 0);
  const entrant = (tid: string) => L.entrants.includes(tid);
  const owner = (tid: string) => pickOwner(lg, d.year, 1, tid);
  const traded = L.teams.filter((t: any) => owner(t.tid) !== t.tid);
  return (
    <div className="panel accent lotto">
      <div className="team-head">
        <h2>{d.year} draft lottery</h2>
        <span className="chip">{L.kind === 'coin' ? 'Coin flip' : `${n} teams · top ${topN} picks drawn`}</span>
      </div>
      <p className="note"><Linkify text={L.text} /></p>
      {n ? (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>
            <th>Seed</th><th className="l">Team</th><th>Record</th>
            {L.kind === 'coin' ? <th>Odds at No. 1</th> : <><th>No. 1</th>{topN > 1 && <th>Top {topN}</th>}<th title="Average pick after the lottery">Avg. pick</th><th title="Lowest possible pick">Worst case</th></>}
          </tr></thead>
          <tbody>{L.teams.map((t: any, i: number) => {
            const o = L.odds[i];
            const worst = o.reduce((a: number, p: number, k: number) => (p > 0.0005 ? k + 1 : a), 0);
            const ow = owner(t.tid);
            return <tr key={t.tid} className={`${t.tid === lg.userTid || ow === lg.userTid ? 'mine' : ''} ${L.kind === 'coin' && !entrant(t.tid) ? 'bench' : ''}`}>
              <td>{i + 1}</td>
              <td className="l"><span className="swatch" style={{ background: teamColor(t.tid)[0] }}></span><TL tid={t.tid} />{ow !== t.tid && <span className="chip tiny traded" title={`${lg.teams[t.tid].name} traded this pick`}>pick owned by {lg.teams[ow].abbr}</span>}</td>
              <td>{t.w}–{t.l}</td>
              {L.kind === 'coin' ? <td>{entrant(t.tid) ? '50%' : <span className="dim">not in it</span>}</td> : <>
                <td><b>{pct(o[0])}</b></td>
                {topN > 1 && <td>{pct(o.slice(0, topN).reduce((a: number, b: number) => a + b, 0))}</td>}
                <td>{exp(o).toFixed(1)}</td>
                <td>{worst}</td>
              </>}
            </tr>;
          })}</tbody>
        </table></div>
      ) : <p className="note">Every team made the playoffs – no lottery.</p>}
      {traded.length > 0 && <p className="note">Traded picks: {traded.map((t: any, i: number) => <span key={t.tid}>{i ? '; ' : ''}<TL tid={t.tid} abbr />'s pick belongs to <b><TL tid={owner(t.tid)} /></b></span>)}. Wherever the lottery puts it, that team makes the selection.</p>}
      <div className="def-row">
        <button className="primary big" onClick={() => { lotteryDraw(lg); onChange(); onDrawn(); }}>{L.kind === 'coin' ? 'Flip the coin' : 'Run the lottery'}</button>
      </div>
      <p className="note">Odds come from simulating the lottery 20,000 times under that era's rules.</p>
    </div>
  );
}

/** The draw revealed from the last lottery slot up to No. 1. */
export function LotteryReveal({ lg, close }: any) {
  const d = lg.draftDay, L = d.lotto;
  const res: string[] = L.result ?? [];
  const n = res.length;
  const [shown, setShown] = useState(0); // how many slots revealed, from the bottom
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || shown >= n) return;
    const left = n - shown; // next slot to reveal (1-based)
    const delay = left <= Math.max(2, L.draws) ? 1700 : 650;
    const id = setTimeout(() => setShown(s => s + 1), delay);
    return () => clearTimeout(id);
  }, [auto, shown, n]);
  const lottery = L.teams.map((t: any) => t.tid);
  const owner = (tid: string) => pickOwner(lg, d.year, 1, tid);
  return (
    <div className="panel accent lotto">
      <div className="team-head">
        <h2>{d.year} lottery results</h2>
        <div className="def-row">
          {shown < n && <button onClick={() => setAuto(!auto)}>{auto ? '⏸ Pause' : '▶ Play'}</button>}
          {shown < n && <button onClick={() => setShown(s => s + 1)}>Next spot</button>}
          {shown < n && <button onClick={() => setShown(n)}>Show all</button>}
          {shown >= n && <button className="primary" onClick={close}>To the draft →</button>}
        </div>
      </div>
      <ol className="reveal">
        {res.map((tid, i) => {
          const slot = i + 1;
          const open = slot > n - shown;
          const was = lottery.indexOf(tid) + 1;
          const mv = was - slot;
          const isNext = slot === n - shown;
          const odds1 = L.odds[lottery.indexOf(tid)][0];
          return (
            <li key={slot} className={`${open ? 'open' : 'hidden'} ${isNext ? 'next' : ''} ${open && (tid === lg.userTid || owner(tid) === lg.userTid) ? 'mine' : ''} ${open && slot === 1 ? 'first' : ''}`}>
              <span className="slot">{slot}</span>
              {open ? <>
                <span className="swatch big-sw" style={{ background: teamColor(owner(tid))[0] }}></span>
                <span className="tname">{owner(tid) !== tid ? <><b>{lg.teams[owner(tid)].name}</b><small className="dim"> (pick from {lg.teams[tid].abbr})</small></> : lg.teams[tid].name}<small className="dim"> · seed {was}{L.kind !== 'coin' ? ` · odds at No. 1 ${pct(odds1)}` : ''}</small></span>
                <span className={`mv ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}`}>{mv > 0 ? `▲ ${mv}` : mv < 0 ? `▼ ${-mv}` : '='}</span>
              </> : <span className="tname dim">{isNext ? 'Revealing…' : '?'}</span>}
            </li>
          );
        })}
      </ol>
      {shown >= n && <p className="note"><Linkify text={d.lottery} /></p>}
    </div>
  );
}
