// @ts-nocheck
// Off-season screens: draft day (one pick at a time), the free-agency hub
// (three stages) and the free-agent list where the user makes offers.
import { Linkify, PL, TL, nav } from './nav';
import { useMemo, useState } from 'react';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm, RATING_LABELS, ratingOf, seasonInfo } from '../data';
import { ageIn } from '../players';
import { peakBpm, payroll, askingSalary, MIN_SAL, maxSalary, hardCap } from '../ai/value';
import { discount, reasons } from '../league/prefs';
import { isFreeAgent } from '../ai/trades';
import {
  initDraft, draftOnClock, draftAdvance, draftPick, draftSuggest, finishDraft,
  enterFreeAgency, faStage, startSeason, faOffer, faDemand, faRenounce, faRelease, faDecide, faMatch,
} from '../league/offseason';
import { SortTable, f1 } from './sorttable';
import { ExpansionRoom, LotteryRoom, LotteryReveal, AutoControls, useAutoPlay } from './draftday';
import { posNum } from '../engine/game';

export const moneyOf = (frac: number, s: number) => {
  const m = frac * seasonInfo(s).cap;
  return m >= 1 ? `$${m.toFixed(1)}M` : `$${Math.round(m * 1000)}K`;
};
export const potOf = (p: any, s: number) => shownFromBpm(peakBpm(p, s));
const R = (p: any, i: number) => ratingOf(p.z[RATING_LABELS[i].k], RATING_LABELS[i].inv);
const SHOW = [0, 1, 4, 7, 10];
const POS = [['all', 'All'], ['g', 'Guards'], ['f', 'Forwards'], ['c', 'Centers']] as const;
const posOk = (p: any, pos: string) => pos === 'all' || (pos === 'g' ? posNum(p.pos) <= 2.5 : pos === 'c' ? posNum(p.pos) >= 4.5 : posNum(p.pos) > 2.5 && posNum(p.pos) < 4.5);
function Ovr({ v }: any) {
  const tier = v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low';
  return <span className={`ovr ${tier} sm`}>{v}</span>;
}
const lastLine = (p: any) => [...p.career].reverse().find((c: any) => !c.po);

