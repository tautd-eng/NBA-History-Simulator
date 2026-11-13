// Online league: the host's browser runs the league; everyone else sends commands and gets each new version.
import { League } from '../types';
import { select, insert, update, rpc, pack, unpack, currentUser } from './client';
import { apply, setCommandSink, Envelope } from '../league/commands';
import { saveHooks } from '../api';

export interface OLeague { id: string; name: string; code: string; host: string; version: number; applied_upto: number; status: string; updated_at?: string }
export interface OMember { user_id: string; name: string; tid: string | null; role: 'host' | 'player'; done: boolean; seen_at: string }
export interface Ctx { league: OLeague; members: OMember[]; me: OMember; role: 'host' | 'player'; version: number; lastCmd: number; lg: League; error?: string; sent: number; failed: Envelope[]; publishing?: boolean; lastPublish?: number }

let ctx: Ctx | null = null;
const listeners = new Set<() => void>();
export const onlineCtx = () => ctx;
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = () => { for (const f of listeners) try { f(); } catch { /* ignore */ } };
/** The app shows this league (a new version arrived) – set by the app. */
let replaceLeague: (lg: League) => void = () => {};
let refreshUi: () => void = () => {};
let statusOf: (lg: League) => string = () => '';
export function bindApp(o: { replace: (lg: League) => void; refresh: () => void; status: (lg: League) => string }) { replaceLeague = o.replace; refreshUi = o.refresh; statusOf = o.status; }

export const slotOf = (id: string) => 'online-' + id;
const clean = (lg: League) => { const c: any = { ...lg }; delete c.online; delete c.userTid; return c; };
/** Where the league is: a new step begins (and nobody is done) when this changes. */
const stepKey = (lg: any) => [lg.season, lg.phase, lg.day, lg.off?.step, lg.fa?.stage, lg.draftDay?.picks?.length ?? 0, lg.draftDay?.stage, lg.previewOpen ?? ''].join('|');

export async function myLeagues() {
  const u = currentUser(); if (!u) return [];
  return (await select('members', `select=tid,role,league_id,leagues(id,name,code,version,status,host,updated_at)&user_id=eq.${u.id}`)) as any[];
}

export async function createOnline(lg: League, name: string, memberName: string) {
  if (!lg.userTid) throw new Error('Pick your team first (Players & teams) – you will run it in the online league.');
  const st = statusOf(lg);
  const l = await rpc('create_league', { p_name: name, p_tid: lg.userTid, p_member_name: memberName, p_data: await pack({ ...clean(lg), humans: [lg.userTid] }), p_status: st });
  return (Array.isArray(l) ? l[0] : l) as OLeague;
}
export async function joinOnline(code: string, memberName: string) { return (await rpc('join_league', { p_code: code, p_member_name: memberName })) as string; }
export async function claimTeam(id: string, tid: string) { await rpc('claim_team', { p_league: id, p_tid: tid }); }
export async function deleteOnline(id: string) { await rpc('delete_league', { p_league: id }); }
export async function leagueInfo(id: string) {
  const [l] = await select('leagues', `id=eq.${id}&select=*`);
  const members = (await select('members', `league_id=eq.${id}&select=user_id,name,tid,role,done,seen_at&order=role.asc,name.asc`)) as OMember[];
  return { league: l as OLeague, members };
}

/** Open a league: download it, set up who plays what, and start following it. */
export async function openOnline(id: string): Promise<League> {
  const u = currentUser(); if (!u) throw new Error('Sign in first.');
  const { league, members } = await leagueInfo(id);
  if (!league) throw new Error('League not found (or you are not in it).');
  const me = members.find(m => m.user_id === u.id)!;
  if (!me?.tid) throw new Error('Pick a team first.');
  const [st] = await select('league_state', `league_id=eq.${id}&select=version,data`);
  const lg = await unpack(st.data) as League;
  const role = league.host === u.id ? 'host' : 'player';
  ctx = { league, members, me, role, version: st.version, lastCmd: league.applied_upto, lg, sent: 0, failed: [] };
  prepare(lg);
  if (role === 'player') await reapplyMine(lg);
  else await pullCommands();
  setCommandSink(role === 'player' ? send : null);
  lastKey = stepKey(lg);
  startPolling();
  emit();
  return ctx.lg;
}
export function closeOnline() { stopPolling(); setCommandSink(null); ctx = null; emit(); }

function prepare(lg: League) {
  if (!ctx) return;
  (lg as any).online = { id: ctx.league.id, role: ctx.role };
  lg.userTid = ctx.me.tid;
  lg.humans = ctx.members.map(m => m.tid).filter(Boolean) as string[];
  ctx.lg = lg;
}

/** A player's own moves the host has not taken in yet: shown on his screen until they are. */
async function reapplyMine(lg: League) {
  if (!ctx) return;
  const mine = await select('commands', `league_id=eq.${ctx.league.id}&user_id=eq.${ctx.me.user_id}&id=gt.${ctx.league.applied_upto}&select=id,tid,cmd&order=id.asc`) as any[];
  for (const c of mine) apply(lg, { cmd: c.cmd, tid: c.tid, at: 0 });
}

