// @ts-nocheck
// Team management – only for the user's team: the rotation (automatic, with how deep and how much the young
// play, or minutes by hand), the tactical set-up, and contract extensions.
import { useMemo, useState } from 'react';
import { K } from '../data';
import { run } from '../league/commands';
import { TL } from './nav';
import { shownOvr as ovrOf, bpmOf } from '../data';
import { ageIn } from '../players';
import { rotationPreview } from '../league/league';
import { extendable } from '../league/extensions';
import { ExtensionBox } from './player';
import { RoleCell } from './roles';
import { readSheet } from './xlsx';
import { importRotations, rotationTemplate, ImportReport } from '../league/rotimport';
import { humans, isHuman } from '../league/humans';
import { posNum } from '../engine/game';

const DEF = () => ({ mode: 'auto', depth: 10, youth: 0, minutes: {}, tac: { pace: 0, three: 0, crash: 0, press: 0 } });
export const mgmtOf = (lg: any) => { const t = lg.teams[lg.userTid]; return (t.mgmt ??= DEF()); };

import { GROUPS, SYSTEMS, tacFrom, defaultChoice } from '../league/tactics';
export { GROUPS, SYSTEMS, tacFrom };
export { natural as naturalSlot };

export function TeamMgmt({ lg, openPlayer, onChange }: any) {
  const [sec, setSec] = useState<'rot' | 'pos' | 'mm' | 'tac' | 'ext'>('rot');
  if (!lg.userTid) return <div className="panel"><h2>Team management</h2><p className="note">Pick a team to run in the settings – then its rotation, tactics and contracts are yours to manage.</p></div>;
  const t = lg.teams[lg.userTid];
  // every change to the team's settings goes out as one command (online: to the host)
  const changed = () => { run(lg, { t: 'mgmt', mgmt: mgmtOf(lg) }); onChange(); };
  const nExt = t.roster.filter((pid: string) => extendable(lg, lg.players[pid])).length;
  return (
    <div className="col">
      <div className="panel accent">
        <div className="team-head"><h2>Team management · <TL tid={t.tid} /></h2></div>
        <div className="seg" role="tablist">
          {[['rot', 'Rotation'], ['pos', 'Lineup & positions'], ['mm', 'Matchups'], ['tac', 'Tactics'], ['ext', `Extensions${nExt ? ` (${nExt})` : ''}`]].map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} className={sec === k ? 'on' : ''} onClick={() => setSec(k as any)}>{l}</button>)}
        </div>
      </div>
      {sec === 'rot' && <Rotation lg={lg} openPlayer={openPlayer} onChange={changed} />}
      {sec === 'pos' && <Positions lg={lg} openPlayer={openPlayer} onChange={changed} />}
      {sec === 'mm' && <Matchups lg={lg} openPlayer={openPlayer} onChange={changed} />}
      {sec === 'tac' && <TacticsPanel lg={lg} onChange={changed} />}
      {sec === 'ext' && <Extensions lg={lg} openPlayer={openPlayer} onChange={changed} />}
    </div>
  );
}

