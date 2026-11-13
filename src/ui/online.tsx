// Online leagues: sign in, create / join / open a shared league, the bar with who is done, the host's tools.
import { useEffect, useState } from 'react';
import { currentUser, signIn, signUp, signOut, select, unpack } from '../online/client';
import { onlineCtx, subscribe, myLeagues, createOnline, joinOnline, claimTeam, openOnline, closeOnline, setDone, publish, hostSetMember, deleteOnline, resendFailed, tick } from '../online/sync';

export function useOnline() {
  const [, set] = useState(0);
  useEffect(() => subscribe(() => set(x => x + 1)), []);
  return onlineCtx();
}

const inviteLink = (code: string) => `${location.origin}${location.pathname}?join=${code}`;

/** The panel: account, your online leagues, join with a code, put this league online. */
export function OnlinePanel({ lg, close, onOpen, joinCode }: any) {
  const [user, setUser] = useState(currentUser());
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('nba-online-name') ?? ''; } catch { return ''; } });
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [leagues, setLeagues] = useState<any[] | null>(null);
  const [code, setCode] = useState(joinCode ?? '');
  const [pick, setPick] = useState<{ id: string; teams: any[]; taken: Set<string> } | null>(null);
  const [lname, setLname] = useState(() => lg?.saveName ?? 'Our league');
  const ctx = onlineCtx();
  const act = async (fn: () => Promise<any>, ok?: string) => { setBusy(true); setMsg(''); try { await fn(); if (ok) setMsg(ok); } catch (e: any) { setMsg(e.message ?? String(e)); } setBusy(false); };
  const refresh = () => act(async () => setLeagues(await myLeagues()));
  useEffect(() => { if (user) refresh(); }, [user]);
  useEffect(() => { try { localStorage.setItem('nba-online-name', name); } catch { /* ignore */ } }, [name]);

  const showTeams = async (id: string) => {
    const [st] = await select('league_state', `league_id=eq.${id}&select=data`);
    const l = await unpack(st.data);
    const mem = await select('members', `league_id=eq.${id}&select=tid`);
    setPick({ id, teams: Object.values(l.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name)), taken: new Set(mem.map((m: any) => m.tid).filter(Boolean)) });
  };
  const open = (id: string) => act(async () => { const l = await openOnline(id); onOpen(l, id); close(); });

  return (
    <div className="overlay center" onClick={close}>
      <div className="dialog saves online-dlg" role="dialog" aria-label="Online league" onClick={e => e.stopPropagation()}>
        <div className="team-head"><h2>Online league</h2><button className="ghost small" onClick={close}>Close</button></div>
        {!user ? <>
          <p className="note">Play one league with friends: each of you runs a team, the host moves the league on. Sign in (or create an account) with an email and a password.</p>
          <div className="online-form">
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            <input type="password" placeholder="Password (6+ characters)" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" />
            <div className="def-row">
              <button className="primary" disabled={busy || !email || !pw} onClick={() => act(async () => { await signIn(email, pw); setUser(currentUser()); })}>Sign in</button>
              <button disabled={busy || !email || pw.length < 6} onClick={() => act(async () => { await signUp(email, pw); setUser(currentUser()); })}>Create account</button>
            </div>
          </div>
        </> : <>
          <p className="note">Signed in as <b>{user.email}</b>. <button className="small ghost" onClick={() => { if (ctx) closeOnline(); signOut(); setUser(null); setLeagues(null); }}>Sign out</button></p>
          <label className="field"><span>Your name in leagues</span><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tautvydas" /></label>

          {pick ? <div className="panel-lite">
            <h3>Pick your team</h3>
            <div className="team-pick">{pick.teams.map((t: any) => <button key={t.tid} disabled={busy || pick.taken.has(t.tid)} className="small" onClick={() => act(async () => { await claimTeam(pick.id, t.tid); setPick(null); await open(pick.id); })}>{t.name}{pick.taken.has(t.tid) ? ' – taken' : ''}</button>)}</div>
            <button className="small ghost" onClick={() => setPick(null)}>Back</button>
          </div> : <>
            <h3>Your leagues</h3>
            {leagues === null ? <p className="note">Loading…</p> : leagues.length ? <ul className="save-list">{leagues.map((m: any) => <li key={m.league_id} className={ctx?.league.id === m.league_id ? 'mine' : ''}>
              <span><b>{m.leagues?.name}</b> <span className="dim">· {m.role === 'host' ? 'you host' : 'player'} · {m.tid ?? 'no team yet'} · code {m.leagues?.code}</span><br /><span className="dim small-t">{m.leagues?.status}</span></span>
              <span className="def-row">
                {m.tid ? <button className="small primary" disabled={busy} onClick={() => open(m.league_id)}>{ctx?.league.id === m.league_id ? 'Reopen' : 'Open'}</button> : <button className="small primary" disabled={busy} onClick={() => act(() => showTeams(m.league_id))}>Pick a team</button>}
                {m.role === 'host' && <button className="small ghost" disabled={busy} onClick={() => { if (confirm('Delete this online league for everyone?')) act(async () => { await deleteOnline(m.league_id); if (ctx?.league.id === m.league_id) closeOnline(); await refresh(); }); }}>Delete</button>}
              </span>
            </li>)}</ul> : <p className="note">None yet.</p>}

            <h3>Join with a code</h3>
            <div className="def-row"><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Invite code" maxLength={6} style={{ width: '9em' }} />
              <button className="primary" disabled={busy || code.trim().length < 4 || !name.trim()} onClick={() => act(async () => { const id = await joinOnline(code, name.trim()); await refresh(); await showTeams(id); })}>Join</button></div>
            {!name.trim() && <p className="note">Enter your name above first.</p>}

            {lg && !lg.online && <>
              <h3>Put this league online</h3>
              <p className="note">You become the host: your browser runs the league, the others join with the code and pick their teams. You keep {lg.userTid ? <b>{lg.teams[lg.userTid]?.name}</b> : <b>no team – pick one under Players & teams first</b>}.</p>
              <div className="def-row"><input value={lname} onChange={e => setLname(e.target.value)} placeholder="League name" />
                <button className="primary" disabled={busy || !lg.userTid || !lname.trim() || !name.trim()} onClick={() => act(async () => { const l = await createOnline(lg, lname.trim(), name.trim()); await refresh(); await open(l.id); })}>Create online league</button></div>
            </>}
          </>}
        </>}
        {msg && <p className="hint">{msg}</p>}
      </div>
    </div>
  );
}

