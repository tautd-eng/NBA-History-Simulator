// @ts-nocheck
// Playoff series previews: how the teams compare, who to watch, the season
// series and a prediction (series odds from team strength and home court).
import { useMemo, useState } from 'react';
import { homeOfGame, seriesText, playoffFormat } from '../league/league';
import { shownOvr as ovrOf } from '../data';
import { teamRows } from './rankings';
import { TLogo, PFace } from './art';
import { PL, TL } from './nav';
import { injName } from '../league/injuries';

const HOME = 3;       // home court, points per 100 possessions
const SCALE = 9;      // logistic scale: 1 point of net rating ≈ 3% per game
const pGame = (diff: number) => 1 / (1 + Math.exp(-diff / SCALE));

/** Chance of every outcome from the current state: { hi wins in n: p, lo wins in n: p }. */
export function seriesOdds(s: any, powHi: number, powLo: number) {
  const need = Math.ceil(s.bestOf / 2);
  const out: Record<string, number> = {};
  const go = (hw: number, lw: number, pr: number) => {
    if (hw >= need) { out[`hi${hw + lw}`] = (out[`hi${hw + lw}`] ?? 0) + pr; return; }
    if (lw >= need) { out[`lo${hw + lw}`] = (out[`lo${hw + lw}`] ?? 0) + pr; return; }
    const g = hw + lw + 1;
    const p = pGame(powHi - powLo + (homeOfGame(s.bestOf, g) ? HOME : -HOME));
    go(hw + 1, lw, pr * p); go(hw, lw + 1, pr * (1 - p));
  };
  go(s.hw, s.lw, 1);
  const hi = Object.entries(out).filter(([k]) => k.startsWith('hi')).reduce((a, [, v]) => a + v, 0);
  const best = Object.entries(out).sort((a, b) => b[1] - a[1])[0];
  return { hi, lo: 1 - hi, out, best };
}

const roundName = (lg: any, s: any) => {
  const R = playoffFormat(lg.season, lg).bestOf.length;
  return s.conf === 'F' || s.round === R ? 'Finals' : s.round === R - 1 ? 'Conference finals' : s.round === R - 2 ? 'Conference semifinals' : 'First round';
};

function h2h(lg: any, a: string, b: string) {
  let wa = 0, wb = 0;
  for (const g of lg.schedule) {
    if (!g.done || !((g.home === a && g.away === b) || (g.home === b && g.away === a))) continue;
    const homeWon = g.hs > g.as;
    if ((g.home === a) === homeWon) wa++; else wb++;
  }
  return [wa, wb];
}

function TeamSide({ lg, tid, seed, row }: any) {
  const t = lg.teams[tid];
  const ps = t.roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  const stars = ps.filter((p: any) => !(p.injury > 0)).slice(0, 3);
  const hurt = ps.filter((p: any) => p.injury > 0 && ovrOf(p.z) >= 70);
  const per = (p: any, k: string) => (p.cur.gp ? (k === 'reb' ? (p.cur.orb + p.cur.drb) : p.cur[k]) / p.cur.gp : 0).toFixed(1);
  const rk = (k: string) => row?.[k + 'Rk'] ? <span className="dim"> ({row[k + 'Rk']})</span> : null;
  return (
    <div className="pv-side">
      <div className="pv-team"><TLogo lg={lg} tid={tid} size={34} /><div><span className="dim">({seed})</span> <b><TL tid={tid} /></b><br /><span className="dim">{t.w}–{t.l}</span></div></div>
      {row && <div className="pv-stats">
        <span>Power{rk('power')}</span><span>OVR {Math.round(row.ovr)}{rk('ovr')}</span>
        {row.ortg != null && <><span>ORtg {row.ortg.toFixed(1)}{rk('ortg')}</span><span>DRtg {row.drtg.toFixed(1)}{rk('drtg')}</span><span>Net {(row.net > 0 ? '+' : '') + row.net.toFixed(1)}{rk('net')}</span></>}
      </div>}
      <ul className="pv-players">{stars.map((p: any) => (
        <li key={p.id}><PFace lg={lg} p={p} size={24} /><span><PL pid={p.id} /> <span className="dim">{p.pos} · OVR {ovrOf(p.z)}</span><br /><span className="dim small-t">{per(p, 'pts')} pts · {per(p, 'reb')} reb · {per(p, 'ast')} ast</span></span></li>
      ))}</ul>
      {hurt.length > 0 && <p className="pv-inj">Injured: {hurt.map((p: any, i: number) => <span key={p.id}>{i ? ', ' : ''}<PL pid={p.id} /> <span className="dim">({p.inj ? injName(p.inj.k) : 'injury'}, ~{p.injury} g)</span></span>)}</p>}
    </div>
  );
}

