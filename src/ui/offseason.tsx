// @ts-nocheck
// Off-season screens: draft day (one pick at a time), the free-agency hub
// (three stages) and the free-agent list where the user makes offers.
import { Linkify, PL, TL, nav } from './nav';
import { RoleCell, roleSortKey } from './roles';
import { money, usd, showDollars, dollarsOf } from './money';
import { useMemo, useState } from 'react';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm, RATING_LABELS, ratingOf, seasonInfo } from '../data';
import { ageIn } from '../players';
import { peakBpm, payroll, askingSalary, MIN_SAL, maxSalary, hardCap } from '../ai/value';
import { discount, reasons, preferredYears, lengthPrice, offerUtility } from '../league/prefs';
import { isFreeAgent } from '../ai/trades';
import {
  initDraft, draftOnClock, draftAdvance, draftPick, draftSuggest, finishDraft,
  enterFreeAgency, faStage, startSeason, faOffer, faDemand, offersOn, withdrawOffer, faRenounce, faRelease, faDecide, faMatch, prevTeam, faOffersFor,
} from '../league/offseason';
import { DecisionsBoard } from './offsteps';
import { isHuman } from '../league/humans';
import { OthersWaiting } from './humans';
import { SortTable, f1 } from './sorttable';
import { ExpansionRoom, LotteryRoom, LotteryReveal, AutoControls, useAutoPlay } from './draftday';
import { posNum } from '../engine/game';

