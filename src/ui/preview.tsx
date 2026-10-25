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

export function SeriesPreview({ lg, s, rows, openGame }: any) {
  const byTid = useMemo(() => Object.fromEntries((rows ?? teamRows(lg).rows).map((r: any) => [r.t.tid, r])), [rows, lg, lg.day]);
  if (!s.hi || !s.lo) return null;
  const rh = byTid[s.hi], rl = byTid[s.lo];
  const odds = seriesOdds(s, rh?.power ?? 0, rl?.power ?? 0);
  const [wa, wb] = h2h(lg, s.hi, s.lo);
  const ab = (t: string) => lg.teams[t].abbr;
  const [k, p] = odds.best;
  const fav = odds.hi >= 0.5 ? s.hi : s.lo;
  const started = s.hw + s.lw > 0;
  const story = useMemo(() => seriesStory(lg, s, rh, rl, odds, wa, wb), [lg, lg.day, s, s.hw, s.lw, rh, rl]);
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
      <div className="pv-story">{story.map((t: string, i: number) => <p key={i}>{i === 0 ? <b>{t}</b> : t}</p>)}</div>
      <SeriesGames lg={lg} s={s} openGame={openGame} />
    </div>
  );
}

/** Game by game: results so far in the series (tap for the box score). */
export function SeriesGames({ lg, s, openGame }: any) {
  const games = (s.games ?? []).map((id: number) => lg.recent.find((r: any) => r.id === id)).filter(Boolean);
  if (!games.length) return null;
  const ab = (t: string) => lg.teams[t]?.abbr ?? t;
  let hw = 0, lw = 0;
  return (
    <div className="pv-games">
      <b className="dim">Series so far</b>
      <ol>{games.map((r: any, i: number) => {
        const homeWon = r.home.pts > r.away.pts;
        const win = homeWon ? r.home.tid : r.away.tid;
        if (win === s.hi) hw++; else lw++;
        const st = hw === lw ? `tied ${hw}–${lw}` : `${ab(hw > lw ? s.hi : s.lo)} ${Math.max(hw, lw)}–${Math.min(hw, lw)}`;
        return (
          <li key={r.id}>
            <span className="dim">G{i + 1}</span>{' '}
            {openGame ? <button className="link" onClick={() => openGame(r.id)}>{ab(r.away.tid)} {r.away.pts} @ {ab(r.home.tid)} {r.home.pts}{r.ot ? ` (${r.ot > 1 ? r.ot + 'OT' : 'OT'})` : ''}</button> : <span>{ab(r.away.tid)} {r.away.pts} @ {ab(r.home.tid)} {r.home.pts}</span>}
            {' '}<span className="dim">· {ab(win)} win · {st}</span>
          </li>
        );
      })}</ol>
    </div>
  );
}

/** A series in a dialog: preview, odds and every game so far. */
export function SeriesDialog({ lg, s, close, openGame }: any) {
  return (
    <div className="overlay center" onClick={close}>
      <div className="dialog pv-dialog" role="dialog" aria-label="Series" onClick={e => e.stopPropagation()}>
        <SeriesPreview lg={lg} s={s} openGame={openGame ? (id: number) => { close(); openGame(id); } : undefined} />
        <div className="dialog-actions"><button className="ghost" onClick={close}>Close</button></div>
      </div>
    </div>
  );
}

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const short = (n: string) => n.split(' ').slice(1).join(' ') || n;

/** Last n regular-season results of a team: wins, games. */
function form(lg: any, tid: string, n = 10) {
  const gs = lg.schedule.filter((g: any) => g.done && (g.home === tid || g.away === tid)).sort((a: any, b: any) => b.day - a.day).slice(0, n);
  const w = gs.filter((g: any) => (g.home === tid) === (g.hs > g.as)).length;
  return { w, g: gs.length };
}

