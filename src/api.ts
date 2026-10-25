// Thin control layer between the UI and the league: advancing time in chunks
// (so the page stays responsive) and saving to the browser.
import { League } from './types';
import { simDay } from './league/league';
import { initDraft, draftAdvance, enterFreeAgency, faStage, startSeason } from './league/offseason';
import { fantasyAdvance } from './league/fantasy';

export type Target = 'day' | 'week' | 'playoffs' | 'seasonEnd' | 'nextSeason' | 'years5';

const tick = () => new Promise(r => setTimeout(r, 0));

/** One unit of progress; returns false when it cannot move (league ended). */
export function stepOnce(lg: League): boolean {
  if (lg.ended) return false;
  if (lg.phase === 'fantasy') { fantasyAdvance(lg, true); return true; }
  if (lg.phase === 'regular' || lg.phase === 'playoffs') { simDay(lg); return true; }
  if (lg.phase === 'draft') {
    if (!lg.draftDay || lg.draftDay.year !== lg.season) initDraft(lg);
    else if (!lg.draftDay.done) draftAdvance(lg, 'all');
    else enterFreeAgency(lg);
    return !lg.ended;
  }
  if (lg.phase === 'offseason') { enterFreeAgency(lg); return !lg.ended; } // saves from older versions
  if (lg.phase === 'freeagency') {
    if (lg.fa && lg.fa.stage <= 3) faStage(lg); else startSeason(lg);
    return true;
  }
  return false;
}

export async function advance(lg: League, target: Target, onProgress: () => void, shouldStop: () => boolean) {
  if (target === 'day') { stepOnce(lg); onProgress(); return; }
  const startSeason = lg.season;
  const startDay = lg.day;
  const done = (): boolean => {
    if (lg.ended) return true;
    switch (target) {
      case 'week': return lg.day >= startDay + 7 || (lg.phase !== 'regular' && lg.phase !== 'playoffs');
      case 'playoffs': return lg.phase !== 'regular';
      case 'seasonEnd': return lg.phase === 'draft';
      case 'nextSeason': return lg.season > startSeason && lg.phase === 'regular';
      case 'years5': return lg.season >= startSeason + 5 && lg.phase === 'regular';
    }
  };
  let n = 0;
  let last = performance.now();
  while (!done()) {
    if (shouldStop()) break;
    if (!stepOnce(lg)) break;
    n++;
    if (performance.now() - last > 120) { onProgress(); await tick(); last = performance.now(); }
  }
  onProgress();
}

// ------------------------------------------------------------ persistence
// Several saved leagues ("slots") in one IndexedDB store; a small index lists them.
const DB = 'nba-istorija', STORE = 'lyga', META = 'slots';
export interface SaveInfo { id: string; name: string; updated: number; label: string }
let slot = (() => { try { return localStorage.getItem('nba-slot') || 'current'; } catch { return 'current'; } })();
export const currentSlot = () => slot;
export function setSlot(id: string) { slot = id; try { localStorage.setItem('nba-slot', id); } catch { /* per-tab only */ } }
export const newSlotId = () => 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function get<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return await new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res((r.result as T) ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function put(key: string, v: any) {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function del(key: string) {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
const labelOf = (lg: League) => `${lg.season - 1}–${String(lg.season).slice(2)}${lg.userTid ? ` · ${lg.teams[lg.userTid]?.name ?? lg.userTid}` : ''}`;
const startLabel = (lg: League) => { const y = lg.start ?? 1980; return `${y - 1}–${String(y).slice(2)}`; };
export const defaultName = (lg: League) => (lg.userTid ? `${lg.teams[lg.userTid]?.name ?? lg.userTid} – from ${startLabel(lg)}` : `League from ${startLabel(lg)}`);

/** All saves, newest first (older single-save data shows up as one slot). */
export async function listSaves(): Promise<SaveInfo[]> {
  try {
    let meta = await get<SaveInfo[]>(META);
    if (!meta) {
      meta = [];
      const old = await get<League>('current');
      if (old) { meta.push({ id: 'current', name: (old as any).saveName ?? defaultName(old), updated: Date.now(), label: labelOf(old) }); await put(META, meta); }
    }
    return [...meta].sort((a, b) => b.updated - a.updated);
  } catch { return []; }
}
async function upsertMeta(info: SaveInfo) {
  const meta = (await listSaves()).filter(x => x.id !== info.id);
  meta.push(info);
  await put(META, meta);
}
export async function saveLeague(lg: League, id = slot): Promise<boolean> {
  try {
    (lg as any).saveName ??= defaultName(lg);
    await put(id, JSON.parse(JSON.stringify(lg)));
    await upsertMeta({ id, name: (lg as any).saveName, updated: Date.now(), label: labelOf(lg) });
    return true;
  } catch { return false; }
}
export async function loadLeague(id = slot): Promise<League | null> {
  try { return await get<League>(id); } catch { return null; }
}
export async function deleteSave(id: string) {
  try {
    await del(id);
    const meta = (await listSaves()).filter(x => x.id !== id);
    await put(META, meta);
  } catch { /* storage unavailable */ }
}
export async function renameSave(id: string, name: string) {
  const lg = await loadLeague(id);
  if (!lg) return;
  (lg as any).saveName = name;
  await saveLeague(lg, id);
}
export async function clearLeague() { await deleteSave(slot); }
