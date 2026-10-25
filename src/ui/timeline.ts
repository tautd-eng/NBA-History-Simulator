// Visual timeline of a game: maps play-by-play events onto "broadcast time".
// Live play runs at game-clock speed (a 15-second possession takes 15 seconds
// at ×1); dead balls (free throws, timeouts, fouls, substitutions, the end of a
// period) get extra time while the game clock is stopped. Both the court and
// the live viewer read the same timeline, so the clock, the score, the
// play-by-play list and the animation stay in step.
import type { PbpEv } from '../engine/game';

export interface TItem {
  i: number; e: PbpEv;
  a: number; b: number;      // visual window: the action leading to the event runs in (a, b]; the event registers at b
  g0: number; g1: number;    // game time at a and b
  sc0: number; scb: number;  // shot clock: game time the possession began and its length (24 or the offensive-rebound reset)
  live: boolean;             // the game clock runs in this window
}

const isShot = (k: string) => k === 'make2' || k === 'make3' || k === 'miss2' || k === 'miss3';

export class Timeline {
  items: TItem[] = [];
  end = 0;
  constructor(public evs: PbpEv[], public orbReset = 24) { this.build(); }

  private build() {
    const items: TItem[] = [];
    let v = 0, g = 0, debt = 0;
    let sc0 = 0, scb = 24;
    let prev: PbpEv | null = null;
    for (let i = 0; i < this.evs.length; i++) {
      const e = this.evs[i];
      const gap = Math.max(0, e.t - g);
      let len: number;
      const k = e.k;
      if (gap > 0) {
        // live play; earlier inserted time (rebounds) is paid back from the next possession
        len = Math.max(gap * 0.55, gap - debt);
        debt = Math.max(0, debt - (gap - len));
        const min = isShot(k) ? 1.5 : k === 'tov' || k === 'foul' ? 1.2 : 0.4;
        if (len < min) { debt += min - len; len = min; }
      } else if (k === 'orb' || k === 'drb') { len = prev && (prev.k === 'ftm') ? 1.0 : 1.1; debt += len; }
      else if (k === 'foul') len = prev && isShot(prev.k) ? 0.9 : 1.1;
      else if (k === 'ft' || k === 'ftm') len = prev && (prev.k === 'ft' || prev.k === 'ftm') ? 2.2 : 3.2;
      else if (k === 'timeout') len = 4.5;
      else if (k === 'period' || k === 'end') len = 2.8;
      else if (k === 'inj') len = 1.6;
      else if (k === 'sub') len = i === 0 ? 0.2 : 1.2;
      else if (isShot(k) || k === 'tov') { len = 1.5; debt += 1.5; }
      else len = 0.5;
      items.push({ i, e, a: v, b: v + len, g0: g, g1: Math.max(g, e.t), sc0, scb, live: gap > 0 || k === 'orb' || k === 'drb' });
      v += len; g = Math.max(g, e.t);
      // shot clock after the event
      if (k === 'make2' || k === 'make3' || k === 'drb' || k === 'tov' || k === 'period' || (k === 'ft' && this.lastFt(i))) { sc0 = g; scb = 24; }
      else if (k === 'orb') { sc0 = g; scb = this.orbReset; }
      prev = e;
    }
    this.items = items;
    this.end = v;
  }
  /** Is event i the last free throw of its trip? */
  lastFt(i: number) { const n = this.evs[i + 1]; return !n || (n.k !== 'ft' && n.k !== 'ftm'); }

  /** Index of the window containing v (the first item whose moment b is >= v). */
  itemAt(v: number) {
    let lo = 0, hi = this.items.length - 1;
    if (hi < 0) return -1;
    if (v > this.items[hi].b) return hi + 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.items[m].b < v) lo = m + 1; else hi = m; }
    return lo;
  }
  /** Number of events that have happened by visual time v. */
  countAt(v: number) {
    let lo = 0, hi = this.items.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.items[m].b <= v) lo = m + 1; else hi = m; }
    return lo;
  }
  gameAt(v: number) {
    const k = this.itemAt(v);
    if (k < 0) return 0;
    if (k >= this.items.length) return this.items[this.items.length - 1].g1;
    const it = this.items[k];
    const u = it.b > it.a ? Math.max(0, Math.min(1, (v - it.a) / (it.b - it.a))) : 1;
    return it.g0 + (it.g1 - it.g0) * u;
  }
  /** First visual moment at which game time reaches t. */
  vOfGame(t: number) {
    for (const it of this.items) {
      if (it.g1 >= t && it.g1 > it.g0) return it.a + (it.b - it.a) * Math.max(0, (t - it.g0) / (it.g1 - it.g0));
      if (it.g1 >= t) return it.a;
    }
    return this.end;
  }
  /** Game clock, score and shot clock at visual time v. */
  clockAt(v: number) {
    const n = this.countAt(v);
    const last = n > 0 ? this.items[n - 1].e : null;
    const k = this.itemAt(v);
    const it = this.items[Math.min(k, this.items.length - 1)];
    if (!it) return { period: 1, left: 720, hs: 0, as: 0, shot: 24 as number | null };
    const g = this.gameAt(v);
    const e = it.e;
    const after = k >= this.items.length; // past the last known event (clutch: waiting for the next call)
    const period = e.p;
    const left = after ? e.c : Math.max(0, e.c + (it.g1 - g));
    let shot: number | null = after ? null : Math.max(0, it.scb - (g - it.sc0));
    if (shot != null && (shot >= left || e.k === 'period' || e.k === 'end')) shot = null;
    return { period, left, hs: last?.hs ?? 0, as: last?.as ?? 0, shot };
  }
}
