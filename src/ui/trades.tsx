// @ts-nocheck
// Trade screen: build a proposal with another team and see the AI's answer before sending it.
import { TL } from './nav';
import { useMemo, useState } from 'react';
import { shownOvr as ovrOf, shownFromRaw, shownFromBpm, seasonInfo } from '../data';
import { ageIn } from '../players';
import { aiResponse, executeTrade, fillRoster, ensurePicks, deadlineDay, pastDeadline, describeAssets, tradeableValue, pickTradeValue } from '../ai/trades';
import { payroll, hardCap } from '../ai/value';

const money = (frac: number, s: number) => {
  const m = frac * seasonInfo(s).cap;
  return m >= 1 ? `$${m.toFixed(1)}M` : `$${Math.round(m * 1000)}K`;
};
const pkKey = (p: any) => `${p.season}-${p.round}-${p.orig}`;
const valCls = (v: number) => (v >= 15 ? 'hi' : v >= 5 ? 'mid' : v < 0 ? 'neg' : '');

function Assets({ lg, xs, openPlayer, info }: any) {
  if (!xs.length) return <>nothing</>;
  const meta = (pid: string) => {
    const p = lg.players[pid];
    const v = info?.[pid] ?? (p ? [ovrOf(p.z), ageIn(p, lg.season)] : null);
    return v ? <span className="dim"> (OVR {v[0]}, age {v[1]})</span> : null;
  };
  return <>{xs.map((x: any, i: number) => <span key={i}>{i ? ', ' : ''}{x.pid
    ? <><button type="button" className="link" onClick={() => openPlayer(x.pid)}>{lg.players[x.pid]?.name ?? x.pid}</button>{meta(x.pid)}</>
    : `${x.pick.season} ${x.pick.round === 1 ? '1st' : '2nd'}-round pick (${lg.teams[x.pick.orig]?.abbr ?? x.pick.orig})`}</span>)}</>;
}

