// Moving a league between devices: a compressed save file to download / open, and an optional
// cloud copy in a private GitHub Gist of the user's own (personal access token with the "gist" scope,
// kept only in this browser).
import { League } from './types';
import { saveLeague, newSlotId, setSlot, saveHooks } from './api';

// ---------------------------------------------------------------- compression
async function gzip(text: string): Promise<Uint8Array> {
  const cs = new (globalThis as any).CompressionStream('gzip');
  const out = new Response(new Blob([text]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new (globalThis as any).DecompressionStream('gzip');
  return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}
function toB64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string) { const bin = atob(s.trim()); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
const isGz = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;

/** A league as a compressed file. */
export async function leagueBlob(lg: League) { return new Blob([await gzip(JSON.stringify(lg))], { type: 'application/gzip' }); }
export const fileName = (lg: League) => `${((lg as any).saveName ?? 'league').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_')}_${lg.season - 1}-${String(lg.season).slice(2)}.nbasave`;

export async function downloadLeague(lg: League) {
  const url = URL.createObjectURL(await leagueBlob(lg));
  const a = document.createElement('a');
  a.href = url; a.download = fileName(lg);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function parseLeague(text: string): League {
  const lg = JSON.parse(text);
  if (!lg || !lg.teams || !lg.players || !lg.season) throw new Error('This file is not a saved league.');
  return lg;
}
/** Reads a save file (compressed or plain JSON) and stores it as a new save slot; returns its id. */
export async function importFile(file: File): Promise<string> {
  const b = new Uint8Array(await file.arrayBuffer());
  const lg = parseLeague(isGz(b) ? await gunzip(b) : new TextDecoder().decode(b));
  return await storeAsNew(lg);
}
async function storeAsNew(lg: League, id = newSlotId()) {
  if (!(await saveLeague(lg, id))) throw new Error('The browser did not allow saving.');
  setSlot(id);
  return id;
}

// ---------------------------------------------------------------- GitHub Gist
const TOKEN_KEY = 'nba-gist-token', GIST_KEY = 'nba-gist-id', AUTO_KEY = 'nba-gist-auto';
const DESC = 'NBA History Simulator – saved leagues';
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } } };
export const cloudToken = () => ls.get(TOKEN_KEY);
export const setCloudToken = (t: string | null) => { ls.set(TOKEN_KEY, t?.trim() || null); ls.set(GIST_KEY, null); };
export const cloudAuto = () => ls.get(AUTO_KEY) === '1';
export const setCloudAuto = (on: boolean) => ls.set(AUTO_KEY, on ? '1' : null);

async function gh(path: string, init: RequestInit = {}) {
  const t = cloudToken();
  if (!t) throw new Error('No GitHub token yet.');
  const r = await fetch('https://api.github.com' + path, { cache: 'no-store', ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${t}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (r.status === 401) throw new Error('GitHub did not accept the token (expired or wrong).');
  if (r.status === 403 || r.status === 404) throw new Error('The token has no access to gists – it needs the "gist" permission.');
  if (!r.ok) throw new Error(`GitHub error ${r.status}.`);
  return r.status === 204 ? null : r.json();
}
/** The user's saves gist (found by its description, created on first upload). */
async function gistId(create: boolean): Promise<string | null> {
  const known = ls.get(GIST_KEY);
  if (known) return known;
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find((x: any) => x.description === DESC);
    if (g) { ls.set(GIST_KEY, g.id); return g.id; }
    if (list.length < 100) break;
  }
  if (!create) return null;
  const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { 'README.md': { content: 'Saved leagues of NBA History Simulator (compressed). Managed by the game – do not edit.' } } }) });
  ls.set(GIST_KEY, g.id);
  return g.id;
}

export interface CloudSave { file: string; name: string; label: string; updated: number; size: number }
const fileOf = (slotId: string) => `league-${slotId}.nbasave.b64`;

/** Uploads a league (one file per save slot, plus an index). */
export async function cloudUpload(lg: League, slotId: string) {
  const id = await gistId(true);
  const data = toB64(await gzip(JSON.stringify(lg)));
  const g = await gh(`/gists/${id}`);
  let index: CloudSave[] = [];
  try { index = JSON.parse(g.files['index.json']?.content ?? '[]'); } catch { index = []; }
  const file = fileOf(slotId);
  index = index.filter(x => x.file !== file);
  index.push({ file, name: (lg as any).saveName ?? 'League', label: `${lg.season - 1}–${String(lg.season).slice(2)}${lg.userTid ? ' · ' + (lg.teams[lg.userTid]?.name ?? '') : ''}`, updated: Date.now(), size: data.length });
  await gh(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [file]: { content: data }, 'index.json': { content: JSON.stringify(index, null, 1) } } }) });
}
export async function cloudList(): Promise<CloudSave[]> {
  const id = await gistId(false);
  if (!id) return [];
  const g = await gh(`/gists/${id}`);
  try { return (JSON.parse(g.files['index.json']?.content ?? '[]') as CloudSave[]).sort((a, b) => b.updated - a.updated); } catch { return []; }
}
/** Downloads a cloud save into this browser (replacing the local copy of the same save if there is one). */
export async function cloudDownload(file: string): Promise<string> {
  const id = await gistId(false);
  if (!id) throw new Error('No cloud saves yet.');
  const g = await gh(`/gists/${id}`);
  const f = g.files[file];
  if (!f) throw new Error('That save is no longer in the cloud.');
  // big files come truncated in the API answer: fetch the raw file then
  const text: string = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  const lg = parseLeague(await gunzip(fromB64(text)));
  const slotId = file.replace(/^league-/, '').replace(/\.nbasave\.b64$/, '');
  return await storeAsNew(lg, slotId);
}
export async function cloudDelete(file: string) {
  const id = await gistId(false);
  if (!id) return;
  const g = await gh(`/gists/${id}`);
  let index: CloudSave[] = [];
  try { index = JSON.parse(g.files['index.json']?.content ?? '[]'); } catch { /* empty */ }
  await gh(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [file]: null, 'index.json': { content: JSON.stringify(index.filter(x => x.file !== file), null, 1) } } }) });
}

// ---------------------------------------------------------------- automatic cloud copy
export const cloudStatus: { last: number; busy: boolean; error: string | null; listeners: Set<() => void> } = { last: 0, busy: false, error: null, listeners: new Set() };
const notify = () => cloudStatus.listeners.forEach(f => f());
let pending: { lg: League; id: string } | null = null, timer: any = null;
/** Upload now (and remember when). */
export async function cloudSync(lg: League, id: string) {
  cloudStatus.busy = true; notify();
  try { await cloudUpload(lg, id); cloudStatus.last = Date.now(); cloudStatus.error = null; }
  catch (e: any) { cloudStatus.error = e?.message ?? String(e); }
  finally { cloudStatus.busy = false; notify(); }
}
// after a local save: upload at most every 90 seconds, always the newest state
saveHooks.push((lg, id) => {
  if (!cloudAuto() || !cloudToken()) return;
  pending = { lg, id };
  if (timer) return;
  const wait = Math.max(3000, 90000 - (Date.now() - cloudStatus.last));
  timer = setTimeout(async () => { timer = null; const p = pending; pending = null; if (p) await cloudSync(p.lg, p.id); }, wait);
});
