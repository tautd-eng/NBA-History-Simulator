// @ts-nocheck
// Clutch mode: the last five minutes of a game on the pixel court, with the
// user coaching one team (play calls, isolation, defence, substitutions, timeouts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { clutchStep, clutchAuto } from '../league/league';
import { CourtCanvas, BoxPair, rosterMaps, fmtTxt, mmss, periodName } from './court';
import { teamColor } from './pixel';

const OFF_CALLS = [
  ['auto', 'Coach decides', 'AI picks the play'],
  ['three', 'Three', 'Ball to the best shooter'],
  ['inside', 'Attack the rim', 'Drive, draw more fouls'],
  ['milk', 'Milk the clock', 'Use the whole shot clock'],
  ['quick', 'Quick shot', 'Shoot within seconds'],
] as const;
const DEF_CALLS = [['normal', 'Normal'], ['pressure', 'Pressure'], ['foul', 'Intentional foul']] as const;
const short = (n: string) => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };

export function ClutchGame({ lg, cs, onFinish, close, openPlayer }: any) {
  const home = lg.teams[cs.home], away = lg.teams[cs.away];
  const userSide = cs.side;
  const userTeam = userSide === 'h' ? home : away;
  const [stage, setStage] = useState<'intro' | 'play' | 'final'>('intro');
  const [rev, setRev] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [autoOff, setAutoOff] = useState(false);
  const [defCall, setDefCall] = useState<'normal' | 'pressure' | 'foul'>('normal');
  const [speed, setSpeed] = useState(2);
  const [mode, setMode] = useState<'arena' | 'classic'>('arena');
  const [shownN, setShownN] = useState<number>(cs.state?.logLen ?? 0);
  const [five, setFive] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [toReq, setToReq] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const startLen = useRef(cs.state?.logLen ?? 0);
  const startLineups = useRef(cs.state ? { h: cs.state.h.filter(p => p.on).map(p => p.pid), a: cs.state.a.filter(p => p.on).map(p => p.pid) } : null);
  const startOff = useRef(cs.state?.off ?? 'h');
  const st = cs.state;
  const log = cs.result ? cs.result.pbp : st.log;
  const upto = stage === 'intro' ? startLen.current : cs.result ? cs.result.pbp.length : st.logLen;

  const maps = useMemo(() => {
    const src = cs.state ?? null;
    const hRows = src ? src.h : cs.result.home.players;
    const aRows = src ? src.a : cs.result.away.players;
    return rosterMaps([hRows, aRows].map(b => b.map((p: any) => ({ pid: p.pid, name: p.name, pos: p.pos ?? lg.players[p.pid]?.pos }))), pid => lg.players[pid]?.pos ?? 'F');
  }, []);

  // after each animation: decide what happens next
  const onIdle = () => {
    if (stage !== 'play') return;
    if (cs.result) { finish(); return; }
    if (cs.state.off === userSide && !autoOff) { setWaiting(true); return; }
    setTimeout(() => step({}), 250 / speed);
  };
  const idleRef = useRef(onIdle);
  idleRef.current = onIdle;

  function step(extra: any) {
    if (cs.result) return;
    const dec: any = { ...extra };
    if (cs.state.off !== userSide) dec.def = defCall;
    if (five) dec.five = five;
    if (toReq) dec.timeout = true;
    clutchStep(cs, dec);
    setToReq(false);
    setFive(null);
    if (defCall === 'foul') setDefCall('normal');
    setWaiting(false);
    setRev(r => r + 1);
  }

  function finish() {
    if (recorded) return;
    setRecorded(true);
    setStage('final');
    onFinish();
  }

  function begin() {
    setStage('play');
    setRev(r => r + 1);
    // first decision right away
    if (cs.state.off === userSide && !autoOff) setWaiting(true);
    else setTimeout(() => step({}), 300);
  }

  function closeNow() {
    if (stage === 'final' || cs.result) { if (!recorded) { clutchAuto(cs); onFinish(); } close(); return; }
    setConfirmClose(true);
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // scoreboard numbers follow the animation: use the last shown event
  const shownUpto = Math.min(upto, Math.max(startLen.current, shownN));
  const shownEv = log[Math.max(0, shownUpto - 1)] ?? { hs: st?.hs ?? 0, as: st?.as ?? 0, p: 4, c: 300 };
  const final = cs.result;
  const userRows = (cs.state ? (userSide === 'h' ? cs.state.h : cs.state.a) : []).map((p: any) => ({ ...p }));
  const onIds = five ?? userRows.filter((p: any) => p.on).map((p: any) => p.pid);
  const onRows = onIds.map((id: string) => userRows.find((p: any) => p.pid === id)).filter(Boolean);
  const bench = userRows.filter((p: any) => !onIds.includes(p.pid) && p.st.min >= 0);

  const swap = (pid: string) => {
    if (onIds.includes(pid)) { setPick(pick === pid ? null : pid); return; }
    if (!pick) return;
    const p = userRows.find((x: any) => x.pid === pid);
    if (!p || p.fouls >= 6) return;
    setFive(onIds.map((x: string) => (x === pick ? pid : x)));
    setPick(null);
  };

  const boxRows = (side: 'h' | 'a') => {
    if (final) return (side === 'h' ? final.home : final.away).players.filter((p: any) => p.st.min > 0).map((p: any) => ({ pid: p.pid, name: p.name, st: p.st, on: false })).sort((a: any, b: any) => b.st.min - a.st.min);
    return (side === 'h' ? st.h : st.a).filter((p: any) => p.st.min > 0 || p.on).map((p: any) => ({ pid: p.pid, name: p.name, st: p.st, on: p.on })).sort((a: any, b: any) => Number(b.on) - Number(a.on) || b.st.min - a.st.min);
  };
  const feed = log.slice(startLen.current, shownUpto).slice(-14).reverse();
  const won = final ? (userSide === 'h' ? final.home.pts > final.away.pts : final.away.pts > final.home.pts) : null;
  const q = st?.q ?? { h: final?.home.q ?? [], a: final?.away.q ?? [] };

  return (
    <div className="overlay live-overlay" onClick={closeNow}>
      <div className="live clutch" role="dialog" aria-label="Final minutes" onClick={e => e.stopPropagation()}>
        <div className="scoreboard pixel-sb">
          <div className="sb-team away"><span className="sb-name"><span className="full">{away.name}</span><span className="abbr">{away.abbr}</span></span><span className="sb-pts">{final && stage === 'final' ? final.away.pts : shownEv.as}</span></div>
          <div className="sb-mid">
            <span className="sb-clock">{stage === 'final' ? 'FINAL' : mmss(shownEv.c ?? 300)}</span>
            <span className="sb-per">{stage === 'final' ? (final?.ot ? 'Final/OT' : 'Final') : periodName(shownEv.p ?? 4)} · {userTeam.abbr} timeouts: {st?.timeouts ?? 0}</span>
          </div>
          <div className="sb-team home"><span className="sb-pts">{final && stage === 'final' ? final.home.pts : shownEv.hs}</span><span className="sb-name"><span className="full">{home.name}</span><span className="abbr">{home.abbr}</span></span></div>
        </div>

        <div className="clutch-stage">
          <CourtCanvas mode={mode} home={{ tid: home.tid, abbr: home.abbr }} away={{ tid: away.tid, abbr: away.abbr }} names={maps.names} sides={maps.sides} pos={maps.pos}
            events={log} upto={upto} speed={speed} onIdle={() => idleRef.current()} onShown={(n: number) => setShownN(n)} />
          {stage === 'intro' && (
            <div className="stage-card">
              <p className="eyebrow">Last 5 minutes · you coach the {userTeam.name}</p>
              <h2>{away.abbr} {st.as} : {st.hs} {home.abbr}</h2>
              <table className="qtable"><thead><tr><th></th>{q.h.map((_: any, i: number) => <th key={i}>{i + 1}</th>)}<th>4 (so far)</th></tr></thead>
                <tbody>
                  <tr><td>{away.abbr}</td>{q.a.map((v: number, i: number) => <td key={i}>{v}</td>)}<td>{st.as - q.a.reduce((x: number, y: number) => x + y, 0)}</td></tr>
                  <tr><td>{home.abbr}</td>{q.h.map((v: number, i: number) => <td key={i}>{v}</td>)}<td>{st.hs - q.h.reduce((x: number, y: number) => x + y, 0)}</td></tr>
                </tbody></table>
              <p className="dim">The first 43 minutes are played. Now it's your call: offensive plays, defense, substitutions and timeouts.</p>
              <button className="primary big" onClick={begin}>Start</button>
            </div>
          )}
          {stage === 'final' && (
            <div className="stage-card">
              <p className="eyebrow">Final</p>
              <h2>{won ? 'Victory!' : 'Defeat'}</h2>
              <p className="big-score">{away.abbr} {final.away.pts} : {final.home.pts} {home.abbr}</p>
              <p className="dim">The result is recorded in the league.</p>
              <button className="primary" onClick={close}>Close</button>
            </div>
          )}
        </div>

        {stage === 'play' && (
          <div className="coach">
            <div className="coach-main">
              {waiting ? (
                <div className="calls">
                  <h3>Offense – which play?</h3>
                  <div className="call-grid">
                    {OFF_CALLS.map(([k, l, d]) => <button key={k} className="call" onClick={() => step({ off: k })}><b>{l}</b><small>{d}</small></button>)}
                  </div>
                  <h3>Or an isolation for</h3>
                  <div className="iso-row">
                    {(userSide === 'h' ? st.h : st.a).filter((p: any) => p.on).map((p: any) => (
                      <button key={p.pid} className="iso" onClick={() => step({ off: 'iso', pid: p.pid })}>{short(p.name)} <span className="dim">{p.st.pts} pts · {p.st.fgm}/{p.st.fga}</span></button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="calls">
                  <h3>{cs.state?.off === userSide ? 'Offense' : 'Defense'}</h3>
                  <p className="dim">{cs.state?.off === userSide ? (autoOff ? 'The coach (AI) calls the plays.' : 'Waiting for the possession…') : 'Opponents on offense. Pick a defense – it stays until you change it (foul – once).'}</p>
                </div>
              )}
              <div className="def-row">
                <span>Defense:</span>
                <div className="seg" role="group" aria-label="Defense">
                  {DEF_CALLS.map(([k, l]) => <button key={k} className={defCall === k ? 'on' : ''} onClick={() => setDefCall(k)}>{l}</button>)}
                </div>
              </div>
              <div className="def-row">
                <button disabled={!st || st.timeouts <= 0 || toReq} onClick={() => setToReq(true)}>{toReq ? 'Timeout requested' : `Timeout (${st?.timeouts ?? 0})`}</button>
                <button onClick={() => { clutchAuto(cs); setWaiting(false); setSpeed(8); setRev(r => r + 1); }}>Play to the end ⏭</button>
                <label className="chk" htmlFor="auto-off"><input id="auto-off" type="checkbox" checked={autoOff} onChange={e => { setAutoOff(e.target.checked); if (e.target.checked && waiting) step({ off: 'auto' }); }} /> AI runs the offense</label>
                <div className="seg" role="group" aria-label="View">
                  <button className={mode === 'arena' ? 'on' : ''} onClick={() => setMode('arena')}>Arena</button>
                  <button className={mode === 'classic' ? 'on' : ''} onClick={() => setMode('classic')}>Court</button>
                </div>
                <div className="seg" role="group" aria-label="Animation speed">
                  {[1, 2, 4, 8].map(v => <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>×{v}</button>)}
                </div>
              </div>
            </div>
            <div className="coach-side">
              <h3>On court <span className="dim">– click a player, then a sub</span></h3>
              <ul className="lineup">
                {onRows.map((p: any) => (
                  <li key={p.pid}><button className={`pl ${pick === p.pid ? 'sel' : ''}`} onClick={() => swap(p.pid)}>
                    <span className="nm">{short(p.name)}</span><span className="dim">{p.pos} · {p.st.pts} pts · PF {p.fouls}</span>
                    <span className="energy" title="Energy"><span style={{ width: `${Math.round(p.e * 100)}%` }} className={p.e < 0.45 ? 'low' : ''}></span></span>
                  </button></li>
                ))}
              </ul>
              <h3>Bench</h3>
              <ul className="lineup bench">
                {bench.map((p: any) => (
                  <li key={p.pid}><button className="pl" disabled={!pick || p.fouls >= 6} onClick={() => swap(p.pid)}>
                    <span className="nm">{short(p.name)}</span><span className="dim">{p.pos} · OVR {p.ovr} · {p.st.pts} pts{p.fouls >= 6 ? ' · fouled out' : ''}</span>
                    <span className="energy"><span style={{ width: `${Math.round(p.e * 100)}%` }} className={p.e < 0.45 ? 'low' : ''}></span></span>
                  </button></li>
                ))}
              </ul>
              {five && <p className="note">Substitutions take effect at the next stoppage.</p>}
            </div>
          </div>
        )}

        <div className="clutch-bottom">
          <ol className="feed short">
            {feed.map((e: any, i: number) => (
              <li key={i} className={`${e.k} ${e.s}`}>
                <span className="fc">{periodName(e.p)} {mmss(e.c)}</span>
                <span className="ft">{fmtTxt(e.txt, home.abbr, away.abbr)}</span>
                <span className="fs">{e.as}–{e.hs}</span>
              </li>
            ))}
          </ol>
        </div>
        <BoxPair openPlayer={openPlayer} teams={[
          { label: away.name, score: final ? final.away.pts : st.as, color: teamColor(away.tid)[0], rows: boxRows('a') },
          { label: home.name, score: final ? final.home.pts : st.hs, color: teamColor(home.tid)[0], rows: boxRows('h') },
        ]} />

        {confirmClose && (
          <div className="confirm-bar">
            <span>The game isn't over. Sim the rest automatically and record the result?</span>
            <button className="primary" onClick={() => { clutchAuto(cs); if (!recorded) { setRecorded(true); onFinish(); } close(); }}>Yes, finish automatically</button>
            <button className="ghost" onClick={() => setConfirmClose(false)}>Keep playing</button>
          </div>
        )}
      </div>
    </div>
  );
}
