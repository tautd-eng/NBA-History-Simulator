// @ts-nocheck
// Shared pieces for the game viewers: the pixel court canvas and box scores of both teams.
import { useEffect, useRef } from 'react';
import { PixelCourt, posNumOf } from './pixel';
import { nav } from './nav';
import { faceOf } from './art';
import { hash01 } from '../rng';
import { shownOvr } from '../data';
import { GOGGLES } from '../looksdb';

/** Sprite looks (skin, hair, jersey number) from each player's generated face. */
function looksFor(names: Record<string, string>) {
  const lg = nav.lg, out: Record<string, any> = {};
  const used: Record<string, Set<number>> = {};
  for (const pid of Object.keys(names)) {
    const p = lg?.players?.[pid];
    if (!p) continue;
    const f = faceOf(p, lg.season);
    const team = p.tid ?? '';
    const u = (used[team] ??= new Set());
    let num = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 40, 41, 42, 44, 45, 50, 52, 55][Math.floor(hash01(pid + 'num') * 36)];
    while (u.has(num)) num = (num + 1) % 56;
    u.add(num);
    // body and gear: bigger frames for big men; tube socks in the early years, sleeves and coloured shoes later
    const h = (k: string) => hash01(pid + k);
    const pn = ({ PG: 1, SG: 2, G: 1.5, SF: 3, F: 3.5, PF: 4, C: 5 } as any)[p.pos] ?? 3;
    const era = lg.season;
    const build = Math.max(0, Math.min(1, (pn - 1) / 4 * 0.7 + h('b') * 0.35));
    const socks = era < 1992 ? '#f4f4f4' : h('s') < (era >= 2010 ? 0.45 : 0.25) ? '#1c1c1c' : '#f4f4f4';
    const sockH = era < 1988 ? 12 : era < 2000 ? 7 : h('sh') < 0.5 ? 9 : 5;
    const shoe = era < 1995 ? (h('sc') < 0.85 ? '#f4f4f4' : '#202020') : h('sc') < 0.45 ? '#f4f4f4' : h('sc') < 0.8 ? '#1c1c1c' : ['#d23a2a', '#2a62d2', '#f2c230', '#30b060'][Math.floor(h('scc') * 4)];
    const sleeve = era >= 2003 && h('sl') < 0.18 ? (h('sls') < 0.5 ? 1 : -1) : 0;
    out[pid] = { skin: f.skin, hair: f.hair, hairColor: f.hairColor, facial: f.facial, band: f.band, num, ht: p.ht ?? 79, build, socks, sockH, shoe, sleeve, knee: pn >= 4 && h('k') < 0.3, tat: era >= 1998 && h('tt') < (era >= 2010 ? 0.5 : 0.3) ? (h('tt2') < 0.45 ? 2 : 1) : 0, goggles: GOGGLES.has(pid) || h('gg') < 0.012, legSleeve: era >= 2008 && h('ls') < 0.12 ? (h('ls2') < 0.5 ? 1 : -1) : 0, wrist: h('w') < (era < 1995 ? 0.35 : 0.2), ovr: shownOvr(p.z), tz: p.z?.[4] ?? 0, az: p.z?.[7] ?? 0, ath: Math.max(0, Math.min(1, 0.5 + (p.z?.[3] ?? 0) * 0.15 + (p.z?.[0] ?? 0) * 0.1 - Math.max(0, (p.ht ?? 79) - 82) * 0.04)) };
  }
  return out;
}

/**
 * The pixel court. Live viewer: pass `v` (broadcast time from the timeline). Clutch mode: pass `upto`
 * (events to play) and the court plays forward on its own at `speed`, calling onIdle when it catches up.
 */
export function CourtCanvas({ home, away, names, sides, pos, events, v, upto, speed = 1, onIdle, onShown, mode = 'classic', replays = true }: any) {
  const ref = useRef<HTMLCanvasElement>(null);
  const court = useRef<PixelCourt | null>(null);
  const idle = useRef(onIdle);
  idle.current = onIdle;
  const shown = useRef(onShown);
  shown.current = onShown;

  useEffect(() => {
    const season = nav.lg?.season ?? 2000;
    const c = new PixelCourt(ref.current!, { home, away, names, side: sides, pos, style: mode, looks: looksFor(names), orbReset: season >= 2019 ? 14 : 24, season, homeName: nav.lg?.teams?.[home.tid]?.name });
    court.current = c;
    (window as any).__court = c; // handy for debugging the director from the console
    c.onIdle = () => idle.current?.();
    c.onShown = (n: number) => shown.current?.(n);
    c.speed = speed;
    if (upto == null) c.ext = v ?? 0;
    c.setEvents(events);
    if (upto != null) c.setUpto(upto);
    try { (document as any).fonts?.load?.('8px "Silkscreen"'); } catch { /* font optional */ }
    c.start();
    return () => c.stop();
  }, [home.tid, away.tid]);

  useEffect(() => { const c = court.current; if (c && c.tl && (c.tl.evs !== events || c.tl.items.length !== events.length)) c.setEvents(events); }, [events, events.length]);
  useEffect(() => { const c = court.current; if (c && upto != null) { if (c.tl?.items.length !== events.length) c.setEvents(events); c.setUpto(upto); } }, [upto]);
  useEffect(() => { if (court.current && upto == null) court.current.ext = v ?? 0; }, [v]);
  useEffect(() => { if (court.current) court.current.speed = speed; }, [speed]);
  useEffect(() => { if (court.current) { court.current.replays = replays; if (!replays) court.current.pending = null; } }, [replays]);
  useEffect(() => { court.current?.setStyle(mode, looksFor(names)); }, [mode]);

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
