// @ts-nocheck
// Result of a finished game: line score by quarter and both box scores.
import { useEffect, useRef } from 'react';
import { BoxPair } from './court';
import { colorsOf } from './art';

export function GameModal({ lg, res, close, openPlayer, hold }: any) {
  const holdRef = useRef(hold);
  holdRef.current = hold;
  useEffect(() => {
    const k = (e: KeyboardEvent) => !holdRef.current && e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const home = lg.teams[res.home.tid], away = lg.teams[res.away.tid];
  const rows = (b: any) => b.players.filter((p: any) => p.st.min > 0).map((p: any) => ({ pid: p.pid, name: p.name + (p.hurt ? ' ✚' : ''), st: p.st, on: false })).sort((a: any, c: any) => Number(c.starter) - Number(a.starter) || c.st.min - a.st.min);
  const n = Math.max(res.home.q.length, res.away.q.length);
  const qn = (i: number) => (i < 4 ? `${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`);
  const label = res.po ? 'Playoffs' : `Regular season, day ${res.day + 1}`;
  return (
    <div className="overlay live-overlay" onClick={close}>
      <div className="live gamebox" role="dialog" aria-label="Box score" onClick={e => e.stopPropagation()}>
        <div className="scoreboard">
          <div className="sb-team away"><span className="sb-name"><span className="full">{away.name}</span><span className="abbr">{away.abbr}</span></span><span className="sb-pts">{res.away.pts}</span></div>
          <div className="sb-mid"><span className="sb-clock">Final</span><span className="sb-per">{res.season - 1}–{String(res.season).slice(2)} · {label}</span>{res.ser && <span className="sb-series">{res.ser}</span>}</div>
          <div className="sb-team home"><span className="sb-pts">{res.home.pts}</span><span className="sb-name"><span className="full">{home.name}</span><span className="abbr">{home.abbr}</span></span></div>
        </div>
        <div className="live-controls">
          <div className="tbl-wrap">
            <table className="qtable light">
              <thead><tr><th></th>{Array.from({ length: n }, (_, i) => <th key={i}>{qn(i)}</th>)}<th>Total</th></tr></thead>
              <tbody>
                <tr><td>{away.abbr}</td>{res.away.q.map((v: number, i: number) => <td key={i}>{v}</td>)}<td><b>{res.away.pts}</b></td></tr>
                <tr><td>{home.abbr}</td>{res.home.q.map((v: number, i: number) => <td key={i}>{v}</td>)}<td><b>{res.home.pts}</b></td></tr>
              </tbody>
            </table>
          </div>
          <button className="ghost" onClick={close}>Close</button>
        </div>
        <BoxPair openPlayer={openPlayer} teams={[
          { label: away.name, score: res.away.pts, color: colorsOf(away.tid, away.abbr)[0], rows: rows(res.away) },
          { label: home.name, score: res.home.pts, color: colorsOf(home.tid, home.abbr)[0], rows: rows(res.home) },
        ]} />
      </div>
    </div>
  );
}
