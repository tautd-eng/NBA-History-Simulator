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
  } else if (lg.phase === 'freeagency' || lg.phase === 'offseason') cur = !lg.fa || lg.fa.stage === 0 ? 'decisions' : 'fa';
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
  for (const r of realPre) {
    const g = r[2]; gp += g; pts += r[4] * g; reb += r[5] * g; ast += r[6] * g; seasons.add(r[0]);
    if (path[path.length - 1] !== r[1]) path.push(r[1]);
    if (r[3] >= 500) peak = Math.max(peak, ovrOf(r[7]));
  }
  for (const c of reg) {
    gp += c.gp; pts += c.pts; reb += c.orb + c.drb; ast += c.ast; seasons.add(c.s);
    if (c.tid && path[path.length - 1] !== c.tid) path.push(c.tid);
  }
  for (const h of p.ovrHist ?? []) peak = Math.max(peak, histShown(h));
  const ys = [...seasons].sort((a, b) => a - b);
  const aw = p.awards ?? [];
  const lastReal = hp?.s?.length ? hp.s[hp.s.length - 1][0] : undefined;
  return {
    first: ys[0], last: ys[ys.length - 1], n: ys.length, gp, path, peak,
    ppg: gp ? pts / gp : 0, rpg: gp ? reb / gp : 0, apg: gp ? ast / gp : 0, pts: Math.round(pts),
    rings: aw.filter((a: string) => /Champion$/.test(a)).length,
    mvp: aw.filter((a: string) => /\bMVP$/.test(a) && !/Finals/.test(a)).length,
    allLg: aw.filter((a: string) => /All-League/.test(a)).length,
    hof: !!hp?.hof, realPre: realPre.length ? new Set(realPre.map((r: any) => r[0])).size : 0, lastReal,
  };
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