/** Player: a move goes to the host (it is already on his own screen). */
function send(env: Envelope) {
  if (!ctx) return;
  const c = ctx;
  insert('commands', { league_id: c.league.id, tid: env.tid, cmd: env.cmd })
    .then(() => { c.sent++; emit(); })
    .catch(e => { c.failed.push(env); c.error = `A move did not reach the host: ${e.message}`; emit(); });
}
export async function resendFailed() {
  if (!ctx) return;
  const f = ctx.failed; ctx.failed = []; ctx.error = undefined;
  for (const env of f) send(env);
}

/** Host: apply the moves the others sent. */
async function pullCommands() {
  if (!ctx || ctx.role !== 'host') return 0;
  const rows = await select('commands', `league_id=eq.${ctx.league.id}&id=gt.${ctx.lastCmd}&select=id,tid,cmd,user_id&order=id.asc&limit=500`) as any[];
  for (const r of rows) {
    // a person acts only for the team he runs now
    const m = ctx.members.find(x => x.user_id === r.user_id);
    if (m?.tid === r.tid) apply(ctx.lg, { cmd: r.cmd, tid: r.tid, at: 0 });
    ctx.lastCmd = r.id;
  }
  return rows.length;
}

let lastKey = '';
let pubTimer: any = null;
/** Host: send the league out (after his own moves and every simulation step). */
export function schedulePublish(delay = 1500) {
  if (!ctx || ctx.role !== 'host') return;
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => publish().catch(e => { if (ctx) { ctx.error = e.message; emit(); } }), delay);
}
export async function publish() {
  if (!ctx || ctx.role !== 'host' || ctx.publishing) return;
  const c = ctx;
  c.publishing = true; emit();
  try {
    const key = stepKey(c.lg);
    const reset = key !== lastKey;
    const v = await rpc('publish_state', { p_league: c.league.id, p_from: c.version, p_data: await pack(clean(c.lg)), p_applied: c.lastCmd, p_status: statusOf(c.lg), p_reset_done: reset });
    c.version = typeof v === 'number' ? v : +v;
    lastKey = key; c.lastPublish = Date.now(); c.error = undefined;
    if (reset) for (const m of c.members) m.done = false;
  } finally { c.publishing = false; emit(); }
}
saveHooks.push((lg, id) => { if (ctx && ctx.role === 'host' && id === slotOf(ctx.league.id) && lg === ctx.lg) schedulePublish(); });

export async function setDone(done: boolean) {
  if (!ctx) return;
  await update('members', `league_id=eq.${ctx.league.id}&user_id=eq.${ctx.me.user_id}`, { done, seen_at: new Date().toISOString() });
  ctx.me.done = done; const m = ctx.members.find(x => x.user_id === ctx!.me.user_id); if (m) m.done = done; emit();
}
export async function hostSetMember(user: string, tid: string | null, remove = false) {
  if (!ctx) return;
  await rpc('host_set_member', { p_league: ctx.league.id, p_user: user, p_tid: tid, p_remove: remove });
  await tick(true);
}

// ---- following the league
let timer: any = null, busy = false, lastSeen = 0;
function startPolling() { stopPolling(); timer = setInterval(() => tick().catch(e => { if (ctx) { ctx.error = e.message; emit(); } }), 6000); }
function stopPolling() { clearInterval(timer); timer = null; }
export async function tick(force = false) {
  if (!ctx || busy || (!force && typeof document !== 'undefined' && document.hidden && Date.now() % 4 !== 0)) return;
  busy = true;
  const c = ctx;
  try {
    const { league, members } = await leagueInfo(c.league.id);
    if (!league) { c.error = 'You are no longer in this league.'; return; }
    c.league = league; c.members = members;
    const me = members.find(m => m.user_id === c.me.user_id);
    if (!me) { c.error = 'The host removed you from this league.'; return; }
    const teamChanged = me.tid !== c.me.tid;
    c.me = me;
    if (c.role === 'host') {
      c.lg.humans = members.map(m => m.tid).filter(Boolean) as string[];
      const n = await pullCommands();
      if (n) { refreshUi(); schedulePublish(4000); }
    } else if (league.version > c.version || teamChanged) {
      const [st] = await select('league_state', `league_id=eq.${c.league.id}&select=version,data`);
      const lg = await unpack(st.data) as League;
      c.version = st.version;
      prepare(lg);
      await reapplyMine(lg);
      replaceLeague(lg);
    }
    if (Date.now() - lastSeen > 60000) { lastSeen = Date.now(); update('members', `league_id=eq.${c.league.id}&user_id=eq.${c.me.user_id}`, { seen_at: new Date().toISOString() }).catch(() => {}); }
    c.error = c.failed.length ? c.error : undefined;
  } finally { busy = false; emit(); }
}
