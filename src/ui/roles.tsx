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