/** A written preview: the headline, how the teams match up, the star duel, form, injuries and a pick. */
function seriesStory(lg: any, s: any, rh: any, rl: any, odds: any, wa: number, wb: number): string[] {
  const T = (tid: string) => lg.teams[tid];
  const nm = (tid: string) => T(tid).name, ab = (tid: string) => T(tid).abbr;
  const n = Object.values(lg.teams).filter((t: any) => t.active).length;
  const out: string[] = [];
  const fav = odds.hi >= 0.5 ? s.hi : s.lo, dog = fav === s.hi ? s.lo : s.hi;
  const pf = Math.max(odds.hi, odds.lo);
  const [k] = odds.best;
  const pickT = k.startsWith('hi') ? s.hi : s.lo, pickN = k.slice(2);
  // headline
  if (s.winner) {
    const lo = s.winner === s.hi ? s.lo : s.hi;
    const upset = (s.winner === s.lo && s.loSeed > s.hiSeed);
    out.push(`${nm(s.winner)} beat ${nm(lo)} ${Math.max(s.hw, s.lw)}–${Math.min(s.hw, s.lw)}${upset ? ' – an upset' : ''}.`);
  } else if (s.hw + s.lw > 0) {
    const lead = s.hw === s.lw ? null : s.hw > s.lw ? s.hi : s.lo;
    const need = Math.ceil(s.bestOf / 2);
    out.push(lead ? `${nm(lead)} lead ${Math.max(s.hw, s.lw)}–${Math.min(s.hw, s.lw)}${Math.max(s.hw, s.lw) === need - 1 ? ` – one win from the next round` : ''}.` : `All square at ${s.hw}–${s.lw}.`);
  } else if (pf < 0.58) out.push(`A coin flip: ${nm(s.hi)} and ${nm(s.lo)} are as close as it gets on paper.`);
  else if (pf < 0.75) out.push(`${nm(fav)} are favoured, but ${nm(dog)} have the tools to make it a long series.`);
  else out.push(`${nm(fav)} are clear favourites against ${nm(dog)}.`);
  out.push('¶');
  // how they match up: offence against defence
  if (rh && rl && rh.ortg != null) {
    const desc = (r: any, tid: string) => {
      const bits: string[] = [];
      if (r.ortgRk <= 3) bits.push(`the league's ${r.ortgRk === 1 ? 'best' : ord(r.ortgRk)} offence`);
      if (r.drtgRk <= 3) bits.push(`the ${r.drtgRk === 1 ? 'best' : ord(r.drtgRk) + '-best'} defence`);
      if (r.ortgRk > n - 3) bits.push('a struggling offence');
      if (r.drtgRk > n - 3) bits.push('a leaky defence');
      return bits.length ? `${ab(tid)} bring ${bits.join(' and ')}` : null;
    };
    const dh = desc(rh, s.hi), dl = desc(rl, s.lo);
    const m: string[] = [dh, dl].filter(Boolean) as string[];
    if (m.length) out.push(m.join('; ') + '.');
    // the key clash: the better offence against the other side's defence
    const [o, d] = rh.ortgRk <= rl.ortgRk ? [rh, rl] : [rl, rh];
    const oT = o === rh ? s.hi : s.lo, dT = o === rh ? s.lo : s.hi;
    const dd = d.drtgRk;
    out.push(dd <= 8 ? `The key clash: ${ab(oT)}'s ${ord(o.ortgRk)}-ranked attack (${o.ortg.toFixed(1)}) against a ${ab(dT)} defence ranked ${ord(dd)} (${d.drtg.toFixed(1)}).`
      : `${ab(oT)} should score: their ${ord(o.ortgRk)}-ranked attack meets a ${ab(dT)} defence that is only ${ord(dd)} in the league.`);
  }
  out.push('¶');
  // stars
  const top = (tid: string) => T(tid).roster.map((pid: string) => lg.players[pid]).filter((p: any) => !(p.injury > 0)).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  const th = top(s.hi), tl = top(s.lo);
  const per = (p: any) => { const c = p.cur; if (!c.gp) return ''; const pts = c.pts / c.gp, reb = (c.orb + c.drb) / c.gp, ast = c.ast / c.gp; const parts = [`${pts.toFixed(1)} pts`]; if (reb >= 8) parts.push(`${reb.toFixed(1)} reb`); if (ast >= 6) parts.push(`${ast.toFixed(1)} ast`); return ` (${parts.join(', ')})`; };
  if (th[0] && tl[0]) {
    out.push(`The marquee duel: ${th[0].name}${per(th[0])} against ${tl[0].name}${per(tl[0])}.`);
    const stars = (xs: any[]) => xs.filter(p => ovrOf(p.z) >= 85).length;
    const sh = stars(th), sl2 = stars(tl);
    if (sh >= 2 && sl2 <= 1) out.push(`${ab(s.hi)} have more star power – ${th.slice(0, sh).map(p => short(p.name)).join(', ')} can each take over a game.`);
    else if (sl2 >= 2 && sh <= 1) out.push(`${ab(s.lo)} have more star power – ${tl.slice(0, sl2).map(p => short(p.name)).join(', ')} can each take over a game.`);
    const depth = (xs: any[]) => xs.slice(5, 9).reduce((a, p) => a + ovrOf(p.z), 0) / Math.max(1, Math.min(4, xs.length - 5));
    const dH = depth(th), dL = depth(tl);
    if (Math.abs(dH - dL) >= 3) out.push(`The bench favours ${ab(dH > dL ? s.hi : s.lo)}, who can keep the pressure on when the starters rest.`);
  }
  // form and the regular season meetings
  const fh = form(lg, s.hi), fl = form(lg, s.lo);
  if (fh.g >= 8 && fl.g >= 8) {
    const hot = (f: any) => f.w >= 7 ? 'hot' : f.w <= 3 ? 'cold' : null;
    const bits = [[s.hi, fh], [s.lo, fl]].filter(([, f]: any) => hot(f)).map(([t, f]: any) => `${ab(t)} come in ${hot(f)} (${f.w}–${f.g - f.w} in their last ${f.g})`);
    if (bits.length) out.push(bits.join(', ') + '.');
  }
  if (wa + wb > 0) out.push(wa === wb ? `They split the season series ${wa}–${wb}.` : `${ab(wa > wb ? s.hi : s.lo)} won the season series ${Math.max(wa, wb)}–${Math.min(wa, wb)}${Math.min(wa, wb) === 0 && Math.max(wa, wb) >= 2 ? ' without a loss' : ''}.`);
  // injuries
  const hurt = (tid: string) => T(tid).roster.map((pid: string) => lg.players[pid]).filter((p: any) => p.injury > 0 && ovrOf(p.z) >= 52).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  for (const tid of [s.hi, s.lo]) {
    const h = hurt(tid);
    const left = s.bestOf - s.hw - s.lw;
    if (h.length) out.push(`${ab(tid)} are without ${h.slice(0, 2).map((p: any) => `${p.name} (~${p.injury} g${p.injury >= left ? ', likely out for the series' : ''})`).join(' and ')}.`);
  }
  // home court and the pick
  if (!s.winner) {
    out.push('¶');
    out.push(`${ab(s.hi)} have home court: a deciding Game ${s.bestOf} would be played in their building.`);
    out.push(`Prediction: ${ab(pickT)} in ${pickN}.`);
  }
  // sentences → paragraphs (the first is the headline)
  const paras: string[] = [];
  let cur: string[] = [];
  for (const x of out) { if (x === '¶') { if (cur.length) paras.push(cur.join(' ')); cur = []; } else cur.push(x); }
  if (cur.length) paras.push(cur.join(' '));
  return paras;
}

/** Previews for the round being played (and the next one once it is set). */
export function PlayoffPreviews({ lg, openGame }: any) {
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
      {cur && <SeriesPreview lg={lg} s={cur} rows={rows} openGame={openGame} />}
    </div>
  );
}

