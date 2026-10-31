// @ts-nocheck
// Player card: ratings, progression year by year, and sortable career statistics.
import { Linkify } from './nav';
import { useEffect, useMemo, useState } from 'react';
import { fatigueAt, nextCal, fatigueLabel } from '../league/fatigue';
import { injName } from '../league/injuries';
import { todayIndex } from '../league/league';
import { RATING_LABELS, ratingOf, shownOvr as ovrOf, shownFromRaw, shownFromBpm, perD, rimD } from '../data';
import { ageIn } from '../players';
import { SortTable, f1, f0, pctf, div } from './sorttable';
import { traits, TRAIT_LABELS, reasons, extensionNeed } from '../league/prefs';
import { extendable, userExtend } from '../league/extensions';
import { maxSalary } from '../ai/value';
import { seasonInfo } from '../data';
import { describeLog, recallStash } from '../league/offseason';
import { PFace, SKINS, HAIR_STYLES, FACIAL_STYLES, faceOf } from './art';
import { RoleCard } from './roles';

/** Small editor for the generated portrait (saved with the league). */
function FaceEditor({ p, season, onChange }: any) {
  const f = faceOf(p, season);
  const set = (k: string, v: any) => { p.face = { ...(p.face ?? {}), [k]: v }; onChange(); };
  return (
    <div className="face-edit">
      <div><span className="dim">Skin tone</span> {SKINS.map((c, i) => <button key={c} className={`sw ${SKINS.indexOf(f.skin) === i ? 'on' : ''}`} style={{ background: c }} aria-label={`Tone ${i + 1}`} onClick={() => set('skin', i)} />)}</div>
      <label><span className="dim">Hair</span> <select value={f.hair} onChange={e => set('hair', e.target.value)}>{HAIR_STYLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      <label><span className="dim">Facial hair</span> <select value={f.facial} onChange={e => set('facial', e.target.value)}>{FACIAL_STYLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      <label><input type="checkbox" checked={!!f.band} onChange={e => set('band', e.target.checked)} /> Headband</label>
      <button className="small" onClick={() => { p.face = { seed: Math.floor(Math.random() * 1e6) }; onChange(); }}>Random</button>
      <button className="small ghost" onClick={() => { delete p.face; onChange(); }}>Original</button>
      <span className="dim note">Faces are generated, not real – you can adjust them here.</span>
    </div>
  );
}

const gmsc = (l: any) => l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;
const isChamp = (k: string) => k === 'Champion' || /čemp|cemp/i.test(k);
const AWARD_NAMES: Record<string, string> = {
  čempionas: 'Champion', Champion: 'Champion', 'Finalo MVP': 'Finals MVP', '6-as žaidėjas': 'Sixth Man of the Year', '6MOY': 'Sixth Man of the Year',
  MVP: 'MVP', 'Finals MVP': 'Finals MVP', DPOY: 'Defensive Player of the Year', ROY: 'Rookie of the Year', MIP: 'Most Improved Player',
  'All-League 1': 'All-League 1st Team', 'All-League 2': 'All-League 2nd Team', 'All-League 3': 'All-League 3rd Team',
  'All-Defensive 1': 'All-Defensive 1st Team', 'All-Defensive 2': 'All-Defensive 2nd Team', 'All-Rookie 1': 'All-Rookie 1st Team', 'All-Rookie 2': 'All-Rookie 2nd Team',
};
const AWARD_SHORT: Record<string, string> = { 'Sixth Man of the Year': '6MOY', 'Defensive Player of the Year': 'DPOY', 'Rookie of the Year': 'ROY', 'Most Improved Player': 'MIP' };
/** award names, including older saves written in Lithuanian */
export function awardLabel(k: string) {
  if (AWARD_NAMES[k]) return AWARD_NAMES[k];
  const s = k.toLowerCase();
  const n = /\b(1|i|pirm)/.test(s) ? 1 : /\b(2|ii|antr)/.test(s) ? 2 : /\b(3|iii|treč|trec)/.test(s) ? 3 : 0;
  const ord = ['', '1st', '2nd', '3rd'][n];
  if (/čemp|cemp|champ/.test(s)) return 'Champion';
  if (/final/.test(s)) return 'Finals MVP';
  if (/naujok|rookie/.test(s)) return n ? `All-Rookie ${ord} Team` : 'Rookie of the Year';
  if (/gyn|def/.test(s)) return n ? `All-Defensive ${ord} Team` : 'Defensive Player of the Year';
  if (/6|šešt|sest|sixth/.test(s)) return 'Sixth Man of the Year';
  if (/pažang|pazang|paženg|pazeng|improv|mip/.test(s)) return 'Most Improved Player';
  if (/simbol|lygos|league|nba|visų|visu/.test(s) && n) return `All-League ${ord} Team`;
  if (/naudingiaus|mvp/.test(s)) return 'MVP';
  return k;
}
const AWARD_ORDER = ['Champion', 'MVP', 'Finals MVP', 'Defensive Player of the Year', 'Rookie of the Year', 'Sixth Man of the Year', 'Most Improved Player', 'All-League 1st Team', 'All-League 2nd Team', 'All-League 3rd Team', 'All-Defensive 1st Team', 'All-Defensive 2nd Team', 'All-Rookie 1st Team', 'All-Rookie 2nd Team'];
/** Awards grouped with a count; hover or tap a chip for the seasons. */
export function AwardChips({ p }: any) {
  const [open, setOpen] = useState<string | null>(null);
  const groups: Record<string, number[]> = {};
  for (const a of p.awards) { const m = /^(\d{4}) (.*)$/.exec(a); if (m) (groups[awardLabel(m[2])] ??= []).push(+m[1]); }
  const keys = Object.keys(groups).sort((a, b) => ((AWARD_ORDER.indexOf(a) + 1 || 99) - (AWARD_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  if (!keys.length) return null;
  const yrs = (k: string) => [...new Set(groups[k])].sort((a, b) => a - b).map(sl).join(', ');
  return (
    <div className="awards">
      <div className="award-chips">{keys.map(k => (
        <button key={k} type="button" className={`chip award ${k === 'Champion' ? 'gold' : ''} ${open === k ? 'on' : ''}`} title={`${k}: ${yrs(k)}`} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
          {k === 'Champion' ? '🏆 ' : ''}{AWARD_SHORT[k] ?? k}{groups[k].length > 1 ? <b> ×{groups[k].length}</b> : null}
        </button>
      ))}</div>
      {open && <p className="award-years"><b>{open}</b> ({groups[open].length}×): {yrs(open)}</p>}
    </div>
  );
}
const sl = (s: number) => `${s - 1}–${String(s).slice(2)}`;
/** Career story: draft, teams, trades, signings, awards, serious injuries. */
function HistoryTab({ lg, p, openTeam }: any) {
  const ev: { s: number; o: number; t: any; k: string }[] = []; // o: order within the season (-1 summer before, game day, 999 after)
  const T = (tid: string) => lg.teams[tid]?.name ?? tid;
  const hasDraftTx = (p.tx ?? []).some((x: any) => x.t.startsWith('Drafted') || x.t.startsWith('Išrinktas') || x.t.startsWith('Fantasy'));
  if (p.draft && !hasDraftTx) ev.push({ s: p.draft.year, o: 999, k: 'draft', t: `Drafted in ${p.draft.year}: No. ${p.draft.pick} (round ${p.draft.round}), ${T(p.draft.tid)}` });
  const first = p.career.find((c: any) => !c.po);
  if (lg.start && p.entered <= lg.start && first) ev.push({ s: lg.start, o: -5, k: 'start', t: `At the league's start – ${T(first.tid)}` });
  for (const x of p.tx ?? []) ev.push({ s: x.s, o: x.d ?? 500, k: 'tx', t: <Linkify text={x.t} /> });
  // free-agency lines not yet copied into the history
  if (lg.fa) for (const x of lg.fa.log.slice(lg.fa.flushed ?? 0)) if (x.pid === p.id) ev.push({ s: lg.season, o: lg.phase === 'freeagency' ? -1 : 500, k: 'tx', t: <Linkify text={describeLog(lg, x)} /> });
  for (const r of lg.trades ?? []) {
    const inA = r.aGets.some((x: any) => x.pid === p.id), inB = r.bGets.some((x: any) => x.pid === p.id);
    if (!inA && !inB) continue;
    const to = inA ? r.a : r.b, from = inA ? r.b : r.a;
    const back = (inA ? r.bGets : r.aGets).map((x: any) => x.pid ? lg.players[x.pid]?.name : `${x.pick.season} ${x.pick.round === 1 ? '1st' : '2nd'}-round pick`).join(', ');
    ev.push({ s: r.s, o: r.phase === 'regular' ? r.day : -1, k: 'trade', t: <>Traded: <button className="link" onClick={() => openTeam(from)}>{T(from)}</button> → <button className="link" onClick={() => openTeam(to)}>{T(to)}</button>{back ? <span className="dim"> (for {back})</span> : null}{r.phase === 'freeagency' || r.phase === 'offseason' ? <span className="dim"> · offseason</span> : r.phase === 'draft' ? <span className="dim"> · during the draft</span> : null}</> });
  }
  for (const a of p.awards) { const m = /^(\d{4}) (.*)$/.exec(a); if (m) ev.push({ s: +m[1], o: 900, k: 'award', t: isChamp(m[2]) ? '🏆 Champion' : `Award: ${awardLabel(m[2])}` }); }
  for (const h of p.injHist ?? []) if (h.g >= 10) ev.push({ s: h.s, o: 600, k: 'inj', t: `Injury: ${injName(h.k)}, missed ~${h.g} games${h.lasting ? ' (lasting effect)' : ''}` });
  ev.sort((a, b) => b.s - a.s || b.o - a.o); // newest first
  const [all, setAll] = useState(false);
  const shown = all ? ev : ev.slice(0, 15);
  // teams (stints) from the career lines
  const stints: { tid: string; a: number; b: number }[] = [];
  for (const c of p.career.filter((c: any) => !c.po && c.tid)) {
    const last = stints[stints.length - 1];
    if (last && last.tid === c.tid && c.s <= last.b + 1) last.b = c.s; else stints.push({ tid: c.tid, a: c.s, b: c.s });
  }
  if (p.tid && (p.cur.gp || !stints.length || stints[stints.length - 1].tid !== p.tid)) {
    const last = stints[stints.length - 1];
    if (last && last.tid === p.tid) last.b = lg.season; else stints.push({ tid: p.tid, a: lg.season, b: lg.season });
  }
  // awards summary
  const groups: Record<string, number[]> = {};
  for (const a of p.awards) { const m = /^(\d{4}) (.*)$/.exec(a); if (m) (groups[awardLabel(m[2])] ??= []).push(+m[1]); }
  const order = ['Champion', 'MVP', 'Finals MVP', 'DPOY', 'ROY', '6MOY', 'MIP', 'All-League 1', 'All-League 2', 'All-League 3', 'All-Defensive 1', 'All-Defensive 2', 'All-Rookie 1', 'All-Rookie 2'];
  const keys = Object.keys(groups).sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  return (
    <>
      <div className="kv">
        <div><span className="dim">Draft</span> {p.draft ? `${p.draft.year}, No. ${p.draft.pick} (round ${p.draft.round}), ${T(p.draft.tid)}` : 'undrafted'}</div>
        <div><span className="dim">In the league since</span> {sl(p.entered)}{p.retired ? ` · retired in ${p.retired}` : ''}</div>
        <div><span className="dim">Teams</span> {stints.length ? stints.map((st, i) => <span key={i}>{i ? ' → ' : ''}<button className="link" onClick={() => openTeam(st.tid)}>{lg.teams[st.tid]?.abbr ?? st.tid}</button> <span className="dim">({st.a === st.b ? sl(st.a) : `${st.a - 1}–${String(st.b).slice(2)}`})</span></span>) : '–'}</div>
        <div><span className="dim">Awards</span> {keys.length ? <AwardChips p={p} /> : 'none yet'}</div>
      </div>
      <h3>Career events</h3>
      {ev.length ? (
        <><ul className="news timeline">{shown.map((e, i) => <li key={i} className={e.k}><span className="yr">{e.s}</span><span>{e.t}</span></li>)}</ul>
          {ev.length > 15 && <button className="small ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${ev.length} events`}</button>}</>
      ) : <p className="note">No events yet.</p>}
      <p className="note">Events are recorded from when the player joined this league.</p>
    </>
  );
}

/** What the player cares about, and – for the user's own players – the extension talks. */
function Priorities({ lg, p, onChange }: any) {
  const tr = traits(p, lg.season);
  const mine = lg.userTid && p.tid === lg.userTid;
  const canExt = mine && extendable(lg, p);
  const N = lg.season + 1;
  const cap = seasonInfo(N).cap;
  const [years, setYears] = useState(3);
  const est = canExt ? extensionNeed(lg, p, lg.userTid, years) : null;
  const [amount, setAmount] = useState(() => (est ? (Math.ceil(est.need * cap * 100) / 100).toFixed(2) : ''));
  const [msg, setMsg] = useState<string | null>(null);
  const why = lg.userTid && lg.userTid !== p.tid ? reasons(lg, p, lg.userTid) : [];
  return (
    <>
      <h3>What matters to him</h3>
      <div className="ratings prio">
        {TRAIT_LABELS.map(([k, l]) => (
          <div key={k} className="rating"><span className="rl">{l}</span><span className="bar"><span style={{ width: `${Math.round(tr[k] * 100)}%` }}></span></span><span className="rv">{tr[k] >= 0.66 ? 'high' : tr[k] >= 0.4 ? 'mid' : 'low'}</span></div>
        ))}
      </div>
      {why.length > 0 && <p className="note">If he were choosing your team: {why.map(w => w.t).join('; ')}.</p>}
      {p.ext && <p className="note"><b>Contract extended:</b> {(p.ext.sal * 100).toFixed(1)}% of the cap through {p.ext.exp}.</p>}
      {canExt && (
        <div className="offer" role="group" aria-label="Contract extension">
          <div><b>Extend contract</b> <span className="dim">His contract ends this season. Right now he wants ~{(est!.need * 100).toFixed(1)}% of the cap (${(est!.need * cap).toFixed(2)}M){est!.why.length ? ` · ${est!.why.join(', ')}` : ''}. Max contract – {(maxSalary(p, N) * 100).toFixed(0)}% of the cap.</span></div>
          <label>Years <select value={years} onChange={e => setYears(+e.target.value)}>{[1, 2, 3, 4, 5].map(y => <option key={y} value={y}>{y}</option>)}</select></label>
          <label>Salary per season, $M <input type="number" step="0.05" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <button className="primary" onClick={() => { const r = userExtend(lg, p.id, (parseFloat(amount.replace(',', '.')) || 0) / cap, years); setMsg(r.msg); onChange?.(); }}>Offer</button>
          {msg && <span className="hint" role="status">{msg}</span>}
        </div>
      )}
    </>
  );
}

function Ovr({ v, small }: any) {
  const tier = v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low';
  return <span className={`ovr ${tier}${small ? ' sm' : ''}`}>{v}</span>;
}

export function PlayerPanel({ lg, pid, close, openTeam, onChange }: any) {
  const p = lg.players[pid];
  const [tab, setTab] = useState<'stats' | 'prog' | 'inj' | 'hist'>('stats');
  const [po, setPo] = useState(false);
  const [mode, setMode] = useState<'pg' | 'tot'>('pg');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const live = lg.phase === 'regular' || lg.phase === 'playoffs';
  const rows = useMemo(() => {
    const out = p.career.filter((c: any) => c.po === po).map((c: any) => ({ key: c.s, s: c.s, tid: c.tid, age: c.age, ovr: c.ovr != null ? shownFromRaw(c.ovr) : null, l: c }));
    const cur = po ? p.curPo : p.cur;
    if (live && cur.gp) out.push({ key: lg.season, s: lg.season, tid: p.tid, age: ageIn(p, lg.season), ovr: ovrOf(p.z), l: cur, now: true });
    return out;
  }, [pid, po, lg.day]);
  const tot = useMemo(() => {
    const t: any = { gp: 0, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 };
    for (const r of rows) for (const k of Object.keys(t)) t[k] += r.l[k] ?? 0;
    return t;
  }, [rows]);
  const pg = mode === 'pg';
  const v = (k: string) => (r: any) => (pg ? r.l[k] / r.l.gp : r.l[k]);
  const fmtN = pg ? f1 : f0;
  const cols = [
    { key: 's', label: 'Season', get: (r: any) => r.s, fmt: (x: any, r: any) => <>{x - 1}–{String(x).slice(2)}{r.now ? ' *' : ''}</> },
    { key: 'tid', label: 'Team', left: true, asc: true, get: (r: any) => lg.teams[r.tid]?.abbr ?? '–' },
    { key: 'age', label: 'Age', get: (r: any) => r.age },
    { key: 'ovr', label: 'OVR', get: (r: any) => r.ovr },
    { key: 'gp', label: 'GP', get: (r: any) => r.l.gp },
    { key: 'min', label: 'Min', get: v('min'), fmt: fmtN },
    { key: 'pts', label: 'Pts', get: v('pts'), fmt: fmtN },
    { key: 'reb', label: 'Reb', get: (r: any) => (r.l.orb + r.l.drb) / (pg ? r.l.gp : 1), fmt: fmtN },
    { key: 'ast', label: 'Ast', get: v('ast'), fmt: fmtN },
    { key: 'stl', label: 'Stl', get: v('stl'), fmt: fmtN },
    { key: 'blk', label: 'Blk', get: v('blk'), fmt: fmtN },
    { key: 'tov', label: 'TOV', get: v('tov'), fmt: fmtN },
    { key: 'fgp', label: 'FG%', get: (r: any) => div(r.l.fgm, r.l.fga), fmt: pctf },
    { key: 'tpp', label: '3P%', get: (r: any) => div(r.l.tpm, r.l.tpa), fmt: pctf },
    { key: 'ftp', label: 'FT%', get: (r: any) => div(r.l.ftm, r.l.fta), fmt: pctf },
    { key: 'pm', label: '+/−', get: v('pm'), fmt: (x: any) => (x > 0 ? '+' : '') + fmtN(x) },
    { key: 'gs', label: 'GmSc', title: 'Game Score (Hollinger): points + 0.4·FG − 0.7·FGA − 0.4·missed FT + 0.7·ORB + 0.3·DRB + STL + 0.7·AST + 0.7·BLK − 0.4·PF − TOV', get: (r: any) => (r.l.gp ? gmsc(r.l) / (pg ? r.l.gp : 1) : null), fmt: f1 },
  ];
  const tg = tot.gp || 1;
  const T = (k: string) => fmtN(pg ? tot[k] / tg : tot[k]);
  const footer = rows.length > 1 ? (
    <tr className="tot"><td>Career</td><td className="l"></td><td></td><td></td><td>{tot.gp}</td><td>{T('min')}</td><td>{T('pts')}</td>
      <td>{fmtN(pg ? (tot.orb + tot.drb) / tg : tot.orb + tot.drb)}</td><td>{T('ast')}</td><td>{T('stl')}</td><td>{T('blk')}</td><td>{T('tov')}</td>
      <td>{pctf(div(tot.fgm, tot.fga))}</td><td>{pctf(div(tot.tpm, tot.tpa))}</td><td>{pctf(div(tot.ftm, tot.fta))}</td><td>{(tot.pm > 0 ? '+' : '') + fmtN(pg ? tot.pm / tg : tot.pm)}</td><td>{f1(gmsc(tot) / (pg ? tg : 1))}</td></tr>
  ) : null;

  // progression rows: ratings recorded each season
  const rh: number[][] = p.rh?.length ? p.rh : [[lg.season, ...RATING_LABELS.map(r => ratingOf(p.z[r.k], r.inv))]];
  const ovrBy = Object.fromEntries(p.ovrHist.map((x: any) => [x[0], shownFromRaw(x[1])]));
  const progRows = rh.map((row, i) => ({ key: row[0], s: row[0], ovr: ovrBy[row[0]] ?? null, r: row.slice(1), prev: i ? rh[i - 1].slice(1) : null, pOvr: i ? ovrBy[rh[i - 1][0]] ?? null : null }));
  const progCols = [
    { key: 's', label: 'Season', get: (x: any) => x.s, fmt: (s: any) => `${s - 1}–${String(s).slice(2)}` },
    { key: 'age', label: 'Age', get: (x: any) => Math.floor(x.s + 1 / 12 - p.born) },
    { key: 'ovr', label: 'OVR', get: (x: any) => x.ovr, fmt: (o: any, x: any) => { const pr = x.pOvr; const d = pr != null && o != null ? o - pr : 0; return <>{o ?? '–'}{d ? <span className={d > 0 ? 'pos delta' : 'neg delta'}>{d > 0 ? '+' : ''}{d}</span> : null}</>; } },
    ...RATING_LABELS.map((lab, i) => ({
      key: 'r' + i, label: lab.short, title: lab.name + (lab.tendency ? ' (tendency)' : ''),
      get: (x: any) => x.r[i],
      fmt: (val: any, x: any) => { const d = x.prev ? val - x.prev[i] : 0; return <span className={`rt ${val >= 70 ? 'hi' : val <= 30 ? 'lo' : ''}`}>{val}{Math.abs(d) >= 2 ? <span className={d > 0 ? 'pos delta' : 'neg delta'}>{d > 0 ? '+' : ''}{d}</span> : null}</span>; },
    })),
  ];

  const [editFace, setEditFace] = useState(false);
  const [, bump] = useState(0);
  const status = p.retired ? `Retired in ${p.retired}` : p.tid ? lg.teams[p.tid].name : (p as any).stash ? `Overseas – rights: ${lg.teams[(p as any).rights]?.abbr ?? '–'}` : 'Free agent';
  const [recallMsg, setRecallMsg] = useState('');
  return (
    <div className="overlay" onClick={close}>
      <aside className="drawer wide" role="dialog" aria-label={p.name} onClick={e => e.stopPropagation()}>
        <button className="close ghost" onClick={close} aria-label="Close">✕</button>
        <div className="p-head">
          <button className="face-btn" title="Edit face" onClick={() => setEditFace(!editFace)}><PFace lg={lg} p={p} size={76} /></button>
          <Ovr v={ovrOf(p.z)} />
          <div>
            <h2>{p.name}</h2>
            <p className="dim">{p.pos} · {(p.ht * 0.0254).toFixed(2)} m · age {ageIn(p, lg.season)} · {p.tid ? <button className="link" onClick={() => openTeam(p.tid)}>{status}</button> : status}</p>
            {p.tid && (lg.phase === 'regular' || lg.phase === 'playoffs') && <p className="dim">Status: {p.injury > 0 ? `injured – ${p.inj ? injName(p.inj.k) : 'injury'}, out ~${p.injury} more games` : fatigueLabel(fatigueAt(lg, p, nextCal(lg, todayIndex(lg)))).toLowerCase()}</p>}
            {p.draft?.tid && <p className="dim">Draft {p.draft.year}: No. {p.draft.pick} ({lg.teams[p.draft.tid]?.abbr ?? p.draft.tid})</p>}
            {(p as any).stash && <p className="dim">Playing overseas – expected to come over for {(p as any).stash - 1}–{String((p as any).stash).slice(2)}.{(p as any).rights === lg.userTid && <> <button className="small primary" onClick={() => { const r = recallStash(lg, p.id); setRecallMsg(r.msg); onChange?.(); bump(x => x + 1); }}>Bring him over now</button></>}</p>}
            {recallMsg && <p className="hint">{recallMsg}</p>}
          </div>
        </div>
        {editFace && <FaceEditor p={p} season={lg.season} onChange={() => bump(x => x + 1)} />}
        {!p.prospect && <RoleCard p={p} />}
        {p.awards.length > 0 && <AwardChips p={p} />}
        <h3>Current skills</h3>
        <div className="ratings">
          {RATING_LABELS.map(r => {
            const val = ratingOf(p.z[r.k], r.inv);
            return (
              <div key={r.name} className="rating">
                <span className="rl">{r.name}{r.tendency ? ' *' : ''}</span>
                <span className="bar"><span style={{ width: `${val}%` }}></span></span>
                <span className="rv">{val}</span>
              </div>
            );
          })}
          {[['Perimeter defense', perD(p.z, p.ht)], ['Rim protection', rimD(p.z, p.ht)]].map(([n, z]: any) => {
            const val = ratingOf(z);
            return (
              <div key={n} className="rating">
                <span className="rl">{n}</span>
                <span className="bar"><span style={{ width: `${val}%` }}></span></span>
                <span className="rv">{val}</span>
              </div>
            );
          })}
        </div>
        <p className="note">Ratings are relative to the league of that era (50 = average player). * – tendency, not ability.</p>
        {!p.retired && !p.prospect && <Priorities key={p.id + lg.season} lg={lg} p={p} onChange={onChange} />}

        <div className="seg" role="group" aria-label="Section">
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>Stats</button>
          <button className={tab === 'prog' ? 'on' : ''} onClick={() => setTab('prog')}>Progression</button>
          <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>History</button>
          <button className={tab === 'inj' ? 'on' : ''} onClick={() => setTab('inj')}>Injuries{p.injHist?.length ? ` (${p.injHist.length})` : ''}</button>
        </div>

        {tab === 'hist' ? <HistoryTab lg={lg} p={p} openTeam={openTeam} /> : tab === 'inj' ? <>
          {p.injHist?.length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Season</th><th className="l">Injury</th><th>Games missed</th><th className="l">Where</th><th className="l">Effects</th></tr></thead>
              <tbody>{[...p.injHist].reverse().map((h: any, i: number) => (
                <tr key={i} className={h.g >= 15 ? 'mine' : ''}>
                  <td>{h.s - 1}–{String(h.s).slice(2)}</td>
                  <td className="l">{injName(h.k)}</td>
                  <td>{h.g}</td>
                  <td className="l dim">{h.w === 'game' ? 'in a game' : 'practice / illness'}</td>
                  <td className="l dim">{h.lasting ? 'lasting: weaker physical attributes' : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="note">No injuries in this league.</p>}
          <p className="note">Severe injuries (torn ACL, Achilles, meniscus) leave a lasting mark on physical attributes – smaller for young players, larger for older ones. Every serious injury slightly raises future risk.</p>
        </> : tab === 'stats' ? <>
          <div className="stats-head">
            <div className="seg" role="group" aria-label="Part of season">
              <button className={!po ? 'on' : ''} onClick={() => setPo(false)}>Regular season</button>
              <button className={po ? 'on' : ''} onClick={() => setPo(true)}>Playoffs</button>
            </div>
            <div className="seg" role="group" aria-label="Show">
              <button className={pg ? 'on' : ''} onClick={() => setMode('pg')}>Per game</button>
              <button className={!pg ? 'on' : ''} onClick={() => setMode('tot')}>Totals</button>
            </div>
          </div>
          {rows.length ? <SortTable cols={cols} rows={rows} initial="s" initialAsc={false} footer={footer} /> : <p className="note">{po ? 'No playoff games yet.' : 'Hasn\'t played in this league yet.'}</p>}
          <p className="note">Click a column header to sort. * – current season.</p>
        </> : <>
          <OvrChart p={p} />
          <SortTable cols={progCols} rows={progRows} initial="s" initialAsc={false} />
          <p className="note">Ratings at the start of each season, newest first; the small numbers show the change from the season before (shown from ±2).</p>
        </>}
      </aside>
    </div>
  );
}

function OvrChart({ p }: any) {
  const sim: [number, number][] = p.ovrHist.map((h: any) => [h[0], shownFromRaw(h[1])]);
  if (sim.length < 2) return <p className="note">The progression chart appears after the first offseason.</p>;
  const x0 = sim[0][0], x1 = Math.max(sim[sim.length - 1][0], x0 + 1);
  const y0 = Math.max(35, Math.min(...sim.map(a => a[1])) - 5), y1 = Math.min(100, Math.max(...sim.map(a => a[1])) + 5);
  const W = 560, Hh = 160, L = 34, R = 12, T = 12, B = 26;
  const X = (s: number) => L + ((s - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (Hh - T - B);
  const path = sim.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)}`).join('');
  const area = `${path}L${X(sim[sim.length - 1][0]).toFixed(1)} ${Hh - B}L${X(sim[0][0]).toFixed(1)} ${Hh - B}Z`;
  const yt = [y0, Math.round((y0 + y1) / 2), y1].map(Math.round);
  const step = Math.max(1, Math.ceil((x1 - x0) / 8));
  const xt: number[] = []; for (let s = x0; s <= x1; s += step) xt.push(s);
  const peak = sim.reduce((a, b) => (b[1] > a[1] ? b : a));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="OVR over his career">
        {yt.map(v => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 6} y={Y(v) + 4} className="axis" textAnchor="end">{v}</text></g>)}
        {xt.map(s => <text key={s} x={X(s)} y={Hh - 8} className="axis" textAnchor="middle">{s}</text>)}
        <path d={area} className="area" />
        <path d={path} className="line sim" />
        <circle cx={X(peak[0])} cy={Y(peak[1])} r="4" className="dot-sim" />
        <text x={X(peak[0])} y={Y(peak[1]) - 8} className="axis strong" textAnchor="middle">peak {peak[1]}</text>
      </svg>
    </div>
  );
}
