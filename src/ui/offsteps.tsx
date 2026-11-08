// @ts-nocheck
// The offseason, step by step: a bar showing where the league is (season recap → retirements →
// development → expansion draft → lottery → draft → contract decisions → free agency → season preview →
// new season), and the screens of the steps that have no room of their own elsewhere.
import { useState } from 'react';
import { PL, TL } from './nav';
import { shownOvr as ovrOf, seasonInfo, H, histShown, LAST_SEASON } from '../data';
import { ageIn } from '../players';
import { offStep, offRetire, offDevelop, unretire, initDraft } from '../league/offseason';
import { SortTable } from './sorttable';
import { injName } from '../league/injuries';
import { posNum } from '../engine/game';

const seasonLabel = (s: number) => `${s - 1}–${String(s).slice(2)}`;
const top = () => { try { window.scrollTo({ top: 0 }); } catch { /* */ } };

/** Where the league is in the year: the steps and the current one. */
export function stepsOf(lg: any) {
  const nextHasNew = lg.season + 1 <= 2100 && Object.keys(seasonInfo(lg.season + 1)?.teams ?? {}).some(t => !lg.teams[t]);
  const d = lg.draftDay && lg.draftDay.year === lg.season ? lg.draftDay : null;
  const lastD = lg.draftDay && lg.draftDay.year === (lg.phase === 'freeagency' || (lg.phase === 'regular' && lg.previewOpen === lg.season) ? lg.season - 1 : lg.season) ? lg.draftDay : null;
  const exp = (lastD?.newTeams?.length ?? 0) > 0 || (lg.phase === 'draft' && !d && nextHasNew);
  const steps = [
    { k: 'recap', t: 'Season recap' },
    { k: 'retire', t: 'Retirements' },
    { k: 'dev', t: 'Development' },
    ...(exp ? [{ k: 'expansion', t: 'Expansion draft' }] : []),
    { k: 'lottery', t: 'Lottery' },
    { k: 'draft', t: 'Draft' },
    { k: 'decisions', t: 'Options & decisions' },
    { k: 'fa', t: 'Free agency' },
    { k: 'preview', t: 'Season preview' },
  ];
  let cur = '';
  if (lg.phase === 'draft') {
    const st = offStep(lg);
    if (st !== 'draft') cur = st;
    else if (!d) cur = exp ? 'expansion' : 'lottery';
    else cur = d.done ? 'draft' : (d.stage ?? 'draft');
  } else if (lg.phase === 'freeagency' || lg.phase === 'offseason') cur = !lg.fa || lg.fa.stage === 0 || (lg.fa.stage === 1 && !lg.fa.sumSeen) ? 'decisions' : 'fa';
  else if (lg.phase === 'regular' && lg.previewOpen === lg.season) cur = 'preview';
  return { steps, cur };
}

export function StepBar({ lg }: any) {
  const { steps, cur } = stepsOf(lg);
  if (!cur) return null;
  const i = steps.findIndex(s => s.k === cur);
  return (
    <ol className="stepbar" aria-label="Offseason steps">
      {steps.map((s, k) => <li key={s.k} className={k === i ? 'on' : k < i ? 'past' : ''}><span className="n">{k + 1}</span>{s.t}</li>)}
      <li className={''}><span className="n">{steps.length + 1}</span>New season</li>
    </ol>
  );
}

