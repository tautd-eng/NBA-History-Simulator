// @ts-nocheck
// Player roles (archetypes) and the team-fit panel.
import { roleOf, teamFit, ARCH_BY_ID } from '../archetypes';
import { PFace } from './art';

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

/** Team fit: how the top of the rotation fits together. */
export function TeamFit({ lg, roster, openPlayer }: any) {
  const healthy = roster.filter((p: any) => !(p.injury > 0));
  const rot = (healthy.length >= 5 ? healthy : roster).slice(0, 8);
  const f = teamFit(rot);
  return (
    <div className="team-fit">
      <div className="fit-head"><h3>Team fit <span className={`fit-score ${f.fitScore >= 58 ? 'pos' : f.fitScore <= 44 ? 'neg' : ''}`}>{f.fitScore}</span></h3>
        <p className="note">How the five best healthy players fit together (top eight for roles). Spacing, a ball-handler, rim protection and not too many ball-dominant scorers change shooting and turnovers in the simulation – talent still matters most.</p></div>
      <div className="ratings fit-bars">
        {f.items.map(i => (
          <div key={i.k} className="rating" title={i.d}>
            <span className="rl">{i.k}</span>
            <span className={`bar ${i.v >= 62 ? 'hi' : i.v <= 38 ? 'lo' : ''}`}><span style={{ width: `${i.v}%` }}></span></span>
            <span className="rv">{i.v}</span>
          </div>
        ))}
      </div>
      {f.notes.length > 0 && <ul className="fit-notes">{f.notes.map((n, i) => <li key={i} className={n.good ? 'good' : 'bad'}>{n.good ? '▲' : '▼'} {n.t}</li>)}</ul>}
      <div className="fit-roles">
        {rot.map((p: any, i: number) => {
          const r = f.roles[i];
          return (
            <button key={p.id} className={`fit-player${i < 5 ? ' starter' : ''}`} onClick={() => openPlayer(p.id)}>
              <PFace lg={lg} p={p} size={30} />
              <span className="fp-name">{p.name}<span className="dim"> {p.pos}</span></span>
              <span className="fp-roles"><RoleBadge id={r.arch.id} />{r.second && <RoleBadge id={r.second.id} small />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
