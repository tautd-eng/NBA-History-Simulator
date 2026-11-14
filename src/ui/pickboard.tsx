// @ts-nocheck
// The draft board beside a draft room: every pick in order, in the team colours – who was taken,
// who is on the clock, and who picks next. Used by the real draft and the fantasy draft.
import { useEffect, useRef } from 'react';
import { colorsOf, Logo } from './art';
import { shownOvr } from '../data';
import { onlineCtx } from '../online/sync';
import { isHuman, humans } from '../league/humans';

const lum = (hex: string) => { const n = parseInt((hex || '#888888').slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** the team's colours as a readable pill: primary background, the secondary (or white/black) for the text */
export function teamPill(lg: any, tid: string) {
  const t = lg.teams[tid];
  const [a, b] = colorsOf(tid, t?.abbr);
  const fg = Math.abs(lum(a) - lum(b)) > 0.35 ? b : lum(a) > 0.55 ? '#111' : '#fff';
  return { background: a, color: fg, borderColor: b };
}

/** Who runs a human team: the online member's name, the name given in “Players & teams”, or just “You”. */
export function ownerName(lg: any, tid: string): string | null {
  if (!isHuman(lg, tid)) return null;
  const m = onlineCtx()?.members?.find((x: any) => x.tid === tid);
  if (m?.name) return m.name;
  const n = lg.humanNames?.[tid];
  if (n && n.trim()) return n.trim();
  return humans(lg).length > 1 ? 'User' : 'You';
}

export interface BoardSlot { n: number; round: number; tid: string; via?: string; pid?: string }

/** The whole draft as a board; `at` is the index of the pick on the clock (−1 when done). */
export function PickBoard({ lg, slots, at, openPlayer, title = 'Draft board', showOvr = true, note }: any) {
  const box = useRef<HTMLDivElement>(null);
  // keep the pick on the clock in view (a little below the top, so the last picks show above it)
  useEffect(() => {
    const el = box.current?.querySelector('.pb-row.clock') as HTMLElement | null;
    if (el && box.current) box.current.scrollTo({ top: Math.max(0, el.offsetTop - box.current.offsetTop - 110), behavior: 'smooth' });
  }, [at]);
  const rounds = [...new Set(slots.map((s: BoardSlot) => s.round))];
  const taken = slots.filter((s: BoardSlot) => s.pid).length;
  return (
    <div className="panel pick-board">
      <div className="team-head"><h2>{title}</h2><span className="dim">{taken} / {slots.length} picks</span></div>
      {note}
      <div className="pb-scroll" ref={box}>
        {rounds.map(r => (
          <div key={r} className="pb-round">
            {rounds.length > 1 && <div className="pb-rh">Round {r}</div>}
            {slots.filter((s: BoardSlot) => s.round === r).map((s: BoardSlot, i: number) => {
              const idx = slots.indexOf(s);
              const p = s.pid ? lg.players[s.pid] : null;
              const clock = idx === at;
              const st = teamPill(lg, s.tid);
              const who = ownerName(lg, s.tid);
              return (
                <div key={s.n} className={`pb-row ${p ? 'done' : clock ? 'clock' : 'next'} ${who ? 'human' : ''} ${s.tid === lg.userTid ? 'mine' : ''}`} style={{ borderLeftColor: st.background }}>
                  <span className="pb-n">{s.n}</span>
                  <span className="pb-team" style={{ background: st.background, color: st.color }} title={lg.teams[s.tid]?.name}>{lg.teams[s.tid]?.abbr}</span>
                  <span className="pb-what">
                    {p ? <><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button> <span className="dim">{p.pos}{showOvr ? ` · ${shownOvr(p.z, p.id)}` : ''}</span></>
                      : clock ? <b className="pb-otc">On the clock</b>
                      : <span className="dim">{lg.teams[s.tid]?.name}</span>}
                    {s.via && <span className="dim small-t"> via {lg.teams[s.via]?.abbr}</span>}
                  </span>
                  {who ? <span className="pb-user" title={`${lg.teams[s.tid]?.name} – run by ${who}`}>{who}</span> : <span />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A banner for the team on the clock, in its colours. */
export function OnClock({ lg, tid, pick, round, mine, via }: any) {
  if (!tid) return null;
  const st = teamPill(lg, tid);
  return (
    <div className={`otc-banner ${mine ? 'mine' : ''}`} style={{ background: st.background, color: st.color }}>
      <Logo t={lg.teams[tid]} size={28} />
      <span><b>No. {pick}</b>{round ? ` · round ${round}` : ''} – {lg.teams[tid].name}{via ? ` (via ${lg.teams[via].abbr})` : ''}</span>
      <span className="otc-tag">{mine ? 'You are on the clock' : ownerName(lg, tid) ? `${ownerName(lg, tid)} is on the clock` : 'On the clock'}</span>
    </div>
  );
}