export function SeriesPreview({ lg, s, rows }: any) {
  const byTid = useMemo(() => Object.fromEntries((rows ?? teamRows(lg).rows).map((r: any) => [r.t.tid, r])), [rows, lg, lg.day]);
  if (!s.hi || !s.lo) return null;
  const rh = byTid[s.hi], rl = byTid[s.lo];
  const odds = seriesOdds(s, rh?.power ?? 0, rl?.power ?? 0);
  const [wa, wb] = h2h(lg, s.hi, s.lo);
  const ab = (t: string) => lg.teams[t].abbr;
  const [k, p] = odds.best;
  const fav = odds.hi >= 0.5 ? s.hi : s.lo;
  const started = s.hw + s.lw > 0;
  const story = (() => {
    const gap = Math.abs(odds.hi - 0.5);
    if (s.winner) return `${ab(s.winner)} won the series ${Math.max(s.hw, s.lw)}–${Math.min(s.hw, s.lw)}.`;
    if (gap < 0.08) return 'A coin flip – these teams are close on paper and home court may decide it.';
    if (gap < 0.25) return `${ab(fav)} are favoured, but this should go deep.`;
    return `${ab(fav)} are clear favourites.`;
  })();
  return (
    <div className="pv">
      <div className="pv-head">
        <span className="eyebrow">{roundName(lg, s)}{s.conf !== 'F' ? ` · ${s.conf === 'E' ? 'East' : 'West'}` : ''} · best of {s.bestOf}</span>
        {started && <span className="chip tiny">{seriesText(lg, s)}</span>}
      </div>
      <div className="pv-grid">
        <TeamSide lg={lg} tid={s.hi} seed={s.hiSeed} row={rh} />
        <TeamSide lg={lg} tid={s.lo} seed={s.loSeed} row={rl} />
        <div className="pv-mid">
          <div className="pv-odds"><b>{Math.round(odds.hi * 100)}%</b><span className="dim">series odds</span><b>{Math.round(odds.lo * 100)}%</b></div>
          <div className="pv-bar"><span style={{ width: `${odds.hi * 100}%` }}></span></div>
          {!s.winner && <div className="dim">Most likely: <b>{ab(k.startsWith('hi') ? s.hi : s.lo)} in {k.slice(2)}</b> ({Math.round(p * 100)}%)</div>}
          <div className="dim">Season series: {wa + wb ? `${ab(s.hi)} ${wa}–${wb}` : 'did not meet'}</div>
          <div className="dim">Home court: {ab(s.hi)}</div>
        </div>
      </div>
      <p className="note">{story}</p>
    </div>
  );
}

/** Previews for the round being played (and the next one once it is set). */
export function PlayoffPreviews({ lg }: any) {
  const rows = useMemo(() => teamRows(lg).rows, [lg, lg.day, lg.phase]);
  const [i, setI] = useState(0);
  const live = lg.series.filter((s: any) => s.hi && s.lo);
  if (!live.length) return null;
  const open = live.filter((s: any) => !s.winner);
  const round = open.length ? Math.min(...open.map((s: any) => s.round)) : Math.max(...live.map((s: any) => s.round));
  const list = live.filter((s: any) => s.round === round);
  const cur = list[Math.min(i, list.length - 1)];
  return (
    <div className="panel">
      <div className="team-head">
        <h2>Series previews</h2>
        <span className="dim">{roundName(lg, list[0])}</span>
      </div>
      <div className="seg pv-tabs" role="group" aria-label="Series">
        {list.map((s: any, k: number) => <button key={k} className={cur === s ? 'on' : ''} onClick={() => setI(k)}>{lg.teams[s.hi].abbr}–{lg.teams[s.lo].abbr}{s.winner ? ' ✓' : ''}</button>)}
      </div>
      {cur && <SeriesPreview lg={lg} s={cur} rows={rows} />}
    </div>
  );
}
