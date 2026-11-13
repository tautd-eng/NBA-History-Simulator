// A small Supabase client over fetch: email + password sign-in, the Data API (tables and RPC).
export const SB_URL = 'https://axzufnymxyzpnoxzpnxe.supabase.co';
export const SB_KEY = 'sb_publishable_x3c19tB_3UtkxKb-Ntw3fA_I86MOvcf';

export interface Session { access: string; refresh: string; exp: number; user: { id: string; email: string } }
const KEY = 'nba-online-session';
let session: Session | null = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const keep = (s: Session | null) => { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* ignore */ } };
export const currentUser = () => session?.user ?? null;

async function authCall(path: string, body: any) {
  const r = await fetch(`${SB_URL}/auth/v1/${path}`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.error_description || j.message || j.error || `Sign-in failed (${r.status})`);
  return j;
}
const fromAuth = (j: any): Session => ({ access: j.access_token, refresh: j.refresh_token, exp: Date.now() / 1000 + (j.expires_in ?? 3600), user: { id: j.user?.id, email: j.user?.email } });

export async function signUp(email: string, password: string) {
  const j = await authCall('signup', { email, password });
  if (!j.access_token) throw new Error('Account created – but email confirmation is on in Supabase. Turn off “Confirm email” (Authentication → Sign In / Providers → Email), or confirm from your inbox and sign in.');
  keep(fromAuth(j));
  return session!;
}
export async function signIn(email: string, password: string) { keep(fromAuth(await authCall('token?grant_type=password', { email, password }))); return session!; }
export function signOut() { keep(null); }

async function token() {
  if (!session) throw new Error('Sign in first.');
  if (session.exp - Date.now() / 1000 < 120) {
    try { keep(fromAuth(await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh }))); }
    catch (e) { keep(null); throw new Error('Your sign-in expired – sign in again.'); }
  }
  return session!.access;
}

async function call(method: string, path: string, body?: any, prefer?: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const j = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(j?.message || j?.hint || `Server error ${r.status}`);
  return j;
}
export const select = (table: string, query: string) => call('GET', `${table}?${query}`);
export const insert = (table: string, row: any) => call('POST', table, row, 'return=minimal');
export const update = (table: string, query: string, patch: any) => call('PATCH', `${table}?${query}`, patch, 'return=minimal');
export const rpc = (fn: string, args: any) => call('POST', `rpc/${fn}`, args);

// ---- the league as text: gzip + base64
export async function pack(obj: any): Promise<string> {
  const gz = new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip')));
  const buf = new Uint8Array(await gz.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function unpack(b64: string): Promise<any> {
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const txt = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(txt);
}
