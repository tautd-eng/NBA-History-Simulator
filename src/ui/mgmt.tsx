// @ts-nocheck
// Team management – only for the user's team: the rotation (automatic, with how deep and how much the young
// play, or minutes by hand), the tactical set-up, and contract extensions.
import { useMemo, useState } from 'react';
import { TL } from './nav';
import { shownOvr as ovrOf, bpmOf } from '../data';
import { ageIn } from '../players';
import { rotationPreview } from '../league/league';
import { extendable } from '../league/extensions';
import { ExtensionBox } from './player';

const DEF = () => ({ mode: 'auto', depth: 10, youth: 0, minutes: {}, tac: { pace: 0, three: 0, crash: 0, press: 0 } });
export const mgmtOf = (lg: any) => { const t = lg.teams[lg.userTid]; return (t.mgmt ??= DEF()); };

const TACS = [
  { k: 'pace', t: 'Pace', lo: 'Slow it down', hi: 'Run', d: 'Faster: more possessions and more fast breaks – more chances for the better team, more variance for the worse one.' },
  { k: 'three', t: 'Shot selection', lo: 'Attack inside', hi: 'Fire threes', d: 'More threes: more points per make, more variance; inside: more free throws and more reliable twos.' },
  { k: 'crash', t: 'Rebounding', lo: 'Get back', hi: 'Crash the glass', d: 'Crashing: more offensive rebounds and second chances – but more fast breaks against you.' },
  { k: 'press', t: 'Defensive pressure', lo: 'Stay home', hi: 'Pressure', d: 'Pressure: more turnovers forced – and more fouls, more free throws for them.' },
  { k: 'focus', t: 'Offensive focus', lo: 'Ball movement', hi: 'Feed the stars', d: 'Stars: your best scorers take more of the shots. Ball movement: shots spread out and come a little cleaner – but more passes, more turnovers.' },
  { k: 'scheme', t: 'Defensive scheme', lo: 'Protect the paint', hi: 'Run shooters off the line', d: 'Chase shooters: fewer and harder threes for them, easier twos. Protect the paint: the reverse.' },
  { k: 'zone', t: 'Zone defense', lo: 'Never', hi: 'Often', d: 'How often you play zone instead of man-to-man: a zone dares them to shoot from outside. Legal from 2001–02.', from: 2002 },
];
const STEPS = [-1, -0.5, 0, 0.5, 1];

export function TeamMgmt({ lg, openPlayer, onChange }: any) {
  const [sec, setSec] = useState<'rot' | 'tac' | 'ext'>('rot');
  if (!lg.userTid) return <div className="panel"><h2>Team management</h2><p className="note">Pick a team to run in the settings – then its rotation, tactics and contracts are yours to manage.</p></div>;
  const t = lg.teams[lg.userTid];
  const nExt = t.roster.filter((pid: string) => extendable(lg, lg.players[pid])).length;
  return (
    <div className="col">
      <div className="panel accent">
        <div className="team-head"><h2>Team management · <TL tid={t.tid} /></h2></div>
        <div className="seg" role="tablist">
          {[['rot', 'Rotation'], ['tac', 'Tactics'], ['ext', `Extensions${nExt ? ` (${nExt})` : ''}`]].map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} className={sec === k ? 'on' : ''} onClick={() => setSec(k as any)}>{l}</button>)}
        </div>
      </div>
      {sec === 'rot' && <Rotation lg={lg} openPlayer={openPlayer} onChange={onChange} />}
      {sec === 'tac' && <TacticsPanel lg={lg} onChange={onChange} />}
      {sec === 'ext' && <Extensions lg={lg} openPlayer={openPlayer} onChange={onChange} />}
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
  const setMin = (pid: string, v: number) => upd(m => { m.minutes[pid] = Math.max(0, Math.min(44, Math.round(v))); });
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
          <p className="note">Set each player's minutes per game. The total should be 240 (5 × 48) – the coach scales it to fit, and the minutes of a player who is out go to the others. Your top five by minutes start and close games. Total now: <b className={Math.abs(total - 240) > 4 ? 'neg' : ''}>{total}</b>.</p>
          <div className="def-row"><button className="small" onClick={fromAuto}>Start from the auto plan</button></div>
        </div>
      )}
      <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th className="l">Player</th><th>Pos</th><th>Age</th><th>OVR</th><th title="Minutes per game so far this season">MPG now</th><th>Plan</th>{m.mode === 'manual' && <th>Your minutes</th>}</tr></thead>
        <tbody>{rows.map((p: any) => {
          const v = plan[p.id];
          return <tr key={p.id} className={p.injury ? 'dim' : ''}>
            <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>{p.injury ? <span className="inj"> out {p.injury}</span> : null}</td>
            <td className="dim">{p.pos}</td><td>{ageIn(p, lg.season)}</td><td>{ovrOf(p.z)}</td><td>{mpg(p) ? mpg(p).toFixed(1) : '–'}</td>
            <td><span className="pr-bar" style={{ width: `${Math.round((v ?? 0) * 1.6)}px` }}></span>{v === undefined ? '–' : v.toFixed(0)}</td>
            {m.mode === 'manual' && <td className="mg-min">
              <button className="small" onClick={() => setMin(p.id, (m.minutes[p.id] ?? 0) - 2)} aria-label="2 minutes less">−</button>
              <b>{m.minutes[p.id] ?? 0}</b>
              <button className="small" onClick={() => setMin(p.id, (m.minutes[p.id] ?? 0) + 2)} aria-label="2 minutes more">+</button>
            </td>}
          </tr>;
        })}</tbody>
      </table></div>
      <p className="note">“Plan” – the minutes the coach would give tonight with these settings (healthy players). In-game he still rests tired players, protects foul trouble and empties the bench in blowouts.</p>
    </div>
  );
}

function TacticsPanel({ lg, onChange }: any) {
  const m = mgmtOf(lg);
  const [, setT] = useState(0);
  const upd = (k: string, v: number) => { m.tac[k] = v; setT(x => x + 1); onChange(); };
  return (
    <div className="panel">
      <div className="team-head"><h2>Tactics</h2><button className="small ghost" onClick={() => { for (const x of TACS) m.tac[x.k] = 0; setT(x => x + 1); onChange(); }}>Balanced</button></div>
      <p className="note">How your team plays every game (your in-game calls in clutch mode still come on top). Each choice is a trade-off – none is free.</p>
      <div className="tac-list">
        {TACS.filter(x => !x.from || lg.season >= x.from).map(x => (
          <div key={x.k} className="tac">
            <div className="tac-head"><b>{x.t}</b><span className="dim small-t">{x.d}</span></div>
            <div className="tac-row">
              <span className="dim small-t">{x.lo}</span>
              <span className="seg">{STEPS.map(v => <button key={v} className={(m.tac[x.k] ?? 0) === v ? 'on' : ''} onClick={() => upd(x.k, v)} aria-label={`${x.t} ${v}`}>{v === 0 ? '·' : v < 0 ? (v === -1 ? '◀◀' : '◀') : v === 1 ? '▶▶' : '▶'}</button>)}</span>
              <span className="dim small-t">{x.hi}</span>
            </div>
          </div>
        ))}
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