export const moneyOf = (frac: number, s: number) => money(frac, s);
export const potOf = (p: any, s: number) => shownFromBpm(peakBpm(p, s));
const R = (p: any, i: number) => ratingOf(p.z[RATING_LABELS[i].k], RATING_LABELS[i].inv);
/** Height and every rating, for lists where you choose players without opening their cards. */
export function attrCols(pOf: (r: any) => any, S: number) {
  return [
    { key: 'role', label: 'Role', left: true, asc: true, title: 'Archetype – for a young player without a clear role yet, what he projects to become (proj.)', get: (r: any) => roleSortKey(pOf(r), S), fmt: (_: any, r: any) => <RoleCell p={pOf(r)} S={S} /> },
    { key: 'ht', label: 'Ht', title: 'Height, cm', get: (r: any) => Math.round(pOf(r).ht * 2.54) },
    ...RATING_LABELS.map((L, i) => ({ key: 'r' + i, label: L.short, title: L.name + (L.tendency ? ' (a tendency, not a skill)' : ''), get: (r: any) => R(pOf(r), i), fmt: (v: any) => L.tendency ? <span className="dim">{v}</span> : v })),
  ];
}
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
  // draft-day trades pop up as they happen (and stay in the pick list)
  const nTrades = lg.draftDay?.trades?.length ?? 0;
  const [seen, setSeen] = useState(nTrades);
  const act = (fn: () => void) => { fn(); onChange(); };
  useAutoPlay(playing, speed, () => {
    const c = draftOnClock(lg);
    if (!c) return false;
    if (isHuman(lg, c.tid)) { lg.userTid = c.tid; return false; } // hot seat: that team picks
    const before = lg.draftDay?.trades?.length ?? 0;
    draftAdvance(lg, 'one'); onTick();
    if ((lg.draftDay?.trades?.length ?? 0) > before) return false; // a trade: stop so it can be seen
    const nx = draftOnClock(lg);
    return !!nx && !isHuman(lg, nx.tid);
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
    return isHuman(lg, owner);
  });
  const board = d.pool.map((pid: string) => lg.players[pid]).filter((p: any) => posOk(p, pos));
  const suggestion = myTurn ? draftSuggest(lg, lg.userTid) : null;
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (p: any) => p.name, fmt: (v: any, p: any) => <button className="link" onClick={() => openPlayer(p.id)}>{v}</button> },
    { key: 'pos', label: 'Pos', get: (p: any) => posNum(p.pos), fmt: (_: any, p: any) => <span className="dim">{p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (p: any) => ageIn(p, d.year + 1) },
    { key: 'ovr', label: 'OVR', get: (p: any) => ovrOf(p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', title: 'Potential – the GM\'s estimate of how good he can become', get: (p: any) => potOf(p, d.year + 1) },
    ...attrCols((p: any) => p, d.year + 1),
    { key: 'act', label: '', get: () => 0, fmt: (_: any, p: any) => myTurn ? <button className={`small ${p.id === suggestion ? 'primary' : ''}`} onClick={() => act(() => draftPick(lg, p.id))}>Pick</button> : null },
  ];
  const recent = [...d.picks].reverse();
  const trades = d.trades ?? [];
  const fresh = trades.slice(seen);
  // picks and trades in one list, newest first (a trade at index i happened just before pick i + 1)
  const feed = [...recent.map((x: any) => ({ k: 'p', at: x.pick - 1 + 0.5, x })), ...trades.map((t: any, i: number) => ({ k: 't', at: t.at, x: t, i }))].sort((a, b) => b.at - a.at);
  return (
    <>
    {fresh.length > 0 && (
      <div className="overlay center" onClick={() => setSeen(trades.length)}>
        <div className="dialog trade-pop" role="dialog" aria-label="Draft-day trade" onClick={e => e.stopPropagation()}>
          <div className="eyebrow">Draft-day trade{fresh.length > 1 ? `s (${fresh.length})` : ''}</div>
          {fresh.map((t: any, i: number) => (
            <div key={i} className="trade-pop-row">
              <h2>{lg.teams[t.up]?.name} trade up to No. {t.to}</h2>
              <p><Linkify text={t.text} /></p>
            </div>
          ))}
          <div className="dialog-actions"><button className="primary" onClick={() => setSeen(trades.length)}>OK</button></div>
        </div>
      </div>
    )}
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
          {!myTurn && myLeft && <button disabled={playing} onClick={() => act(() => draftAdvance(lg, 'user'))}>{(lg.humans?.length ?? 0) > 1 ? 'To the next human pick' : 'To my pick'}</button>}
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
              {feed.slice(0, 50).map((f: any) => f.k === 't' ? (
                <li key={'t' + f.i} className="pop-in trade-li"><span className="yr">⇄</span><span><b>Trade:</b> <Linkify text={f.x.text} /></span></li>
              ) : (
                <li key={f.x.pick} className={`pop-in ${f.x.tid === lg.userTid ? 'mine' : ''}`}>
                  <span className="yr">{f.x.pick}</span>
                  <span><b>{lg.teams[f.x.tid].abbr}</b>{f.x.via ? <span className="dim"> (via {lg.teams[f.x.via].abbr})</span> : null} <button className="link" onClick={() => openPlayer(f.x.pid)}>{lg.players[f.x.pid].name}</button> <span className="dim">{lg.players[f.x.pid].pos} · OVR {ovrOf(lg.players[f.x.pid].z)} · pot {potOf(lg.players[f.x.pid], d.year + 1)}</span></span>
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
    </>
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
  'Contract decisions before the market opens: players decide on their player options, teams on team options and qualifying offers for younger players (restricted free agents, RFA). Other teams can make offers to an RFA, but his team can match and keep him. Trading is open before you confirm: clear salary first if you need room to keep an option – a player traded with an open option takes it with him, and his new team decides.',
  'First wave: the top free agents ask for full price and some wait for better offers. Only you can make offers to your own players whose contracts ended.',
  'Second wave: asking prices drop (~15%) and most players with offers sign. Teams are actively looking for trades.',
  'Final wave: the remaining players accept ~70% of their original ask. After it, teams fill their rosters to the minimum and the season begins.',
];

export function FAHub({ lg, onChange, openPlayer, openTeam, goFA }: any) {
  const fa = lg.fa;
  const [msg, setMsg] = useState<string | null>(null);
  const [offersOf, setOffersOf] = useState<string | null>(null);
  // the market right now: which teams would make each of the best free agents an offer
  const market = useMemo(() => {
    const m = new Map<string, any[]>();
    if (!fa || fa.stage < 1 || fa.stage > 3) return m;
    const top = Object.values(lg.players).filter((p: any) => isFreeAgent(lg, p)).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)).slice(0, 80);
    for (const p of top as any[]) m.set(p.id, faOffersFor(lg, p));
    return m;
  }, [fa?.stage, fa?.log.length, lg.trades?.length]);
  if (!fa) return null;
  if (fa.stage === 1 && !fa.sumSeen) return <OptionsSummary lg={lg} openPlayer={openPlayer} onOpen={() => { fa.sumSeen = true; onChange(); try { window.scrollTo({ top: 0 }); } catch { /* */ } }} />;
  const act = (fn: () => any) => { const r = fn(); if (r?.msg) setMsg(r.msg); onChange(); };
  const [neg, setNeg] = useState<string | null>(null);
  const N = lg.season;
  const u = lg.userTid ? lg.teams[lg.userTid] : null;
  const pay = u ? payroll(lg, u.tid) : 0;
  const capLim = N < 1985 ? 1.3 : 1.0;
  const pending = fa.stage === 1 ? fa.pending.map((pid: string) => lg.players[pid]).filter((p: any) => (p.bird ?? lg.userTid) === lg.userTid) : [];
  const top = Object.values(lg.players).filter((p: any) => isFreeAgent(lg, p)).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)).slice(0, 8);
  const stages = [0, 1, 2, 3].map(s => ({ s, log: fa.log.filter((x: any) => x.st === s) }));
  const decisions = fa.stage === 0 ? (fa.decisions ?? []).filter((d: any) => (d.tid ?? lg.userTid) === lg.userTid || (d.kind === 'team' && lg.players[d.pid]?.tid === lg.userTid)) : [];
  const sheets = (fa.sheets ?? []).filter((sh: any) => (lg.players[sh.pid]?.rfa ?? lg.userTid) === lg.userTid);
  const entry = (x: any, i: number) => {
    const p = x.pid ? lg.players[x.pid] : null;
    if (x.kind === 'trade') return <li key={i}><span className="yr">⇄</span><span><Linkify text={x.desc} /></span></li>;
    if (!p) return null;
    const who = <button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>;
    const team = x.tid ? lg.teams[x.tid].abbr : '';
    const k = { sign: 'signed', resign: 're-signed', release: 'released', leave: 'hit the market', option: 'option', qo: 'qualifying offer (RFA)', match: 'matched', sheet: 'offer sheet to an RFA' }[x.kind];
    return <li key={i} className={x.tid === lg.userTid ? 'mine' : ''}><span className="yr">{x.tid ? <TL tid={x.tid} abbr /> : team}</span><span>{who} <span className="dim">OVR {ovrOf(p.z)}, age {ageIn(p, N)} · {k}{x.sal ? ` · ${moneyOf(x.sal, N)}${x.exp ? ` through ${x.exp}` : ''}` : ''}{x.desc ? <> · <Linkify text={x.desc} /></> : ''}</span></span></li>;
  };
  const tradesAll = fa.log.filter((x: any) => x.kind === 'trade').reverse();
  const signed = fa.log.filter((x: any) => x.pid && lg.players[x.pid] && x.st >= 1 && ['sign', 'resign', 'match', 'sheet', 'qo'].includes(x.kind) && !(x.kind === 'sheet' && (x.desc ?? '').includes('awaiting')))
    .map((x: any, i: number) => ({ ...x, key: i, p: lg.players[x.pid] }));
  const avail = Object.values(lg.players).filter((p: any) => isFreeAgent(lg, p) && ovrOf(p.z) >= 55).map((p: any) => ({ key: p.id, p, from: prevTeam(p) }));
  const nm = (p: any) => <button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>;
  const tm = (tid: string) => tid && lg.teams[tid] ? <TL tid={tid} abbr /> : <span className="dim">–</span>;
  const availCols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (_: any, r: any) => <>{nm(r.p)}{r.p.rfa ? <span className="chip tiny rfa" title={`Restricted: the ${lg.teams[r.p.rfa]?.name} can match`}>RFA</span> : null}</> },
    { key: 'pos', label: 'Pos', get: (r: any) => posNum(r.p.pos), fmt: (_: any, r: any) => <span className="dim">{r.p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, N) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', get: (r: any) => potOf(r.p, N) },
    { key: 'from', label: 'Last team', left: true, get: (r: any) => lg.teams[r.from]?.abbr ?? '', fmt: (_: any, r: any) => tm(r.from) },
    { key: 'ask', label: 'Asks', get: (r: any) => (u ? faDemand(lg, r.p, u.tid, preferredYears(r.p, N)) : askingSalary(r.p, N)), fmt: (v: any) => moneyOf(v, N) },
    { key: 'int', label: 'Interest', title: 'AI teams that would make him an offer right now – the one he likes best first', left: true, get: (r: any) => market.get(r.p.id)?.length ?? -1,
      fmt: (_: any, r: any) => { const o = market.get(r.p.id); if (!o) return <span className="dim">–</span>; if (!o.length) return <span className="dim">no offers</span>;
        return <button className="link-btn" onClick={() => setOffersOf(r.p.id)} title={`${o.length} teams would offer – leaning towards ${lg.teams[o[0].tid].name}. Click for all offers.`}><b>{o.length}</b> <span className="dim">→</span> {lg.teams[o[0].tid].abbr} <span className="chip tiny">offers</span></button>; } },
    ...attrCols((r: any) => r.p, N),
  ];
  const signedCols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (_: any, r: any) => nm(r.p) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, N) },
    { key: 'from', label: 'From', left: true, get: (r: any) => lg.teams[r.from]?.abbr ?? '', fmt: (_: any, r: any) => tm(r.from) },
    { key: 'to', label: 'To', left: true, get: (r: any) => lg.teams[r.tid]?.abbr ?? '', fmt: (_: any, r: any) => <b>{tm(r.tid)}</b> },
    { key: 'sal', label: 'Salary', get: (r: any) => r.sal ?? 0, fmt: (v: any) => moneyOf(v, N) },
    { key: 'yrs', label: 'Yrs', get: (r: any) => (r.exp ? r.exp - N + 1 : 1) },
    { key: 'st', label: 'Wave', get: (r: any) => r.st, fmt: (v: any, r: any) => <span className="dim" title={r.desc ?? ''}>{v >= 4 ? 'late' : `W${v}`}{r.kind === 'match' ? ' ✓' : r.kind === 'qo' ? ' QO' : r.kind === 'resign' ? ' ↺' : ''}</span> },
  ];
  return (
    <div className="col">
    {offersOf && <OffersDialog lg={lg} p={lg.players[offersOf]} offers={market.get(offersOf) ?? faOffersFor(lg, lg.players[offersOf])} close={() => setOffersOf(null)} openPlayer={openPlayer} />}
    <div className="grid-2">
      <section className="col">
        <div className="panel accent">
          <div className="team-head">
            <h2>{fa.stage === 0 ? `Options & contract decisions · ${N - 1}–${String(N).slice(2)}` : `Free agency · ${N - 1}–${String(N).slice(2)}`}</h2>
            {fa.stage > 0 && <div className="seg stage-seg" aria-label="Free agency stages">{[1, 2, 3].map(s => <span key={s} className={`chip ${fa.stage === s ? 'on-clock' : fa.stage > s ? 'past' : ''}`}>Wave {s}</span>)}</div>}
          </div>
          <p className="note">{fa.stage <= 3 ? STAGE_TXT[fa.stage] : 'Free agency is over. When the season starts, teams with fewer than 13 players will sign minimum deals, and teams with more than 15 will release their weakest.'}</p>
          {u && <div className="kv">
            <div><span className="dim">{u.name}</span> {u.roster.length} players · payroll {Math.round(pay * 100)}% of the cap{usd(pay, N)} {hardCap(lg) < Infinity ? <> · room under the cap ({Math.round(hardCap(lg) * 100)}%): <b className={pay > hardCap(lg) ? 'neg' : ''}>{Math.round((hardCap(lg) - pay) * 100)}%</b></> : <> · cap space {Math.max(0, Math.round((capLim - pay) * 100))}%{N >= 1995 ? ` · mid-level exception ${fa.mle.includes(u.tid) ? 'used' : 'available'}` : ''}</>}</div>
          </div>}
          <div className="def-row">
            {fa.stage <= 3
              ? <button className="primary" onClick={() => act(() => faStage(lg))}>{fa.stage === 0 ? 'Confirm decisions →' : `Finish wave ${fa.stage} →`}</button>
              : <button className="primary" onClick={() => act(() => startSeason(lg))}>To the season preview →</button>}
            <button onClick={goFA}>All free agents</button>
          </div>
          {msg && <p className="hint" role="status">{msg}</p>}
        </div>
        <OthersWaiting lg={lg} onChange={onChange} />
        {decisions.length > 0 && (
          <div className="panel">
            <h2>Your contract decisions</h2>
            {(() => {
              const u = lg.userTid, hc = hardCap(lg);
              if (!u || hc === Infinity) return null;
              const off = decisions.filter((d: any) => d.kind === 'team' && lg.players[d.pid].tid === u && (d.choice ?? d.rec) === false).reduce((a: number, d: any) => a + d.sal, 0);
              const pay = payroll(lg, u) - off;
              return <p className={pay > hc ? 'hint warn-t' : 'note'}>Payroll with these choices: <b>{Math.round(pay * 100)}%</b> of the cap (hard cap {Math.round(hc * 100)}%).{pay > hc ? ' Over the hard cap – trade salary away or decline an option before you confirm.' : ''}</p>;
            })()}
            <p className="note">Team option – whether to keep the player next season at the salary in his contract. Qualifying offer – if you tender it, the player becomes a restricted free agent: you can match other teams' offers, and if nobody offers, he plays for you for one year at this amount. If you don't choose, the GM decides (his recommendation is marked).</p>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th className="l">Player</th><th>Age</th><th>OVR</th><th className="l">Decision</th><th>Salary</th><th className="l">GM suggests</th><th></th></tr></thead>
              <tbody>{decisions.map((d: any) => {
                const p = lg.players[d.pid];
                const yes = d.choice ?? null;
                if (d.kind === 'team' && p.tid !== lg.userTid && (d.tid ?? lg.userTid) === lg.userTid) return <tr key={d.pid}><td className="l">{p.name}</td><td colSpan={6} className="l dim">Traded – the option went with him; {p.tid ? lg.teams[p.tid].name : 'his new team'} decide{p.tid ? '' : 's'}.</td></tr>;
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
              <thead><tr><th className="l">Player</th><th>Age</th><th>OVR</th><th>Pot</th><th title="For the length he would pick himself">Asks</th><th></th></tr></thead>
              <tbody>{pending.map((p: any) => {
                const need = faDemand(lg, p, u.tid, preferredYears(p, N));
                return <tr key={p.id}>
                  <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos}</span></td>
                  <td>{ageIn(p, N)}</td><td><Ovr v={ovrOf(p.z)} /></td><td>{potOf(p, N)}</td>
                  <td>{moneyOf(need, N)}</td>
                  <td className="l"><button className={`small ${neg === p.id ? '' : 'primary'}`} onClick={() => setNeg(neg === p.id ? null : p.id)}>{neg === p.id ? 'Close' : 'Negotiate'}</button> <button className="small" onClick={() => act(() => faRenounce(lg, p.id))}>Let go</button></td>
                </tr>;
              })}</tbody>
            </table></div>
            {neg && pending.some((p: any) => p.id === neg) && <FAOfferBox key={neg} lg={lg} p={lg.players[neg]} onDone={(r: any) => { setMsg(r.msg); if (r.ok) setNeg(null); onChange(); }} onCancel={() => setNeg(null)} />}
          </div>
        )}
      </section>
      <section className="col">
        {fa.stage === 0 ? <DecisionsBoard lg={lg} openPlayer={openPlayer} /> : (
          <div className="panel fa-trades">
            <h2>Trades this summer</h2>
            {tradesAll.length ? <ul className="news">{tradesAll.slice(0, 30).map((x: any, i: number) => <li key={i}><span className="yr">{x.st ? `W${x.st}` : '⇄'}</span><span><Linkify text={x.desc} /></span></li>)}</ul> : <p className="note">No trades yet – AI teams talk at the end of each wave.</p>}
          </div>
        )}
      </section>
    </div>
    {fa.stage >= 1 && (
      <div className="grid-2">
        <section className="panel">
          <div className="team-head"><h2>Still available</h2><span className="dim">{avail.length} players (OVR 55+)</span><button className="small" onClick={goFA}>Make offers</button></div>
          <SortTable cols={availCols} rows={avail} initial="ovr" limit={60} />
        </section>
        <section className="panel">
          <div className="team-head"><h2>Signed</h2><span className="dim">{signed.length} deals · ✓ matched offer sheet · ↺ re-signed · QO played on the qualifying offer</span></div>
          {signed.length ? <SortTable cols={signedCols} rows={signed} initial="ovr" limit={120} rowClass={(r: any) => (r.tid === lg.userTid ? 'mine' : '')} /> : <p className="note">Nobody has signed yet – deals are done at the end of each wave.</p>}
        </section>
      </div>
    )}
    {fa.stage >= 1 && (
      <div className="panel">
        <h2>All moves, wave by wave</h2>
        {stages.filter(x => x.s <= fa.stage).reverse().map(({ s, log }) => {
          const routine = log.filter((x: any) => x.kind === 'option' && !x.user && x.tid !== lg.userTid && (x.desc ?? '').includes('team exercised'));
          const shown = log.filter((x: any) => !routine.includes(x));
          return <div key={s}>
            <h3>{s ? `Wave ${s}` : 'Contract decisions'} {s === fa.stage && s <= 3 ? '(in progress)' : ''}</h3>
            {routine.length > 0 && <p className="note">Teams exercised {routine.length} options (players stay).</p>}
            {shown.length ? <ul className="news">{shown.slice(0, 80).map(entry)}</ul> : !routine.length && <p className="note">{s === fa.stage ? 'Quiet so far – AI teams act at the end of the wave.' : 'Nothing happened.'}</p>}
          </div>;
        })}
      </div>
    )}
    </div>
  );
}

/** After the contract decisions: what happened, and who is on the market. */
function OptionsSummary({ lg, openPlayer, onOpen }: any) {
  const fa = lg.fa, N = lg.season;
  const log = fa.log.filter((x: any) => x.st === 0 && x.pid && lg.players[x.pid]);
  const d = (x: any) => x.desc ?? '';
  const groups = [
    ['Team options picked up', log.filter((x: any) => x.kind === 'option' && /exercised the option|you exercised/.test(d(x)))],
    ['Team options declined', log.filter((x: any) => x.kind === 'option' && /team declined|you declined/.test(d(x)))],
    ['Players opting out', log.filter((x: any) => x.kind === 'option' && /declined his player option/.test(d(x)))],
    ['Players opting in', log.filter((x: any) => x.kind === 'option' && /exercised his player option/.test(d(x)))],
    ['Re-signed before the market', log.filter((x: any) => x.kind === 'resign')],
    ['Qualifying offers (restricted)', log.filter((x: any) => x.kind === 'qo')],
  ] as const;
  const market = Object.values(lg.players).filter((p: any) => isFreeAgent(lg, p) || fa.pending.includes(p.id)).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z)).slice(0, 15);
  const row = (x: any, i: number) => { const p = lg.players[x.pid]; return <li key={i} className={x.tid === lg.userTid ? 'mine' : ''}><span className="yr">{x.tid ? <TL tid={x.tid} abbr /> : ''}</span><span><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">OVR {ovrOf(p.z)}, age {ageIn(p, N)}{x.sal && x.kind !== 'option' ? ` · ${moneyOf(x.sal, N)}${x.exp ? ` through ${x.exp}` : ''}` : ''}</span></span></li>; };
  return (
    <div className="col">
      <div className="panel accent step-head">
        <div className="team-head">
          <h2>Contract decisions are in</h2>
          <button className="primary" onClick={onOpen}>Open the market →</button>
        </div>
        <p className="note">What every team decided before free agency – and who is now on the market.</p>
      </div>
      <div className="grid-2">
        <section className="col">
          {groups.map(([t, xs]: any) => (
            <div className="panel" key={t}>
              <h2>{t} <span className="dim">({xs.length})</span></h2>
              {xs.length ? <ul className="news">{[...xs].sort((a: any, b: any) => ovrOf(lg.players[b.pid].z) - ovrOf(lg.players[a.pid].z)).slice(0, 15).map(row)}</ul> : <p className="note">None.</p>}
              {xs.length > 15 && <p className="note">…and {xs.length - 15} more.</p>}
            </div>
          ))}
        </section>
        <section className="col">
          <div className="panel">
            <h2>Best players on the market</h2>
            <ul className="news">{market.map((p: any) => <li key={p.id}><span className="yr">{ovrOf(p.z)}</span><span><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos} · age {ageIn(p, N)} · last with {lg.teams[prevTeam(p)]?.abbr ?? '–'}{p.rfa ? ` · restricted (${lg.teams[p.rfa]?.abbr} can match)` : ''}{fa.pending.includes(p.id) ? (p.bird && p.bird !== lg.userTid ? ` · ${lg.teams[p.bird]?.abbr} negotiate first` : ' · your player – you negotiate first') : ''}</span></span></li>)}</ul>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Every offer a free agent has on the table right now, and how much he likes each one. */
function OffersDialog({ lg, p, offers: ai, close, openPlayer }: any) {
  const N = lg.season, u = lg.userTid;
  const ask0 = ai[0]?.ask ?? askingSalary(p, N);
  const offers = [...ai, ...offersOn(lg, p.id).map((o: any) => ({ tid: o.tid, sal: o.sal, yrs: o.yrs, score: offerUtility(lg, p, o.tid, o.sal, ask0, o.yrs), human: true, short: o.sal + 1e-9 < faDemand(lg, p, o.tid, o.yrs) }))]
    .sort((a: any, b: any) => (a.short ? 1 : 0) - (b.short ? 1 : 0) || b.score - a.score);
  const best = Math.max(0.01, ...offers.map((o: any) => o.score));
  return (
    <div className="overlay center" onClick={close}>
      <div className="dialog offers-dlg" role="dialog" aria-label={`Offers for ${p.name}`} onClick={e => e.stopPropagation()}>
        <div className="team-head"><h2>Offers for {p.name}</h2><button className="ghost small" onClick={close}>Close</button></div>
        <p className="note">OVR {ovrOf(p.z)} · age {ageIn(p, N)} · asks about {moneyOf(offers[0]?.ask ?? askingSalary(p, N), N)}{p.rfa ? <> · restricted: the <TL tid={p.rfa} /> can match any offer</> : ''}. What AI teams would offer right now and how much he likes each deal (money against his ask, plus winning, role, loyalty and the city). Offers are made at the end of the wave; until then they can still change.</p>
        {offers.length ? <ul className="offers">
          {offers.map((o: any, i: number) => {
            const why = reasons(lg, p, o.tid).slice(0, 2).map((x: any) => x.t).join('; ');
            return <li key={o.tid} className={i === 0 ? 'lead' : ''}>
              <span className="o-team"><TL tid={o.tid} />{i === 0 ? <span className="chip tiny on-clock">leaning</span> : null}{o.mle ? <span className="chip tiny" title="Mid-level exception">MLE</span> : null}{o.needRoom ? <span className="chip tiny" title="His own team – would clear room to keep him">Bird rights</span> : null}{o.human ? <span className="chip tiny">{o.tid === u ? 'your offer' : 'person'}</span> : null}{o.short ? <span className="chip tiny" title="Under what he asks from this team">under his number</span> : null}</span>
              <span className="o-money"><b>{moneyOf(o.sal, N)}</b> × {o.yrs} yrs</span>
              <span className="o-bar" title={`His interest: ${Math.round(100 * o.score / best)}% of his favourite offer`}><span style={{ width: `${Math.max(4, Math.min(100, 100 * o.score / best))}%` }}></span></span>
              {why && <span className="o-why dim">{why}</span>}
            </li>;
          })}
        </ul> : <p className="note">No AI team would make him an offer right now.</p>}
        {u && <p className="note">From your team he asks {moneyOf(faDemand(lg, p, u), N)}{reasons(lg, p, u).length ? ` (${reasons(lg, p, u).slice(0, 2).map((x: any) => x.t).join('; ')})` : ''}. Make or change your offer under “Free agents” – he answers at the end of the wave.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- free agents list
export function FreeAgentsView({ lg, onChange, openPlayer }: any) {
  const [pos, setPos] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rel, setRel] = useState<string | null>(null);
  const N = lg.season;
  const cap = seasonInfo(N).cap;
  const u = lg.userTid ? lg.teams[lg.userTid] : null;
  const canSign = u && (lg.phase === 'freeagency' || lg.phase === 'regular');
  const list = Object.values(lg.players).filter((p: any) => (isFreeAgent(lg, p) || (lg.fa?.stage === 1 && lg.fa.pending.includes(p.id))) && posOk(p, pos));
  const rows = list.map((p: any) => ({ key: p.id, p, l: lastLine(p), need: u ? faDemand(lg, p, u.tid, preferredYears(p, N)) : askingSalary(p, N) }));
  const pick = (r: any) => { setSel(r.p.id); setMsg(null); };
  const cols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button>{r.p.bird && r.p.bird === lg.userTid ? <span className="chip tiny">yours</span> : null}{offersOn(lg, r.p.id).some((o: any) => o.tid === lg.userTid) ? <span className="chip tiny on-clock" title="You made him an offer">offer made</span> : null}{r.p.rfa ? <span className="chip tiny rfa" title={`Restricted free agent: the ${lg.teams[r.p.rfa]?.name} can match an offer`}>RFA {lg.teams[r.p.rfa]?.abbr}</span> : null}</> },
    { key: 'pos', label: 'Pos', get: (r: any) => posNum(r.p.pos), fmt: (_: any, r: any) => <span className="dim">{r.p.pos}</span> },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, N) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} /> },
    { key: 'pot', label: 'Pot.', get: (r: any) => potOf(r.p, N) },
    ...attrCols((r: any) => r.p, N),
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
        {sp && canSign && <FAOfferBox key={sp.id} lg={lg} p={sp} onDone={(r: any) => { setMsg(r.msg); if (r.ok) setSel(null); onChange(); }} onCancel={() => setSel(null)} />}
        {msg && <p className="hint" role="status">{msg}</p>}
        <SortTable cols={cols} rows={rows} initial="ovr" limit={150} />
      </section>
      {u && (
        <section className="panel">
          <h2>{u.name}</h2>
          <p className="note">{u.roster.length} players (13–15 allowed) · payroll {Math.round(pay * 100)}% of the cap{usd(pay, N)}. A released player's salary stays on the books at half until his contract ends.</p>
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
          {offersOn && (lg.offers ?? []).some((o: any) => o.tid === u.tid) && <>
            <h3>Your open offers</h3>
            <ul className="news">{(lg.offers ?? []).filter((o: any) => o.tid === u.tid).map((o: any) => { const q = lg.players[o.pid]; return <li key={o.pid}><span className="yr">{o.yrs} yr</span><span><button className="link" onClick={() => setSel(o.pid)}>{q.name}</button> <span className="dim">{moneyOf(o.sal, N)} per season · answers {lg.phase === 'freeagency' ? 'at the end of the wave' : 'tomorrow'}</span> <button className="small ghost" onClick={() => { withdrawOffer(lg, o.pid); setMsg('Offer withdrawn.'); onChange(); }}>Withdraw</button></span></li>; })}</ul>
          </>}
        </section>
      )}
    </div>
  );
}

