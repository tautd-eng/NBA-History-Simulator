// @ts-nocheck
// Shared pieces for the game viewers: the pixel court canvas and box scores of both teams.
import { useEffect, useRef } from 'react';
import { PixelCourt, posNumOf } from './pixel';

export function CourtCanvas({ home, away, names, sides, pos, events, upto, speed = 1, onIdle, lineups, offense }: any) {
  const ref = useRef<HTMLCanvasElement>(null);
  const court = useRef<PixelCourt | null>(null);
  const pushed = useRef(0);
  const idle = useRef(onIdle);
  idle.current = onIdle;

  useEffect(() => {
    const c = new PixelCourt(ref.current!, { home, away, names, side: sides, pos });
    court.current = c;
    c.onIdle = () => idle.current?.();
    if (lineups) { c.setLineups(lineups.h, lineups.a, true); c.formation(offense ?? 'h', true); }
    pushed.current = lineups ? upto : 0;
    if (!lineups) c.push(events.slice(0, upto));
    try { (document as any).fonts?.load?.('8px "Silkscreen"'); } catch { /* font optional */ }
    c.start();
    return () => c.stop();
  }, [home.tid, away.tid]);

  useEffect(() => {
    const c = court.current;
    if (!c) return;
    if (upto < pushed.current) {
      // replay from the start
      c.players.clear(); c.queue = []; c.anim = null;
      pushed.current = 0;
    }
    if (upto > pushed.current) { c.push(events.slice(pushed.current, upto)); pushed.current = upto; }
  }, [upto, events]);

  useEffect(() => { if (court.current) court.current.speed = speed; }, [speed]);

  return <canvas ref={ref} className="pixel-court" aria-label="Court" />;
}

export function rosterMaps(boxes: { pid: string; name: string; pos?: string }[][], posOf: (pid: string) => string) {
  const names: Record<string, string> = {}, sides: Record<string, string> = {}, pos: Record<string, number> = {};
  boxes.forEach((b, i) => b.forEach(p => { names[p.pid] = p.name; sides[p.pid] = i === 0 ? 'h' : 'a'; pos[p.pid] = posNumOf(p.pos ?? posOf(p.pid)); }));
  return { names, sides, pos };
}

const short = (n: string) => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };

/** Box scores for both teams at once. rows: { pid, name, st, on? } */
export function BoxPair({ teams, openPlayer }: any) {
  return (
    <div className="box-pair">
      {teams.map((t: any) => {
        const tot = t.rows.reduce((a: any, r: any) => { for (const k of ['pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf']) a[k] = (a[k] ?? 0) + (r.st[k] ?? 0); return a; }, {});
        return (
          <div key={t.label} className="tbl-wrap">
            <table className="tbl box compact">
              <caption><span className="swatch" style={{ background: t.color }}></span>{t.label} <b>{t.score}</b></caption>
              <thead><tr><th className="l">Player</th><th>Min</th><th>Pts</th><th>FG</th><th>3P</th><th>FT</th><th>Reb</th><th>Ast</th><th>Stl</th><th>Blk</th><th>PF</th></tr></thead>
              <tbody>
                {t.rows.map((r: any) => (
                  <tr key={r.pid} className={r.on ? 'oncourt' : r.st.min > 0 ? '' : 'bench'}>
                    <td className="l">{r.on && <span className="dot-on" aria-label="on court"></span>}<button className="link" onClick={() => openPlayer?.(r.pid)}>{short(r.name)}</button></td>
                    <td>{Math.floor(r.st.min)}</td><td><b>{r.st.pts}</b></td><td>{r.st.fgm}-{r.st.fga}</td><td>{r.st.tpm}-{r.st.tpa}</td><td>{r.st.ftm}-{r.st.fta}</td>
                    <td>{r.st.orb + r.st.drb}</td><td>{r.st.ast}</td><td>{r.st.stl}</td><td>{r.st.blk}</td><td className={r.st.pf >= 5 ? 'neg' : ''}>{r.st.pf}</td>
                  </tr>
                ))}
                <tr className="tot"><td className="l">Total</td><td></td><td><b>{tot.pts}</b></td><td>{tot.fgm}-{tot.fga}</td><td>{tot.tpm}-{tot.tpa}</td><td>{tot.ftm}-{tot.fta}</td><td>{tot.orb + tot.drb}</td><td>{tot.ast}</td><td>{tot.stl}</td><td>{tot.blk}</td><td>{tot.pf}</td></tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export const fmtTxt = (txt: string, home: string, away: string) => txt.replace('{h}', home).replace('{a}', away).replace('Home', home).replace('Away', away);
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const periodName = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