/** Top bar in an online league: who has done his moves, your Done button, the host's tools. */
export function OnlineBar({ lg, openPanel, onLeave }: any) {
  const ctx = useOnline();
  const [manage, setManage] = useState(false);
  const [msg, setMsg] = useState('');
  if (!ctx) return null;
  const host = ctx.role === 'host';
  const draft = lg.phase === 'draft' && lg.draftDay && !lg.draftDay.done && (lg.draftDay.stage ?? 'draft') === 'draft';
  const players = ctx.members.filter(m => m.tid);
  const doneN = players.filter(m => m.done || m.role === 'host').length;
  const online = (m: any) => Date.now() - new Date(m.seen_at).getTime() < 3 * 60000;
  const copy = () => { navigator.clipboard?.writeText(inviteLink(ctx.league.code)).then(() => setMsg('Invite link copied.'), () => setMsg(inviteLink(ctx.league.code))); };
  const act = async (fn: () => Promise<any>) => { setMsg(''); try { await fn(); } catch (e: any) { setMsg(e.message); } };
  return (
    <div className="online-bar">
      <div className="ob-row">
        <b>{ctx.league.name}</b>
        <span className="dim">{host ? 'you host' : `host: ${ctx.members.find(m => m.role === 'host')?.name || '–'}`} · code <button className="link" onClick={copy} title="Copy the invite link">{ctx.league.code}</button></span>
        {!draft && <span className="ob-done">{doneN}/{players.length} done</span>}
        {draft && <span className="ob-done">Draft – the league waits for whoever is on the clock</span>}
        <span className="ob-sp" />
        {!host && !draft && <button className={`small ${ctx.me.done ? '' : 'primary'}`} onClick={() => act(() => setDone(!ctx.me.done))}>{ctx.me.done ? '✓ Done – undo' : 'I\'m done'}</button>}
        {host && <span className="dim small-t">{ctx.publishing ? 'sending…' : ctx.lastPublish ? 'sent' : ''}</span>}
        {host && <button className="small ghost" onClick={() => act(publish)}>Send now</button>}
        {host && <button className="small ghost" onClick={() => setManage(!manage)}>People</button>}
        {!host && <button className="small ghost" onClick={() => act(() => tick(true))}>Refresh</button>}
        <button className="small ghost" onClick={openPanel}>Leagues</button>
        <button className="small ghost" onClick={() => { closeOnline(); onLeave(); }}>Leave</button>
      </div>
      <div className="ob-people">{players.map(m => <span key={m.user_id} className={`ob-p ${m.done || m.role === 'host' ? 'done' : ''}`} title={`${m.name || 'player'} – ${lg.teams[m.tid!]?.name ?? m.tid}${online(m) ? ' · online' : ''}`}>
        {online(m) ? <i className="ob-on" /> : null}{lg.teams[m.tid!]?.abbr ?? m.tid} <span className="dim">{m.name}</span>{m.role === 'host' ? ' ★' : m.done ? ' ✓' : ''}
      </span>)}</div>
      {host && <p className="note">You move the league on (the controls above) – when everyone is done, or when you decide. Each step you take goes out to the others; people who did nothing get their GM's choices.</p>}
      {!host && <p className="note">Make your moves – they go to the host. Press “I'm done” when you are; the host moves the league on.</p>}
      {(ctx.error || msg) && <p className="hint neg">{ctx.error || msg} {ctx.failed.length > 0 && <button className="small" onClick={() => resendFailed()}>Send again</button>}</p>}
      {host && manage && <div className="ob-manage">
        <h3>People</h3>
        <ul className="news">{ctx.members.map(m => <li key={m.user_id}><span className="yr">{m.role === 'host' ? 'host' : ''}</span><span>
          <b>{m.name || 'player'}</b> – {m.tid ? lg.teams[m.tid]?.name : 'no team'}{' '}
          {m.role !== 'host' && <>
            <select value={m.tid ?? ''} onChange={e => act(() => hostSetMember(m.user_id, e.target.value || null))} aria-label={`Team for ${m.name}`}>
              <option value="">No team (GM runs it)</option>
              {Object.values(lg.teams).filter((t: any) => t.active).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((t: any) => <option key={t.tid} value={t.tid} disabled={ctx.members.some(x => x.tid === t.tid && x.user_id !== m.user_id)}>{t.name}</option>)}
            </select>{' '}
            <button className="small ghost" onClick={() => { if (confirm(`Remove ${m.name || 'this player'} from the league?`)) act(() => hostSetMember(m.user_id, null, true)); }}>Remove</button>
          </>}
        </span></li>)}</ul>
      </div>}
    </div>
  );
}