/**
 * Contract talks with a free agent (or one of your own): length and salary. Each length has its own price –
 * a young player wants paying for the free agency he gives up, a veteran takes less for security.
 */
export function FAOfferBox({ lg, p, onDone, onCancel }: any) {
  const N = lg.season;
  const cap = seasonInfo(N).cap;
  const tid = lg.userTid;
  const [years, setYears] = useState(() => preferredYears(p, N));
  const [sal, setSal] = useState<number | null>(null);
  const need = (y: number) => faDemand(lg, p, tid, y);
  const n = need(years);
  const offer = sal ?? n;
  const max = maxSalary(p, N);
  const dol = showDollars(), $ = (x: number) => dollarsOf(x, N, true);
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  const bump = (dx: number) => setSal(Math.max(MIN_SAL, Math.min(max, Math.round((offer + dx) * 10000) / 10000)));
  const why = reasons(lg, p, tid);
  const L = lengthPrice(p, N, years, Math.min(max, askingSalary(p, N)));
  const pay = payroll(lg, tid);
  const pref = preferredYears(p, N);
  // every offer on the table – the AI teams' (what they would bid now) and people's – by how much he likes it
  const ask0 = askingSalary(p, N) * (lg.phase === 'freeagency' ? [1, 1, 0.85, 0.7, 0.7][Math.max(1, Math.min(3, lg.fa?.stage ?? 3))] : 0.7);
  const mineNow = offersOn(lg, p.id).find((o: any) => o.tid === tid);
  const rows = [
    ...faOffersFor(lg, p).map((o: any) => ({ tid: o.tid, sal: o.sal, yrs: o.yrs, score: o.score })),
    ...offersOn(lg, p.id).map((o: any) => ({ tid: o.tid, sal: o.sal, yrs: o.yrs, score: offerUtility(lg, p, o.tid, o.sal, ask0, o.yrs), human: true, mine: o.tid === tid, short: o.sal + 1e-9 < faDemand(lg, p, o.tid, o.yrs) })),
  ].sort((a: any, b: any) => (a.short ? 1 : 0) - (b.short ? 1 : 0) || b.score - a.score);
  const top = Math.max(1e-6, ...rows.map((r: any) => r.score));
  const table = rows.slice(0, 8).map((r: any) => ({ ...r, rel: Math.max(0.05, Math.min(1, r.score / top)) }));
  return (
    <div className="offer ext" role="group" aria-label={`Offer to ${p.name}`}>
      <div><b>{p.name}</b> <span className="dim">{p.pos} · age {ageIn(p, N)} · OVR {ovrOf(p.z)} · max contract {pc(max)}{usd(max, N)} · your payroll {Math.round(pay * 100)}% of the cap</span></div>
      <p className="note">{why.length ? `About your team: ${why.map((x: any) => x.t).join('; ')}.` : 'He cares about the terms, not the team.'}{p.rfa && p.rfa !== tid ? ` Restricted free agent – the ${lg.teams[p.rfa].name} can match your offer.` : ''} He would pick {pref} year{pref > 1 ? 's' : ''} himself.{L.why ? ` For ${years} years: ${L.why}.` : ''}</p>
      <table className="tbl compact ext-years">
        <thead><tr><th className="l">Years</th>{[1, 2, 3, 4, 5].map(y => <th key={y}><button className={`small ${y === years ? 'primary' : ''}`} onClick={() => { setYears(y); setSal(null); }}>{y}</button></th>)}</tr></thead>
        <tbody><tr><td className="l dim">He signs for</td>{[1, 2, 3, 4, 5].map(y => { const v = need(y); return <td key={y} className={y === years ? 'on' : ''}>{pc(v)}{dol && <><br /><span className="dim small-t">{$(v)}</span></>}</td>; })}</tr></tbody>
      </table>
      <div className="ext-adjust">
        <span>Your offer for <b>{years}</b> yr{years > 1 ? 's' : ''}:</span>
        <button className="small" onClick={() => bump(-0.01)} aria-label="1% of the cap less">−1%</button>
        <button className="small" onClick={() => bump(-0.0025)} aria-label="a quarter percent less">−¼</button>
        <b className="ext-amt">{(offer * 100).toFixed(2)}% {dol && <span className="dim">· {$(offer)}</span>}</b>
        <button className="small" onClick={() => bump(0.0025)} aria-label="a quarter percent more">+¼</button>
        <button className="small" onClick={() => bump(0.01)} aria-label="1% of the cap more">+1%</button>
        <button className="small ghost" onClick={() => setSal(null)}>His number</button>
      </div>
      <div className={`ext-chance ${offer + 1e-9 >= n ? 'pos' : offer >= n * 0.93 ? 'mid' : 'neg'}`}>
        {offer + 1e-9 >= n ? <>This meets his number{offer > n + 1e-4 ? ` (you are paying ${((offer - n) * 100).toFixed(2)}% more than you need to)` : ''}. He takes it unless another offer appeals to him more.</>
          : offer >= n * 0.93 ? <>Close: about a <b>1 in 3</b> chance he takes {((1 - offer / n) * 100).toFixed(1)}% less than his number.</>
          : <>Too far under his number ({pc(n)}) – he will say no.</>}
        {' '}He answers {lg.phase === 'freeagency' ? 'at the end of this wave' : 'tomorrow'}.
      </div>
      {table.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th className="l">On the table</th><th>Salary</th><th>Yrs</th><th className="l">He likes it</th><th></th></tr></thead>
        <tbody>{table.map((r: any, i: number) => <tr key={i} className={r.tid === tid ? 'mine' : ''}>
          <td className="l">{lg.teams[r.tid].name}{r.mine ? ' (you)' : r.human ? ' (person)' : ''}</td>
          <td>{pc(r.sal)}</td><td>{r.yrs}</td>
          <td className="l"><span className="o-bar inl"><span style={{ width: `${Math.round(100 * r.rel)}%` }}></span></span>{i === 0 ? <span className="chip tiny">leading</span> : null}{r.short ? <span className="chip tiny neg">under his number</span> : null}</td>
          <td>{r.mine ? <button className="small ghost" onClick={() => { withdrawOffer(lg, p.id); onDone({ ok: false, msg: 'Offer withdrawn.' }); }}>Withdraw</button> : null}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="def-row">
        <button className="primary" onClick={() => onDone(faOffer(lg, p.id, offer, years))}>{mineNow ? 'Change offer' : 'Make offer'}: {years} yr{years > 1 ? 's' : ''} at {dol ? $(offer) : pc(offer)}</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
