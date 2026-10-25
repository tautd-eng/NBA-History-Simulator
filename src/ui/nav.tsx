// @ts-nocheck
// Links to player cards and team pages from anywhere, and plain text (news,
// logs, notes) with player and team names turned into links.
import { Fragment } from 'react';

export const nav: { lg: any; player: (pid: string) => void; team: (tid: string) => void } = { lg: null, player: () => {}, team: () => {} };

/** Player name that opens his card. */
export function PL({ pid, children }: any) {
  const p = nav.lg?.players[pid];
  return <button type="button" className="link" onClick={e => { e.stopPropagation(); nav.player(pid); }}>{children ?? p?.name ?? pid}</button>;
}
/** Team name (or abbreviation) that opens the team page. */
export function TL({ tid, abbr, children }: any) {
  const t = nav.lg?.teams[tid];
  if (!t) return <>{children ?? tid}</>;
  return <button type="button" className="link" onClick={e => { e.stopPropagation(); nav.team(tid); }}>{children ?? (abbr ? t.abbr : t.name)}</button>;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let cache: { key: string; re: RegExp | null; map: Map<string, ['p' | 't', string]> } | null = null;
function index(lg: any) {
  const key = `${lg.seed}|${Object.keys(lg.players).length}|${lg.season}|${Object.values(lg.teams).map((t: any) => t.name).join()}`;
  if (cache?.key === key) return cache;
  const map = new Map<string, ['p' | 't', string]>();
  // players: the most relevant one wins a shared name (on a team, then the latest to enter the league)
  const ps = (Object.values(lg.players) as any[]).filter(p => !p.prospect).sort((a, b) => Number(!!a.tid) - Number(!!b.tid) || a.entered - b.entered);
  for (const p of ps) if (p.name && p.name.length > 3) map.set(p.name, ['p', p.id]);
  for (const t of Object.values(lg.teams) as any[]) map.set(t.name, ['t', t.tid]);
  for (const h of lg.history ?? []) for (const t of h.standings ?? []) if (!map.has(t.name) && lg.teams[t.tid]) map.set(t.name, ['t', t.tid]);
  const names = [...map.keys()].sort((a, b) => b.length - a.length).map(esc);
  const re = names.length ? new RegExp(`(?<![\\p{L}])(${names.join('|')})(?![\\p{L}])`, 'gu') : null;
  cache = { key, re, map };
  return cache;
}

/** Text with every known player and team name linked. */
export function Linkify({ text }: { text: string }) {
  const lg = nav.lg;
  if (!lg || !text) return <>{text}</>;
  const { re, map } = index(lg);
  if (!re) return <>{text}</>;
  const out: any[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(re)) {
    const [kind, id] = map.get(m[0])!;
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(kind === 'p' ? <PL key={i++} pid={id}>{m[0]}</PL> : <TL key={i++} tid={id}>{m[0]}</TL>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((x, k) => <Fragment key={k}>{x}</Fragment>)}</>;
}