// ---------------------------------------------------------------- 1) season recap
export function RecapStep({ lg, onChange, children }: any) {
  const last = lg.history[lg.history.length - 1];
  const fin = last?.bracket?.series?.filter((x: any) => x.winner).sort((a: any, b: any) => b.round - a.round)[0];
  return (
    <div className="col">
      <div className="panel accent step-head">
        <div className="team-head">
          <h2>The {seasonLabel(lg.season)} season is over</h2>
          <button className="primary" onClick={() => { offRetire(lg); onChange(); top(); }}>Start the offseason →</button>
        </div>
        {last && <p className="lead"><b><TL tid={last.champion} /></b> are the champions{fin ? <> – they beat the <TL tid={fin.winner === fin.hi ? fin.lo : fin.hi} /> {Math.max(fin.hw, fin.lw)}–{Math.min(fin.hw, fin.lw)} in the Finals</> : ''}.{last.fmvp ? <> Finals MVP: <PL pid={last.fmvp} />.</> : null}</p>}
        <p className="note">Next: retirements, then player development over the summer, the draft, contract decisions and free agency – one step at a time.</p>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- 2) retirements
const WHY: Record<string, string> = { age: 'Age and decline', history: 'His real career ended here', unsigned: 'No team wanted him' };

/**
 * A whole career: his real NBA seasons before this league began plus his seasons in this league –
 * years, teams, totals, peak, honors, and how it compares with what really happened.
 */
export function careerSummary(lg: any, p: any) {
  const start = lg.start ?? lg.history?.[0]?.season ?? lg.season;
  const hp = H.players[p.id];
  const realPre = (hp?.s ?? []).filter((r: any) => r[0] < start && !(p.shift));
  const reg = p.career.filter((c: any) => !c.po);
  let gp = 0, pts = 0, reb = 0, ast = 0;
  const seasons = new Set<number>(), path: string[] = [];
  let peak = 0;
  const tops: number[] = [];
  for (const r of realPre) {
    const g = r[2]; gp += g; pts += r[4] * g; reb += r[5] * g; ast += r[6] * g; seasons.add(r[0]);
    if (path[path.length - 1] !== r[1]) path.push(r[1]);
    if (r[3] >= 500) { const o = ovrOf(r[7]); peak = Math.max(peak, o); tops.push(o); }
  }
  for (const c of reg) {
    gp += c.gp; pts += c.pts; reb += c.orb + c.drb; ast += c.ast; seasons.add(c.s);
    if (c.tid && path[path.length - 1] !== c.tid) path.push(c.tid);
  }
  const played = new Set(reg.filter((c: any) => c.min >= 500).map((c: any) => c.s));
  for (const h of p.ovrHist ?? []) { const o = histShown(h); peak = Math.max(peak, o); if (played.has(h[0])) tops.push(o); }
  // real titles before this league (the team he finished the season with won it)
  const lastTeam: Record<number, string> = {};
  for (const r of realPre) lastTeam[r[0]] = r[1];
  const realRings = Object.entries(lastTeam).filter(([y, t]) => H.champions?.[y] === t).length;
  tops.sort((a, b) => b - a);
  const best5 = tops.slice(0, 5); while (best5.length < 5) best5.push(70);
  const ys = [...seasons].sort((a, b) => a - b);
  const aw = p.awards ?? [];
  const lastReal = hp?.s?.length ? hp.s[hp.s.length - 1][0] : undefined;
  return {
    first: ys[0], last: ys[ys.length - 1], n: ys.length, gp, path, peak,
    ppg: gp ? pts / gp : 0, rpg: gp ? reb / gp : 0, apg: gp ? ast / gp : 0, pts: Math.round(pts),
    rings: aw.filter((a: string) => /Champion$/.test(a)).length + realRings,
    mvp: aw.filter((a: string) => /\bMVP$/.test(a) && !/Finals/.test(a)).length,
    allLg: aw.filter((a: string) => /All-League/.test(a)).length,
    avg5: best5.reduce((a, b) => a + b, 0) / 5,
    hof: !!hp?.hof, realPre: realPre.length ? new Set(realPre.map((r: any) => r[0])).size : 0, lastReal,
  };
}
// ---------------------------------------------------------------- Hall of Fame
/** Hall of Fame threshold: fitted on real careers that fit inside the data (1981–2019) – it lets in about the real Hall's share. */
export const HOF_LINE = 34;
/** A career's Hall of Fame case: peak, a run of great seasons, longevity, points, and this league's honors. */
export function hofScore(c: any) {
  return Math.max(0, c.peak - 84) * 1.2 + Math.max(0, c.avg5 - 80) * 1.5 + c.n * 0.4 + c.pts / 2500
    + c.mvp * 8 + c.allLg * 2.5 + c.rings * 1.5 + (c.hof ? 10 : 0);
}
/** Is this retired player in the Hall of Fame (by his career, or put in by hand)? */
export function hofStatus(lg: any, p: any): { in: boolean; manual: boolean; score: number; c: any } {
  const c = careerSummary(lg, p);
  const score = hofScore(c);
  const manual = (lg.hofManual ?? []).includes(p.id);
  // a Hall of Famer in reality goes in when he retires here too
  return { in: !!p.retired && (manual || c.hof || score >= HOF_LINE), manual, score, c };
}
export function hofInduct(lg: any, pid: string, on = true) {
  const m = new Set<string>(lg.hofManual ?? []);
  if (on) m.add(pid); else m.delete(pid);
  lg.hofManual = [...m];
}

// ---------------------------------------------------------------- retired jerseys
/**
 * What a player meant to each team he played for: seasons there (real seasons before this league count),
 * how good he was there, and the titles, MVPs and All-League teams he won there.
 */
export function tenures(lg: any, p: any) {
  const start = lg.start ?? lg.history?.[0]?.season ?? lg.season;
  const hp = H.players[p.id];
  const by: Record<string, { tid: string; seasons: Set<number>; good: number; best: number; gp: number; pts: number; rings: number; mvp: number; allLg: number }> = {};
  const at = (tid: string) => (by[tid] ??= { tid, seasons: new Set(), good: 0, best: 0, gp: 0, pts: 0, rings: 0, mvp: 0, allLg: 0 });
  const teamOf: Record<number, string> = {};
  for (const r of (hp?.s ?? []).filter((r: any) => r[0] < start && !p.shift)) {
    const t = at(r[1]); const o = r[3] >= 500 ? ovrOf(r[7]) : 0;
    if (!t.seasons.has(r[0])) t.good += Math.max(0, o - 80);
    t.seasons.add(r[0]); t.best = Math.max(t.best, o); t.gp += r[2]; t.pts += r[4] * r[2]; teamOf[r[0]] = r[1];
  }
  for (const c of p.career.filter((c: any) => !c.po && c.tid)) {
    const t = at(c.tid); const h = (p.ovrHist ?? []).find((x: any) => x[0] === c.s); const o = h && c.min >= 500 ? histShown(h) : 0;
    if (!t.seasons.has(c.s)) t.good += Math.max(0, o - 80);
    t.seasons.add(c.s); t.best = Math.max(t.best, o); t.gp += c.gp; t.pts += c.pts; teamOf[c.s] = c.tid;
  }
  for (const [y, t] of Object.entries(teamOf)) if (+y < start && H.champions?.[y] === t && by[t]) by[t].rings++;
  // a title or award goes to the team he finished that season with (the playoff line if he made it)
  for (const c of p.career.filter((c: any) => c.po && c.tid)) teamOf[c.s] = c.tid;
  for (const a of p.awards ?? []) {
    const m = /^(\d{4}) (.*)$/.exec(a); if (!m) continue;
    const t = teamOf[+m[1]]; if (!t || !by[t]) continue;
    if (/Champion$/.test(m[2])) by[t].rings++;
    else if (m[2] === 'MVP') by[t].mvp++;
    else if (/^All-League/.test(m[2])) by[t].allLg++;
  }
  return Object.values(by).map(t => ({ ...t, n: t.seasons.size, score: t.seasons.size * 0.8 + t.good * 0.5 + t.rings * 3 + t.mvp * 8 + t.allLg * 2 }));
}
/** A team retires a jersey for a long, great run with it (a franchise icon), or by hand. */
export const JERSEY_LINE = 25;
export function jerseysOf(lg: any, p: any) {
  const man = (lg.jerseyManual ?? []).filter((x: any) => x.pid === p.id).map((x: any) => x.tid);
  const auto = (t: any) => (t.n >= 4 && t.score >= JERSEY_LINE) || (t.n >= 8 && t.score >= JERSEY_LINE - 4);
  return tenures(lg, p).filter(t => auto(t) || man.includes(t.tid)).map(t => ({ ...t, manual: man.includes(t.tid) && !auto(t) }));
}
export function jerseyRetire(lg: any, pid: string, tid: string, on = true) {
  const m = (lg.jerseyManual ?? []).filter((x: any) => !(x.pid === pid && x.tid === tid));
  if (on) m.push({ pid, tid });
  lg.jerseyManual = m;
}
const teamName = (lg: any, t: string) => lg.teams[t]?.name ?? t;
/** Why he is in: the strongest parts of his case, in words. */
export function hofWhy(c: any) {
  const b: string[] = [];
  if (c.mvp) b.push(`${c.mvp}× MVP`);
  if (c.rings) b.push(`${c.rings}× champion`);
  if (c.allLg) b.push(`${c.allLg}× All-League`);
  if (c.peak >= 90) b.push(`peaked at ${c.peak} OVR`);
  if (c.avg5 >= 86) b.push(`five seasons at ~${Math.round(c.avg5)}`);
  if (c.n >= 15) b.push(`${c.n} seasons`);
  if (c.pts >= 20000) b.push(`${Math.round(c.pts / 1000)}k points`);
  if (c.hof) b.unshift('a Hall of Famer in reality');
  return b.length ? b.join(', ') : `career score ${Math.round(hofScore(c))}`;
}
export const jerseyWhy = (t: any) => [`${t.n} seasons`, t.best ? `best ${t.best} OVR there` : '', t.rings ? `${t.rings}× champion there` : '', t.mvp ? `${t.mvp}× MVP there` : '', t.allLg ? `${t.allLg}× All-League there` : ''].filter(Boolean).join(', ');

/**
 * Hall of Fame and retired jerseys for a set of retired players: who got in and why, who just missed –
 * with buttons to put a player in the Hall (or have a team retire his jersey) by hand.
 */
export function HonorsPanel({ lg, pids, title, note, onChange, openPlayer, showBallot = true, team, head }: any) {
  const [, setT] = useState(0);
  const bump = () => { setT(x => x + 1); onChange?.(); };
  const ps = pids.map((id: string) => lg.players[id]).filter((p: any) => p?.retired);
  const st = ps.map((p: any) => ({ p, ...hofStatus(lg, p), jer: jerseysOf(lg, p), ten: tenures(lg, p) })).sort((a: any, b: any) => b.score - a.score);
  const inn = st.filter((x: any) => x.in);
  const ballot = showBallot ? st.filter((x: any) => !x.in && x.score >= HOF_LINE - 12).slice(0, 12) : [];
  const jer = st.flatMap((x: any) => x.jer.filter((t: any) => !team || t.tid === team).map((t: any) => ({ ...x, t })));
  const jerNear = showBallot ? st.flatMap((x: any) => x.ten.filter((t: any) => (!team || t.tid === team) && t.n >= 3 && t.score >= JERSEY_LINE - 8 && !x.jer.some((j: any) => j.tid === t.tid)).map((t: any) => ({ ...x, t }))).slice(0, 10) : [];
  const nm = (p: any) => <button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>;
  // by hand: any retired player into the Hall, any team retiring his jersey
  const [addP, setAddP] = useState('');
  const [jerP, setJerP] = useState('');
  const [jerT, setJerT] = useState('');
  const outs = st.filter((x: any) => !x.in);
  const jp = st.find((x: any) => x.p.id === jerP);
  const manual = showBallot && (
    <div className="def-row hof-manual">
      <span className="dim">By hand:</span>
      <select className="small-sel" aria-label="Player to induct" value={addP} onChange={e => setAddP(e.target.value)}>
        <option value="">Induct a player…</option>
        {outs.slice(0, 300).map((x: any) => <option key={x.p.id} value={x.p.id}>{x.p.name} ({Math.round(x.score)})</option>)}
      </select>
      <button className="small" disabled={!addP} onClick={() => { hofInduct(lg, addP, true); setAddP(''); bump(); }}>Induct</button>
      <select className="small-sel" aria-label="Player whose jersey to retire" value={jerP} onChange={e => { setJerP(e.target.value); setJerT(''); }}>
        <option value="">Retire a jersey…</option>
        {st.slice(0, 300).map((x: any) => <option key={x.p.id} value={x.p.id}>{x.p.name}</option>)}
      </select>
      {jp && <select className="small-sel" aria-label="Team" value={jerT} onChange={e => setJerT(e.target.value)}>
        <option value="">team…</option>
        {jp.ten.filter((t: any) => !jp.jer.some((j: any) => j.tid === t.tid)).map((t: any) => <option key={t.tid} value={t.tid}>{teamName(lg, t.tid)} ({t.n} seasons)</option>)}
      </select>}
      <button className="small" disabled={!jerP || !jerT} onClick={() => { jerseyRetire(lg, jerP, jerT, true); setJerP(''); setJerT(''); bump(); }}>Retire jersey</button>
    </div>
  );
  return (
    <div className="panel">
      <div className="team-head"><h2>{title}</h2>{head}</div>
      {note && <p className="note">{note}</p>}
      {manual}
      <div className="grid-2 honors">
        <section>
          <h3>Hall of Fame</h3>
          {inn.length ? <ul className="news">{inn.map((x: any) => (
            <li key={x.p.id}><span className="yr">🏛</span><span>{nm(x.p)} <span className="dim">class of {x.p.retired}{x.manual ? ' · put in by you' : ''}</span><br /><span className="small-t">{hofWhy(x.c)}.</span>
              {x.manual && <> <button className="small ghost" onClick={() => { hofInduct(lg, x.p.id, false); bump(); }}>Remove</button></>}</span></li>
          ))}</ul> : <p className="note">Nobody gets in this time.</p>}
          {ballot.length > 0 && <>
            <h3>Close, but not in</h3>
            <ul className="news">{ballot.map((x: any) => (
              <li key={x.p.id}><span className="yr dim">{Math.round(x.score)}</span><span>{nm(x.p)} <span className="dim small-t">{hofWhy(x.c)} · needs {HOF_LINE}</span> <button className="small" onClick={() => { hofInduct(lg, x.p.id, true); bump(); }}>Induct</button></span></li>
            ))}</ul>
          </>}
        </section>
        <section>
          <h3>Retired jerseys</h3>
          {jer.length ? <ul className="news">{jer.map((x: any) => (
            <li key={x.p.id + x.t.tid}><span className="yr">{lg.teams[x.t.tid] ? <TL tid={x.t.tid} abbr /> : x.t.tid}</span><span>{nm(x.p)} <span className="dim">– the {teamName(lg, x.t.tid)} retire his jersey{x.t.manual ? ' (by you)' : ''}</span><br /><span className="small-t">{jerseyWhy(x.t)}.</span>
              {x.t.manual && <> <button className="small ghost" onClick={() => { jerseyRetire(lg, x.p.id, x.t.tid, false); bump(); }}>Undo</button></>}</span></li>
          ))}</ul> : <p className="note">No jerseys retired this time.</p>}
          {jerNear.length > 0 && <>
            <h3>Could have their jerseys retired</h3>
            <ul className="news">{jerNear.map((x: any) => (
              <li key={x.p.id + x.t.tid}><span className="yr dim">{lg.teams[x.t.tid]?.abbr ?? x.t.tid}</span><span>{nm(x.p)} <span className="dim small-t">{jerseyWhy(x.t)}</span> <button className="small" onClick={() => { jerseyRetire(lg, x.p.id, x.t.tid, true); bump(); }}>Retire jersey</button></span></li>
            ))}</ul>
          </>}
        </section>
      </div>
    </div>
  );
}

/** How his exit compares with history. */
export function vsReality(c: any, Y: number) {
  if (c.lastReal === undefined) return 'not a real player';
  if (c.lastReal >= LAST_SEASON) return `his real career was still going when the data ends (${LAST_SEASON - 1}–${String(LAST_SEASON).slice(2)})`;
  if (c.lastReal === Y) return 'same year as in reality';
  if (c.lastReal > Y) return `in reality played on through ${c.lastReal - 1}–${String(c.lastReal).slice(2)} (${c.lastReal - Y} more)`;
  return `outlasted his real career (ended ${c.lastReal - 1}–${String(c.lastReal).slice(2)})`;
}
const teamTag = (lg: any, t: string) => lg.teams[t] ? <TL tid={t} abbr /> : <span>{t}</span>;

export function RetireStep({ lg, onChange, openPlayer }: any) {
  const [msg, setMsg] = useState<string | null>(null);
  const o = lg.off;
  const Y = lg.season;
  const rows = (o?.ret ?? []).map((r: any) => ({ ...r, key: r.pid, p: lg.players[r.pid] })).filter((r: any) => r.p).map((r: any) => ({ ...r, c: careerSummary(lg, r.p) }));
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><button className="link" onClick={() => openPlayer(r.pid)}>{v}</button>{r.c.hof ? <span className="chip tiny" title="In the Hall of Fame in reality">HOF</span> : null}<br /><span className="dim small-t">{r.p.pos} · {r.tid ? <>last with {teamTag(lg, r.tid)}</> : 'free agent'}</span></> },
    { key: 'age', label: 'Age', get: (r: any) => r.age },
    { key: 'ovr', label: 'OVR', title: 'Overall in his last season', get: (r: any) => r.ovr, fmt: (v: any) => <span className={`ovr ${v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low'} sm`}>{v}</span> },
    { key: 'rk', label: 'Pos. rank', title: 'Where he ranked at his position (guards / forwards / centers) in the league – a top-20 player at his position does not retire (only past 40)', get: (r: any) => r.rk ?? 999, fmt: (v: any, r: any) => v < 999 ? <span className="dim">No. {v} {['G', 'F', 'C'][(x => x <= 2.5 ? 0 : x >= 4.5 ? 2 : 1)(posNum(r.p.pos))]}</span> : '–' },
    { key: 'peak', label: 'Peak', title: 'Best overall of his career (real seasons before this league included)', get: (r: any) => r.c.peak },
    { key: 'yrs', label: 'Career', left: true, get: (r: any) => r.c.n, fmt: (_: any, r: any) => <>{r.c.first ? `${r.c.first - 1}–${String(r.c.last).slice(2)}` : '–'} <span className="dim">· {r.c.n} seasons</span><br /><span className="dim small-t">{r.c.path.map((t: string, i: number) => <span key={i}>{i ? ' → ' : ''}{teamTag(lg, t)}</span>)}</span></> },
    { key: 'gp', label: 'GP', get: (r: any) => r.c.gp },
    { key: 'ppg', label: 'PPG', get: (r: any) => r.c.ppg, fmt: (v: any) => v.toFixed(1) },
    { key: 'rpg', label: 'RPG', get: (r: any) => r.c.rpg, fmt: (v: any) => v.toFixed(1) },
    { key: 'apg', label: 'APG', get: (r: any) => r.c.apg, fmt: (v: any) => v.toFixed(1) },
    { key: 'hon', label: 'Honors', left: true, get: (r: any) => r.c.rings * 100 + r.c.mvp * 10 + r.c.allLg, fmt: (_: any, r: any) => <span className="dim small-t">{[r.c.rings ? `🏆 ${r.c.rings}` : '', r.c.mvp ? `${r.c.mvp}× MVP` : '', r.c.allLg ? `${r.c.allLg}× All-League` : ''].filter(Boolean).join(' · ') || '–'}</span> },
    { key: 'why', label: 'Why / history', left: true, get: (r: any) => r.why, fmt: (v: any, r: any) => <>{WHY[v] ?? v}{r.p.injury > 0 ? <span className="neg"> · injured ({r.p.injury} games left)</span> : null}<br /><span className="dim small-t">{vsReality(r.c, Y)}</span></> },
    { key: 'act', label: '', get: (r: any) => (r.undone ? 2 : r.back ? 1 : 0), fmt: (_: any, r: any) => r.undone ? <span className="chip tiny">coming back</span> : r.back ? <button className="small" onClick={() => { const x = unretire(lg, r.pid); setMsg(x.msg); onChange(); }}>Talk him out of it</button> : <span className="dim small-t">final</span> },
  ];
  const mine = rows.filter((r: any) => r.tid && r.tid === lg.userTid);
  const legends = rows.filter((r: any) => r.c.hof || r.c.mvp || r.c.peak >= 90).sort((a: any, b: any) => b.c.peak - a.c.peak).slice(0, 4);
  const start = lg.start ?? lg.history?.[0]?.season;
  return (
    <div className="col">
      <div className="panel accent step-head">
        <div className="team-head">
          <h2>Retirements · summer {Y}</h2>
          <button className="primary" onClick={() => { offDevelop(lg); onChange(); top(); }}>Continue to player development →</button>
        </div>
        <p className="note">{rows.length} players have announced their retirement. Some of them could still play and would listen if asked – “Talk him out of it” brings him back for another season (to his team if it has room and he is under contract, otherwise to free agency). Once development starts, the decisions are final.</p>
        {mine.length > 0 && <p className="hint">From your team: {mine.map((r: any) => r.p.name).join(', ')}.</p>}
        {msg && <p className="hint" role="status">{msg}</p>}
      </div>
      {legends.length > 0 && (
        <div className="ret-legends">
          {legends.map((r: any) => (
            <div key={r.pid} className="panel ret-card">
              <div className="eyebrow">{r.c.hof ? 'Hall of Famer' : r.c.mvp ? 'MVP' : 'Star'} calls it a career</div>
              <h3><button className="link" onClick={() => openPlayer(r.pid)}>{r.p.name}</button></h3>
              <p className="small-t">{r.c.first - 1}–{String(r.c.last).slice(2)} · {r.c.n} seasons · {r.c.path.map((t: string, i: number) => <span key={i}>{i ? ' → ' : ''}{teamTag(lg, t)}</span>)}</p>
              <p className="ret-nums"><b>{r.c.ppg.toFixed(1)}</b> PPG <b>{r.c.rpg.toFixed(1)}</b> RPG <b>{r.c.apg.toFixed(1)}</b> APG · {r.c.pts.toLocaleString()} points</p>
              <p className="dim small-t">Peak OVR {r.c.peak}{r.c.rings ? ` · 🏆 ${r.c.rings}` : ''}{r.c.mvp ? ` · ${r.c.mvp}× MVP` : ''} · {vsReality(r.c, Y)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="panel">
        {rows.length ? <SortTable cols={cols} rows={rows} initial="peak" limit={200} rowClass={(r: any) => (r.tid && r.tid === lg.userTid ? 'mine' : r.undone ? 'dim' : '')} /> : <p className="note">Nobody retired this summer.</p>}
        <p className="note">Career numbers include his real NBA seasons before this league began{start ? ` (${start - 1}–${String(start).slice(2)})` : ''} and every season in this league. Peak – his best overall. The last line under “Why” compares the exit with his real career.</p>
      </div>
      <HonorsPanel lg={lg} pids={rows.filter((r: any) => !r.undone).map((r: any) => r.pid)} title="Hall of Fame & retired jerseys" onChange={onChange} openPlayer={openPlayer}
        note={`The Hall weighs a career: peak, a run of great seasons, longevity, points and honors (MVPs, titles, All-League) – about the share of players the real Hall lets in; real Hall of Famers go in automatically. A team retires a jersey for a long, great run with it (4+ seasons). You can put anyone in by hand.`} />
    </div>
  );
}

// ---------------------------------------------------------------- 3) development
const sg = (x: number) => (x > 0 ? `+${x}` : `${x}`);
/** One sentence on what moved a player this summer (from the causes recorded by the development step). */
export function devReason(lg: any, p: any, S: number): string {
  const w = p.devWhy;
  if (!w || w.s !== S) return '';
  const age = ageIn(p, S); // (the age shown next to his name)
  const parts: { v: number; t: string }[] = [];
  const add = (v: number, t: string) => { if (Math.abs(v) >= 1) parts.push({ v, t: `${t} (${sg(v)})` }); };
  const inj = (p.injHist ?? []).filter((h: any) => h.s === S - 1 && h.lasting);
  add(w.inj, inj.length ? `a ${injName(inj[inj.length - 1].k)} took a lasting toll` : 'lost ground during the season');
  add(w.perf, w.perf > 0 ? 'a strong season – he played above his rating' : w.flop ? 'a poor season' : 'played below his rating');
  add(w.trend, w.trend > 0 ? (age <= 24 ? `natural growth at ${age}` : `still improving at ${age}`) : age >= 30 ? `age decline at ${age}` : `development stalled at ${age}`);
  add(w.luck, w.luck > 0 ? 'a productive summer of work' : 'an off summer');
  add(w.cap, w.cap > 0 ? 'young-player protection limited the drop' : 'one summer can only move him so far');
  add(w.destiny, 'pulled toward his real career');
  add(w.league ?? 0, 'league-wide recalibration');
  parts.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  let txt = parts.slice(0, 3).map(x => x.t).join('; ');
  if (!txt) txt = w.dz && age <= 25 ? 'played about at his level – no penalty for a young player' : 'little changed';
  else if (w.dz && age <= 25 && Math.abs(w.perf) < 1) txt += '; played about at his level (no penalty at his age)';
  return txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
}

export function DevStep({ lg, onChange, children }: any) {
  const hasNew = Object.keys(seasonInfo(lg.season + 1)?.teams ?? {}).some(t => !lg.teams[t]);
  return (
    <div className="col">
      <div className="panel accent step-head">
        <div className="team-head">
          <h2>Player development · summer {lg.season}</h2>
          <button className="primary" onClick={() => { initDraft(lg); onChange(); top(); }}>Continue to {hasNew ? 'the expansion draft' : 'the draft lottery'} →</button>
        </div>
        <p className="note">Every player changed over the summer: age, potential, last season's play, injuries and some luck. Each line says what moved him most.</p>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- 7) contract decisions, league-wide
export function DecisionsBoard({ lg, openPlayer }: any) {
  const [all, setAll] = useState(false);
  const fa = lg.fa;
  const N = lg.season;
  const KIND = (x: any) => {
    const d = x.desc ?? '';
    if (x.kind === 'option') return /team exercised|you exercised/.test(d) ? 'Team option picked up' : /team declined|you declined/.test(d) ? 'Team option declined' : /declined his player option/.test(d) ? 'Opted out' : /exercised his player option/.test(d) ? 'Opted in' : d;
    return x.kind === 'resign' ? 'Re-signed' : x.kind === 'qo' ? 'Qualifying offer' : x.kind === 'leave' ? 'Let go' : x.kind;
  };
  const rows = (fa?.log ?? []).filter((x: any) => x.st === 0 && x.pid && lg.players[x.pid] && ['option', 'resign', 'qo', 'leave'].includes(x.kind))
    .map((x: any, i: number) => ({ ...x, key: i, p: lg.players[x.pid], o: ovrOf(lg.players[x.pid].z) }))
    .filter((r: any) => all || r.o >= 74 || r.tid === lg.userTid);
  const cols = [
    { key: 'team', label: 'Team', left: true, get: (r: any) => lg.teams[r.tid]?.abbr ?? '', fmt: (_: any, r: any) => <TL tid={r.tid} abbr /> },
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.pid)}>{v}</button> },
    { key: 'age', label: 'Age', get: (r: any) => ageIn(r.p, N) },
    { key: 'o', label: 'OVR', get: (r: any) => r.o },
    { key: 'what', label: 'Decision', left: true, get: (r: any) => KIND(r), fmt: (v: any, r: any) => <span className={/declined|Let go|Opted out/i.test(v) ? 'neg' : ''}>{v}{r.sal && r.kind !== 'option' ? <span className="dim"> · {Math.round(r.sal * 100)}%{r.exp ? ` to ${r.exp}` : ''}</span> : null}</span> },
  ];
  return (
    <div className="panel">
      <div className="team-head">
        <h2>What every team decided</h2>
        <label className="chk"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> all players (not just OVR 74+)</label>
      </div>
      <p className="note">Team and player options, re-signings before the market opens and qualifying offers (the player becomes a restricted free agent: his team can match any offer). % – salary as a share of the cap.</p>
      {rows.length ? <SortTable cols={cols} rows={rows} initial="o" limit={300} rowClass={(r: any) => (r.tid === lg.userTid ? 'mine' : '')} /> : <p className="note">Nothing yet.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- 9) season preview
export function PreviewStep({ lg, onChange, children }: any) {
  return (
    <div className="col">
      <div className="panel accent step-head">
        <div className="team-head">
          <h2>The {seasonLabel(lg.season)} season is about to start</h2>
          <button className="primary" onClick={() => { lg.previewOpen = null; onChange(); top(); }}>Start the season ▶</button>
        </div>
        <p className="note">Rosters are set. Here is how the league looks before opening night.</p>
      </div>
      {children}
    </div>
  );
}

/** History: everyone in the Hall of Fame and every retired jersey, by class and by team. */
export function HallOfFameView({ lg, openPlayer, onChange }: any) {
  const [y, setY] = useState<string>('all');
  const [team, setTeam] = useState<string>('');
  const all = (Object.values(lg.players) as any[]).filter(p => p.retired && (p.career.length || p.ovrHist?.length));
  const years = [...new Set(all.map(p => p.retired))].sort((a: any, b: any) => b - a);
  const pids = all.filter(p => y === 'all' || p.retired === +y).map(p => p.id);
  const teams = (Object.values(lg.teams) as any[]).filter(t => t.active).sort((a, b) => a.name.localeCompare(b.name));
  if (!years.length) return <div className="panel"><h2>Hall of Fame</h2><p className="note">The first class is chosen after the first offseason's retirements.</p></div>;
  return <HonorsPanel lg={lg} pids={pids} title="Hall of Fame & retired jerseys" onChange={onChange} openPlayer={openPlayer} team={team || undefined}
    head={<>
      <select className="small-sel" aria-label="Class" value={y} onChange={e => setY(e.target.value)}><option value="all">All classes</option>{years.map((x: any) => <option key={x} value={x}>Class of {x}</option>)}</select>
      <select className="small-sel" aria-label="Team" value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams' jerseys</option>{teams.map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}</select>
    </>}
    note={`Players retired in this league. The Hall weighs a whole career (real seasons before this league count): peak, a run of great seasons, longevity, points and honors – the line is ${HOF_LINE}; real Hall of Famers go in automatically. A team retires a jersey for a long, great run with it (4+ seasons, score ${JERSEY_LINE}+). “Close, but not in” and the jersey candidates can be added by hand.`} />;
}
