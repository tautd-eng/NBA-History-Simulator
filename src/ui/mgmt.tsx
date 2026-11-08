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

// tactics as a coach sets them (NBA 2K-style points of emphasis), turned into the engine's numbers
type Opt = { k: string; t: string; v: Record<string, any>; d?: string };
const GROUPS: { k: string; t: string; side: 'o' | 'd'; d: string; opts: Opt[]; from?: number }[] = [
  { k: 'of', t: 'Offensive focus', side: 'o', d: 'Who takes the shots and from where.', opts: [
    { k: 'neutral', t: 'Neutral', v: {} },
    { k: 'star', t: 'Play through star', v: { focus: 1 }, d: 'Your best scorers take more of the shots.' },
    { k: 'ball', t: 'Ball movement', v: { focus: -1 }, d: 'Shots spread out and come a little cleaner – more passes, more turnovers.' },
    { k: 'basket', t: 'Get to basket', v: { three: -1 }, d: 'Fewer threes, more drives and free throws.' },
    { k: 'shooters', t: 'Get shooters open', v: { three: 1 }, d: 'Many more threes – more points per make, more variance.' },
    { k: 'post', t: 'Feed the post', v: { post: 1, three: -0.4 }, d: 'The bigs get it inside: their shots, more fouls drawn.' },
    { k: 'pnr', t: 'Pick & roll', v: { pnr: 1 }, d: 'Guards and bigs run it: easier twos, a few more turnovers.' },
  ] },
  { k: 'tempo', t: 'Offensive tempo', side: 'o', d: 'How fast you play.', opts: [
    { k: 'patient', t: 'Patient', v: { pace: -1 } }, { k: 'avg', t: 'Average', v: {} }, { k: 'push', t: 'Push', v: { pace: 0.5 } }, { k: 'will', t: 'Shoot at will', v: { pace: 1 } },
  ] },
  { k: 'oreb', t: 'Offensive rebounding', side: 'o', d: 'After your misses: go for the board or get back.', opts: [
    { k: 'limit', t: 'Limit transition', v: { crash: -1 }, d: 'Fewer second chances, fewer breaks against you.' },
    { k: 'some', t: 'Some crash, others run', v: {} },
    { k: 'crash', t: 'Crash the glass', v: { crash: 1 }, d: 'More second chances – more fast breaks against you.' },
  ] },
  { k: 'df', t: 'Defensive focus', side: 'd', d: 'What you take away.', opts: [
    { k: 'paint', t: 'Protect the paint', v: { scheme: -1 }, d: 'Fewer and harder twos for them – more threes.' },
    { k: 'neutral', t: 'Neutral', v: {} },
    { k: 'perim', t: 'Limit perimeter', v: { scheme: 1 }, d: 'Fewer and harder threes – easier twos.' },
  ] },
  { k: 'aggr', t: 'Defensive aggression', side: 'd', d: 'How hard you guard.', opts: [
    { k: 'cons', t: 'Conservative', v: { press: -1, phys: -0.5 }, d: 'Few fouls and few turnovers forced – easier shots for them.' },
    { k: 'neutral', t: 'Neutral', v: {} },
    { k: 'phys', t: 'Physical', v: { phys: 1 }, d: 'Every shot contested – more fouls, foul trouble.' },
    { k: 'press', t: 'Pressure', v: { press: 1, phys: 0.3 }, d: 'Gamble for steals – more turnovers, more fouls.' },
  ] },
  { k: 'dreb', t: 'Defensive rebounding', side: 'd', d: 'After their misses.', opts: [
    { k: 'run', t: 'Run in transition', v: { dreb: -1 }, d: 'Leak out for breaks – they get more offensive rebounds.' },
    { k: 'neutral', t: 'Some crash, others run', v: {} },
    { k: 'crash', t: 'Crash the glass', v: { dreb: 1 }, d: 'Everybody boxes out – fewer breaks for you.' },
  ] },
  { k: 'cover', t: 'Pick & roll coverage', side: 'd', d: 'How your bigs and guards play the screen.', opts: [
    { k: 'auto', t: 'Auto', v: {} },
    { k: 'drop', t: 'Drop', v: { cover: 'drop' }, d: 'The big stays back: the rim is protected, guards get pull-up threes.' },
    { k: 'switch', t: 'Switch', v: { cover: 'switch' }, d: 'No open man – but their bigs post up smaller defenders.' },
    { k: 'blitz', t: 'Blitz', v: { cover: 'blitz' }, d: 'Trap the ball-handler: turnovers – and open shooters when it fails.' },
  ] },
  { k: 'dbl', t: 'Double the star', side: 'd', d: 'Their top scorer.', opts: [
    { k: 'never', t: 'Never', v: { dbl: -1 }, d: 'He gets his – but nobody else gets open looks.' },
    { k: 'auto', t: 'Auto', v: {} },
    { k: 'always', t: 'Always', v: { dbl: 1 }, d: 'The ball goes elsewhere or he turns it over – kick-out threes are open.' },
  ] },
  { k: 'zone', t: 'Zone defense', side: 'd', d: 'Zone instead of man-to-man (legal from 2001–02).', from: 2002, opts: [
    { k: 'never', t: 'Never', v: { zone: -1 } }, { k: 'auto', t: 'Auto', v: {} }, { k: 'often', t: 'Often', v: { zone: 1 } },
  ] },
];
const SYSTEMS: { k: string; t: string; d: string; set: Record<string, string> }[] = [
  { k: 'balanced', t: 'Balanced', d: 'Nothing forced.', set: {} },
  { k: 'grit', t: 'Grit and Grind', d: 'Slow, inside, physical, every board.', set: { of: 'post', tempo: 'patient', oreb: 'crash', df: 'paint', aggr: 'phys', dreb: 'crash' } },
  { k: 'space', t: 'Pace and Space', d: 'Push it, shooters open, get back.', set: { of: 'shooters', tempo: 'push', oreb: 'limit', df: 'perim', dreb: 'run' } },
  { k: 'seven', t: '7 seconds', d: 'Shoot early, threes, run, switch everything.', set: { of: 'shooters', tempo: 'will', oreb: 'limit', dreb: 'run', cover: 'switch' } },
  { k: 'triangle', t: 'Triangle', d: 'Patient ball movement.', set: { of: 'ball', tempo: 'patient' } },
  { k: 'postc', t: 'Post centric', d: 'Through the bigs.', set: { of: 'post', oreb: 'crash' } },
  { k: 'perim', t: 'Perimeter centric', d: 'Pick and roll and the guards.', set: { of: 'pnr', tempo: 'push' } },
  { k: 'star', t: 'Star system', d: 'The ball goes to your best player.', set: { of: 'star' } },
  { k: 'defense', t: 'Defense first', d: 'Slow, physical, protect the rim, double the star.', set: { tempo: 'patient', df: 'paint', aggr: 'phys', dreb: 'crash', dbl: 'always' } },
];
/** The engine's numbers from the coach's choices. */
function tacFrom(ch: Record<string, string>) {
  const t: any = { pace: 0, three: 0, crash: 0, press: 0 };
  for (const g of GROUPS) Object.assign(t, (g.opts.find(o => o.k === ch[g.k]) ?? g.opts.find(o => !Object.keys(o.v).length) ?? g.opts[0]).v);
  return t;
}
const defaultChoice = (g: typeof GROUPS[number]) => (g.opts.find(o => !Object.keys(o.v).length) ?? g.opts[0]).k;

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
