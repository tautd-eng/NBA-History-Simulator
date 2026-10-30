// @ts-nocheck
// Season preview: projected records, title favourites and the reasons behind them. Made once before the
// season (stored in the league) so it can be checked against what happened.
import { useState } from 'react';
import { teamStrength } from '../ai/value';
import { rosterFit } from '../archetypes';
import { bpmOf, shownOvr as ovrOf } from '../data';
import { seasonGames, activeTeams } from '../league/league';
import { ageIn } from '../players';
import { TLogo } from './art';
import { PL, TL } from './nav';
import { offRating, defRating } from './rankings';

const short = (n: string) => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };

/** Builds the projection for the current season. */
export function makePreview(lg: any) {
  const ts = activeTeams(lg);
  const G = seasonGames(lg);
  const S = lg.season;
  const str = ts.map(t => teamStrength(lg, t.tid));
  const mean = str.reduce((a, b) => a + b, 0) / str.length;
  const byB = (a: any, b: any) => bpmOf(b.z) - bpmOf(a.z);
  const last = lg.history.find((h: any) => h.season === S - 1);
  const allPlayers = Object.values(lg.players) as any[];
  const leagueTop = allPlayers.filter(p => p.tid && !p.retired).sort(byB);
  const rankOf = new Map(leagueTop.map((p, i) => [p.id, i + 1]));
  const prevTid = (p: any) => { const r = p.career.filter((c: any) => c.s === S - 1 && !c.po); return r.length ? r[r.length - 1].tid : null; };
  // bench depth: players 6–8 of each team
  const depth = ts.map(t => { const ps = t.roster.map((id: string) => lg.players[id]).sort(byB); return ps.slice(5, 8).reduce((a: number, p: any) => a + bpmOf(p.z), 0) / 3; });
  const depthRank = depth.map(d => 1 + depth.filter(x => x > d).length);
  // the starting fives' offensive and defensive skill, ranked
  const five = (t: any) => t.roster.map((id: string) => lg.players[id]).sort(byB).slice(0, 5);
  const offV = ts.map(t => five(t).reduce((a: number, p: any) => a + offRating(p), 0)), defV = ts.map(t => five(t).reduce((a: number, p: any) => a + defRating(p), 0));
  const rnk = (arr: number[], i: number) => 1 + arr.filter(x => x > arr[i]).length;

  const rows = ts.map((t, i) => {
    const ps = t.roster.map((id: string) => lg.players[id]).sort(byB);
    const fit = rosterFit(ps);
    const wp = Math.max(0.12, Math.min(0.88, 0.5 + 0.0245 * (str[i] - mean) + 0.1 * fit));
    const why: { w: number; t: string; good: boolean }[] = [];
    const star = ps[0], second = ps[1];
    const rk = rankOf.get(star?.id) ?? 99;
    const two = second && (rankOf.get(second.id) ?? 99) <= 20;
    const tag = (p: any) => `${p.name} (${ovrOf(p.z)})`;
    if (star && rk <= 5) why.push({ w: 9 - rk, good: true, t: `${tag(star)} – one of the ${rk <= 2 ? 'two' : 'five'} best players in the league${two ? `, with ${tag(second)} beside him` : ''}` });
    else if (star && two) why.push({ w: 5, good: true, t: `Two stars: ${tag(star)} and ${tag(second)}` });
    else if (star && rk <= 15) why.push({ w: 3, good: true, t: `Built around ${tag(star)}` });
    if (star && rk > 15 && !two) why.push({ w: 2.5, good: true, t: `Led by ${tag(star)}${second ? ` and ${tag(second)}` : ''}` });
    const oR = rnk(offV, i), dR = rnk(defV, i);
    if (oR <= 3) why.push({ w: 3.5, good: true, t: `One of the most skilled offensive starting fives (No. ${oR})` });
    else if (oR > ts.length - 3) why.push({ w: 2.5, good: false, t: 'Where do the points come from? A bottom-three offensive five' });
    if (dR <= 3) why.push({ w: 3.5, good: true, t: `Defence travels: a top-three defensive starting five` });
    else if (dR > ts.length - 3) why.push({ w: 2.5, good: false, t: 'Leaky defence – a bottom-three defensive five' });
    if (!star || rk > 40) why.push({ w: 4, good: false, t: 'No star to lean on in close games' });
    if (depthRank[i] <= 3) why.push({ w: 4, good: true, t: 'One of the deepest benches in the league' });
    else if (depthRank[i] > ts.length - 3) why.push({ w: 3, good: false, t: 'Thin bench – one injury away from trouble' });
    // summer moves
    const arr = ps.filter((p: any) => { const pt = prevTid(p); return pt && pt !== t.tid; }).filter((p: any) => ovrOf(p.z) >= 82).slice(0, 2);
    for (const p of arr) why.push({ w: 3 + (ovrOf(p.z) - 82) / 3, good: true, t: `Added ${p.name} (${ovrOf(p.z)}) from ${lg.teams[prevTid(p)]?.abbr ?? '?'}` });
    const rook = ps.find((p: any) => p.draft?.year === S - 1 && ovrOf(p.z) >= 78 && !prevTid(p));
    if (rook) why.push({ w: 2, good: true, t: `Rookie ${rook.name} (No. ${rook.draft.pick} pick) should help right away` });
    const lost = allPlayers.filter(p => prevTid(p) === t.tid && p.tid !== t.tid && ovrOf(p.z) >= 85).sort(byB).slice(0, 2);
    for (const p of lost) why.push({ w: 3 + (ovrOf(p.z) - 85) / 3, good: false, t: `Lost ${p.name} (${p.retired ? 'retired' : p.tid ? 'to ' + lg.teams[p.tid].abbr : 'free agent'})` });
    // last season
    const ls = last?.standings.find((x: any) => x.tid === t.tid);
    if (last?.champion === t.tid) why.push({ w: 6, good: true, t: 'Defending champions' });
    else if (last?.runnerUp === t.tid) why.push({ w: 3, good: true, t: 'Reached the Finals last season' });
    if (ls) { const lw = ls.w / Math.max(1, ls.w + ls.l); const d = (wp - lw) * G; if (Math.abs(d) >= 8) why.push({ w: 3 + Math.abs(d) / 6, good: d > 0, t: d > 0 ? `Should be much better than last season's ${ls.w}–${ls.l}` : `Unlikely to repeat last season's ${ls.w}–${ls.l}` }); }
    // how the pieces fit (a pundit's eye, no numbers)
    if (fit > 0.3) why.push({ w: 3, good: true, t: 'The roles fit: shooting, playmaking and defence in the right places' });
    else if (fit < -0.35) why.push({ w: 3, good: false, t: 'Questions about fit – a lot of similar pieces' });
    // age and health
    const top8 = ps.slice(0, 8);
    const age = top8.reduce((a: number, p: any) => a + ageIn(p, S), 0) / Math.max(1, top8.length);
    if (age >= 30.5) why.push({ w: 2.5, good: false, t: `Veteran rotation (avg age ${age.toFixed(1)}) – can the legs hold up?` });
    else if (age <= 24.3) why.push({ w: 2.5, good: true, t: `Young rotation (avg age ${age.toFixed(1)}) – should improve as the season goes` });
    const hurt = top8.filter((p: any) => p.injury >= 10).slice(0, 1);
    for (const p of hurt) why.push({ w: 4, good: false, t: `${p.name} starts the season injured (out ~${p.injury} games)` });
    why.sort((a, b) => b.w - a.w);
    return { tid: t.tid, conf: t.conf, wp, w: Math.round(wp * G), l: G - Math.round(wp * G), why: why.slice(0, 4), lastW: ls?.w, lastL: ls?.l };
  });
  // title odds: stronger teams win series far more often than their win% suggests
  const ex = rows.map(r => Math.exp(0.42 * (r.wp - 0.5) / 0.0245));
  const tot = ex.reduce((a, b) => a + b, 0);
  rows.forEach((r, i) => (r.odds = ex[i] / tot));
  rows.sort((a, b) => b.wp - a.wp);
  return { season: S, day: lg.day ?? 0, G, rows };
}

