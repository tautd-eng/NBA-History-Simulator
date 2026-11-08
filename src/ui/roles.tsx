// @ts-nocheck
// Player roles (archetypes) and the team-fit panel.
import { roleOf, ARCH_BY_ID } from '../archetypes';

const HUE: Record<string, number> = { twoway: 45, general: 205, creator: 15, sniper: 280, '3d': 165, slasher: 0, pointfwd: 220, lockdown: 135, unicorn: 300, stretch: 260, protector: 190, glass: 30, post: 345, playbig: 235, runner: 100, role: 0 };
export function RoleBadge({ id, small, title }: { id: string; small?: boolean; title?: string }) {
  const a = ARCH_BY_ID[id];
  const h = HUE[id] ?? 0, grey = id === 'role';
  return <span className={`role-badge${small ? ' sm' : ''}`} title={title ?? `${a.name} – ${a.blurb}`} style={grey ? {} : { '--rh': h } as any}>{small ? a.short : a.name}</span>;
}

/** Role card on the player page. */
export function RoleCard({ p }: any) {
  const r = roleOf(p.z, p.pos);
  return (
    <div className="role-card">
      <div className="role-top">
        <RoleBadge id={r.arch.id} />{r.second && <><span className="dim">+</span><RoleBadge id={r.second.id} /></>}
        <span className="dim role-blurb">{r.arch.blurb}</span>
      </div>
      <div className="role-pm">
        <div><b className="pos">Brings:</b> {r.arch.plus}{r.strengths.length > 0 && <> <span className="dim">Best at: {r.strengths.join(', ').toLowerCase()}.</span></>}</div>
        <div><b className="neg">Watch out:</b> {r.arch.minus}{r.weaknesses.length > 0 && <> <span className="dim">Weak spots: {r.weaknesses.join(', ').toLowerCase()}.</span></>}</div>
      </div>
    </div>
  );
}

import { H, agingIndex } from '../data';
import { ageIn } from '../players';
/** His ratings at his peak if he develops like the average player (the league's aging curve, skill by skill). */
export function projectedZ(p: any, S: number) {
  const z = p.z.slice();
  const off = p.dev?.peak ?? 0;
  for (let a = Math.floor(ageIn(p, S)); a < 27 + off; a++) {
    const ai = agingIndex(a - off);
    H.keys.forEach((k: string, i: number) => { z[i] += H.aging[k]?.mean[ai] ?? 0; });
  }
  return z;
}
/** Role badges for a list: what he is – or, for a young player who has no clear role yet, what he projects to become. */
export function RoleCell({ p, S }: any) {
  const r = roleOf(p.z, p.pos);
  const young = p.prospect || ageIn(p, S) <= 24;
  if (r.arch.id !== 'role' || !young) return <>{<RoleBadge id={r.arch.id} />}{r.second && <RoleBadge id={r.second.id} small />}</>;
  const pr = roleOf(projectedZ(p, S), p.pos);
  if (pr.arch.id === 'role') return <RoleBadge id="role" />;
  return <span className="proj-role" title={`No clear role yet – projected to become: ${pr.arch.name}${pr.second ? ` / ${pr.second.name}` : ''} (if he develops like an average player)`}><span className="dim small-t">proj.</span> <RoleBadge id={pr.arch.id} title={`Projected: ${pr.arch.name} – ${pr.arch.blurb}`} />{pr.second && <RoleBadge id={pr.second.id} small />}</span>;
}
export function roleSortKey(p: any, S: number) {
  const r = roleOf(p.z, p.pos);
  if (r.arch.id !== 'role' || !(p.prospect || ageIn(p, S) <= 24)) return r.arch.name;
  const pr = roleOf(projectedZ(p, S), p.pos);
  return pr.arch.id === 'role' ? 'Role Player' : pr.arch.name + ' (proj.)';
}
