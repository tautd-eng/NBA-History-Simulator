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
    // material for the team-by-team write-up
    const xf = ps.filter((p: any) => p !== star && p !== second && ageIn(p, S) <= 23).sort(byB)[0];
    const extra = {
      core: ps.slice(0, 3).map((p: any) => ({ id: p.id, n: p.name, o: ovrOf(p.z) })),
      added: arr.map((p: any) => ({ id: p.id, n: p.name, o: ovrOf(p.z), from: lg.teams[prevTid(p)]?.abbr ?? '?' })),
      lost: lost.map((p: any) => ({ id: p.id, n: p.name, o: ovrOf(p.z), to: p.retired ? 'retired' : p.tid ? lg.teams[p.tid].abbr : 'FA' })),
      rook: rook ? { id: rook.id, n: rook.name, pick: rook.draft.pick } : null,
      xf: xf ? { id: xf.id, n: xf.name, o: ovrOf(xf.z), age: ageIn(xf, S) } : null,
      mode: t.mode ?? null, strat: t.strategy ?? null, age: Math.round(age * 10) / 10, oR, dR, depthR: depthRank[i], fit,
      allWhy: why.map(x => ({ t: x.t, good: x.good })),
    };
    return { tid: t.tid, conf: t.conf, wp, w: Math.round(wp * G), l: G - Math.round(wp * G), why: why.slice(0, 4), lastW: ls?.w, lastL: ls?.l, ...extra };
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
  // (a preview made by an older version has no team write-ups: early in the season it is simply made again)
  const old = lg.preview && lg.preview.season === lg.season && !lg.preview.rows[0]?.core && lg.phase === 'regular' && (lg.day ?? 0) < 10;
  if (!lg.preview || lg.preview.season !== lg.season || old) lg.preview = makePreview(lg);
  return lg.preview;
}