export function ensurePreview(lg: any) {
  if (lg.phase !== 'regular' && lg.phase !== 'playoffs') return null;
  if (!lg.preview || lg.preview.season !== lg.season) lg.preview = makePreview(lg);
  return lg.preview;
}

function Why({ r }: any) {
  return <ul className="sp-why">{r.why.map((x: any, i: number) => <li key={i} className={x.good ? 'good' : 'bad'}>{x.good ? '+' : '−'} {x.t}</li>)}</ul>;
}

export function SeasonPreview({ lg, openTeam }: any) {
  const [openSt, setOpen] = useState<boolean | null>(null);
  const pv = ensurePreview(lg);
  if (!pv) return null;
  const played = activeTeams(lg).reduce((a: number, t: any) => a + t.w + t.l, 0) / Math.max(1, activeTeams(lg).length);
  const early = played < pv.G * 0.12;
  const open = openSt ?? early;
  const fav = pv.rows.slice(0, 5);
  const last = lg.history.find((h: any) => h.season === pv.season - 1);
  const lastW = (r: any) => (r.lastW != null ? r.lastW / Math.max(1, r.lastW + r.lastL) : null);
  const dark = pv.rows.slice(5).filter((r: any) => lastW(r) != null).sort((a: any, b: any) => (b.wp - lastW(b)) - (a.wp - lastW(a)))[0];
  const drop = pv.rows.filter((r: any) => lastW(r) != null && lastW(r) > 0.55).sort((a: any, b: any) => (a.wp - lastW(a)) - (b.wp - lastW(b)))[0];
  const confs = [...new Set(pv.rows.map((r: any) => r.conf))].sort();
  const pct = (x: number) => (x >= 0.995 ? '>99%' : x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
  const cur = (tid: string) => { const t = lg.teams[tid]; return t.w + t.l ? `${t.w}–${t.l}` : ''; };
  return (
    <details className="panel season-preview" open={open} onToggle={(e: any) => setOpen(e.target.open)}>
      <summary><h2>{pv.season - 1}–{String(pv.season).slice(2)} season preview</h2>{!early && <span className="dim"> – how the preseason picks look now</span>}</summary>
      <h3>Title favourites</h3>
      <div className="sp-favs">
        {fav.map((r: any, i: number) => (
          <div key={r.tid} className="sp-fav">
            <div className="sp-head">
              <span className="sp-rank">{i + 1}</span>
              <TLogo lg={lg} tid={r.tid} size={28} />
              <b><TL tid={r.tid} /></b>
              <span className="dim">proj. {r.w}–{r.l}{!early && cur(r.tid) ? ` · now ${cur(r.tid)}` : ''}</span>
              <span className="sp-odds" title="Chance to win the title">{pct(r.odds)}</span>
            </div>
            <Why r={r} />
          </div>
        ))}
      </div>
      <div className="sp-extra">
        {dark && <div><h3>Dark horse: <TL tid={dark.tid} /></h3><p className="dim">{dark.lastW}–{dark.lastL} last season, projected {dark.w}–{dark.l}.</p><Why r={dark} /></div>}
        {drop && drop.tid !== dark?.tid && <div><h3>Could disappoint: <TL tid={drop.tid} /></h3><p className="dim">{drop.lastW}–{drop.lastL} last season, projected {drop.w}–{drop.l}.</p><Why r={drop} /></div>}
      </div>
      <h3>Projected standings</h3>
      <div className="sp-confs">
        {confs.map((c: string) => (
          <table key={c} className="tbl compact">
            <caption>{confs.length > 1 ? (c === 'E' ? 'East' : 'West') : 'League'}</caption>
            <thead><tr><th>#</th><th className="l">Team</th><th>Proj.</th>{!early && <th>Now</th>}<th title="Chance to win the title">Title</th></tr></thead>
            <tbody>{pv.rows.filter((r: any) => r.conf === c).map((r: any, i: number) => (
              <tr key={r.tid} className={r.tid === lg.userTid ? 'mine' : ''} title={r.why.map((x: any) => (x.good ? '+ ' : '− ') + x.t).join('\n')}>
                <td>{i + 1}</td><td className="l"><TL tid={r.tid} /></td><td>{r.w}–{r.l}</td>{!early && <td>{cur(r.tid)}</td>}<td>{pct(r.odds)}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}
      </div>
      <p className="note">Projection from the rosters before the season{last ? '' : ' (first season of the league – no previous record)'}. Hover a team in the table for the reasons.</p>
    </details>
  );
}