function Rotation({ lg, openPlayer, onChange }: any) {
  const m = mgmtOf(lg);
  const [, setT] = useState(0);
  const upd = (f: (m: any) => void) => { f(m); setT(x => x + 1); onChange(); };
  const t = lg.teams[lg.userTid];
  const ps = t.roster.map((pid: string) => lg.players[pid]);
  const plan = rotationPreview(lg, lg.userTid, m);
  const auto = rotationPreview(lg, lg.userTid, { ...m, mode: 'auto' });
  const rows = [...ps].sort((a, b) => (plan[b.id] ?? -1) - (plan[a.id] ?? -1) || ovrOf(b.z) - ovrOf(a.z));
  const total = ps.reduce((a: number, p: any) => a + (m.minutes[p.id] ?? 0), 0);
  const setMin = (pid: string, v: number) => upd(m => { m.minutes[pid] = Math.max(0, Math.min(48, Math.round(v || 0))); });
  const fromAuto = () => upd(m => { m.minutes = Object.fromEntries(ps.map((p: any) => [p.id, Math.round(auto[p.id] ?? 0)])); m.mode = 'manual'; });
  const mpg = (p: any) => (p.cur?.gp ? p.cur.min / p.cur.gp : 0);
  return (
    <div className="panel">
      <div className="team-head">
        <h2>Rotation</h2>
        <div className="seg" role="group" aria-label="Rotation mode">
          <button className={m.mode === 'auto' ? 'on' : ''} onClick={() => upd(m => (m.mode = 'auto'))}>Auto</button>
          <button className={m.mode === 'manual' ? 'on' : ''} onClick={() => (Object.keys(m.minutes).length ? upd(m => (m.mode = 'manual')) : fromAuto())}>Minutes by hand</button>
        </div>
      </div>
      {m.mode === 'auto' ? (
        <div className="mg-settings">
          <label>Rotation depth
            <span className="seg">{[8, 9, 10, 11].map(d => <button key={d} className={m.depth === d ? 'on' : ''} onClick={() => upd(m => (m.depth = d))}>{d}</button>)}</span>
            <span className="dim small-t">players who get real minutes (playoffs: the coach shortens it anyway)</span>
          </label>
          <label>Young players
            <span className="seg">{[[0, 'Earn it'], [0.35, 'Some push'], [0.7, 'Develop'], [1, 'Play the kids']].map(([v, l]: any) => <button key={l} className={Math.abs(m.youth - v) < 0.01 ? 'on' : ''} onClick={() => upd(m => (m.youth = v))}>{l}</button>)}</span>
            <span className="dim small-t">extra minutes for players 25 and under – the younger, the more (regular season only)</span>
          </label>
        </div>
      ) : (
        <div className="mg-settings">
          <p className="note">Set each player's minutes per game – type them in or use − / +. The total should be 240 (5 × 48) – the coach scales it to fit, and the minutes of a player who is out go to the others. Your top five by minutes start and close games. Total now: <b className={Math.abs(total - 240) > 4 ? 'neg' : ''}>{total}</b>.</p>
          <div className="def-row"><button className="small" onClick={fromAuto}>Start from the auto plan</button></div>
        </div>
      )}
      <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th className="l">Player</th><th>Pos</th><th>Age</th><th>OVR</th><th title="Minutes per game so far this season">MPG now</th><th>Plan</th>{m.mode === 'manual' && <th>Your minutes</th>}</tr></thead>
        <tbody>{rows.map((p: any) => {
          const v = plan[p.id];
          return <tr key={p.id} className={p.injury ? 'dim' : ''}>
            <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>{(m.starters ?? []).includes(p.id) ? <span className="chip tiny on-clock" title="Named starter (Lineup & positions)">Starter · {SLOTS[(m.starters ?? []).indexOf(p.id)]}</span> : null}{p.injury ? <span className="inj"> out {p.injury}</span> : null}</td>
            <td className="dim">{p.pos}</td><td>{ageIn(p, lg.season)}</td><td>{ovrOf(p.z)}</td><td>{mpg(p) ? mpg(p).toFixed(1) : '–'}</td>
            <td><span className="pr-bar" style={{ width: `${Math.round((v ?? 0) * 1.6)}px` }}></span>{v === undefined ? '–' : v.toFixed(0)}</td>
            {m.mode === 'manual' && <td className="mg-min">
              <button className="small" onClick={() => setMin(p.id, (m.minutes[p.id] ?? 0) - 1)} aria-label="1 minute less">−</button>
              <input type="number" min={0} max={48} inputMode="numeric" className="min-in" aria-label={`Minutes for ${p.name}`} value={m.minutes[p.id] ?? 0}
                onChange={e => setMin(p.id, e.target.value === '' ? 0 : +e.target.value)} onFocus={e => e.target.select()} />
              <button className="small" onClick={() => setMin(p.id, (m.minutes[p.id] ?? 0) + 1)} aria-label="1 minute more">+</button>
            </td>}
          </tr>;
        })}</tbody>
      </table></div>
      <p className="note">“Plan” – the minutes the coach would give tonight with these settings (healthy players). In-game he still rests tired players, protects foul trouble and empties the bench in blowouts.</p>
      <SheetImport lg={lg} onChange={() => { setT(x => x + 1); onChange(); }} />
    </div>
  );
}

