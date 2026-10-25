// @ts-nocheck
// Live game viewer: replays a recorded game's play-by-play at a chosen speed,
// on the pixel court or the shot chart, with both teams' box scores side by side.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CourtCanvas, BoxPair, rosterMaps, fmtTxt, mmss, periodName } from './court';
import { teamColor } from './pixel';

const SPEEDS = [[1, '×1'], [2, '×2'], [4, '×4'], [8, '×8'], [24, '×24'], [72, '×72'], [240, '×240']] as const;

function clockOf(t: number) {
  let period: number, left: number;
  if (t <= 2880) { period = Math.min(4, Math.floor(t / 720) + 1); left = period * 720 - t; if (t === 2880) left = 0; }
  else { const o = t - 2880; period = 5 + Math.min(Math.floor(o / 300), 20); left = (period - 4) * 300 - o; }
  return { period, left: Math.max(0, left) };
}

export function LiveGame({ lg, data, close, openPlayer, hold }: any) {
  const { res, pbp } = data;
  const home = lg.teams[res.home.tid], away = lg.teams[res.away.tid];
  const endT = pbp[pbp.length - 1].t;
  const [t, setT] = useState(() => Math.min(data.startAt ?? 0, data.pbp[data.pbp.length - 1].t));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(24);
  const [view, setView] = useState<'court' | 'arena' | 'chart'>(() => (data.startAt ?? 0) >= 2580 ? 'arena' : 'court');
  const raf = useRef(0);
  const holdRef = useRef(hold);
  holdRef.current = hold;

  useEffect(() => {
    if (!playing || hold) return; // paused while a player card is open on top
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setT(x => {
        const nx = Math.min(endT, x + dt * speed);
        if (nx >= endT) setPlaying(false);
        return nx;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, hold]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (holdRef.current) return; if (e.key === 'Escape') close(); if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  let n = 0;
  while (n < pbp.length && pbp[n].t <= t) n++;
  const shown = pbp.slice(0, n);
  const lastEv = shown[shown.length - 1] ?? { hs: 0, as: 0 };
  const done = t >= endT;
  const { period, left } = done ? { period: pbp[pbp.length - 1].p, left: 0 } : clockOf(t);

  const maps = useMemo(() => rosterMaps([res.home.players, res.away.players].map(b => b.map((p: any) => ({ pid: p.pid, name: p.name }))), pid => lg.players[pid]?.pos ?? 'F'), [res]);

  // live box score: replay stat deltas and minutes from lineups
  const box = useMemo(() => {
    const st: Record<string, any> = {};
    const get = (pid: string) => (st[pid] ??= { min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 });
    let on = { h: [] as string[], a: [] as string[] };
    let prevT = 0;
    for (const e of shown) {
      const dt = e.t - prevT;
      if (dt > 0) for (const pid of [...on.h, ...on.a]) get(pid).min += dt / 60;
      prevT = e.t;
      if (e.d) for (const [pid, k, v] of e.d) get(pid)[k] += v;
      if (e.on) on = e.on;
    }
    const dt = Math.max(0, t - prevT);
    for (const pid of [...on.h, ...on.a]) get(pid).min += dt / 60;
    for (const b of [res.home, res.away]) for (const p of b.players) get(p.pid);
    return { st, on };
  }, [n, Math.floor(t)]);

  const shots = shown.filter(e => e.x !== undefined).slice(-24);
  const feed = shown.slice(-40).reverse();

  const lead = useMemo(() => {
    const pts: [number, number][] = [[0, 0]];
    for (const e of pbp) if (e.k === 'make2' || e.k === 'make3' || e.k === 'ft') pts.push([e.t, e.hs - e.as]);
    return pts;
  }, [pbp]);
  const maxLead = Math.max(8, ...lead.map(p => Math.abs(p[1])));
  const LW = 600, LH = 70;
  const lx = (s: number) => (s / Math.max(endT, 2880)) * LW;
  const ly = (v: number) => LH / 2 - (v / maxLead) * (LH / 2 - 4);
  const seen = lead.filter(p => p[0] <= t);
  const leadPath = seen.map((p, i) => `${i ? 'L' : 'M'}${lx(p[0]).toFixed(1)} ${ly(p[1]).toFixed(1)}`).join('') + (t > 0 ? `L${lx(t).toFixed(1)} ${ly(seen.at(-1)![1]).toFixed(1)}` : '');

  const rows = (side: 'h' | 'a') => (side === 'h' ? res.home : res.away).players
    .map((p: any) => ({ pid: p.pid, name: p.name, st: box.st[p.pid], on: box.on[side].includes(p.pid) }))
    .filter((r: any) => r.st.min > 0 || r.on)
    .sort((a: any, b: any) => Number(b.on) - Number(a.on) || b.st.min - a.st.min);

  return (
    <div className="overlay live-overlay" onClick={close}>
      <div className="live" role="dialog" aria-label="Live game" onClick={e => e.stopPropagation()}>
        <div className="scoreboard">
          <div className="sb-team away"><span className="sb-name"><span className="full">{away.name}</span><span className="abbr">{away.abbr}</span></span><span className="sb-pts">{lastEv.as}</span></div>
          <div className="sb-mid">
            <span className="sb-clock">{done ? 'Final' : mmss(left)}</span>
            <span className="sb-per">{done ? (res.ot ? `Final/${res.ot > 1 ? res.ot + 'OT' : 'OT'}` : 'Final') : periodName(period)}</span>
            {(done ? res.ser : data.before) && <span className="sb-series">{done ? res.ser : data.before}</span>}
          </div>
          <div className="sb-team home"><span className="sb-pts">{lastEv.hs}</span><span className="sb-name"><span className="full">{home.name}</span><span className="abbr">{home.abbr}</span></span></div>
        </div>
        <div className="live-controls">
          <button className="primary" onClick={() => { if (done) { setT(0); setPlaying(true); } else setPlaying(p => !p); }}>{done ? 'Watch again' : playing ? 'Pause' : 'Play'}</button>
          <div className="seg" role="group" aria-label="Speed">
            {SPEEDS.map(([v, l]) => <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>{l}</button>)}
          </div>
          <div className="seg" role="group" aria-label="View">
            <button className={view === 'court' ? 'on' : ''} onClick={() => setView('court')}>Court</button>
            <button className={view === 'arena' ? 'on' : ''} onClick={() => setView('arena')}>Arena</button>
            <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Shot chart</button>
          </div>
          <button disabled={done} onClick={() => { const nx = period < 4 ? period * 720 : period === 4 ? 2880 : 2880 + (period - 4) * 300; setT(Math.min(endT, nx)); }}>Next quarter ⏭</button>
          <button disabled={done || t >= 2580} onClick={() => { setT(Math.min(endT, 2580)); setView('arena'); }}>Last 5 min</button>
          <button onClick={() => { setT(endT); setPlaying(false); }}>To the end</button>
          <button className="ghost" onClick={close}>Close</button>
        </div>
        <div className="live-grid">
          <div className="live-left">
            {view !== 'chart' ? (
              <CourtCanvas mode={view} home={{ tid: home.tid, abbr: home.abbr }} away={{ tid: away.tid, abbr: away.abbr }} names={maps.names} sides={maps.sides} pos={maps.pos} events={pbp} upto={n} speed={Math.max(0.55, speed / 16)} />
            ) : (
              <div className="court-wrap">
                <svg viewBox="-1 -1 52 36" className="court" role="img" aria-label="Shot chart">
                  <rect x="0" y="0" width="50" height="34" className="floor" />
                  <path d="M3 0 V14 A23.75 23.75 0 0 0 47 14 V0" className="cline" />
                  <rect x="17" y="0" width="16" height="19" className="paint" />
                  <circle cx="25" cy="19" r="6" className="cline" />
                  <path d="M21 4 A4 4 0 0 0 29 4" className="cline" />
                  <line x1="22" y1="4" x2="28" y2="4" className="cline" />
                  <circle cx="25" cy="5.25" r="0.75" className="rim" />
                  {shots.map((e, i) => {
                    const made = e.k.startsWith('make');
                    const cls = `shot ${e.s === 'h' ? 'h' : 'a'} ${made ? 'made' : 'miss'} ${i === shots.length - 1 ? 'latest' : ''}`;
                    const y = Math.min(33, e.y);
                    return made ? <circle key={i} cx={e.x} cy={y} r="0.9" className={cls} /> : <g key={i} className={cls}><line x1={e.x - 0.7} y1={y - 0.7} x2={e.x + 0.7} y2={y + 0.7} /><line x1={e.x - 0.7} y1={y + 0.7} x2={e.x + 0.7} y2={y - 0.7} /></g>;
                  })}
                </svg>
                <div className="legend"><span className="k h"></span>{home.abbr} <span className="k a"></span>{away.abbr} · dot – made, cross – missed (last 24 shots)</div>
              </div>
            )}
            <div className="lead">
              <div className="lead-head"><span>{home.abbr} lead ↑</span><span>↓ {away.abbr} lead</span></div>
              <svg viewBox={`0 0 ${LW} ${LH}`} preserveAspectRatio="none" role="img" aria-label="Score margin over the game">
                <line x1="0" x2={LW} y1={LH / 2} y2={LH / 2} className="mid" />
                {[720, 1440, 2160].map(q => <line key={q} x1={lx(q)} x2={lx(q)} y1="0" y2={LH} className="qline" />)}
                <path d={leadPath} className="leadline" />
              </svg>
            </div>
            <div className="pbp">
            <h3>Play-by-play</h3>
            <ol className="feed" aria-live="polite">
              {feed.map(e => (
                <li key={pbp.indexOf(e)} className={`${e.k} ${e.s}`}>
                  <span className="fc">{e.k === 'period' || e.k === 'end' ? '' : `${periodName(e.p)} ${mmss(e.c)}`}</span>
                  <span className="ft">{fmtTxt(e.txt, home.abbr, away.abbr)}</span>
                  <span className="fs">{e.as}–{e.hs}</span>
                </li>
              ))}
            </ol>
            </div>
          </div>
          <div className="live-right">
            <BoxPair openPlayer={openPlayer} teams={[
              { label: away.name, score: lastEv.as, color: teamColor(away.tid)[0], rows: rows('a') },
              { label: home.name, score: lastEv.hs, color: teamColor(home.tid)[0], rows: rows('h') },
            ]} />
          </div>
        </div>
        <p className="note">Green dot – player on the court. The result is already recorded in the league; here you see how the game unfolded.</p>
      </div>
    </div>
  );
}
