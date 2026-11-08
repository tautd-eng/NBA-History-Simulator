// @ts-nocheck
// The offseason, step by step: a bar showing where the league is (season recap → retirements →
// development → expansion draft → lottery → draft → contract decisions → free agency → season preview →
// new season), and the screens of the steps that have no room of their own elsewhere.
import { useState } from 'react';
import { PL, TL } from './nav';
import { shownOvr as ovrOf, seasonInfo } from '../data';
import { ageIn } from '../players';
import { offStep, offRetire, offDevelop, unretire, initDraft } from '../league/offseason';
import { SortTable } from './sorttable';
import { injName } from '../league/injuries';

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
const WHY: Record<string, string> = { age: 'age and decline', history: 'his real career ended here', unsigned: 'no team wanted him' };
export function RetireStep({ lg, onChange, openPlayer }: any) {
  const [msg, setMsg] = useState<string | null>(null);
  const o = lg.off;
  const rows = (o?.ret ?? []).map((r: any) => ({ ...r, key: r.pid, p: lg.players[r.pid] })).filter((r: any) => r.p);
  const Y = lg.season;
  const career = (p: any) => {
    const reg = p.career.filter((c: any) => !c.po);
    const gp = reg.reduce((a: number, c: any) => a + c.gp, 0), pts = reg.reduce((a: number, c: any) => a + c.pts, 0);
    const rings = p.awards.filter((a: string) => /Champion$/.test(a)).length;
    const mvp = p.awards.filter((a: string) => /\bMVP$/.test(a) && !/Finals/.test(a)).length;
    return { n: new Set(reg.map((c: any) => c.s)).size, ppg: gp ? pts / gp : 0, rings, mvp, peak: Math.max(...(p.ovrHist ?? []).map((h: any) => h[2] ?? 0), 0) };
  };
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.pid)}>{v}</button> },
    { key: 'team', label: 'Team', left: true, get: (r: any) => (r.tid ? lg.teams[r.tid]?.abbr : 'FA'), fmt: (v: any, r: any) => r.tid ? <TL tid={r.tid} abbr /> : <span className="dim">FA</span> },
    { key: 'age', label: 'Age', get: (r: any) => r.age },
    { key: 'ovr', label: 'OVR', title: 'Overall in his last season', get: (r: any) => r.ovr, fmt: (v: any) => <span className={`ovr ${v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low'} sm`}>{v}</span> },
    { key: 'yrs', label: 'Seasons', get: (r: any) => career(r.p).n },
    { key: 'ppg', label: 'Career PPG', get: (r: any) => career(r.p).ppg, fmt: (v: any) => v.toFixed(1) },
    { key: 'hon', label: 'Honors', left: true, get: (r: any) => career(r.p).rings * 10 + career(r.p).mvp, fmt: (_: any, r: any) => { const c = career(r.p); return <span className="dim">{[c.rings ? `${c.rings}× champion` : '', c.mvp ? `${c.mvp}× MVP` : ''].filter(Boolean).join(', ') || '–'}</span>; } },
    { key: 'why', label: 'Why', left: true, get: (r: any) => r.why, fmt: (v: any, r: any) => <span className="dim">{WHY[v] ?? v}{r.p.injury > 0 ? ` (injured: ${r.p.injury} games)` : ''}</span> },
    { key: 'act', label: '', get: (r: any) => (r.undone ? 2 : r.back ? 1 : 0), fmt: (_: any, r: any) => r.undone ? <span className="chip tiny">coming back</span> : r.back ? <button className="small" onClick={() => { const x = unretire(lg, r.pid); setMsg(x.msg); onChange(); }}>Talk him out of it</button> : <span className="dim small-t">final</span> },
  ];
  const mine = rows.filter((r: any) => r.tid && r.tid === lg.userTid);
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
      <div className="panel">
        {rows.length ? <SortTable cols={cols} rows={rows} initial="ovr" limit={200} rowClass={(r: any) => (r.tid && r.tid === lg.userTid ? 'mine' : r.undone ? 'dim' : '')} /> : <p className="note">Nobody retired this summer.</p>}
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
