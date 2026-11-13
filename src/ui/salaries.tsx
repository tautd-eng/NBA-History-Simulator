// Salary cap breakdown: a team's contracts season by season (as shares of each season's cap), and the league at a glance.
import { useState } from 'react';
import { shownOvr as ovrOf } from '../data';
import { payroll, hardCap, deadPay } from '../ai/value';
import { ageIn } from '../players';
import { money, usd } from './money';
import { SortTable } from './sorttable';
import { useNavState } from './nav';
import { registerTable } from './export';

const seasonLabel = (s: number) => `${s - 1}–${String(s).slice(2)}`;
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

export function SalaryView({ lg, openPlayer, openTeam }: any) {
  const teams = Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name)) as any[];
  const [tid, setTid] = useNavState<string>('sal.tid', lg.userTid ?? teams[0].tid);
  const [mode, setMode] = useNavState<'team' | 'league'>('sal.mode', 'team');
  return (
    <div className="col">
      <div className="panel">
        <div className="team-head">
          <h2>Salary cap</h2>
          <div className="seg" role="group" aria-label="View">
            <button className={mode === 'team' ? 'on' : ''} onClick={() => setMode('team')}>Team breakdown</button>
            <button className={mode === 'league' ? 'on' : ''} onClick={() => setMode('league')}>All teams</button>
          </div>
          {mode === 'team' && <select aria-label="Team" className="mm-opp" value={tid} onChange={e => setTid(e.target.value)}>
            {teams.map(t => <option key={t.tid} value={t.tid}>{t.name}</option>)}
          </select>}
        </div>
        <p className="note">Every salary is a share of that season's salary cap – the same scale in every era. Hard cap {Math.round(hardCap(lg) * 100)}% of the cap.</p>
      </div>
      {mode === 'team' ? <TeamSalary lg={lg} tid={tid} openPlayer={openPlayer} openTeam={openTeam} /> : <LeagueSalary lg={lg} open={(t: string) => { setTid(t); setMode('team'); }} />}
    </div>
  );
}

function TeamSalary({ lg, tid, openPlayer, openTeam }: any) {
  const t = lg.teams[tid];
  const S = lg.season, YRS = [S, S + 1, S + 2, S + 3, S + 4];
  const ps = t.roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z, b.id) - ovrOf(a.z, a.id));
  const pay = payroll(lg, tid), hc = hardCap(lg);
  const on = (p: any, s: number) => s <= p.contract.exp;
  const opt = (p: any, s: number) => p.contract.opts?.find((o: any) => o.s === s)?.k;
  const dead = (lg.dead ?? []).filter((d: any) => d.tid === tid && d.exp >= S);
  const total = (s: number) => ps.reduce((a: number, p: any) => a + (on(p, s) ? p.contract.sal : 0), 0) + deadPay(lg, tid, s);
  const after = (p: any) => (p.contract.rookie ? 'RFA' : 'UFA');
  const fmtS = (x: number, s: number) => money(x, s);
  const rows: (string | number)[][] = [['Player', 'Pos', 'Age', 'OVR', ...YRS.map(seasonLabel)],
    ...ps.map((p: any) => [p.name, p.pos, ageIn(p, S), ovrOf(p.z, p.id), ...YRS.map(s => on(p, s) ? pc(p.contract.sal) + (opt(p, s) ? ` (${opt(p, s)} option)` : '') : (s === p.contract.exp + 1 ? after(p) : ''))]),
    ...dead.map((d: any) => [`${lg.players[d.pid]?.name ?? d.pid} (released)`, '', '', '', ...YRS.map(s => (s <= d.exp ? pc(d.sal) : ''))]),
    ['Total', '', '', '', ...YRS.map(s => pc(total(s)))]];
  return (
    <div className="panel sal-panel">
      <div className="team-head"><h2><button className="link" onClick={() => openTeam(tid)}>{t.name}</button></h2></div>
      <div className="sal-top">
        <div><span>Team salary</span><b>{pc(pay)}</b><small>of the cap{usd(pay, S)}</small></div>
        <div><span>Cap room</span><b className={pay > 1 ? 'neg' : 'pos'}>{pay > 1 ? '−' : ''}{pc(Math.abs(1 - pay))}</b><small>{pay > 1 ? 'over the cap – exceptions and minimum deals only' : 'free to sign players'}</small></div>
        <div><span>Hard cap room</span><b className={hc - pay < 0.05 ? 'neg' : ''}>{pc(hc - pay)}</b><small>to the {Math.round(hc * 100)}% limit</small></div>
        <div className="sal-legend"><span><i className="sw team"></i>Team option</span><span><i className="sw player"></i>Player option</span><span><i className="sw rk"></i>Rookie deal</span></div>
      </div>
      <div className="tbl-wrap"><table className="tbl sal-tbl" ref={el => registerTable(el, () => rows)}>
        <thead><tr><th className="l">Player</th><th>Pos</th><th>Age</th><th>OVR</th>{YRS.map(s => <th key={s}>{seasonLabel(s)}</th>)}</tr></thead>
        <tbody>
          {ps.map((p: any) => <tr key={p.id} className={tid === lg.userTid ? '' : ''}>
            <td className="l"><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>{p.contract.rookie ? <span className="chip tiny" title="Rookie contract – a restricted free agent when it ends">R</span> : null}</td>
            <td className="dim">{p.pos}</td><td>{ageIn(p, S)}</td><td>{ovrOf(p.z, p.id)}</td>
            {YRS.map(s => {
              const o = opt(p, s);
              return <td key={s} className={on(p, s) ? `sal ${o ? 'opt-' + o : p.contract.rookie ? 'rk' : ''}` : 'dim'} title={o ? `${o === 'team' ? 'Team' : 'Player'} option` : undefined}>
                {on(p, s) ? fmtS(p.contract.sal, s) : s === p.contract.exp + 1 ? <span className="fa-tag">{after(p)}</span> : '–'}
              </td>;
            })}
          </tr>)}
          {dead.map((d: any, i: number) => <tr key={'d' + i} className="dim">
            <td className="l">{lg.players[d.pid]?.name ?? d.pid} <span className="chip tiny" title="Released – this money stays on the books">dead</span></td><td></td><td></td><td></td>
            {YRS.map(s => <td key={s}>{s <= d.exp ? fmtS(d.sal, s) : '–'}</td>)}
          </tr>)}
        </tbody>
        <tfoot><tr className="sal-total"><td className="l"><b>Total</b></td><td></td><td></td><td></td>{YRS.map(s => { const v = total(s); return <td key={s}><b className={v > hc ? 'neg' : v > 1 ? 'warn-t' : ''}>{fmtS(v, s)}</b></td>; })}</tr>
          <tr><td className="l dim">Cap room</td><td></td><td></td><td></td>{YRS.map(s => { const v = 1 - total(s); return <td key={s} className={v < 0 ? 'neg' : 'pos'}>{v < 0 ? '−' : ''}{pc(Math.abs(v))}</td>; })}</tr></tfoot>
      </table></div>
      <p className="note">Contracts are flat: the same share of the cap every season. UFA / RFA – the season he becomes an unrestricted or restricted free agent.</p>
    </div>
  );
}