// ---------------------------------------------------------------- draft day
export function DraftRoom({ lg, onChange, onTick = () => {}, openPlayer, openTeam }: any) {
  const d = lg.draftDay && lg.draftDay.year === lg.season ? lg.draftDay : null;
  const [pos, setPos] = useState('all');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  const [reveal, setReveal] = useState(false);
  const act = (fn: () => void) => { fn(); onChange(); };
  useAutoPlay(playing, speed, () => {
    const c = draftOnClock(lg);
    if (!c || c.tid === lg.userTid) return false;
    draftPick(lg); onTick();
    const nx = draftOnClock(lg);
    return !!nx && nx.tid !== lg.userTid;
  }, () => { setPlaying(false); onChange(); });
  if (!d) {
    const last = lg.history[lg.history.length - 1];
    return (
      <div className="panel accent">
        <h2>Draft day awaits</h2>
        <p className="note">The {lg.season} season is over. On draft day {seasonInfo(lg.season + 1).teams && Object.keys(seasonInfo(lg.season + 1).teams).some(t => !lg.teams[t]) ? 'there will first be an expansion draft for the new teams, then ' : ''}you'll see the lottery odds and the draw, and then teams pick one by one. You can make your own picks or skip ahead.</p>
        <div className="def-row"><button className="primary" onClick={() => act(() => initDraft(lg))}>Start draft day</button></div>
        {last?.champion && <p className="note">Champions: <TL tid={last.champion} />.</p>}
      </div>
    );
  }
  if (d.done) return <DraftSummary lg={lg} d={d} openPlayer={openPlayer} openTeam={openTeam} onNext={() => act(() => enterFreeAgency(lg))} />;
  const stage = d.stage ?? 'draft';
  if (stage === 'expansion') return <ExpansionRoom lg={lg} onChange={onChange} onTick={onTick} openPlayer={openPlayer} openTeam={openTeam} />;
  if (stage === 'lottery') return <LotteryRoom lg={lg} onChange={onChange} onDrawn={() => setReveal(true)} />;
  if (reveal && d.lotto?.result) return <LotteryReveal lg={lg} close={() => setReveal(false)} />;
  const on = draftOnClock(lg);
  const myTurn = on && on.tid === lg.userTid;
  const myLeft = lg.userTid && d.order.slice(d.idx).some((o: any, i: number) => {
    const owner = lg.picks?.find((p: any) => p.season === d.year && p.round === o.round && p.orig === o.orig)?.owner ?? o.orig;
    return owner === lg.userTid;
  });
  const board = d.pool.map((pid: string) => lg.players[pid]).filter((p: any) => posOk(p, pos));
  const suggestion = myTurn ? draftSuggest(lg, lg.userTid) : null;
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (p: any) => p.name, fmt: (v: any, p: any) => <button className="link" onClick={() => openPlayer(p.id)}>{v}</button> },
    { key: 'pos', label: 'Pos', get: (p: any) => posNum(p.pos), fmt: (_: any, p: any) => <span className="dim">{p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (p: any) => ageIn(p, d.year + 1) },
    { key: 'ovr', label: 'OVR', get: (p: any) => ovrOf(p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', title: 'Potential – the GM\'s estimate of how good he can become', get: (p: any) => potOf(p, d.year + 1) },
    ...SHOW.map(i => ({ key: 'r' + i, label: RATING_LABELS[i].short, title: RATING_LABELS[i].name, get: (p: any) => R(p, i) })),
    { key: 'act', label: '', get: () => 0, fmt: (_: any, p: any) => myTurn ? <button className={`small ${p.id === suggestion ? 'primary' : ''}`} onClick={() => act(() => draftPick(lg, p.id))}>Pick</button> : null },
  ];
  const recent = [...d.picks].reverse();
  return (
    <div className="grid-2">
      <section className="panel accent">
        <div className="team-head">
          <h2>{d.year} draft day</h2>
          {on && <span className={`chip ${myTurn ? 'on-clock' : ''}`}>No. {on.pick} · round {on.round} – {lg.teams[on.tid].name} on the clock{on.tid !== on.orig ? ` (via ${lg.teams[on.orig].abbr})` : ''}</span>}
        </div>
        {d.lottery && <p className="note"><Linkify text={d.lottery} /></p>}
        <div className="def-row">
          {myTurn ? <>
            <span className="hint">You're on the clock – pick from the list{suggestion ? ` (GM suggests: ${lg.players[suggestion].name})` : ''}.</span>
            <button onClick={() => act(() => draftPick(lg))}>Let the GM pick</button>
          </> : <button className="primary" disabled={playing} onClick={() => act(() => draftAdvance(lg, 'one'))}>Next pick</button>}
          <AutoControls playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} disabled={!on || myTurn} />
          {!myTurn && myLeft && <button disabled={playing} onClick={() => act(() => draftAdvance(lg, 'user'))}>To my pick</button>}
          <button onClick={() => { setPlaying(false); act(() => { draftAdvance(lg, 'all'); finishDraft(lg); }); }}>{lg.userTid ? 'To the end (GM picks for me)' : 'To the end'}</button>
          {d.lotto?.result && <button className="ghost" onClick={() => setReveal(true)}>Lottery</button>}
        </div>
        <div className="def-row">
          <div className="seg" role="group" aria-label="Position">{POS.map(([k, l]) => <button key={k} className={pos === k ? 'on' : ''} onClick={() => setPos(k)}>{l}</button>)}</div>
          <span className="hint">{d.pool.length} players left on the board</span>
        </div>
        <SortTable cols={cols} rows={board.map((p: any) => ({ ...p, key: p.id }))} initial="pot" limit={80} />
        <p className="note">Pot – the scouts' estimate of how much a player can grow. It's imprecise: some rookies will surprise, some will disappoint.</p>
      </section>
      <section className="col">
        <div className="panel">
          <h2>Picks</h2>
          {recent.length ? (
            <ul className="news">
              {recent.slice(0, 40).map((x: any) => (
                <li key={x.pick} className={`pop-in ${x.tid === lg.userTid ? 'mine' : ''}`}>
                  <span className="yr">{x.pick}</span>
                  <span><b>{lg.teams[x.tid].abbr}</b>{x.via ? <span className="dim"> (via {lg.teams[x.via].abbr})</span> : null} <button className="link" onClick={() => openPlayer(x.pid)}>{lg.players[x.pid].name}</button> <span className="dim">{lg.players[x.pid].pos} · OVR {ovrOf(lg.players[x.pid].z)} · pot {potOf(lg.players[x.pid], d.year + 1)}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="note">The draft hasn't started – the first pick is on the clock.</p>}
        </div>
        <div className="panel">
          <h2>Upcoming picks</h2>
          <ul className="news">
            {d.order.slice(d.idx, d.idx + 12).map((o: any, i: number) => {
              const owner = lg.picks?.find((p: any) => p.season === d.year && p.round === o.round && p.orig === o.orig)?.owner ?? o.orig;
              return <li key={i} className={owner === lg.userTid ? 'mine' : ''}><span className="yr">{d.idx + i + 1}</span><span>{lg.teams[owner].name}{owner !== o.orig ? <span className="dim"> (via {lg.teams[o.orig].abbr})</span> : null}</span></li>;
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}

function DraftSummary({ lg, d, openPlayer, openTeam, onNext }: any) {
  const S = d.year + 1;
  const rows = d.picks.map((x: any) => ({ ...x, key: x.pick, p: lg.players[x.pid] })).filter((r: any) => r.p);
  const byPot = [...rows].sort((a, b) => potOf(b.p, S) - potOf(a.p, S));
  const byOvr = [...rows].sort((a, b) => ovrOf(b.p.z) - ovrOf(a.p.z));
  const steal = rows.filter((r: any) => r.pick > 10).sort((a: any, b: any) => potOf(b.p, S) - potOf(a.p, S))[0];
  const mine = rows.filter((r: any) => r.tid === lg.userTid);
  const cols = [
    { key: 'pick', label: 'No.', asc: true, get: (r: any) => r.pick },
    { key: 'team', label: 'Team', left: true, get: (r: any) => lg.teams[r.tid].abbr, fmt: (v: any, r: any) => <><button className="link" onClick={() => openTeam(r.tid)}>{v}</button>{r.via ? <span className="dim"> (via {lg.teams[r.via].abbr})</span> : null}</> },
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.pid)}>{v}</button> },
    { key: 'pos', label: 'Pos', get: (r: any) => posNum(r.p.pos), fmt: (_: any, r: any) => <span className="dim">{r.p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, S) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', get: (r: any) => potOf(r.p, S) },
    { key: 'where', label: '', left: true, get: (r: any) => ((r.p as any).stash ? 1 : 0), fmt: (v: any, r: any) => v ? <span className="dim">stays overseas (until {(r.p as any).stash})</span> : '' },
  ];
  const line = (r: any) => r ? <><button className="link" onClick={() => openPlayer(r.pid)}>{r.p.name}</button> <span className="dim">({lg.teams[r.tid].abbr}, No. {r.pick})</span></> : '–';
  return (
    <div className="col">
      <div className="panel accent">
        <div className="team-head">
          <h2>{d.year} draft recap</h2>
          <button className="primary" onClick={onNext}>To free agency →</button>
        </div>
        {d.lottery && <p className="note"><Linkify text={d.lottery} /></p>}
        {lg.classSrc?.[d.year] && <p className="note"><b>Revealed:</b> this year brought the real {lg.classSrc[d.year]} draft class.</p>}
        <div className="kv">
          <div><span className="dim">No. 1</span> {line(rows[0])}</div>
          <div><span className="dim">Most ready now</span> {line(byOvr[0])}</div>
          <div><span className="dim">Highest potential</span> {line(byPot[0])}</div>
          {steal && <div><span className="dim">Possible steal (after pick 10)</span> {line(steal)}</div>}
          {lg.userTid && <div><span className="dim">Your rookies</span> {mine.length ? mine.map((r: any, i: number) => <span key={r.pid}>{i ? ', ' : ''}<button className="link" onClick={() => openPlayer(r.pid)}>{r.p.name}</button> <span className="dim">(No. {r.pick})</span></span>) : 'you had no picks this year'}</div>}
        </div>
      </div>
      <div className="panel">
        <SortTable cols={cols} rows={rows} initial="pick" initialAsc rowClass={(r: any) => (r.tid === lg.userTid ? 'mine' : '')} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- free agency hub
const STAGE_TXT = [
  'Contract decisions before the market opens: players decide on their player options, teams on team options and qualifying offers for younger players (restricted free agents, RFA). Other teams can make offers to an RFA, but his team can match and keep him.',
  'First wave: the top free agents ask for full price and some wait for better offers. Only you can make offers to your own players whose contracts ended.',
  'Second wave: asking prices drop (~15%) and most players with offers sign. Teams are actively looking for trades.',
  'Final wave: the remaining players accept ~70% of their original ask. After it, teams fill their rosters to the minimum and the season begins.',
];

export function FAHub({ lg, onChange, openPlayer, openTeam, goFA }: any) {
  const fa = lg.fa;
  const [msg, setMsg] = useState<string | null>(null);
  if (!fa) return null;
  const act = (fn: () => any) => { const r = fn(); if (r?.msg) setMsg(r.msg); onChange(); };
  const N = lg.season;
  const u = lg.userTid ? lg.teams[lg.userTid] : null;
  const pay = u ? payroll(lg, u.tid) : 0;
  const capLim = N < 1985 ? 1.3 : 1.0;
  const pending = fa.stage === 1 ? fa.pending.map((pid: string) => lg.players[pid]) : [];
  const top = Object.values(lg.players).filter((p: any) => isFreeAgent(lg, p)).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)).slice(0, 8);
  const stages = [0, 1, 2, 3].map(s => ({ s, log: fa.log.filter((x: any) => x.st === s) }));
  const decisions = fa.stage === 0 ? (fa.decisions ?? []) : [];
  const sheets = fa.sheets ?? [];
  const entry = (x: any, i: number) => {
    const p = x.pid ? lg.players[x.pid] : null;
    if (x.kind === 'trade') return <li key={i}><span className="yr">⇄</span><span><Linkify text={x.desc} /></span></li>;
    if (!p) return null;
    const who = <button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>;
    const team = x.tid ? lg.teams[x.tid].abbr : '';
    const k = { sign: 'signed', resign: 're-signed', release: 'released', leave: 'hit the market', option: 'option', qo: 'qualifying offer (RFA)', match: 'matched', sheet: 'offer sheet to an RFA' }[x.kind];
    return <li key={i} className={x.tid === lg.userTid ? 'mine' : ''}><span className="yr">{x.tid ? <TL tid={x.tid} abbr /> : team}</span><span>{who} <span className="dim">OVR {ovrOf(p.z)}, age {ageIn(p, N)} · {k}{x.sal ? ` · ${moneyOf(x.sal, N)}${x.exp ? ` through ${x.exp}` : ''}` : ''}{x.desc ? <> · <Linkify text={x.desc} /></> : ''}</span></span></li>;
  };
  return (
    <div className="grid-2">
      <section className="col">
        <div className="panel accent">
          <div className="team-head">
            <h2>Free agency · {N - 1}–{String(N).slice(2)}</h2>
            <div className="seg stage-seg" aria-label="Free agency stages">{[0, 1, 2, 3].map(s => <span key={s} className={`chip ${fa.stage === s ? 'on-clock' : fa.stage > s ? 'past' : ''}`}>{s ? `Wave ${s}` : 'Decisions'}</span>)}</div>
          </div>
          <p className="note">{fa.stage <= 3 ? STAGE_TXT[fa.stage] : 'Free agency is over. When the season starts, teams with fewer than 13 players will sign minimum deals, and teams with more than 15 will release their weakest.'}</p>
          {u && <div className="kv">
            <div><span className="dim">{u.name}</span> {u.roster.length} players · payroll {moneyOf(pay, N)} ({Math.round(pay * 100)}% of the cap) · cap space {Math.max(0, Math.round((capLim - pay) * 100))}%{hardCap(lg) < Infinity ? <> · left under the hard cap ({Math.round(hardCap(lg) * 100)}%): <b className={pay > hardCap(lg) ? 'neg' : ''}>{Math.round((hardCap(lg) - pay) * 100)}%</b></> : null}{N >= 1995 ? ` · mid-level exception ${fa.mle.includes(u.tid) ? 'used' : 'available'}` : ''}</div>
          </div>}
          <div className="def-row">
            {fa.stage <= 3
              ? <button className="primary" onClick={() => act(() => faStage(lg))}>{fa.stage === 0 ? 'Confirm decisions and open the market →' : `Finish wave ${fa.stage} →`}</button>
              : <button className="primary" onClick={() => act(() => startSeason(lg))}>Start the {N - 1}–{String(N).slice(2)} season</button>}
            <button onClick={goFA}>All free agents</button>
          </div>
          {msg && <p className="hint" role="status">{msg}</p>}
        </div>
        {decisions.length > 0 && (
          <div className="panel">
            <h2>Your contract decisions</h2>
            <p className="note">Team option – whether to keep the player next season at the salary in his contract. Qualifying offer – if you tender it, the player becomes a restricted free agent: you can match other teams' offers, and if nobody offers, he plays for you for one year at this amount. If you don't choose, the GM decides (his recommendation is marked).</p>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th className="l">Player</th><th>Age</th><th>OVR</th><th className="l">Decision</th><th>Salary</th><th className="l">GM suggests</th><th></th></tr></thead>
              <tbody>{decisions.map((d: any) => {
                const p = lg.players[d.pid];
                const yes = d.choice ?? null;
                return <tr key={d.pid}>
                  <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos}</span></td>
                  <td>{ageIn(p, N)}</td><td><Ovr v={ovrOf(p.z)} /></td>
                  <td className="l">{d.kind === 'team' ? 'Team option' : 'Qualifying offer'}</td>
                  <td>{moneyOf(d.sal, N)}</td>
                  <td className="l dim">{d.rec ? (d.kind === 'team' ? 'keep' : 'tender') : (d.kind === 'team' ? 'decline' : 'don\'t tender')}</td>
                  <td className="l">
                    <button className={`small ${yes === true ? 'primary' : ''}`} onClick={() => act(() => faDecide(lg, d.pid, true))}>{d.kind === 'team' ? 'Keep' : 'Tender'}</button>{' '}
                    <button className={`small ${yes === false ? 'primary' : ''}`} onClick={() => act(() => faDecide(lg, d.pid, false))}>{d.kind === 'team' ? 'Decline' : 'Don\'t tender'}</button>
                  </td>
                </tr>;
              })}</tbody>
            </table></div>
          </div>
        )}
        {sheets.length > 0 && (
          <div className="panel accent">
            <h2>Offer sheets for your RFAs</h2>
            <p className="note">Another team signed your restricted free agent to an offer sheet. Match it and he stays with you on the same terms (you can go over the cap, up to the hard cap), or let him go. If you do nothing, the GM decides at the end of the wave.</p>
            <ul className="news">{sheets.map((sh: any) => {
              const p = lg.players[sh.pid];
              return <li key={sh.pid}><span className="yr">{lg.teams[sh.tid].abbr}</span><span><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">OVR {ovrOf(p.z)}, age {ageIn(p, N)} · {moneyOf(sh.sal, N)} through {sh.exp}</span>{' '}
                <button className="small primary" onClick={() => act(() => faMatch(lg, sh.pid, true))}>Match</button>{' '}
                <button className="small" onClick={() => act(() => faMatch(lg, sh.pid, false))}>Let go</button></span></li>;
            })}</ul>
          </div>
        )}
        {pending.length > 0 && (
          <div className="panel">
            <h2>Your players with expired contracts</h2>
            <p className="note">In this wave only you can negotiate with them, and you can go over the cap (up to the hard cap). If you do nothing, the GM decides at the end of the wave.</p>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th className="l">Player</th><th>Age</th><th>OVR</th><th>Pot</th><th>Asks</th><th></th></tr></thead>
              <tbody>{pending.map((p: any) => {
                const need = faDemand(lg, p, u.tid);
                return <tr key={p.id}>
                  <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos}</span></td>
                  <td>{ageIn(p, N)}</td><td><Ovr v={ovrOf(p.z)} /></td><td>{potOf(p, N)}</td>
                  <td>{moneyOf(need, N)}</td>
                  <td className="l"><button className="small primary" onClick={() => act(() => faOffer(lg, p.id, need))}>Re-sign</button> <button className="small" onClick={() => act(() => faRenounce(lg, p.id))}>Let go</button></td>
                </tr>;
              })}</tbody>
            </table></div>
          </div>
        )}
        <div className="panel">
          <h2>Best remaining free agents</h2>
          <ul className="news">{top.map((p: any) => <li key={p.id}><span className="yr">{ovrOf(p.z)}</span><span><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos} · age {ageIn(p, N)} · asks {moneyOf(u ? faDemand(lg, p, u.tid) : askingSalary(p, N), N)}</span></span></li>)}</ul>
          {!top.length && <p className="note">No players left on the market.</p>}
        </div>
      </section>
      <section className="col">
        {stages.filter(x => x.s <= fa.stage).reverse().map(({ s, log }) => (
          <div className="panel" key={s}>
            <h2>{s ? `Wave ${s}` : 'Contract decisions'} {s === fa.stage && s <= 3 ? '(in progress)' : ''}</h2>
            {(() => {
              // routine: AI teams exercising options – one summary line instead of dozens
              const routine = log.filter((x: any) => x.kind === 'option' && !x.user && x.tid !== lg.userTid && (x.desc ?? '').includes('team exercised'));
              const shown = log.filter((x: any) => !routine.includes(x));
              return <>
                {routine.length > 0 && <p className="note">Teams exercised {routine.length} options (players stay).</p>}
                {shown.length ? <ul className="news">{shown.slice(0, 80).map(entry)}</ul> : !routine.length && <p className="note">{s === fa.stage ? 'Quiet so far – AI teams act at the end of the wave.' : 'Nothing happened.'}</p>}
              </>;
            })()}
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- free agents list
export function FreeAgentsView({ lg, onChange, openPlayer }: any) {
  const [pos, setPos] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [rel, setRel] = useState<string | null>(null);
  const N = lg.season;
  const cap = seasonInfo(N).cap;
  const u = lg.userTid ? lg.teams[lg.userTid] : null;
  const canSign = u && (lg.phase === 'freeagency' || lg.phase === 'regular');
  const list = Object.values(lg.players).filter((p: any) => (isFreeAgent(lg, p) || (lg.fa?.stage === 1 && lg.fa.pending.includes(p.id))) && posOk(p, pos));
  const rows = list.map((p: any) => ({ key: p.id, p, l: lastLine(p), need: u ? faDemand(lg, p, u.tid) : askingSalary(p, N) }));
  const pick = (r: any) => { setSel(r.p.id); setAmount((Math.ceil(r.need * cap * 100) / 100).toFixed(2)); setMsg(null); };
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button>{r.p.bird && r.p.bird === lg.userTid ? <span className="chip tiny">yours</span> : null}{r.p.rfa ? <span className="chip tiny rfa" title={`Restricted free agent: the ${lg.teams[r.p.rfa]?.name} can match an offer`}>RFA {lg.teams[r.p.rfa]?.abbr}</span> : null}</> },
    { key: 'pos', label: 'Pos', get: (r: any) => posNum(r.p.pos), fmt: (_: any, r: any) => <span className="dim">{r.p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, N) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', get: (r: any) => potOf(r.p, N) },
    ...SHOW.map(i => ({ key: 'r' + i, label: RATING_LABELS[i].short, title: RATING_LABELS[i].name, get: (r: any) => R(r.p, i) })),
    { key: 'ls', label: 'Last season', title: 'Last season played', get: (r: any) => r.l?.s ?? null, fmt: (v: any) => v ?? '–' },
    { key: 'pts', label: 'Pts', get: (r: any) => (r.l?.gp ? r.l.pts / r.l.gp : null), fmt: f1 },
    { key: 'reb', label: 'Reb', get: (r: any) => (r.l?.gp ? (r.l.orb + r.l.drb) / r.l.gp : null), fmt: f1 },
    { key: 'ast', label: 'Ast', get: (r: any) => (r.l?.gp ? r.l.ast / r.l.gp : null), fmt: f1 },
    { key: 'need', label: 'Asks', get: (r: any) => r.need, fmt: (v: any) => moneyOf(v, N) },
    ...(u ? [{ key: 'disc', label: 'For you', title: 'Discount he gives your team (+) or premium he wants (−) compared to his market price', get: (r: any) => discount(lg, r.p, u.tid), fmt: (v: any, r: any) => <span className={v > 0.02 ? 'pos' : v < -0.02 ? 'neg' : 'dim'} title={reasons(lg, r.p, u.tid).map(x => x.t).join('; ') || 'he doesn\'t mind either way'}>{v > 0 ? '+' : ''}{Math.round(v * 100)}%</span> }] : []),
    ...(canSign ? [{ key: 'act', label: '', get: () => 0, fmt: (_: any, r: any) => <button className={`small ${sel === r.p.id ? 'primary' : ''}`} onClick={() => pick(r)}>Negotiate</button> }] : []),
  ];
  const sp = sel ? lg.players[sel] : null;
  const pay = u ? payroll(lg, u.tid) : 0;
  const send = () => {
    const sal = Math.max(MIN_SAL, (parseFloat(amount.replace(',', '.')) || 0) / cap);
    const r = faOffer(lg, sel!, sal);
    setMsg(r.msg);
    if (r.ok) setSel(null);
    onChange();
  };
  const mine = u ? u.roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)) : [];
  return (
    <div className="grid-2 fa-grid">
      <section className="panel">
        <div className="team-head">
          <h2>Free agents</h2>
          <span className="dim">{rows.length} unsigned players</span>
        </div>
        <p className="note">
          {lg.phase === 'freeagency' ? `Free agency is underway (wave ${Math.min(3, lg.fa?.stage ?? 3)}). Asking prices drop with every wave.`
            : lg.phase === 'regular' ? 'During the season you can sign a player if you have fewer than 15 and fit under the cap (a minimum contract always works).'
            : 'You can sign players in free agency and during the regular season.'}
          {u ? ` Asking prices are for your team: players come cheaper to a strong team and where they'll get a big role.` : ''}
        </p>
        <div className="def-row">
          <div className="seg" role="group" aria-label="Position">{POS.map(([k, l]) => <button key={k} className={pos === k ? 'on' : ''} onClick={() => setPos(k)}>{l}</button>)}</div>
        </div>
        {sp && canSign && (
          <div className="offer" role="group" aria-label="Offer">
            <div><b>{sp.name}</b> <span className="dim">{sp.pos} · age {ageIn(sp, N)} · OVR {ovrOf(sp.z)} · asks {moneyOf(faDemand(lg, sp, u.tid), N)} · max contract {moneyOf(maxSalary(sp, N), N)}</span></div>
            <div className="dim">{reasons(lg, sp, u.tid).length ? `About your team: ${reasons(lg, sp, u.tid).map(x => x.t).join('; ')}.` : 'He cares about the terms, not the team.'}{sp.rfa && sp.rfa !== u.tid ? ` Restricted free agent – the ${lg.teams[sp.rfa].name} can match your offer.` : ''}</div>
            <label>Salary per season, $M <input type="number" step="0.05" min={(MIN_SAL * cap).toFixed(2)} value={amount} onChange={e => setAmount(e.target.value)} /></label>
            <button className="primary" onClick={send}>Offer</button>
            <button className="ghost" onClick={() => setSel(null)}>Cancel</button>
            <span className="dim">Min {moneyOf(MIN_SAL, N)} · your payroll {Math.round(pay * 100)}% of the cap</span>
          </div>
        )}
        {msg && <p className="hint" role="status">{msg}</p>}
        <SortTable cols={cols} rows={rows} initial="ovr" limit={150} />
      </section>
      {u && (
        <section className="panel">
          <h2>{u.name}</h2>
          <p className="note">{u.roster.length} players (13–15 allowed) · payroll {moneyOf(pay, N)} ({Math.round(pay * 100)}% of the cap). A released player's salary stays on the books until his contract ends.</p>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th className="l">Player</th><th>OVR</th><th className="l">Contract</th><th></th></tr></thead>
            <tbody>{mine.map((p: any) => <tr key={p.id}>
              <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos}</span></td>
              <td><Ovr v={ovrOf(p.z)} /></td>
              <td className="l dim">{moneyOf(p.contract.sal, N)} through {p.contract.exp}</td>
              <td>{canSign && (rel === p.id
                ? <><button className="small danger" onClick={() => { const r = faRelease(lg, p.id); setMsg(r.msg); setRel(null); onChange(); }}>Really release</button> <button className="small ghost" onClick={() => setRel(null)}>No</button></>
                : <button className="small" onClick={() => setRel(p.id)}>Release</button>)}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