/** Minutes, positions and starters from an Excel / CSV sheet – for your team, or for several teams at once. */
function SheetImport({ lg, onChange }: any) {
  const [rep, setRep] = useState<ImportReport | null>(null);
  const [err, setErr] = useState('');
  const load = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setRep(null);
    try {
      const rows = await readSheet(f);
      // online: only your own team, and it goes to the host as your team's settings
      setRep(importRotations(lg, rows, lg.online?.role === 'player' ? lg.userTid : undefined));
      onChange();
    }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  };
  const template = () => {
    const tids = humans(lg);
    const csv = rotationTemplate(lg, tids, (tid: string) => rotationPreview(lg, tid, lg.teams[tid].mgmt ?? { mode: 'auto', depth: 10, youth: 0, minutes: {} }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
    a.download = `rotation-${lg.teams[lg.userTid].abbr}-${lg.season}.csv`;
    a.click();
  };
  const imported = Object.values(lg.teams).filter((t: any) => t.mgmt?.imported && !isHuman(lg, t.tid)) as any[];
  return (
    <div className="sheet-import">
      <h3>From a spreadsheet</h3>
      <p className="note">One row per player with the columns <b>Team</b> (abbreviation or name; may be left out for your team), <b>Player</b>, <b>Position</b> (PG, SG, SF, PF, C), <b>Minutes</b> and <b>Starter</b> (Y for the five). Excel (.xlsx) or CSV. If the minutes add up to less than 240, the rest go to the players the sheet leaves out; more than 240 is scaled down. Tactics go in a second block or sheet with the columns <b>Team</b>, <b>Tactic</b> and <b>Choice</b>, named as on the Tactics tab (e.g. “Offensive focus” – “Play through star”, or “System” – “Grit and Grind”). The sheet may list several teams – an AI team listed in it plays that rotation and those tactics too. The template has both blocks.</p>
      <div className="def-row">
        <label className="btn-file">Import Excel / CSV<input type="file" accept=".xlsx,.csv,.txt" onChange={e => { load(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <button className="small ghost" onClick={template}>Download a template (your rotation and tactics now)</button>
      </div>
      {err && <p className="hint neg">{err}</p>}
      {rep && <div className="note">
        {rep.teams.map(t => <div key={t.tid}>✓ {lg.teams[t.tid].name}: {t.players} players{t.minutes ? `, ${t.minutes} minutes` : ''}{t.starters ? `, ${Math.min(5, t.starters)} starters` : ''}{(t as any).tactics ? ', tactics' : ''}{t.ai ? ' (AI team – follows the sheet)' : ''}</div>)}
        {rep.problems.map((p, i) => <div key={i} className="warn-t">• {p}</div>)}
      </div>}
      {imported.length > 0 && <p className="note">AI teams playing an imported rotation: {imported.map(t => t.abbr).join(', ')}. <button className="small ghost" onClick={() => { for (const t of imported) delete t.mgmt; onChange(); }}>Give them back to their coaches</button></p>}
    </div>
  );
}

function TacticsPanel({ lg, onChange }: any) {
  const m = mgmtOf(lg);
  const [, setT] = useState(0);
  const ch: Record<string, string> = (m.choice ??= {});
  const apply = () => { m.tac = tacFrom(ch); setT(x => x + 1); onChange(); };
  const pick = (k: string, v: string) => { ch[k] = v; ch.system = ''; apply(); };
  const system = (s: any) => { for (const g of GROUPS) ch[g.k] = s.set[g.k] ?? defaultChoice(g); ch.system = s.k; apply(); };
  const groups = GROUPS.filter(g => !g.from || lg.season >= g.from);
  const block = (side: 'o' | 'd') => groups.filter(g => g.side === side).map(g => {
    const cur = ch[g.k] ?? defaultChoice(g);
    const o = g.opts.find(x => x.k === cur);
    return (
      <div key={g.k} className="tac">
        <div className="tac-head"><b>{g.t}</b><span className="dim small-t">{g.d}</span></div>
        <div className="seg tac-opts">{g.opts.map(x => <button key={x.k} className={cur === x.k ? 'on' : ''} onClick={() => pick(g.k, x.k)}>{x.t}</button>)}</div>
        {o?.d && <span className="small-t why-t">{o.d}</span>}
      </div>
    );
  });
  return (
    <div className="col">
      <div className="panel">
        <div className="team-head"><h2>Preferred system</h2></div>
        <p className="note">A system sets all the points of emphasis below at once; change any of them afterwards. Every choice is a trade-off – none is free. Your in-game calls in clutch mode still come on top.</p>
        <div className="tac-sys">{SYSTEMS.map(x => <button key={x.k} className={`sys ${ch.system === x.k ? 'on' : ''}`} onClick={() => system(x)}><b>{x.t}</b><span className="dim small-t">{x.d}</span></button>)}</div>
      </div>
      <div className="grid-2">
        <div className="panel"><h2>Offense</h2><div className="tac-list">{block('o')}</div></div>
        <div className="panel"><h2>Defense</h2><div className="tac-list">{block('d')}</div></div>
      </div>
    </div>
  );
}

function Extensions({ lg, openPlayer, onChange }: any) {
  const t = lg.teams[lg.userTid];
  const ps = t.roster.map((pid: string) => lg.players[pid]);
  const ext = ps.filter((p: any) => extendable(lg, p)).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  const done = ps.filter((p: any) => p.ext);
  const [, setT] = useState(0);
  const ch = () => { setT(x => x + 1); onChange(); };
  return (
    <div className="col">
      <div className="panel">
        <h2>Extensions</h2>
        <p className="note">During the regular season you can extend players whose contracts end this season. His price starts from his market value (what he would ask in free agency). Wanting to stay brings it down a little (a hometown discount is at most ~10%); not wanting to stay pushes it up – up to twice his market value, and past the max he simply leaves. Veterans give a little for a longer deal; a long deal for a young player is priced on his expected growth over the deal (his path toward his projected peak, averaged) – you pay for some of the upside and carry the risk that he never gets there. At his number he signs; a few percent below it is a gamble – and only a player who wants to stay takes less.</p>
        {lg.phase !== 'regular' && <p className="hint">Extensions open in the regular season.</p>}
        {done.length > 0 && <p className="note">Already extended: {done.map((p: any) => `${p.name} (${(p.ext.sal * 100).toFixed(1)}% through ${p.ext.exp})`).join(', ')}.</p>}
      </div>
      {ext.map((p: any) => <div key={p.id} className="panel"><ExtensionBox lg={lg} p={p} onChange={ch} compact /></div>)}
      {lg.phase === 'regular' && !ext.length && <div className="panel"><p className="note">Nobody on your roster has a contract ending this season (or everyone is already extended).</p></div>}
    </div>
  );
}

const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
/** Natural slot (1 … 5) from his listed position. */
/** The slots his listed position covers (G = PG/SG, F = SF/PF, G-F = SG/SF, F-C = PF/C …). */
function slotsOf(pos: string): number[] {
  const m: Record<string, number[]> = { PG: [1], SG: [2], SF: [3], PF: [4], C: [5], G: [1, 2], F: [3, 4], GF: [2, 3], 'G-F': [2, 3], 'F-G': [2, 3], FC: [4, 5], 'F-C': [4, 5], 'C-F': [4, 5] };
  return m[pos] ?? m[pos.split('-')[0]] ?? [3];
}
/** Where he naturally plays: within his listed position, by size and game – a small playmaker is the point guard, a big rebounder the power forward. */
function natural(p: any) {
  const opts = slotsOf(p.pos);
  if (opts.length === 1) return opts[0];
  const [lo, hi] = opts, z = p.z, ht = p.ht;
  const ast = z[K.ast], reb = z[K.orb] + z[K.drb], tpr = z[K.tpr], blk = z[K.blk];
  // a guard or wing who runs the offence is the point guard (Magic Johnson at 6'9")
  if (lo <= 2 && ast >= 1.8 && ht <= 82) return 1;
  // above 0 leans to the bigger slot; each term against what is usual for that listed position
  const lean = lo === 1 ? (ht - 75) * 0.5 - (ast - 0.8) + 0.3 * (reb + 1.9)                              // PG or SG
    : lo === 2 ? (ht - 78) * 0.5 + 0.3 * (reb + 1) - 0.5 * (ast - 0.1)                                    // SG or SF
    : lo === 3 ? (ht - 80) * 0.35 + 0.6 * (reb - 0.8) - 0.5 * (tpr - 0.2) - 0.3 * (ast + 0.6)             // SF or PF
    : (ht - 82) * 0.5 + 0.5 * (blk - 0.8) - 0.6 * (tpr + 0.7) - 0.2 * (ast + 0.7);                        // PF or C
  return lean > 0 ? hi : lo;
}
/** Playing him there is a stretch: outside his listed position (one slot over is fine for a specialist). */
const outOf = (p: any, slot: number) => { const o = slotsOf(p.pos); return o.length === 1 ? Math.abs(o[0] - slot) > 1 : !o.includes(slot); };

/** The starting five by position, and where everyone else plays. */
function Positions({ lg, openPlayer, onChange }: any) {
  const m = mgmtOf(lg);
  const [, setT] = useState(0);
  const upd = (f: (m: any) => void) => { f(m); setT(x => x + 1); onChange(); };
  const t = lg.teams[lg.userTid];
  const ps = t.roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  const st: string[] = (m.starters ??= ['', '', '', '', '']);
  const setStarter = (i: number, pid: string) => upd(m => { m.starters = m.starters.map((x: string, j: number) => (j === i ? pid : x === pid && pid ? '' : x)); });
  const slotOf = (p: any) => { const i = st.indexOf(p.id); return i >= 0 ? i + 1 : m.pos?.[p.id] ?? 0; };
  const setPos = (pid: string, v: number) => upd(m => { m.pos ??= {}; if (v) m.pos[pid] = v; else delete m.pos[pid]; });
  const named = st.filter(Boolean).length;
  return (
    <div className="grid-2">
      <div className="panel">
        <h2>Starting five</h2>
        <p className="note">Name a starter for each position – or leave it to the coach (Auto). A named starter opens the game at that position and plays at least a starter's minutes (24+). If he is out, the coach fills the spot.</p>
        <table className="tbl compact"><tbody>{SLOTS.map((sl, i) => {
          const p = st[i] ? lg.players[st[i]] : null;
          return <tr key={sl}>
            <td className="l"><b>{sl}</b></td>
            <td className="l"><select aria-label={`Starter at ${sl}`} value={st[i] || ''} onChange={e => setStarter(i, e.target.value)}>
              <option value="">Auto – the coach decides</option>
              {ps.map((q: any) => <option key={q.id} value={q.id}>{q.name} ({q.pos}, {ovrOf(q.z)}){q.injury ? ' – injured' : ''}</option>)}
            </select></td>
            <td className="l">{p ? <><RoleCell p={p} S={lg.season} />{outOf(p, i + 1) ? <span className="chip tiny" title={`Listed as ${p.pos} – usually plays ${SLOTS[natural(p) - 1]}`}>out of position</span> : null}</> : null}</td>
          </tr>;
        })}</tbody></table>
        <div className="def-row"><button className="small ghost" disabled={!named} onClick={() => upd(m => { m.starters = ['', '', '', '', '']; })}>Clear – all Auto</button></div>
      </div>
      <div className="panel">
        <h2>Positions</h2>
        <p className="note">Where each player plays when he is on the floor. Positions decide the matchups (your 1 guards their 1 unless you set matchups), the floor balance the coach keeps (about two guards and two bigs) and who runs the post-ups and pick and rolls. A small player at the 5 defends their center.</p>
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th className="l">Player</th><th>Listed</th><th>OVR</th><th className="l">Plays</th></tr></thead>
          <tbody>{ps.map((p: any) => {
            const i = st.indexOf(p.id);
            return <tr key={p.id}>
              <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button></td>
              <td className="dim">{p.pos}</td><td>{ovrOf(p.z)}</td>
              <td className="l">{i >= 0 ? <span>{SLOTS[i]} <span className="dim small-t">(starter)</span></span> :
                <select aria-label={`Position for ${p.name}`} value={m.pos?.[p.id] ?? 0} onChange={e => setPos(p.id, +e.target.value)}>
                  <option value={0}>Auto ({SLOTS[natural(p) - 1]})</option>
                  {SLOTS.map((sl, j) => <option key={sl} value={j + 1}>{sl}</option>)}
                </select>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}

/** The opponent you meet next: your playoff series, or the next game on the schedule. */
function nextOpponent(lg: any, tid: string) {
  const s = (lg.series ?? []).find((x: any) => !x.winner && (x.hi === tid || x.lo === tid) && x.hi && x.lo);
  if (s) return { tid: s.hi === tid ? s.lo : s.hi, why: 'your playoff series' };
  const g = (lg.schedule ?? []).filter((x: any) => !x.done && (x.home === tid || x.away === tid)).sort((a: any, b: any) => a.day - b.day)[0];
  if (g) return { tid: g.home === tid ? g.away : g.home, why: 'your next game' };
  return null;
}

/** Defensive assignments against a given team: who guards their best players (used in every game against them). */
function Matchups({ lg, openPlayer, onChange }: any) {
  const m = mgmtOf(lg);
  const [, setT] = useState(0);
  const me = lg.userTid;
  const nx = nextOpponent(lg, me);
  const [opp, setOpp] = useState<string>(nx?.tid ?? Object.keys(lg.teams).find(t => t !== me && lg.teams[t].active));
  const upd = (f: (m: any) => void) => { f(m); setT(x => x + 1); onChange(); };
  const mine = lg.teams[me].roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  const theirs = lg.teams[opp].roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)).slice(0, 9);
  const set = (theirPid: string, myPid: string) => upd(m => { m.mm ??= {}; m.mm[opp] ??= {}; if (myPid) m.mm[opp][theirPid] = myPid; else delete m.mm[opp][theirPid]; });
  const cur = m.mm?.[opp] ?? {};
  const teams = Object.values(lg.teams).filter((t: any) => t.active && t.tid !== me).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const sets = Object.entries(m.mm ?? {}).filter(([, v]: any) => Object.keys(v).length);
  return (
    <div className="panel">
      <div className="team-head">
        <h2>Matchups</h2>
        <select className="mm-opp" aria-label="Opponent" value={opp} onChange={e => setOpp(e.target.value)}>
          {teams.map((t: any) => <option key={t.tid} value={t.tid}>{t.name}{nx?.tid === t.tid ? ` – ${nx.why}` : ''}</option>)}
        </select>
      </div>
      <p className="note">Pick who guards their players – in every game against the {lg.teams[opp].name}, playoffs included. When both are on the floor your man takes him (his defense, size and hands against that player's shots and drives); otherwise it goes by position. Auto: the defender at the same position.</p>
      <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th className="l">Their player</th><th>Pos</th><th>OVR</th><th className="l">Role</th><th className="l">Guarded by</th></tr></thead>
        <tbody>{theirs.map((p: any) => {
          const d = cur[p.id] ? lg.players[cur[p.id]] : null;
          return <tr key={p.id}>
            <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button></td>
            <td className="dim">{p.pos}</td><td>{ovrOf(p.z)}</td>
            <td className="l"><RoleCell p={p} S={lg.season} /></td>
            <td className="l"><select aria-label={`Who guards ${p.name}`} value={cur[p.id] ?? ''} onChange={e => set(p.id, e.target.value)}>
              <option value="">Auto – by position</option>
              {mine.map((q: any) => <option key={q.id} value={q.id}>{q.name} ({q.pos}, {ovrOf(q.z)})</option>)}
            </select>{d && Math.abs(d.ht - p.ht) >= 4 ? <span className={`chip tiny ${d.ht < p.ht ? 'neg' : ''}`} title="Height difference">{d.ht > p.ht ? '+' : ''}{Math.round((d.ht - p.ht) * 2.54)} cm</span> : null}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {Object.keys(cur).length > 0 && <div className="def-row"><button className="small ghost" onClick={() => upd(m => { delete m.mm[opp]; })}>Clear – all Auto</button></div>}
      {sets.length > 0 && <p className="note">Matchups set against: {sets.map(([tid]: any) => lg.teams[tid]?.abbr).join(', ')}.</p>}
    </div>
  );
}