function LeagueSalary({ lg, open }: any) {
  const S = lg.season, hc = hardCap(lg);
  const rows = Object.values(lg.teams).filter((t: any) => t.active).map((t: any) => {
    const ps = t.roster.map((pid: string) => lg.players[pid]);
    const next = ps.reduce((a: number, p: any) => a + (p.contract.exp >= S + 1 ? p.contract.sal : 0), 0) + deadPay(lg, t.tid, S + 1);
    const top = [...ps].sort((a: any, b: any) => b.contract.sal - a.contract.sal)[0];
    return { key: t.tid, t, pay: payroll(lg, t.tid), next, n: ps.length, dead: deadPay(lg, t.tid), top };
  });
  const cols = [
    { key: 'team', label: 'Team', left: true, asc: true, get: (r: any) => r.t.name, fmt: (v: any, r: any) => <button className="link" onClick={() => open(r.t.tid)}>{v}</button> },
    { key: 'pay', label: 'Salary', title: 'Payroll this season, % of the cap', get: (r: any) => r.pay, fmt: (v: any) => <b className={v > hc ? 'neg' : v > 1 ? 'warn-t' : ''}>{pc(v)}</b> },
    { key: 'room', label: 'Cap room', get: (r: any) => 1 - r.pay, fmt: (v: any) => <span className={v < 0 ? 'neg' : 'pos'}>{v < 0 ? '−' : ''}{pc(Math.abs(v))}</span> },
    { key: 'hard', label: 'Hard cap room', get: (r: any) => hc - r.pay, fmt: (v: any) => pc(v) },
    { key: 'dead', label: 'Dead money', get: (r: any) => r.dead, fmt: (v: any) => (v ? pc(v) : '–') },
    { key: 'next', label: `Committed ${seasonLabel(S + 1)}`, get: (r: any) => r.next, fmt: (v: any) => pc(v) },
    { key: 'n', label: 'Players', get: (r: any) => r.n },
    { key: 'top', label: 'Highest paid', left: true, get: (r: any) => r.top?.contract.sal ?? 0, fmt: (_: any, r: any) => r.top ? `${r.top.name} – ${pc(r.top.contract.sal)}` : '–' },
  ];
  return <div className="panel"><h2>All teams · {seasonLabel(S)}</h2><SortTable cols={cols} rows={rows} initial="pay" /></div>;
}
