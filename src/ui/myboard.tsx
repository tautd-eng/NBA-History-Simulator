// Your own draft board: rank the prospects yourself (drag, arrows, add / remove). Your GM drafts from it when
// he picks for you, and the draft room shows where everyone stands on it.
import { htStr, htCol, htDiff } from './units';
import { useState } from 'react';
import { boardScore } from '../ai/trades';
import { mgmtOf } from './mgmt';
import { run } from '../league/commands';
import { RoleCell } from './roles';

export function boardOf(lg: any, year: number): string[] {
  const b = lg.userTid ? lg.teams[lg.userTid]?.mgmt?.board : null;
  return b && b.year === year ? b.order : [];
}
export function setBoard(lg: any, year: number, order: string[]) {
  const m: any = mgmtOf(lg);
  m.board = { year, order };
  run(lg, { t: 'mgmt', mgmt: m });
}
export function toggleOnBoard(lg: any, year: number, pid: string) {
  const b = boardOf(lg, year);
  setBoard(lg, year, b.includes(pid) ? b.filter(x => x !== pid) : [...b, pid]);
}
/** The “+ board” button for a prospect in a list. */
export function BoardToggle({ lg, year, pid, onChange }: any) {
  const b = boardOf(lg, year), i = b.indexOf(pid);
  return <button className={`small ${i >= 0 ? 'on-board' : 'ghost'}`} title={i >= 0 ? 'On your board – click to take him off' : 'Add to your board'} onClick={() => { toggleOnBoard(lg, year, pid); onChange(); }}>{i >= 0 ? `#${i + 1}` : '+'}</button>;
}

export function MyBoard({ lg, year, pool, openPlayer, onChange, title = 'Your board' }: any) {
  const [drag, setDrag] = useState<number | null>(null);
  if (!lg.userTid) return null;
  const order = boardOf(lg, year);
  const t = lg.teams[lg.userTid];
  const save = (o: string[]) => { setBoard(lg, year, o); onChange(); };
  const move = (i: number, j: number) => { if (j < 0 || j >= order.length) return; const o = [...order]; const [x] = o.splice(i, 1); o.splice(j, 0, x); save(o); };
  const fill = () => {
    const ps = pool.map((id: string) => lg.players[id]).filter(Boolean);
    const scouts = ps.map((p: any) => [p.id, boardScore(lg, p, t, year)] as [string, number]).sort((a: any, b: any) => b[1] - a[1]).map((x: any) => x[0]);
    save([...order, ...scouts.filter((id: string) => !order.includes(id))].slice(0, Math.max(30, order.length)));
  };
  const S = year + 1;
  return (
    <div className="panel my-board">
      <div className="team-head">
        <h2>{title}{order.length ? ` · ${order.length}` : ''}</h2>
        <span className="def-row">
          <button className="small" onClick={fill} title="Add your scouts' top prospects below the ones you already ranked">{order.length ? 'Fill up from the scouts' : 'Start from your scouts\' board'}</button>
          {order.length > 0 && <button className="small ghost" onClick={() => { if (confirm('Clear your board?')) save([]); }}>Clear</button>}
        </span>
      </div>
      <p className="note">Your own order. Drag a row (or use the arrows) to move him, + in the lists adds a prospect. When your GM picks for you – “Let the GM pick”, the draft running past you, or you are not there online – he takes the highest player still on your board.</p>
      {order.length ? <ol className="board-list">{order.map((pid: string, i: number) => {
        const p = lg.players[pid];
        if (!p) return null;
        const gone = !pool.includes(pid);
        const by = gone && p.draft?.tid ? lg.teams[p.draft.tid]?.abbr : null;
        return <li key={pid} draggable className={`${gone ? 'gone' : ''} ${drag === i ? 'dragging' : ''}`}
          onDragStart={() => setDrag(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag !== null && drag !== i) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}>
          <span className="bl-n">{i + 1}</span>
          <span className="bl-name"><button className="link" onClick={() => openPlayer(pid)}>{p.name}</button> <span className="dim">{p.pos} · {Math.floor(S - p.born)} · {htStr(p.ht)}</span>{by ? <span className="chip tiny">taken – {by}</span> : null}</span>
          <span className="bl-role"><RoleCell p={p} S={S} /></span>
          <span className="bl-btns">
            <button className="small ghost" disabled={i === 0} onClick={() => move(i, 0)} title="To the top">⤒</button>
            <button className="small ghost" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Up">↑</button>
            <button className="small ghost" disabled={i === order.length - 1} onClick={() => move(i, i + 1)} aria-label="Down">↓</button>
            <button className="small ghost" onClick={() => save(order.filter(x => x !== pid))} aria-label="Remove">✕</button>
          </span>
        </li>;
      })}</ol> : <p className="note">Empty – your GM uses your scouts' board until you rank anyone.</p>}
    </div>
  );
}