export function Trades({ lg, openPlayer, onDone }: any) {
  ensurePicks(lg);
  const teams = Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const [a, setA] = useState(lg.userTid ?? teams[0].tid);
  const [b, setB] = useState(teams.find((t: any) => t.tid !== (lg.userTid ?? teams[0].tid)).tid);
  const [selA, setSelA] = useState<Set<string>>(new Set());
  const [selB, setSelB] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const assets = (sel: Set<string>, tid: string) => {
    const out: any[] = [];
    for (const k of sel) {
      if (k.startsWith('p:')) { const pid = k.slice(2); if (lg.players[pid]?.tid === tid) out.push({ pid }); }
      else { const pk = (lg.picks ?? []).find((p: any) => 'k:' + pkKey(p) === k && p.owner === tid); if (pk) out.push({ pick: { season: pk.season, round: pk.round, orig: pk.orig } }); }
    }
    return out;
  };
  const aGives = assets(selA, a), bGives = assets(selB, b);
  const reply = (aGives.length || bGives.length) ? aiResponse(lg, a, b, bGives, aGives) : null;
  const closed = lg.phase === 'playoffs' || (lg.phase === 'regular' && pastDeadline(lg));

  const toggle = (set: Set<string>, setter: any, k: string) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n); setMsg(null);
  };

  const propose = () => {
    if (!reply?.accept) return;
    const rec = executeTrade(lg, a, b, bGives, aGives, true);
    fillRoster(lg, a); fillRoster(lg, b);
    setSelA(new Set()); setSelB(new Set());
    setMsg(`Trade done: ${rec.desc}`);
    onDone();
  };

  const Side = ({ tid, sel, setSel, label }: any) => {
    const t = lg.teams[tid];
    const players = t.roster.map((pid: string) => lg.players[pid]).sort((x: any, y: any) => ovrOf(y.z) - ovrOf(x.z));
    const picks = (lg.picks ?? []).filter((p: any) => p.owner === tid).sort((x: any, y: any) => x.season - y.season || x.round - y.round);
    return (
      <div className="trade-side">
        <h3>{label}</h3>
        <p className="dim">{t.roster.length} players · payroll {money(payroll(lg, tid), lg.season)} ({Math.round(payroll(lg, tid) * 100)}% of the cap) · {t.mode === 'allin' ? 'all-in – buying for now' : t.mode === 'tank' ? 'tanking – selling veterans' : t.mode === 'rising' ? 'rising – protecting youth' : t.mode === 'capclear' ? 'clearing salary' : t.mode === 'retool' ? 'retooling – open to side moves' : ({ contend: 'contender', middle: 'middle of the pack', rebuild: 'rebuilding' } as any)[t.strategy]}{hardCap(lg) < Infinity ? ` · ${Math.max(0, Math.round((hardCap(lg) - payroll(lg, tid)) * 100))}% left under the hard cap` : ''}</p>
        <ul className="pick-list">
          {players.map((p: any) => {
            const k = 'p:' + p.id;
            return (
              <li key={k}>
                <label className={sel.has(k) ? 'on' : ''}>
                  <input type="checkbox" id={`tr-${tid}-${p.id}`} checked={sel.has(k)} onChange={() => toggle(sel, setSel, k)} />
                  <span className="tp-name"><button type="button" className="link" onClick={e => { e.preventDefault(); e.stopPropagation(); openPlayer(p.id); }} title="Player card">{p.name}</button></span>
                  <span className="tp-meta">age {ageIn(p, lg.season)} · OVR {ovrOf(p.z)} · {money(p.contract.sal, lg.season)} through {p.contract.exp}{b && lg.teams[b] ? <> · <span className={`tv ${valCls(tradeableValue(lg, p, b))}`} title={`How much the ${lg.teams[b].name} value this player in a trade (production minus salary cost)`}>value {tradeableValue(lg, p, b).toFixed(1)}</span></> : null}</span>
                </label>
              </li>
            );
          })}
          {picks.map((p: any) => {
            const k = 'k:' + pkKey(p);
            return (
              <li key={k}>
                <label className={`pick ${sel.has(k) ? 'on' : ''}`}>
                  <input type="checkbox" id={`tr-${tid}-${pkKey(p)}`} checked={sel.has(k)} onChange={() => toggle(sel, setSel, k)} />
                  <span className="tp-name">{p.season} {p.round === 1 ? '1st' : '2nd'}-round pick</span>
                  <span className="tp-meta">{p.orig === tid ? 'own' : `from ${lg.teams[p.orig]?.abbr ?? p.orig}`}{b && lg.teams[b] ? <> · <span className="tv" title={`How much the ${lg.teams[b].name} value this pick`}>value {pickTradeValue(lg, p, b).toFixed(1)}</span></> : null}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const trades = (lg.trades ?? []).slice().reverse();
  return (
    <div className="col">
      <div className="panel">
        <h2>Trade proposal</h2>
        <p className="note">{closed ? (lg.phase === 'playoffs' ? 'Trading is closed during the playoffs.' : 'This season\'s trade deadline has passed. Trading reopens after the draft.') : lg.phase === 'regular' ? `Trade deadline: day ${deadlineDay(lg) + 1} of the season (today is day ${lg.day + 1}).` : 'Offseason: trading is open.'} AI teams trade among themselves; with your team they only trade when you propose.</p>
        <div className="trade-pick">
          <label htmlFor="trade-a">Your side
            <select id="trade-a" value={a} onChange={e => { setA(e.target.value); setSelA(new Set()); if (e.target.value === b) setB(teams.find((t: any) => t.tid !== e.target.value).tid); }}>
              {teams.map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
            </select>
          </label>
          <label htmlFor="trade-b">Partner
            <select id="trade-b" value={b} onChange={e => { setB(e.target.value); setSelB(new Set()); }}>
              {teams.filter((t: any) => t.tid !== a).map((t: any) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <div className="trade-grid">
          <Side tid={a} sel={selA} setSel={setSelA} label={`${lg.teams[a].abbr} send`} />
          <Side tid={b} sel={selB} setSel={setSelB} label={`${lg.teams[b].abbr} send`} />
        </div>
        <div className={`verdict ${reply ? (reply.accept ? 'yes' : 'no') : ''}`}>
          {reply ? <>
            <p><b>{reply.text}</b></p>
            <p className="dim">Salaries: {lg.teams[a].abbr} send {money(aGives.reduce((s: number, x: any) => s + (x.pid ? lg.players[x.pid].contract.sal : 0), 0), lg.season)}, receive {money(bGives.reduce((s: number, x: any) => s + (x.pid ? lg.players[x.pid].contract.sal : 0), 0), lg.season)}</p>
          </> : <p className="dim">Select players or picks on both sides – the AI's answer appears here. “Value” is how much the partner GM values an asset: on-court benefit over the next few years (a star is worth far more than two average players) minus salary cost; a cheap deal or rookie contract adds value, an overpay subtracts it. A pick is the expected rookie at that slot on a cheap deal.</p>}
          <button className="primary" disabled={!reply?.accept || closed} onClick={propose}>Propose trade</button>
        </div>
        {msg && <p className="ok-msg">{msg}</p>}
      </div>
      <div className="panel">
        <h2>Trade history</h2>
        {trades.length ? (
          <ul className="news">
            {trades.slice(0, 80).map((t: any, i: number) => <li key={i}><span className="yr">{t.s}</span><span>{t.user && <span className="chip tiny">yours</span>} <b><TL tid={t.a} abbr /></b> get <Assets lg={lg} xs={t.aGets} openPlayer={openPlayer} info={t.info ?? (t.s === lg.season ? undefined : {})} />; <b><TL tid={t.b} abbr /></b> get <Assets lg={lg} xs={t.bGets} openPlayer={openPlayer} info={t.info ?? (t.s === lg.season ? undefined : {})} />.</span></li>)}
          </ul>
        ) : <p className="note">No trades yet.</p>}
      </div>
    </div>
  );
}