const ORD = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const pickOf = (key: string, xs: string[]) => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0; return xs[Math.abs(h) % xs.length]; };
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** A pundit's paragraph about one team, built from the projection and the reasons behind it. */
function teamBlurb(lg: any, r: any, confRank: number, nConf: number, S: number) {
  const name = lg.teams[r.tid].name, key = r.tid + S;
  const tier = confRank <= 2 ? 'contender' : confRank <= 6 ? 'playoff' : confRank <= 10 ? 'playin' : 'lottery';
  const conf = r.conf === 'E' ? 'East' : r.conf === 'W' ? 'West' : 'league';
  const out: string[] = [];
  out.push(pickOf(key + 'a', ({
    contender: [`The ${name} start the year as a genuine title threat`, `Few teams have a better case than the ${name}`, `The ${name} are built to play in June`],
    playoff: [`The ${name} look like a solid playoff team`, `The ${name} should be playing in late April`, `Expect the ${name} in the playoff picture`],
    playin: [`The ${name} sit right on the play-in line`, `It could go either way for the ${name}`, `The ${name} are a coin flip for the postseason`],
    lottery: [`It looks like a long winter for the ${name}`, `The ${name} are headed for the lottery`, `Ping-pong balls are the likelier prize for the ${name}`],
  } as any)[tier]) + ` – projected ${r.w}–${r.l}, ${ORD(confRank)} in the ${conf}.`);
  const c = r.core ?? [];
  if (c.length >= 2) {
    const sup = `${c[1].n} (${c[1].o})${c[2] ? ` and ${c[2].n} (${c[2].o})` : ''}`;
    out.push(pickOf(key + 'c', [
      `Everything runs through ${c[0].n} (${c[0].o}), with ${sup} in support.`,
      `${c[0].n} (${c[0].o}) is the engine; ${sup} ${c[2] ? 'are' : 'is'} next in line.`,
      `It starts with ${c[0].n} (${c[0].o}) – ${sup} ${c[2] ? 'complete' : 'completes'} the core.`,
    ]));
  }
  const adds = r.added ?? [], lost = r.lost ?? [];
  if (adds.length || lost.length || r.rook) {
    const bits: string[] = [];
    if (adds.length) bits.push(`added ${adds.map((p: any) => `${p.n} from ${p.from}`).join(' and ')}`);
    if (lost.length) bits.push(`lost ${lost.map((p: any) => `${p.n} (${p.to === 'retired' ? 'retired' : p.to === 'FA' ? 'still a free agent' : 'to ' + p.to})`).join(' and ')}`);
    if (r.rook) bits.push(`drafted ${r.rook.n} at No. ${r.rook.pick}`);
    out.push(`Over the summer they ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`);
  }
  const why = r.allWhy ?? r.why ?? [];
  const good = why.find((x: any) => x.good && !/^Added|^Rookie|^Defending|^Reached|^Built|^Led|^Two stars|one of the/.test(x.t));
  const bad = why.find((x: any) => !x.good && !/^Lost/.test(x.t));
  if (good) out.push(`${pickOf(key + 'g', ['The strength:', 'What works:', 'Reason for hope:'])} ${lc(good.t)}.`);
  if (bad) out.push(`${pickOf(key + 'b', ['The worry:', 'The question mark:', 'What could go wrong:'])} ${lc(bad.t)}.`);
  if (r.mode === 'tank') out.push('The front office is playing for the draft – veterans could be moved before the deadline.');
  else if (r.mode === 'allin') out.push('Management has pushed its chips in: expect them to buy at the deadline.');
  else if (r.mode === 'rising') out.push('A young core is growing up – patience is the plan.');
  const pl = lg.teams[r.tid]?.plan;
  if (pl && pl.s === lg.season && r.tid !== lg.userTid) {
    if (pl.ownFirst === null && (tier === 'lottery' || tier === 'playin')) out.push('Their own first-round pick belongs to someone else, so losing buys nothing – they will try to win now.');
    else if (r.mode !== 'allin' && pl.stage === 'push' && pl.act) out.push('The front office thinks it is one piece away and is ready to spend picks to get it.');
    else if (r.mode !== 'tank' && pl.tankOk && pl.classStrong > 0.25 && tier === 'lottery') out.push('A strong draft class is coming, and they own their pick – a lottery finish would not be the worst outcome.');
  }
  if (r.xf && !c.some((p: any) => p.id === r.xf.id)) out.push(`X-factor: ${r.xf.n} (${r.xf.age}, ${r.xf.o}) – ${pickOf(key + 'x', r.xf.o >= 78
    ? ['already part of the rotation and still getting better', 'one more step from him and this team looks different', 'young, already useful, and nowhere near his ceiling']
    : ['a leap from him would change the outlook', 'worth watching: the minutes are there for him', 'raw, but the upside is real'])}.`);
  else if (r.xf) out.push(`Only ${r.xf.age}, ${r.xf.n} is still getting better – a big reason for optimism.`);
  return out.join(' ');
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
      {pv.rows[0]?.core && <>
        <h3>Team by team</h3>
        {confs.map((c: string) => (
          <div key={c} className="sp-teams">
            {confs.length > 1 && <h4>{c === 'E' ? 'Eastern Conference' : 'Western Conference'}</h4>}
            {pv.rows.filter((r: any) => r.conf === c).map((r: any, i: number, arr: any[]) => (
              <div key={r.tid} className={`sp-team ${r.tid === lg.userTid ? 'mine' : ''}`}>
                <div className="sp-head"><TLogo lg={lg} tid={r.tid} size={22} /><b><TL tid={r.tid} /></b><span className="dim">proj. {r.w}–{r.l}{!early && cur(r.tid) ? ` · now ${cur(r.tid)}` : ''} · title {pct(r.odds)}</span></div>
                <p>{teamBlurb(lg, r, i + 1, arr.length, pv.season)}</p>
              </div>
            ))}
          </div>
        ))}
      </>}
      <p className="note">Projection from the rosters before the season{last ? '' : ' (first season of the league – no previous record)'}. Hover a team in the table for the reasons.</p>
    </details>
  );
}
