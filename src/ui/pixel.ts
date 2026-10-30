// Retro pixel-art court. It plays a game back on a broadcast timeline (see
// timeline.ts): every possession is staged from the play-by-play — how the
// ball came in (inbound, outlet, steal, offensive rebound), the bring-up,
// ball movement while the shot clock runs, and the final action that the
// event implies (pick and roll, isolation, post-up, drive and kick, coming off
// a screen, backdoor cut, fast break, putback). Situational calls from the
// engine (milking the clock, holding for the last shot, 2-for-1, intentional
// fouls) change how the possession is played. Players accelerate and steer
// toward their targets; defenders guard their man, help, close out and box out.
import type { PbpEv } from '../engine/game';
import { hash01 } from '../rng';
import { Timeline } from './timeline';
import { drawAthleteOutlined as drawAthlete, shade, Body, Hands, AthPose } from './athlete';
import { AZ, AXC, AFX, AFY, AYF, VZ, aproj, depthScale, renderCourt, renderStands, Layer } from './arena';

export const VW = 320, VH = 180;
const S = 2; // drawn at 2× so text and overlays stay crisp
const Z = 1.4; // broadcast camera zoom: follows the ball across the court
const FAR_Y = 74, NEAR_Y = 168, FAR_L = 50, FAR_R = 270, NEAR_L = 6, NEAR_R = 314;
const LEN = 94, WID = 50;

// Team colours (franchise id → [primary, secondary]). Plain colours, no marks.
const COLORS: Record<string, [string, string]> = {
  ATL: ['#c8102e', '#fdb927'], BOS: ['#007a33', '#ba9653'], BRK: ['#1f2a44', '#c8102e'], CHA: ['#1d8cab', '#f26532'],
  CHI: ['#ce1141', '#111111'], CLE: ['#6f263d', '#ffb81c'], DAL: ['#0064b1', '#8d9093'], DEN: ['#0e2240', '#fec524'],
  DET: ['#1d42ba', '#c8102e'], GSW: ['#1d428a', '#ffc72c'], HOU: ['#ce1141', '#c4ced4'], IND: ['#002d62', '#fdbb30'],
  LAC: ['#1d428a', '#c8102e'], LAL: ['#552583', '#fdb927'], MEM: ['#2b3a6b', '#5d76a9'], MIA: ['#98002e', '#111111'],
  MIL: ['#00471b', '#eee1c6'], MIN: ['#0c2340', '#78be20'], NOP: ['#00788c', '#4b2f87'], NYK: ['#006bb6', '#f58426'],
  OKC: ['#00653a', '#ffc200'], ORL: ['#0077c0', '#111111'], PHI: ['#006bb6', '#ed174c'], PHO: ['#5a2d81', '#e56020'],
  POR: ['#c8102e', '#111111'], SAC: ['#5a2d81', '#63727a'], SAS: ['#2a2a2a', '#c4ced4'], TOR: ['#753bbd', '#ce1141'],
  UTA: ['#3e2680', '#f9a01b'], WAS: ['#c8102e', '#002b5c'],
};
export const teamColor = (tid: string) => COLORS[tid] ?? ['#666666', '#bbbbbb'];

const SKIN = ['#5b3a29', '#7a4b33', '#9c6644', '#c68863', '#e0ac85', '#f1c9a5'];
const HAIR = ['#1b1410', '#1b1410', '#3b2414', '#6b4a2b', '#c9a35b', null];

export interface CourtTeam { tid: string; abbr: string }
export interface CourtOpts {
  home: CourtTeam; away: CourtTeam;
  names: Record<string, string>;
  side: Record<string, 'h' | 'a'>;
  pos: Record<string, number>; // 1 (PG) … 5 (C)
  style?: 'classic' | 'arena';  // arena: flat broadcast court with big sprites, benches and a score bug
  looks?: Record<string, Look>; // per player: skin, hair, number
  orbReset?: number;            // shot clock after an offensive rebound (24, or 14 from 2018–19)
  season?: number;
  homeName?: string;            // full team name (painted on the baselines)
}
export interface Look extends Body { ovr?: number; ath?: number }

type Side = 'h' | 'a';
type Pose = 'stand' | 'run' | 'shoot' | 'jump' | 'stance' | 'celebrate' | 'rest' | 'dribble' | 'gather' | 'layup' | 'dunk' | 'hang' | 'hook' | 'block' | 'contest' | 'pass' | 'screen' | 'boxout' | 'reb' | 'follow' | 'fade';
type Beh =
  | { k: 'spot' }
  | { k: 'guard'; man: string; tight: number }
  | { k: 'back'; man: string; slot: number }
  | { k: 'follow'; pid: string; dx: number; dd: number }
  | { k: 'box'; man: string }
  | { k: 'mark'; pid: string; dist: number }
  | { k: 'arrive'; x: number; d: number; at: number }; // get to a spot by a deadline (broadcast time)
interface PSprite {
  pid: string; side: Side; x: number; d: number; vx: number; vd: number; tx: number; td: number;
  spd: number; mul: number; z: number; jt: number; jd: number; jh: number;
  pose: Pose; pt: number; face: number; beh: Beh; skin: string; hair: string | null; leaving?: boolean;
  ph: number; // stride phase
  hand?: number;  // dribbling hand: 1 = front (strong) hand, -1 = the other
  dph?: number;   // dribble phase
  xover?: number; // crossover in progress (seconds left)
  rate?: number;  // dribbles per second
  hang?: number;  // hanging on the rim after a dunk (seconds)
  lvx?: number;   // last velocity along the court (to notice a change of direction)
  ax?: number; ad?: number; // the spot he was sent to (idle shuffles stay around it)
  next?: [Pose, number];     // the pose that follows the current one
}
interface Fly { x0: number; d0: number; z0: number; x1: number; d1: number; z1: number; peak: number; t: number; dur: number; to?: string; done?: () => void; bounce?: boolean }
interface Ball { x: number; d: number; z: number; holder: string | null; fly: Fly | null }
interface Key { at: number; fn: () => void; done?: boolean }
interface Floater { text: string; color: string; t: number; dur: number; big: boolean; at?: { x: number; d: number; z: number } }
interface Mark { x: number; d: number; made: boolean; side: Side; t: number; three: boolean }
type Add = (at: number, fn: () => void) => void;
interface How { how: 'inbound' | 'rebound' | 'orb' | 'steal' | 'side' | 'period' | 'tip'; pid?: string | null }

// running speeds, feet per second
const WALK = 5, JOG = 11, RUN = 16, SPRINT = 22, ACC = 32;
// half-court spots (feet from the basket along the court, depth across): top, wings, corners, elbows, blocks, slots
const SP: Record<string, [number, number]> = {
  // wings sit at 45 degrees and the slots higher up, so the floor is spread along the court as well as across it
  top: [27, 25], lw: [16.5, 8], rw: [16.5, 42], lc: [2.5, 3], rc: [2.5, 47], le: [13.5, 18.5], re: [13.5, 31.5], lb: [4.5, 18.5], rb: [4.5, 31.5], ls: [24, 14], rs: [24, 36],
};

const surname = (n: string) => { const p = n.split(' '); return (p.length > 1 ? p.slice(1).join(' ') : n).toUpperCase(); };
function posNumOf(pos: string) {
  const m: Record<string, number> = { PG: 1, SG: 2, G: 1.5, GF: 2.5, SF: 3, F: 3.5, FC: 4.5, PF: 4, C: 5 };
  return m[pos] ?? m[pos.split('-')[0]] ?? 3;
}
export { posNumOf };
const isShot = (k: string) => k === 'make2' || k === 'make3' || k === 'miss2' || k === 'miss3';
const other = (s: Side): Side => (s === 'h' ? 'a' : 'h');
const hyp = Math.hypot;
/** small deterministic generator for a window's cosmetic choices */
function gen(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class PixelCourt {
  ctx: CanvasRenderingContext2D;
  o: CourtOpts;
  players = new Map<string, PSprite>();
  ball: Ball = { x: 47, d: 25, z: 3, holder: null, fly: null };
  floaters: Floater[] = [];
  speed = 1;
  cheer = 0;
  net = { h: 0, a: 0 };
  last = 0;
  raf = 0;
  crowd: { x: number; y: number; c: string; ph: number }[] = [];
  onIdle: (() => void) | null = null;
  dbg: ((x: any) => void) | null = null; // test hook
  onShown: ((n: number) => void) | null = null;
  idleFired = true;
  label: { pid: string; t: number } | null = null;
  label2: { pid: string; t: number } | null = null; // the defender on the play
  match = new Map<string, string>(); // offensive pid → defender pid
  marks: Mark[] = [];
  trail: { x: number; y: number; t: number }[] = [];
  rimFx: { side: Side; made: boolean; t: number } | null = null;
  hl: { pid: string; t: number } | null = null;
  caption: { text: string; side: Side | ''; kind: string; t: number } | null = null;
  z = Z;
  arena = false;
  camX = (VW - VW / Z) / 2;
  camY = VH - VH / Z;
  font = '"Silkscreen", "Courier New", monospace';
  // playback
  tl: Timeline | null = null;
  v = 0;              // broadcast time on screen
  cur = 0;            // window being played
  keys: Key[] = [];
  ext: number | null = null;   // live viewer: time to show
  auto = false;                // clutch: advance by itself up to `limit`
  limit = 0;
  ff = false;                  // fast-forwarding after a jump: no floaters
  shown = -1;

  benchCache = new Map<string, HTMLCanvasElement>();
  R = 1; // extra resolution of the canvas (crisp text and overlays)
  Rw = 1; // arena: resolution of the pixel buffer the scene is drawn into (scaled up ×R)
  buf: HTMLCanvasElement | null = null;
  courtL: Layer | null = null;
  standsL: (Layer & { cheer: HTMLCanvasElement }) | null = null;
  shake = 0;
  hot = new Map<string, boolean>(); // players on fire (three makes in a row)
  streak = new Map<string, number>();
  replay: { from: number; to: number; t: number } | null = null;
  replaying = false;
  replays = true;                 // the viewer can turn slow-motion replays off
  pending: { from: number; to: number; at: number } | null = null;
  extRate = 1; lastExt: number | null = null;
  lastReplayT = -999;
  notes = new Map<number, string>(); // what happened, explained (turnovers): shown with the play-by-play line
  canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, o: CourtOpts) {
    this.canvas = canvas;
    canvas.width = VW * S; canvas.height = VH * S;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.o = o;
    this.setStyle(o.style ?? 'classic', o.looks);
    const pal = ['#d94f4f', '#e8c547', '#4f86d9', '#e6e6e6', '#58b368', '#b05fd1', '#f08a3c', '#7a7a7a', '#2f2f2f'];
    for (let y = 20; y < FAR_Y - 12; y += 4) {
      for (let x = 2; x < VW - 2; x += 3) {
        const r = hash01(`${x},${y}`);
        if (r < 0.12) continue;
        this.crowd.push({ x: x + (y % 8 === 2 ? 1 : 0), y, c: pal[Math.floor(hash01(`${y},${x}`) * pal.length)], ph: r * 6.28 });
      }
    }
  }

  start() {
    const loop = (now: number) => {
      const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
      this.last = now;
      this.update(dt);
      this.draw(now / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); }

  /** Switch between the classic broadcast court and the arena view. */
  setStyle(style: 'classic' | 'arena', looks?: Record<string, Look>) {
    this.arena = style === 'arena';
    if (looks) this.o.looks = looks;
    const R = this.arena ? 2 : 1;
    if (R !== this.R || this.canvas.width !== VW * S * R) {
      this.R = R;
      this.canvas.width = VW * S * R; this.canvas.height = VH * S * R;
      this.ctx.imageSmoothingEnabled = false;
    }
    this.z = this.arena ? AZ : Z;
    this.camY = this.arena ? AYF - 32 : VH - VH / this.z;
    this.camX = this.arena ? AXC - VW / this.z / 2 : Math.max(0, Math.min(VW - VW / this.z, this.camX));
    this.benchCache.clear();
  }

  // ------------------------------------------------------------ geometry
  proj(x: number, d: number, z = 0) {
    if (this.arena) return aproj(x, d, z);
    const t = Math.max(-0.15, Math.min(1.2, d / WID));
    const l = FAR_L + t * (NEAR_L - FAR_L), r = FAR_R + t * (NEAR_R - FAR_R);
    const sc = (r - l) / LEN;
    return { x: l + (x / LEN) * (r - l), y: FAR_Y + t * (NEAR_Y - FAR_Y) - z * sc * 0.9, sc };
  }
  basket(side: Side) { return side === 'h' ? { x: LEN - 5.25, d: 25 } : { x: 5.25, d: 25 }; }
  dir(side: Side) { return side === 'h' ? 1 : -1; } // home attacks the right basket
  /** a half-court spot for the team attacking with `side` */
  spot(side: Side, name: string, jitter = 0, r?: () => number) {
    const [rel, d] = SP[name] ?? SP.top;
    const j = (u: number) => (u - 0.5) * jitter;
    const B = this.basket(side);
    return { x: B.x - this.dir(side) * (rel + (r ? j(r()) : 0)), d: d + (r ? j(r()) : 0) };
  }

  // ------------------------------------------------------------ playback API
  setEvents(evs: PbpEv[]) {
    const n0 = this.tl?.items.length ?? 0;
    this.tl = new Timeline(evs, this.o.orbReset ?? 24);
    if (n0 === 0 && this.tl.items.length) this.seek(this.ext ?? 0);
    else if (this.cur >= n0 && this.cur < this.tl.items.length) this.enter(this.cur); // new events after the end: plan the next window
  }
  /** Clutch mode: play up to the moment of event `upto` (count), then report idle. */
  setUpto(upto: number) {
    if (!this.tl) return;
    const it = this.tl.items[Math.min(upto, this.tl.items.length) - 1];
    const lim = it ? it.b + 0.5 : 0;
    if (!this.auto) { this.auto = true; this.seek(lim); }
    this.limit = lim;
    if (this.v < lim - 1e-6) this.idleFired = false;
  }

  update(dt: number) {
    // how fast the viewer is playing (replays only make sense at watching speed)
    if (this.ext != null && dt > 0) { const r = (this.ext - (this.lastExt ?? this.ext)) / dt; this.extRate = this.extRate * 0.92 + Math.max(0, Math.min(50, r)) * 0.08; this.lastExt = this.ext; }
    if (this.replay) {
      // slow-motion replay of the last play, then back to live
      this.replay.t += dt;
      const u = this.replay.from + this.replay.t * 0.42;
      if (u >= this.replay.to || this.ext == null || this.ext < this.replay.from - 0.5) { this.replay = null; this.replaying = false; this.seek(this.ext ?? this.v); }
      else if (u > this.v) this.advance(u - this.v);
    } else {
      let target = this.v;
      if (this.ext != null) target = this.ext;
      else if (this.auto) target = Math.min(this.limit, this.v + dt * this.speed);
      const dv = target - this.v;
      if (this.tl && (dv < -0.01 || dv > 3)) { this.pending = null; this.seek(target); }
      else if (dv > 1e-6) this.advance(dv);
      else if (this.auto) { this.behave(); this.physics(dt); this.ballStep(dt); } // waiting for the coach: players settle
      if (this.pending && this.v >= this.pending.at) {
        const pr = this.pending; this.pending = null;
        if (this.ext != null && this.extRate < 2.6 && this.replays) { this.replay = { from: pr.from, to: pr.to, t: 0 }; this.replaying = true; this.seek(pr.from); }
      }
    }
    if (this.auto && !this.idleFired && this.v >= this.limit - 1e-6) { this.idleFired = true; this.onIdle?.(); }
    // cosmetic timers run in real time
    this.floaters = this.floaters.filter(f => (f.t += dt) < f.dur);
    this.trail = this.trail.filter(q => (q.t += dt) < 0.5);
    this.marks = this.marks.filter(m => (m.t += dt) < 9);
    if (this.rimFx && (this.rimFx.t += dt) > 0.7) this.rimFx = null;
    if (this.hl && (this.hl.t -= dt) <= 0) this.hl = null;
    if (this.caption) this.caption.t += dt;
    if (this.label) { this.label.t -= dt; if (this.label.t <= 0) this.label = null; }
    if (this.label2) { this.label2.t -= dt; if (this.label2.t <= 0) this.label2 = null; }
    this.cheer = Math.max(0, this.cheer - dt);
    this.net.h = Math.max(0, this.net.h - dt); this.net.a = Math.max(0, this.net.a - dt);
    const bp = this.proj(this.ball.x, this.ball.d);
    if (this.arena) {
      // broadcast camera: leads the play toward the basket being attacked, eases in and out
      // keep the basket being attacked in the picture: frame between the ball and the rim
      const hold = this.P(this.ball.holder);
      const off: Side | null = hold ? hold.side : this.ball.fly ? (this.ball.x > 47 ? 'h' : 'a') : null;
      let fx = this.ball.x;
      if (off) {
        const B = this.basket(off);
        const near = Math.abs(B.x - this.ball.x);
        fx = near < 44 ? this.ball.x + (B.x - this.ball.x) * 0.42 : this.ball.x + this.dir(off) * 8;
      }
      const vw = VW / this.z;
      const camT = Math.max(-26, Math.min(346 - vw, this.proj(fx, 25).x - vw / 2));
      this.camX += (camT - this.camX) * Math.min(1, dt * 2.2);
      this.shake = Math.max(0, this.shake - dt * 2.5);
    } else {
      const camT = Math.max(0, Math.min(VW - VW / this.z, bp.x - VW / this.z / 2));
      this.camX += (camT - this.camX) * Math.min(1, dt * 3);
    }
  }

  private advance(dv: number) {
    const n = Math.max(1, Math.ceil(dv / 0.025));
    for (let i = 0; i < n; i++) this.stepSim(dv / n);
  }

  private stepSim(h: number) {
    const items = this.tl?.items ?? [];
    this.v += h;
    while (this.cur < items.length && this.v >= items[this.cur].b) {
      this.fire(Infinity);
      this.register(this.cur);
      this.cur++;
      this.enter(this.cur);
    }
    if (this.cur < items.length) this.fire(this.v - items[this.cur].a);
    this.behave();
    this.physics(h);
    this.ballStep(h);
  }
  private fire(t: number) {
    for (const k of this.keys) if (!k.done && k.at <= t) { k.done = true; k.fn(); }
  }
  private enter(k: number) {
    const items = this.tl?.items ?? [];
    this.keys = k < items.length ? this.plan(k) : [];
  }

  /** Jump to time v: rebuild the scene at the start of its window and play forward quickly. */
  seek(v: number) {
    const tl = this.tl;
    if (!tl || !tl.items.length) { this.v = v; return; }
    v = Math.max(0, Math.min(tl.end + 1, v));
    const k = Math.min(tl.itemAt(v), tl.items.length - 1);
    this.ff = true;
    this.resetScene(k);
    this.cur = k;
    this.v = tl.items[k].a;
    this.enter(k);
    while (this.v < v - 1e-9) this.stepSim(Math.min(0.05, v - this.v));
    this.ff = this.replaying;
    if (this.shown !== tl.countAt(this.v)) { this.shown = tl.countAt(this.v); if (!this.replaying) this.onShown?.(this.shown); }
  }

  /** The event at window k happens. */
  private register(k: number) {
    const it = this.tl!.items[k], e = it.e;
    if (e.k !== 'sub' || k > 0) this.setCaption(e, k);
    // highlights get a slow-motion replay: dunks, blocks, late daggers
    if (!this.ff && !this.replaying && this.ext != null && e.t - this.lastReplayT > 75) {
      const shooter = this.pidOf(e, 'fga');
      const big = e.k === 'make2' && e.sk === 'dunk' && (this.starOf(shooter ?? '') > 0 || hash01('rp' + k) < 0.5)
        || (e.k === 'miss2' || e.k === 'miss3') && !!this.pidOf(e, 'blk') && hash01('rb' + k) < 0.5
        || (e.k === 'make3' || e.k === 'make2') && e.p >= 4 && e.c < 40 && Math.abs(e.hs - e.as) <= 3;
      if (big) { this.pending = { from: Math.max(it.a, it.b - 2.7), to: it.b + 0.45, at: it.b + 1.1 }; this.lastReplayT = e.t; }
    }
    this.shown = k + 1;
    if (!this.replaying) this.onShown?.(k + 1);
  }

  // ------------------------------------------------------------ helpers
  pidOf(e: PbpEv, k: string) { return e.d?.find(x => x[1] === k)?.[0] ?? null; }
  private say(text: string, color = '#ffffff', big = true, dur = 1.1, at?: { x: number; d: number; z: number }) { if (!this.ff) this.floaters.push({ text, color, t: 0, dur, big, at }); }
  private sayAt(pid: string | null, text: string, color: string, dur = 1.1) {
    const p = pid ? this.players.get(pid) : null;
    this.say(text, color, false, dur, p ? { x: p.x, d: p.d, z: 22 } : undefined);
  }
  private setCaption(e: PbpEv, k = -1) {
    const txt = e.txt.replace('{h}', this.o.home.abbr).replace('{a}', this.o.away.abbr);
    const d = e.m && e.k.startsWith('m') ? this.o.names[e.m] : null;
    const note = this.notes.get(k);
    this.caption = { text: note ? note : d ? `${txt} · guarded by ${d.split(' ').slice(-1)[0]}` : txt, side: e.s, kind: e.k, t: 0 };
  }
  /** what the team is doing (shown until the play happens) */
  private call(side: Side, text: string) { this.caption = { text, side, kind: 'call', t: 0 }; }
  abbr(s: Side) { return s === 'h' ? this.o.home.abbr : this.o.away.abbr; }
  private sideColor(s: Side | '') { return s === 'h' ? teamColor(this.o.home.tid)[0] : s === 'a' ? teamColor(this.o.away.tid)[0] : '#ffffff'; }
  on(side: Side) { return [...this.players.values()].filter(p => p.side === side && !p.leaving); }
  /** on-court players by position: point guard first, centre last */
  ord(side: Side) { return this.on(side).sort((p, q) => (this.o.pos[p.pid] ?? 3) - (this.o.pos[q.pid] ?? 3) || (p.pid < q.pid ? -1 : 1)); }
  posN(pid: string | null | undefined) { return pid ? this.o.pos[pid] ?? 3 : 3; }
  private P(pid: string | null | undefined) { return pid ? this.players.get(pid) ?? null : null; }
  private ballPos() {
    const h = this.P(this.ball.holder);
    return h && !this.ball.fly ? { x: h.x, d: h.d } : { x: this.ball.x, d: this.ball.d };
  }

  private addPlayer(pid: string, side: Side, x: number, d: number) {
    const r = hash01(pid);
    const pn = this.o.pos[pid] ?? 3;
    const sp: PSprite = {
      pid, side, x, d, vx: 0, vd: 0, tx: x, td: d, spd: JOG, mul: (1.06 - (pn - 1) * 0.035) * (0.95 + 0.05 * hash01(pid + 'q') + 0.08 * (this.o.looks?.[pid]?.ath ?? 0.5)) * (1 + 0.025 * this.starOf(pid)),
      z: 0, jt: 0, jd: 0, jh: 0, pose: 'stand', pt: 0, face: side === 'h' ? 1 : -1, beh: { k: 'spot' }, ph: hash01(pid + 'ph') * 6.28,
      skin: SKIN[Math.floor(r * SKIN.length)], hair: HAIR[Math.floor(hash01(pid + 'h') * HAIR.length)],
    };
    this.players.set(pid, sp);
    return sp;
  }
  /** send a player somewhere at a given speed */
  private go(p: PSprite | null, x: number, d: number, spd = RUN) {
    if (!p) return;
    if (p.beh.k === 'arrive' && p.beh.at > this.v) return; // on his way to his shot: nothing else matters now
    p.ax = x; p.ad = d;
    p.beh = { k: 'spot' }; p.tx = x; p.td = Math.max(-4, Math.min(WID + 4, d)); p.spd = Math.min(spd, 26);
  }
  private jump(p: PSprite | null, h: number, dur: number, pose: Pose = 'jump') {
    if (!p) return;
    p.jt = 0; p.jd = dur; p.jh = h; p.pose = pose; p.pt = dur + 0.15;
  }
  private setPose(p: PSprite | null, pose: Pose, t: number) { if (p) { p.pose = pose; p.pt = t; } }
  private give(pid: string | null | undefined) {
    if (!pid) return;
    this.ball.fly = null;
    this.ball.holder = pid;
  }
  private flyBall(x1: number, d1: number, z1: number, peak: number, dur: number, done?: () => void, to?: string) {
    const b = this.ball;
    const from = this.P(b.holder);
    const x0 = from ? from.x + from.face * 0.8 : b.x, d0 = from ? from.d + 0.4 : b.d, z0 = from ? Math.max(5, b.z) : b.z;
    b.holder = null;
    b.fly = { x0, d0, z0, x1, d1, z1, peak, t: 0, dur, done, to };
  }
  /** a pass (homes in on the receiver) */
  private pass(to: string | null | undefined, bounce = false, lob = false) {
    const r = this.P(to);
    if (!r || this.ball.holder === to) return;
    const passer = this.P(this.ball.holder);
    const from = this.ballPos();
    const dist = hyp(r.x - from.x, r.d - from.d);
    // a crisp chest pass travels flat and fast; bounce passes skip off the floor; lobs float
    if (passer) { this.setPose(passer, 'pass', 0.28); passer.face = Math.sign(r.x - passer.x) || passer.face; }
    this.flyBall(r.x, r.d, 4.6, lob ? 9 + dist * 0.08 : bounce ? 0 : 4.9 + dist * 0.012, lob ? 0.35 + dist / 34 : Math.max(0.16, 0.08 + dist / (bounce ? 40 : 50)), () => this.give(to), to);
    if (bounce && this.ball.fly) this.ball.fly.bounce = true;
  }
  /** defenders take their man (offence pid → defender pid by position, unless a matchup is given) */
  private matchUp(off: Side, force?: [string, string]) {
    const o = this.ord(off), d = this.ord(other(off));
    this.match.clear();
    o.forEach((p, i) => { if (d[i]) this.match.set(p.pid, d[i].pid); });
    if (force) this.assign(force[0], force[1]);
  }
  private assign(offPid: string, defPid: string) {
    if (!this.players.has(offPid) || !this.players.has(defPid)) return;
    const cur = this.match.get(offPid);
    if (cur === defPid) return;
    for (const [o, d] of this.match) if (d === defPid) { if (cur) this.match.set(o, cur); else this.match.delete(o); }
    this.match.set(offPid, defPid);
  }
  defOf(pid: string | null | undefined) { return pid ? this.P(this.match.get(pid)) : null; }
  private guardAll(off: Side) {
    for (const [o, d] of this.match) { const dp = this.P(d); if (dp && dp.side !== off) dp.beh = { k: 'guard', man: o, tight: 0 }; }
  }
  private retreat(def: Side) {
    // the defence sprints back, then picks up its man
    this.ord(def).forEach((p, i) => {
      const man = [...this.match].find(([, d]) => d === p.pid)?.[0];
      p.beh = { k: 'back', man: man ?? '', slot: i };
    });
  }

  // ------------------------------------------------------------ lineups
  setLineups(h: string[], a: string[], snap = false) {
    const keep = new Set([...h, ...a]);
    const outs: Record<Side, PSprite[]> = { h: [], a: [] };
    for (const [pid, p] of this.players) if (!keep.has(pid)) {
      if (snap) { this.players.delete(pid); continue; }
      if (!p.leaving) { outs[p.side].push(p); p.leaving = true; this.go(p, 47 + (p.side === 'h' ? -3 : 3), -3, JOG); }
    }
    for (const [side, ids] of [['h', h], ['a', a]] as const) for (const pid of ids) {
      const ex = this.players.get(pid);
      if (ex) { ex.leaving = false; continue; }
      const rep = outs[side].shift();
      if (snap) this.addPlayer(pid, side, 47, 25);
      else { const p = this.addPlayer(pid, side, 47 + (side === 'h' ? -3 : 3), -3); this.go(p, rep ? rep.x : 47, rep ? rep.d : 25, JOG); }
    }
    if (this.ball.holder && !this.players.has(this.ball.holder)) this.ball.holder = null;
  }

  // ------------------------------------------------------------ simulation
  private behave() {
    const bp = this.ballPos();
    for (const p of this.players.values()) {
      const b = p.beh;
      if (b.k === 'spot') {
        // nobody stands like a statue in live play: small shuffles around his spot
        if (p.ax !== undefined && this.ball.holder && this.ball.holder !== p.pid && p.pt <= 0 && hyp(p.tx - p.x, p.td - p.d) < 0.6) {
          const bucket = Math.floor(this.v / 1.7 + hash01(p.pid) * 7);
          if (hash01(p.pid + '|' + bucket) < 0.55) { p.tx = p.ax + (hash01(p.pid + 'x' + bucket) - 0.5) * 2.2; p.td = (p.ad ?? p.d) + (hash01(p.pid + 'd' + bucket) - 0.5) * 1.6; p.spd = WALK; }
        }
        continue;
      }
      if (b.k === 'arrive') {
        const dist = hyp(b.x - p.x, b.d - p.d), left = b.at - this.v;
        p.tx = b.x; p.td = b.d;
        p.spd = Math.max(JOG, Math.min(SPRINT * 1.3, dist / Math.max(0.12, left) * 1.25));
        if (left <= 0) p.beh = { k: 'spot' };
        continue;
      }
      if (b.k === 'guard' || b.k === 'box' || b.k === 'back') {
        const man = this.P(b.man);
        if (b.k === 'back') {
          const B = this.basket(other(p.side)), s = this.dir(other(p.side));
          const slots = [[9, 25], [15, 14], [15, 36], [20, 21], [21, 30]];
          const [rel, dd] = slots[b.slot % 5];
          p.tx = B.x - s * rel; p.td = dd; p.spd = SPRINT;
          const ballNear = Math.abs(bp.x - B.x) < 42;
          if (man && (ballNear || hyp(p.tx - p.x, p.td - p.d) < 3)) p.beh = { k: 'guard', man: man.pid, tight: 0 };
          continue;
        }
        if (!man || man.leaving) { p.beh = { k: 'spot' }; continue; }
        const B = this.basket(man.side);
        const dx = B.x - man.x, dd = B.d - man.d, dist = hyp(dx, dd) || 1;
        if (b.k === 'box') { p.tx = man.x + dx / dist * 2.4; p.td = man.d + dd / dist * 2.4; p.spd = RUN; continue; }
        if (this.ball.holder === man.pid) {
          const gap = Math.min(4, dist * 0.35);
          p.tx = man.x + dx / dist * gap; p.td = man.d + dd / dist * gap;
          // closing out: sprint, then chop the feet with a hand up
          p.spd = hyp(p.tx - p.x, p.td - p.d) > 5 ? SPRINT : RUN;
        } else {
          const db = hyp(man.x - bp.x, man.d - bp.d);
          const ballRim = hyp(bp.x - B.x, bp.d - B.d);
          let f = 0.16 + 0.24 * Math.min(1, db / 28) + (ballRim < 12 ? 0.14 : 0) - b.tight * 0.12;
          if (dist > 50) f = 6 / dist;
          let tx = man.x + dx * f, td = man.d + dd * f;
          const w = db > 18 ? 0.2 : 0.06;
          tx += (bp.x - tx) * w; td += (bp.d - td) * w;
          p.tx = tx; p.td = td; p.spd = RUN;
        }
      } else if (b.k === 'follow') {
        const o = this.P(b.pid);
        if (!o) { p.beh = { k: 'spot' }; continue; }
        p.tx = o.x + b.dx; p.td = o.d + b.dd; p.spd = Math.max(p.spd, RUN);
      } else if (b.k === 'mark') {
        const o = this.P(b.pid);
        if (!o) { p.beh = { k: 'spot' }; continue; }
        const B = this.basket(o.side);
        const dx = B.x - o.x, dd = B.d - o.d, dist = hyp(dx, dd) || 1;
        const g = Math.min(b.dist, dist * 0.5);
        p.tx = o.x + dx / dist * g; p.td = o.d + dd / dist * g; p.spd = SPRINT;
      }
    }
  }

  private physics(dt: number) {
    const bp = this.ballPos();
    for (const [pid, p] of this.players) {
      if (p.hang && p.hang > 0) p.hang -= dt;
      else if (p.jd > 0) { p.jt += dt; const u = p.jt / p.jd; if (u >= 1) { p.jd = 0; p.z = 0; } else p.z = p.jh * 4 * u * (1 - u); }
      const dx = p.tx - p.x, dd = p.td - p.d, dist = hyp(dx, dd);
      const vmax = p.spd * p.mul;
      const vdes = dist < 0.08 ? 0 : Math.min(vmax, Math.sqrt(2 * ACC * 0.8 * dist));
      const ux = dist ? dx / dist : 0, ud = dist ? dd / dist : 0;
      let wx = ux * vdes - p.vx, wd = ud * vdes - p.vd;
      const wl = hyp(wx, wd), amax = ACC * (p.spd >= SPRINT ? 1.15 : 1) * dt * (p.z > 0.3 && p.beh.k !== 'arrive' ? 0.25 : p.z > 0.3 ? 2.5 : 1);
      if (wl > amax) { wx *= amax / wl; wd *= amax / wl; }
      p.vx += wx; p.vd += wd;
      p.x += p.vx * dt; p.d += p.vd * dt;
      p.ph = (p.ph + hyp(p.vx, p.vd) * dt * (Math.PI * 2 / 8.5)) % (Math.PI * 2); // one stride cycle every ~8.5 ft
      if (Math.abs(p.vx) > 2) p.face = Math.sign(p.vx);
      else if (Math.abs(bp.x - p.x) > 1.5 && this.ball.holder !== pid) p.face = Math.sign(bp.x - p.x);
      if (p.pt > 0) { p.pt -= dt; if (p.pt <= 0) { p.pose = 'stand'; if (p.next && p.z < 0.2) { [p.pose, p.pt] = p.next; p.next = undefined; } } }
      if (this.ball.holder === pid && !this.ball.fly) {
        const v = hyp(p.vx, p.vd);
        p.dph = (p.dph ?? 0) + dt * Math.PI * (1.9 + v * 0.09);
        if (p.xover && p.xover > 0) p.xover -= dt;
        else {
          // crossovers: when he changes direction, and now and then to shake his man
          const turn = Math.abs(p.vx) > 3 && Math.sign(p.vx) !== Math.sign(p.lvx ?? p.vx);
          const dm = this.defOf(pid), close = dm ? hyp(dm.x - p.x, dm.d - p.d) < 6 : false;
          if (turn || (close && hash01(pid + Math.floor(this.v * 3)) < dt * 3 * (0.35 + 0.3 * this.starOf(pid)))) { p.xover = 0.28; p.hand = -(p.hand ?? 1); }
        }
        p.lvx = p.vx;
      } else p.xover = 0;
      if (p.leaving && dist < 1.2) this.players.delete(pid);
    }
    // nobody stands inside anybody else
    const ps = [...this.players.values()];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dd = b.d - a.d, dist = hyp(dx, dd);
      // teammates keep their spacing; opponents can get close but not inside each other
      const min = a.side === b.side ? (a.z > 0.5 || b.z > 0.5 ? 1.9 : 3.4) : 2.1;
      if (dist < min && dist > 0.001) {
        const push = (min - dist) * 0.5 * Math.min(1, dt * (a.side === b.side ? 5 : 12));
        a.x -= dx / dist * push; a.d -= dd / dist * push; b.x += dx / dist * push; b.d += dd / dist * push;
      }
    }
  }

  private ballStep(dt: number) {
    const b = this.ball;
    if (b.fly) {
      const f = b.fly;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      if (f.to && u < 0.85) { const r = this.P(f.to); if (r) { f.x1 = r.x; f.d1 = r.d; } }
      b.x = f.x0 + (f.x1 - f.x0) * u; b.d = f.d0 + (f.d1 - f.d0) * u;
      const lin = f.z0 + (f.z1 - f.z0) * u;
      if (f.bounce) b.z = u < 0.62 ? f.z0 * (1 - u / 0.62) : f.z1 * (u - 0.62) / 0.38;
      else b.z = lin + 4 * (Math.max(f.peak, f.z0, f.z1) - Math.max(f.z0, f.z1)) * u * (1 - u);
      if (f.peak >= 11 && !this.ff) { const pp = this.proj(b.x, b.d, b.z); this.trail.push({ x: pp.x, y: pp.y, t: 0 }); }
      if (u >= 1) { b.fly = null; f.done?.(); }
    } else if (b.holder) {
      const p = this.P(b.holder);
      if (!p) { b.holder = null; return; }
      b.x = p.x + p.face * 0.9; b.d = p.d + 0.5;
      const up = p.pose === 'shoot' || p.pose === 'jump' || p.pose === 'rest';
      b.z = up ? 7.5 + p.z : 0.6 + 2.8 * Math.abs(Math.sin(this.v * 7.5));
    } else if (b.z > 0) {
      b.z = Math.max(0, b.z - dt * 12);
    }
  }

  // ------------------------------------------------------------ reading the timeline
  /** side with the ball during window k */
  possSide(k: number): Side {
    const items = this.tl!.items;
    const sideOf = (e: PbpEv): Side | '' => (e.k === 'foul' ? (e.s ? other(e.s as Side) : '') : ['sub', 'timeout', 'period', 'end', 'inj', 'start'].includes(e.k) ? '' : (e.s as Side | ''));
    for (let j = k; j < items.length; j++) { const s = sideOf(items[j].e); if (s) return s; }
    for (let j = k - 1; j >= 0; j--) { const s = sideOf(items[j].e); if (s) return s; }
    return 'h';
  }
  /** how the team with the ball in window k got it */
  how(k: number): How {
    const items = this.tl!.items;
    let dead = false;
    for (let j = k - 1; j >= 0; j--) {
      const e = items[j].e;
      switch (e.k) {
        case 'sub': case 'inj': continue;
        case 'timeout': dead = true; continue;
        case 'foul': dead = true; continue;
        case 'make2': case 'make3': return { how: dead ? 'side' : 'inbound' };
        case 'ft': return { how: dead || !this.tl!.lastFt(j) ? 'side' : 'inbound' };
        case 'ftm': return { how: 'side' };
        case 'drb': return { how: dead ? 'side' : 'rebound', pid: this.pidOf(e, 'drb') };
        case 'orb': return { how: dead ? 'side' : 'orb', pid: this.pidOf(e, 'orb') };
        case 'tov': { const st = this.pidOf(e, 'stl'); return st && !dead ? { how: 'steal', pid: st } : { how: 'side' }; }
        case 'period': return { how: 'period' };
        case 'end': return { how: 'period' };
        default: return { how: 'side' };
      }
    }
    return { how: 'tip' };
  }

  // ------------------------------------------------------------ scene set-up after a jump
  private resetScene(k: number) {
    const items = this.tl!.items;
    let lu: { h: string[]; a: string[] } | null = null;
    for (let j = k - 1; j >= 0; j--) if (items[j].e.on) { lu = items[j].e.on!; break; }
    if (!lu && items[k].e.on) lu = items[k].e.on!;
    this.players.clear();
    this.ball = { x: 47, d: 25, z: 3, holder: null, fly: null };
    if (lu) { for (const pid of lu.h) this.addPlayer(pid, 'h', 47, 25); for (const pid of lu.a) this.addPlayer(pid, 'a', 47, 25); }
    this.match.clear();
    this.floaters = []; this.trail = []; this.rimFx = null; this.label = null; this.label2 = null; this.hl = null;
    this.marks = [];
    for (let j = Math.max(0, k - 12); j < k; j++) {
      const e = items[j].e;
      if (!isShot(e.k) || e.x === undefined) continue;
      const side = e.s as Side;
      this.marks.push({ x: side === 'h' ? LEN - (e.y ?? 12) : (e.y ?? 12), d: side === 'h' ? (e.x ?? 25) : WID - (e.x ?? 25), made: e.k.startsWith('make'), side, t: Math.max(0, items[k].a - items[j].b), three: e.k.endsWith('3') });
    }
    const prev = k > 0 ? items[k - 1].e : null;
    if (prev) this.setCaption(prev); else this.caption = null;
    this.setupFor(k);
    for (const p of this.players.values()) { p.x = p.tx; p.d = p.td; p.vx = 0; p.vd = 0; }
    const h = this.P(this.ball.holder);
    if (h) { this.ball.x = h.x; this.ball.d = h.d; }
  }

  private setupFor(k: number) {
    const it = this.tl!.items[k], e = it.e;
    const off = this.possSide(k), def = other(off);
    const B = this.basket(off), O = this.basket(def), s = this.dir(off);
    if (e.k === 'ft' || e.k === 'ftm') { const sh = this.pidOf(e, 'fta'); this.ftFormation(e.s as Side, sh); this.give(sh); return; }
    if (e.k === 'orb' || e.k === 'drb') {
      const shooting = e.k === 'orb' ? (e.s as Side) : other(e.s as Side);
      this.halfcourt(shooting);
      const Bs = this.basket(shooting);
      this.ball.holder = null; this.ball.x = Bs.x - this.dir(shooting) * 3; this.ball.d = 25; this.ball.z = 10;
      return;
    }
    const h = this.how(k);
    const o = this.ord(off), d = this.ord(def);
    const put = (p: PSprite | undefined, x: number, dd: number) => { if (p) { p.tx = x; p.td = dd; } };
    switch (isShot(e.k) || e.k === 'tov' || e.k === 'foul' ? h.how : 'side') {
      case 'inbound':
        o.forEach((p, i) => put(p, O.x + s * (8 + i * 7), 12 + ((i * 13) % 27)));
        d.forEach((p, i) => put(p, O.x + s * (16 + i * 7), 14 + ((i * 11) % 24)));
        put(o[o.length - 1], O.x - s * 7, 24);
        this.give(o[o.length - 1]?.pid);
        return;
      case 'rebound': {
        o.forEach((p, i) => put(p, O.x + s * (6 + i * 4), 12 + ((i * 13) % 27)));
        d.forEach((p, i) => put(p, O.x + s * (8 + i * 4), 15 + ((i * 11) % 22)));
        const r = this.P(h.pid); if (r) put(r, O.x + s * 4, 25);
        this.give(h.pid);
        return;
      }
      case 'orb': {
        this.halfcourt(off);
        const r = this.P(h.pid); if (r) put(r, B.x - s * 4, 23);
        this.give(h.pid);
        return;
      }
      case 'steal': {
        this.halfcourt(def);
        this.give(h.pid);
        return;
      }
      case 'tip':
        o.forEach((p, i) => put(p, 47 + s * (i === o.length - 1 ? 1.5 : 7 + (i % 2) * 4), i === o.length - 1 ? 25 : 14 + i * 6));
        d.forEach((p, i) => put(p, 47 - s * (i === d.length - 1 ? 1.5 : 7 + (i % 2) * 4), i === d.length - 1 ? 25 : 16 + i * 5));
        this.ball.x = 47; this.ball.d = 25; this.ball.z = 6;
        return;
      default:
        this.halfcourt(off);
        put(o[2] ?? o[0], 47 + s * 10, -2);
        this.give((o[2] ?? o[0])?.pid);
    }
  }

  /** half-court spots by position (point guard first); stretch fours space to the corner in later eras */
  homes() { return (this.o.season ?? 2000) >= 2008 ? ['top', 'lw', 'rw', 'rc', 'lb'] : ['top', 'lw', 'rw', 're', 'lb']; }
  /** off-ball players go back to balanced spots: both wings, a corner and a block, away from the ball */
  private respace(off: Side, keep: (string | null)[], spd = JOG, r?: () => number) {
    const hold = this.P(this.ball.holder) ?? this.P(keep[0]);
    const strong = hold ? (hold.d < 25 ? 'l' : 'r') : 'l', weak = strong === 'l' ? 'r' : 'l';
    const modern = (this.o.season ?? 2000) >= 2008;
    const set = ['top', 'lw', 'rw', weak + 'c', modern ? strong + 'c' : strong + 'b', modern ? weak + 'b' : weak + 'e', strong + 'b'];
    const pts = set.map(n => ({ n, ...this.spot(off, n, 2, r) }));
    const taken = new Set<string>();
    const fixed = keep.map(pid => this.P(pid)).filter((p): p is PSprite => !!p);
    for (const p of fixed) { let best = -1, bd = 1e9; pts.forEach((q, i) => { const d = hyp(q.x - p.x, q.d - p.d); if (!taken.has(q.n) && d < bd) { bd = d; best = i; } }); if (best >= 0) taken.add(pts[best].n); }
    const free = this.ord(off).filter(p => !fixed.includes(p));
    // bigs prefer the paint, everybody else the perimeter; then the closest pairs first
    const pairs: [number, PSprite, typeof pts[0]][] = [];
    for (const p of free) for (const q of pts) {
      if (taken.has(q.n)) continue;
      const big = this.posN(p.pid) >= 4.5, inside = q.n.endsWith('b') || q.n.endsWith('e');
      pairs.push([hyp(q.x - p.x, q.d - p.d) + (big === inside ? 0 : 25), p, q]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const done = new Set<string>();
    for (const [, p, q] of pairs) { if (done.has(p.pid) || taken.has(q.n)) continue; done.add(p.pid); taken.add(q.n); this.go(p, q.x, q.d, spd); }
  }

  /** the offence in its half-court spots, the defence on its men */
  private halfcourt(off: Side) {
    const o = this.ord(off), names = this.homes();
    o.forEach((p, i) => { const q = this.spot(off, names[i] ?? 'top'); p.tx = q.x; p.td = q.d; p.beh = { k: 'spot' }; });
    this.matchUp(off);
    const B = this.basket(off);
    for (const [op, dp] of this.match) {
      const a = this.P(op), d = this.P(dp);
      if (a && d) { d.tx = a.tx + (B.x - a.tx) * 0.25; d.td = a.td + (B.d - a.td) * 0.25; d.beh = { k: 'guard', man: op, tight: 0 }; }
    }
    this.give(o[0]?.pid);
  }

  ftFormation(side: Side, shooter: string | null, spd = WALK) {
    const B = this.basket(side), s = this.dir(side);
    const def = this.ord(other(side)), off = this.ord(side).filter(p => p.pid !== shooter);
    const lane = (rel: number, top: boolean) => ({ x: B.x - s * rel, d: top ? 16 : 34 });
    const spots: [PSprite | undefined, { x: number; d: number }][] = [
      [def[def.length - 1], lane(7, true)], [def[def.length - 2], lane(7, false)],
      [off[off.length - 1], lane(11, true)], [off[off.length - 2], lane(11, false)],
      [def[def.length - 3], lane(14, true)],
    ];
    const used = new Set<string>();
    for (const [p, q] of spots) if (p) { this.go(p, q.x, q.d, spd); used.add(p.pid); }
    let i = 0;
    for (const p of [...off, ...def]) if (!used.has(p.pid)) { this.go(p, B.x - s * (30 + (i % 2) * 4), 14 + (i * 7) % 24, spd); i++; }
    const sh = this.P(shooter);
    if (sh) this.go(sh, B.x - s * 15, 25, spd);
  }

  // ------------------------------------------------------------ staging: one window of the timeline
  private plan(k: number): Key[] {
    const items = this.tl!.items, it = items[k], e = it.e, L = it.b - it.a;
    const keys: Key[] = [];
    const add: Add = (at, fn) => keys.push({ at: Math.max(0, Math.min(L, at)), fn });
    const r = gen(k * 7919 + (e.t | 0) * 31 + 17);
    if (e.on && e.k === 'sub') {
      const on = e.on;
      add(0, () => this.setLineups(on.h, on.a, k === 0 || this.players.size === 0));
      if (k === 0) add(0, () => this.setupTip());
    }
    switch (e.k) {
      case 'make2': case 'make3': case 'miss2': case 'miss3': this.planShot(k, L, add, r); break;
      case 'tov': this.planTov(k, L, add, r); break;
      case 'foul': this.planFoul(k, L, add, r); break;
      case 'orb': case 'drb': this.planReb(k, L, add); break;
      case 'ft': case 'ftm': this.planFt(k, L, add, r); break;
      case 'hold': this.possession(k, L, 0.4, null, add, r); break; // ball handler walks it up and lets the clock die
      case 'timeout': add(0, () => { this.say('TIMEOUT', '#ffffff', false, 1.4); this.huddle(); }); break;
      case 'period': case 'end': add(0, () => {
        this.say(e.k === 'end' ? 'FINAL' : e.txt.toUpperCase(), '#ffd34d', true, 2);
        if (e.k === 'end') { const win: Side = e.hs > e.as ? 'h' : 'a'; for (const p of this.on(win)) { this.go(p, p.x + (r() - 0.5) * 6, p.d + (r() - 0.5) * 6, JOG); this.setPose(p, 'celebrate', 3); } this.cheer = 2; }
        else this.huddle();
      }); break;
      case 'inj': { const pid = this.pidOf(e, 'inj') ?? e.d?.[0]?.[0] ?? null; add(0, () => { const p = this.P(pid); if (p) this.go(p, p.side === 'h' ? 14 : 80, -3, WALK * 0.6); }); break; }
    }
    return keys.sort((a, b) => a.at - b.at);
  }

  private setupTip() {
    const o = this.ord('h'), d = this.ord('a');
    o.forEach((p, i) => { p.x = p.tx = 47 - (i === o.length - 1 ? 1.5 : 7 + (i % 2) * 4); p.d = p.td = i === o.length - 1 ? 25 : 14 + i * 6; });
    d.forEach((p, i) => { p.x = p.tx = 47 + (i === d.length - 1 ? 1.5 : 7 + (i % 2) * 4); p.d = p.td = i === d.length - 1 ? 25 : 16 + i * 5; });
    this.ball = { x: 47, d: 25, z: 6, holder: null, fly: null };
  }

  /** players walk to their bench (timeouts, between quarters) */
  private huddle() {
    for (const side of ['h', 'a'] as const) {
      const cx = side === 'h' ? 14 : 80;
      this.on(side).forEach((p, i) => { const a = (i / 5) * Math.PI * 2; this.go(p, cx + Math.cos(a) * 2.6, -1.5 + Math.sin(a) * 1.4, WALK); });
    }
    this.ball.holder = null; this.ball.fly = null; this.ball.x = 47; this.ball.d = -1; this.ball.z = 3;
  }

  /**
   * The possession leading to the event at the end of window k: the ball comes in, gets brought up,
   * moves around while the shot clock runs, then the final action starts at `finStart` and lasts until `end`.
   * Returns the time the final action starts and who should have the ball then.
   */
  private possession(k: number, end: number, finDur: number, needBall: string | null, add: Add, r: () => number, opts: { fb?: boolean; quick?: boolean; receiver?: string | null } = {}) {
    const items = this.tl!.items, e = items[k].e;
    const off = this.possSide(k), def = other(off);
    const B = this.basket(off), O = this.basket(def), s = this.dir(off);
    const h = this.how(k);
    const o = this.ord(off);
    const pg = o[0], big = o[o.length - 1];
    const call = (e as any).call as string | undefined;
    const fb = !!opts.fb;
    const slow = call === 'milk' || call === 'hold';
    // who gets the ball first
    let holder = this.ball.holder && this.P(this.ball.holder)?.side === off ? this.ball.holder : null;
    let first: string | null = null, pA = 0;
    let inb: PSprite | null = null;
    if (h.how === 'inbound') {
      inb = o.filter(p => p !== pg).sort((p, q) => Math.abs(p.x - O.x) - Math.abs(q.x - O.x))[0] ?? big;
      first = opts.receiver ?? (inb === pg ? o[1]?.pid : pg?.pid) ?? null; pA = 1.3;
    } else if (h.how === 'rebound') {
      holder = h.pid ?? holder;
      first = this.posN(holder) <= 2 || fb ? holder : (opts.receiver ?? pg?.pid ?? null); pA = first === holder ? 0.1 : 0.8;
    } else if (h.how === 'steal') {
      holder = h.pid ?? holder;
      first = fb || this.posN(holder) <= 2 ? holder : (pg?.pid ?? holder); pA = first === holder ? 0.1 : 0.6;
    } else if (h.how === 'orb') {
      holder = h.pid ?? holder; first = holder; pA = 0;
    } else if (h.how === 'tip') {
      first = opts.receiver ?? pg?.pid ?? null; pA = 1.4;
    } else {
      inb = o.find(p => p !== pg && this.posN(p.pid) >= 2 && this.posN(p.pid) <= 3.5) ?? o[1] ?? null;
      first = opts.receiver ?? (inb === pg ? o[1]?.pid : pg?.pid) ?? null; pA = 1.0;
    }
    // bring-up: the ball handler from his start to the top of the key
    const f0 = this.P(first) ?? this.P(holder);
    const startX = h.how === 'inbound' ? O.x + s * 10 : h.how === 'side' || h.how === 'period' ? 47 + s * 14 : f0 ? f0.x : 47;
    const topX = B.x - s * 26;
    const dist = Math.max(0, (topX - startX) * s);
    const bSpd = fb ? SPRINT * 0.95 : slow ? WALK + 2 : opts.quick ? RUN : RUN * 0.8;
    let pB = h.how === 'orb' ? 0 : fb ? 0 : dist / bSpd;
    const need = pA + pB + finDur;
    const sc = need > end ? Math.max(0.25, end / need) : 1;
    const tB = pA * sc, tC = tB + pB * sc, tD = Math.max(tC, end - finDur * sc);
    // --- phase A: the ball comes in
    add(0, () => {
      if (h.how !== 'orb' && h.how !== 'steal') this.matchUp(off);
      else if (!this.match.size) this.matchUp(off);
      const others = this.ord(off).filter(p => p.pid !== first && p !== inb && p.pid !== holder);
      if (h.how === 'inbound') {
        const I = inb;
        if (I) { this.go(I, O.x - s * 7, 25 + (r() - 0.5) * 8, RUN / sc); this.give(I.pid); }
        const f = this.P(first); if (f) this.go(f, O.x + s * 9, 25 + (r() < 0.5 ? -8 : 8), RUN / sc);
        this.retreat(def);
      } else if (h.how === 'side' || h.how === 'period') {
        const I = inb, sx = h.how === 'period' ? 47 : 47 + s * 12;
        if (I) { this.go(I, sx, -2, RUN / sc); this.give(I.pid); }
        const f = this.P(first); if (f) this.go(f, sx + s * 5, 9, RUN / sc);
        this.guardAll(off);
      } else if (h.how === 'tip') {
        const c1 = big, c2 = this.ord(def).at(-1);
        this.ball.holder = null; this.ball.fly = { x0: 47, d0: 25, z0: 6, x1: 47, d1: 25, z1: 12, peak: 15, t: 0, dur: 0.7 * sc };
        add(0.55 * sc, () => { this.jump(c1 ?? null, 3.4, 0.6 * sc); this.jump(c2 ?? null, 3.2, 0.6 * sc); });
        add(0.75 * sc, () => { const f = this.P(first); if (f) { this.ball.holder = big?.pid ?? null; this.pass(first); } });
        this.guardAll(off);
      } else {
        this.give(holder);
        if (fb) this.retreat(def); else if (h.how === 'orb') this.guardAll(off); else this.retreat(def);
        if (first && first !== holder) { const f = this.P(first); const hp = this.P(holder); if (f && hp) this.go(f, hp.x + s * 14, hp.d < 25 ? 8 : 42, RUN / sc); }
      }
      // everyone else runs to the front court
      const names = this.homes();
      others.forEach(p => { const q = this.spot(off, names[o.indexOf(p)] ?? 'lc', 3, r); this.go(p, q.x, q.d, (fb ? SPRINT : slow ? JOG : RUN) / sc); });
      if (fb) this.call(off, `${this.abbr(off)} on the break!`);
      else if (call === 'milk') this.call(off, `${this.abbr(off)} milk the clock`);
      else if (call === 'hold') this.call(off, `${this.abbr(off)} hold for the last shot`);
      else if (call === 'two4one') this.call(off, `${this.abbr(off)} push for a 2-for-1`);
      else if (call === 'quick') this.call(off, `${this.abbr(off)} need a quick score`);
      else if (call === 'three') this.call(off, `${this.abbr(off)} need a three`);
      else if (h.how !== 'orb') this.call(off, `${this.abbr(off)} ball`);
    });
    if (first && holder !== first && h.how !== 'tip') add(Math.max(0.15, tB - 0.35 * sc), () => { if (this.ball.holder !== first) this.pass(first); });
    // --- phase B: bring it up
    if (pB > 0) add(tB, () => {
      const f = this.P(this.ball.holder) ?? this.P(first);
      if (f) this.go(f, topX, 25 + (r() - 0.5) * 8, bSpd / sc);
      if (inb) { const q = this.spot(off, 're', 3, r); this.go(inb, q.x, q.d, RUN / sc); }
    });
    // --- phase C: ball movement while the shot clock runs
    let vh: string | null = first ?? holder;
    let t = tC;
    const left = () => tD - t;
    if (slow && left() > 2) {
      add(t + 0.2, () => {
        const f = this.P(vh); if (f) this.go(f, topX - s * 2, 25, WALK);
        const wide = ['lc', 'rc', 'lw', 'rw'];
        this.ord(off).filter(p => p.pid !== vh).forEach((p, i) => { const q = this.spot(off, wide[i] ?? 'lw'); this.go(p, q.x, q.d, JOG); });
      });
      t = tD;
    }
    while (left() > 2.1) {
      const dur = Math.min(left() - 0.2, 2.2 + r() * 1.2);
      // how teams of that era move the ball: post-ups and screens away in the 80s and 90s, swings and drives later
      const era = this.o.season ?? 2000;
      const [cSwing, cScreen, cProbe] = era < 1995 ? [0.33, 0.56, 0.68] : era < 2010 ? [0.4, 0.64, 0.8] : [0.46, 0.66, 0.9];
      const kind = r();
      const mates = this.ord(off).filter(p => p.pid !== vh);
      const at = t;
      if (kind < cSwing && mates.length) {
        // swing it to a wing, everybody shifts
        // the ball finds the stars more often
        const wings = mates.filter(p => this.posN(p.pid) <= 3.5);
        const star = mates.filter(p => this.starOf(p.pid) > 0).sort((a, b) => this.starOf(b.pid) - this.starOf(a.pid))[0];
        const w = (star && r() < 0.45 ? star : wings[Math.floor(r() * 3) % Math.max(1, wings.length)]) ?? mates[0];
        const to = w.pid;
        const vhPrev = vh;
        const side1 = r() < 0.5, side2 = r() < 0.5;
        add(at, () => { const q = this.spot(off, side1 ? 'lw' : 'rw', 3, r); this.go(w, q.x, q.d, JOG); });
        add(at + 0.6, () => this.pass(to));
        add(at + 1.1, () => { const pr = this.P(vhPrev); if (pr) { const q = this.spot(off, side2 ? 'ls' : 'rs', 3, r); this.go(pr, q.x, q.d, JOG); } });
        vh = to;
      } else if (kind < cScreen && mates.length >= 2) {
        // screen away: a big screens for a wing, they swap spots
        const scr = mates.slice().sort((p, q) => this.posN(q.pid) - this.posN(p.pid))[0];
        const cut = mates.find(p => p !== scr) ?? mates[0];
        add(at, () => { const dd = this.defOf(cut.pid); const tgt = dd ?? cut; this.go(scr, tgt.x + (r() - 0.5), tgt.d + (cut.d < 25 ? 2 : -2), JOG); });
        add(at + 0.75, () => this.setPose(scr, 'screen', 0.8));
        add(at + 0.9, () => { this.go(cut, scr.x - s * 3, scr.d + (cut.d < 25 ? 6 : -6), RUN); });
        add(at + 1.6, () => { const q = this.spot(off, cut.d < 25 ? 'le' : 're', 3, r); this.go(scr, q.x, q.d, JOG); });
      } else if (kind < cProbe) {
        // probe: drive into the lane and kick it back out
        const f = vh;
        add(at, () => { const p = this.P(f); if (p) this.go(p, B.x - s * 13, 25 + (r() - 0.5) * 10, RUN); });
        add(at + 1.2, () => { const p = this.P(f); if (p) this.go(p, B.x - s * 23, p.d < 25 ? 12 : 38, JOG); });
      } else if (mates.length) {
        // post touch
        const bg = mates.slice().sort((p, q) => this.posN(q.pid) - this.posN(p.pid))[0];
        const back = vh;
        add(at, () => { const q = this.spot(off, r() < 0.5 ? 'lb' : 'rb'); this.go(bg, q.x, q.d, JOG); });
        add(at + 0.7, () => this.pass(bg.pid));
        add(at + 1.7, () => this.pass(back));
      }
      { const vhHere = vh; add(at + dur - 0.5, () => this.respace(off, [this.ball.holder ?? vhHere], JOG, r)); }
      t += dur;
    }
    // late in the shot clock
    const items2 = this.tl!.items[k];
    const scAtEnd = items2.scb - (items2.g1 - items2.sc0);
    if (scAtEnd <= 4 && items2.g1 - items2.g0 > 10 && !fb) add(Math.max(tC, end - 3), () => this.call(off, 'Shot clock winding down…'));
    // the ball to the man who starts the final action
    if (needBall && needBall !== vh) add(Math.max(tC, tD - 0.5 * sc), () => this.pass(needBall));
    return { tD, sc, off, def, B, s };
  }

  // ------------------------------------------------------------ shots
  private planShot(k: number, L: number, add: Add, r: () => number) {
    const items = this.tl!.items, e = items[k].e;
    const off = e.s as Side, def = other(off), B = this.basket(off), s = this.dir(off);
    const actor = this.pidOf(e, 'fga');
    const blocker = this.pidOf(e, 'blk');
    let assist = this.pidOf(e, 'ast');
    const made = e.k.startsWith('make'), three = e.k.endsWith('3');
    const ex = e.x ?? 25, ey = e.y ?? 12;
    const S = { x: off === 'h' ? LEN - ey : ey, d: off === 'h' ? ex : WID - ex };
    const rim = hyp(S.x - B.x, S.d - B.d) < 7;
    const h = this.how(k);
    const gap = items[k].g1 - items[k].g0;
    const fb = !!(e as any).fb || ((h.how === 'steal' || h.how === 'rebound') && gap <= 6 && rim);
    const o = this.ord(off);
    const pg = o[0]?.pid ?? null;
    const big = (p: string | null) => this.posN(p) >= 3.75;
    const md = e.m && this.players.has(e.m) ? e.m : null;
    // misses have no assist: imagine who created it
    if (!assist && !made && r() < 0.5) assist = (actor === pg ? o[1]?.pid : pg) ?? null;
    let type: string;
    if (h.how === 'orb' && h.pid === actor && gap <= 3.5 && rim) type = 'putback';
    else if (fb) type = 'fb';
    else if (rim) type = big(actor) ? (assist && !big(assist) ? ((this.o.season ?? 2000) < 1995 ? (r() < 0.35 ? 'roll' : r() < 0.6 ? 'post' : 'cut') : r() < 0.75 ? 'roll' : 'cut') : r() < 0.6 ? 'post' : 'drive') : assist ? (r() < 0.55 ? 'cut' : 'drive') : (r() < 0.5 ? 'drive' : 'pnrDrive');
    else if (three) type = assist ? (!big(actor) && r() < 0.4 ? 'offscreen' : 'kick') : (r() < 0.6 ? 'pullup' : 'pnrPull');
    else type = big(actor) ? (assist ? 'pop' : 'post') : assist ? (r() < 0.6 ? 'offscreen' : 'kick') : (r() < 0.5 ? 'pnrPull' : 'pullup');
    // late in the shot clock there is no time for a set play
    const sc0 = items[k].scb - (items[k].g1 - items[k].sc0);
    if (sc0 <= 2.5 && type !== 'putback' && type !== 'fb' && gap > 8) type = rim ? 'drive' : 'pullup';
    // stars get the floor cleared for them
    const starA = actor ? this.starOf(actor) : 0;
    if (!assist && !fb && ['drive', 'pullup', 'pnrDrive', 'pnrPull'].includes(type) && gap > 7 && r() < (starA === 2 ? 0.7 : starA === 1 ? 0.45 : 0.1)) type = 'iso';
    // the shot itself, as the play-by-play describes it
    const sk = e.sk ?? (rim ? 'layup' : three ? 'three' : 'jumper');
    const motion = type === 'putback' ? (sk === 'dunk' ? 'dunk' : 'tip') : sk === 'dunk' ? 'dunk' : sk === 'layup' || sk === 'putback' ? 'layup' : sk === 'floater' ? 'floater' : sk === 'hook' ? 'hook' : sk === 'fadeaway' || sk === 'turnaround' ? 'fade' : sk === 'stepback' ? 'stepback' : 'jumper';
    const dist0 = hyp(S.x - B.x, S.d - B.d);
    const FL: Record<string, number> = { dunk: 0.14, tip: 0.35, layup: 0.45, floater: 0.7, hook: 0.62 };
    const fl = Math.min(L * 0.45, FL[motion] ?? 0.62 + dist0 * 0.017);
    const release = L - fl;
    const creator = ['roll', 'pop', 'kick', 'cut', 'offscreen'].includes(type) ? (assist ?? pg) : actor;
    const screener = o.filter(p => p.pid !== actor && p.pid !== creator).sort((p, q) => this.posN(q.pid) - this.posN(p.pid))[0]?.pid ?? null;
    const DUR: Record<string, number> = { iso: 3.4, putback: 0.35, fb: 0, roll: 2.9, pop: 2.7, pnrDrive: 2.6, pnrPull: 2.5, drive: 2.6, pullup: 1.9, post: 2.8, kick: 2.1, offscreen: 2.1, cut: 1.6 };
    let finDur = DUR[type] ?? 2;
    if (type === 'fb') {
      const hpid = h.pid && this.players.has(h.pid) ? h.pid : this.ball.holder;
      const hp = this.P(hpid);
      finDur = Math.max(1.2, (hp ? Math.abs(B.x - hp.x) : 50) / SPRINT + 0.5);
    }
    const needBall = type === 'putback' || type === 'fb' ? null : creator === actor && ['post', 'kick', 'offscreen', 'cut'].includes(type) ? null : creator;
    const P = this.possession(k, release, finDur, needBall, add, r, { fb: type === 'fb' });
    const c = P.sc, T = (x: number) => P.tD + x * c;
    if (actor && md && type !== 'roll' && type !== 'pop') add(0, () => this.assign(actor, md));
    const A = () => this.P(actor);
    const DA = () => this.P(md) ?? this.defOf(actor);
    const name = (p: string | null) => surname(this.o.names[p ?? ''] ?? '').toLowerCase().replace(/(^|[ -'])\w/g, ch => ch.toUpperCase());
    const cap = (txt: string) => add(P.tD, () => this.call(off, txt));
    if (type !== 'fb' && type !== 'putback' && type !== 'drive') add(P.tD, () => this.respace(off, [actor, creator, screener], JOG, r));
    // ---- the final action
    switch (type) {
      case 'roll': case 'pop': {
        cap(`Pick and ${type}: ${name(creator)} & ${name(actor)}`);
        add(T(0), () => { const hnd = this.P(creator), a = A(); if (hnd && a) this.go(a, hnd.x + s * 2, hnd.d + (hnd.d < 25 ? 2.5 : -2.5), RUN / c); });
        add(T(0.75), () => this.setPose(A(), 'screen', 0.6 * c));
        add(T(1.0), () => {
          const hnd = this.P(creator), dh = this.defOf(creator), a = A();
          if (hnd) this.go(hnd, B.x - s * 15, 25 + (hnd.d < 25 ? 5 : -5), RUN / c);
          if (dh && hnd) dh.beh = { k: 'follow', pid: hnd.pid, dx: -s * 2.6, dd: hnd.d < 25 ? -1 : 1 };
          const da = this.defOf(actor); if (da && a) this.go(da, a.x + s * 3, a.d, RUN / c);
        });
        add(T(1.4), () => {
          const a = A(); this.go(a, S.x, S.d, (type === 'roll' ? RUN : JOG) / c);
          const da = DA(), dh = this.defOf(creator);
          if (md && dh && md === dh.pid) { // switch on the screen
            this.assign(actor!, md); if (a) dh.beh = { k: 'mark', pid: a.pid, dist: 2 };
            this.sayAt(md, 'SWITCH', '#9fd3ff', 1.0);
          } else if (da && a) da.beh = { k: 'follow', pid: a.pid, dx: -s * 2.5, dd: 0.8 };
        });
        add(T(type === 'roll' ? 2.15 : 1.95), () => this.pass(actor, type === 'roll'));
        break;
      }
      case 'pnrDrive': case 'pnrPull': {
        cap(`${name(actor)} off the pick${screener ? ' from ' + name(screener) : ''}`);
        add(T(0), () => { const a = A(), x = this.P(screener); if (a && x) this.go(x, a.x + s * 2, a.d + (a.d < 25 ? 2.5 : -2.5), RUN / c); });
        add(T(0.7), () => this.setPose(this.P(screener), 'screen', 0.8 * c));
        add(T(0.9), () => {
          const a = A(); if (!a) return;
          this.go(a, S.x, S.d, (type === 'pnrDrive' ? SPRINT : RUN) / c);
          const da = DA(); if (da) da.beh = { k: 'follow', pid: a.pid, dx: -s * 2.4, dd: a.d < 25 ? -1 : 1 };
          const dx = this.defOf(screener); if (dx) this.go(dx, B.x - s * 9, 25, RUN / c);
        });
        if (type === 'pnrDrive') add(T(1.9), () => this.helpSide(off, actor, blocker));
        break;
      }
      case 'drive': {
        cap(`${name(actor)} attacks the basket`);
        this.clearOut(add, T(0), off, actor, r);
        add(T(0.2), () => { const a = A(); if (a) this.go(a, a.x + s * 1.2, a.d + 1.5, WALK); });
        add(T(0.6), () => { const a = A(); if (a) this.go(a, a.x - s * 0.8, a.d - 3, JOG / c); });
        add(T(1.1), () => {
          const a = A(); if (!a) return;
          this.go(a, S.x, S.d, SPRINT / c);
          const da = DA(); if (da) da.beh = { k: 'follow', pid: a.pid, dx: -s * 2, dd: a.d < 25 ? -1.2 : 1.2 };
        });
        add(T(1.8), () => this.helpSide(off, actor, blocker));
        break;
      }
      case 'iso': {
        const dm = md ?? this.defOf(actor)?.pid ?? null;
        const ha = actor ? this.looksOf(actor).ht : 79, hd = dm ? this.looksOf(dm).ht : 79;
        cap(`ISO: ${name(actor)}${dm ? ' vs ' + name(dm) : ''}${Math.abs(ha - hd) >= 5 ? ' – mismatch!' : ''}`);
        this.clearOut(add, T(0), off, actor, r);
        // set up 22+ feet out on the side of the shot, then work his man
        const dS = hyp(S.x - B.x, S.d - B.d);
        let ux = (S.x - B.x) / (dS || 1), ud = (S.d - B.d) / (dS || 1);
        if (dS < 4) { ux = -s; ud = (S.d - 25) / 12; const l = hyp(ux, ud); ux /= l; ud /= l; }
        const R0 = Math.max(21, dS + 3), ix = B.x + ux * R0, id = Math.max(4, Math.min(46, B.d + ud * R0));
        add(T(0), () => { this.go(A(), ix, id, JOG / c); const da = DA(); if (da && actor) da.beh = { k: 'guard', man: actor, tight: 1.5 }; });
        const xo = () => { const a = A(); if (a) { a.xover = 0.28; a.hand = -(a.hand ?? 1); } };
        add(T(0.95), () => this.go(A(), ix - ux * 1.4, id - ud * 1.4, WALK * 1.4)); // jab step
        add(T(1.25), () => { this.go(A(), ix, id, WALK); xo(); });
        add(T(1.7), () => { this.go(A(), ix, id + (id < 25 ? 2 : -2), WALK); xo(); });
        add(T(2.15), () => { this.go(A(), ix, id, WALK); xo(); }); // hesitation
        add(T(2.55), () => {
          const a = A(); if (!a) return;
          this.go(a, S.x, S.d, rim ? SPRINT : RUN);
          const da = DA(); if (da) da.beh = { k: 'follow', pid: a.pid, dx: -s * 2, dd: a.d < 25 ? -1 : 1 };
        });
        if (rim) add(T(3.0), () => this.helpSide(off, actor, blocker));
        break;
      }
      case 'pullup': {
        cap(three ? `${name(actor)} pulls up from deep` : `${name(actor)} creates his own shot`);
        add(T(0), () => { const a = A(); if (a) this.go(a, S.x - s * 3, S.d + (S.d < 25 ? 2 : -2), JOG / c); });
        add(T(0.7), () => { const a = A(); if (a) this.go(a, S.x - s * 5.5, S.d, RUN / c); });
        add(T(1.25), () => { const a = A(); if (a) this.go(a, S.x, S.d, RUN / c); });
        break;
      }
      case 'post': {
        cap(`${name(actor)} posts up`);
        const blk = S.d < 25 ? 'lb' : 'rb';
        add(T(0), () => { const q = this.spot(off, blk); this.go(A(), q.x, q.d, RUN / c); const da = DA(); if (da && actor) da.beh = { k: 'guard', man: actor, tight: 1 }; });
        add(T(0.9), () => this.pass(actor));
        add(T(1.3), () => { const a = A(); if (a) { this.go(a, a.x + s * 2.5, a.d, WALK * 0.7); a.face = -s; } });
        add(T(2.15), () => this.go(A(), S.x, S.d, RUN / c));
        break;
      }
      case 'kick': {
        cap(`${name(creator)} drives and kicks to ${name(actor)}`);
        add(T(0), () => this.go(A(), S.x, S.d, JOG / c));
        add(T(0.25), () => { const hnd = this.P(creator); if (hnd) this.go(hnd, B.x - s * 8, 25 + (r() - 0.5) * 8, SPRINT / c); });
        add(T(0.6), () => { const da = DA(), a = A(); if (da && a) this.go(da, (a.x + B.x) / 2, (a.d + 25) / 2, RUN / c); });
        add(T(1.3), () => this.pass(actor));
        add(T(1.35), () => { const da = DA(); if (da && actor) da.beh = { k: 'mark', pid: actor, dist: 3 }; });
        break;
      }
      case 'offscreen': {
        cap(`${name(actor)} comes off a screen`);
        add(T(0), () => { this.go(A(), B.x - s * 4, S.d < 25 ? 12 : 38, RUN / c); const x = this.P(screener); if (x) this.go(x, B.x - s * 10, S.d < 25 ? 16 : 34, JOG / c); });
        add(T(0.9), () => { const a = A(); if (!a) return; this.go(a, S.x, S.d, SPRINT / c); const da = DA(); if (da) da.beh = { k: 'follow', pid: a.pid, dx: -s * 1.2, dd: S.d < 25 ? 2.5 : -2.5 }; });
        add(T(1.45), () => this.pass(actor));
        break;
      }
      case 'cut': {
        cap(`Backdoor cut: ${name(actor)}`);
        add(T(0), () => { const a = A(); if (a) { const da = DA(); if (da && actor) da.beh = { k: 'guard', man: actor, tight: 1.5 }; } });
        add(T(0.25), () => { const a = A(); if (a) this.go(a, a.x - s * 3, a.d + (a.d < 25 ? 2 : -2), JOG / c); });
        add(T(0.6), () => { const a = A(); if (!a) return; this.go(a, S.x, S.d, SPRINT / c); const da = DA(); if (da) da.beh = { k: 'follow', pid: a.pid, dx: -s * 2, dd: 1 }; });
        add(T(1.05), () => this.pass(actor, true));
        break;
      }
      case 'fb': {
        const hpid = this.ball.holder && this.P(this.ball.holder)?.side === off ? this.ball.holder : (h.pid ?? pg);
        add(T(0), () => {
          const hp = this.P(this.ball.holder) ?? this.P(hpid), a = A();
          if (hp && a && hp !== a) {
            this.go(hp, B.x - s * 20, 25 + (r() - 0.5) * 6, SPRINT);
            this.go(a, B.x - s * 15, a.d < 25 ? 9 : 41, SPRINT * 1.05);
          } else if (a) this.go(a, S.x, S.d, SPRINT);
        });
        add(Math.max(T(0), release - 1.0), () => { const a = A(); if (a) this.go(a, S.x, S.d, SPRINT); });
        add(Math.max(T(0), release - 0.85), () => { if (this.ball.holder !== actor) this.pass(actor); });
        break;
      }
      case 'putback':
        add(0, () => { const a = A(); if (a) this.go(a, S.x, S.d, RUN); this.call(off, `${name(actor)} goes right back up`); });
        break;
    }
    this.shotKeys(add, k, L, release, fl, actor, md, blocker, made, three, rim, S, off, def, B, s, r, type, motion);
  }

  /** weak-side help: the nearest big rotates to the rim (or the blocker) */
  private helpSide(off: Side, actor: string | null, blocker: string | null) {
    const B = this.basket(off);
    const da = this.defOf(actor);
    const help = this.P(blocker) ?? this.ord(other(off)).filter(p => p !== da).sort((p, q) => hyp(p.x - B.x, p.d - B.d) - hyp(q.x - B.x, q.d - B.d))[0];
    if (help && actor) help.beh = { k: 'mark', pid: actor, dist: 1.6 };
    if (help) this.label2 = { pid: help.pid, t: 1.4 };
    // the rotation behind him: the farthest defender drops to the man the helper left
    if (help && help !== da) {
      const left = [...this.match].find(([, d]) => d === help.pid)?.[0];
      const bp = this.ballPos();
      const rot = this.ord(other(off)).filter(p => p !== help && p !== da).sort((p, q) => hyp(q.x - bp.x, q.d - bp.d) - hyp(p.x - bp.x, p.d - bp.d))[0];
      if (left && rot) { const lm = this.P(left); if (lm) { rot.beh = { k: 'spot' }; this.go(rot, lm.x + (B.x - lm.x) * 0.3, lm.d + (B.d - lm.d) * 0.3, SPRINT); } }
    }
  }
  /** isolation: teammates clear to the weak side */
  private clearOut(add: Add, at: number, off: Side, actor: string | null, r: () => number) {
    add(at, () => {
      const a = this.P(actor); if (!a) return;
      const weak = a.d < 25 ? ['rc', 'rw', 'lc', 'rs'] : ['lc', 'lw', 'rc', 'ls'];
      this.ord(off).filter(p => p.pid !== actor).forEach((p, i) => { const q = this.spot(off, weak[i % 4], 3, r); this.go(p, q.x, q.d, JOG); });
    });
  }

  private shotKeys(add: Add, k: number, L: number, release: number, fl: number, actor: string | null, md: string | null, blocker: string | null, made: boolean, three: boolean, rim: boolean, S: { x: number; d: number }, off: Side, def: Side, B: { x: number; d: number }, s: number, r: () => number, type: string, motion = 'jumper') {
    const items = this.tl!.items, e = items[k].e;
    const lk = actor ? this.looksOf(actor) : null;
    const ath = lk?.ath ?? 0.5, star = actor ? this.starOf(actor) : 0;
    const A = () => this.P(actor);
    const DA = () => this.P(md) ?? this.defOf(actor);
    const next = items[k + 1]?.e;
    const n2 = items[k + 2]?.e;
    const andOne = next?.k === 'foul' && made && !!n2 && (n2.k === 'ft' || n2.k === 'ftm') && n2.s === off;
    // whatever the play, the shooter gets to his spot in time: the shot comes from where the play-by-play says
    const gatherAt = release - (rim ? 0.4 : 0.32);
    const abs = (t: number) => items[k].a + t;
    // a step-back starts a step closer to the basket and hops back to the spot
    const sb = motion === 'stepback';
    const dS = hyp(B.x - S.x, B.d - S.d) || 1;
    const P0 = sb ? { x: S.x + (B.x - S.x) / dS * 3.2, d: S.d + (B.d - S.d) / dS * 3.2 } : S;
    const due = sb ? Math.max(0.3, release - 0.8) : gatherAt;
    // far away (just got the ball back at the other end): head there right from the start
    add(0, () => { const a = A(); if (a && hyp(a.x - P0.x, a.d - P0.d) / RUN > due - 1.9) a.beh = { k: 'arrive', x: P0.x, d: P0.d, at: abs(due) }; });
    for (const lead of type === 'fb' ? [3.2, 1.9, 0.9] : [1.9, 0.9]) add(Math.max(0, due - lead), () => { const a = A(); if (a && hyp(a.x - P0.x, a.d - P0.d) > 0.5) a.beh = { k: 'arrive', x: P0.x, d: P0.d, at: abs(due) }; });
    // the move into the shot
    const showOff = (txt: string) => { if (star > 0 || r() < 0.35) this.sayAt(actor, txt, '#ffd34d', 1.0); };
    if (sb) add(Math.max(0, release - 0.78), () => {
      const a = A(); if (!a) return;
      a.beh = { k: 'arrive', x: S.x, d: S.d, at: abs(release - 0.4) }; this.jump(a, 0.4, 0.3, 'gather');
      showOff('STEP-BACK');
    });
    const up = motion === 'dunk' ? 0.5 : motion === 'layup' || motion === 'floater' ? 0.45 : motion === 'tip' ? 0.3 : motion === 'hook' ? 0.35 : 0.22;
    if (motion === 'jumper' || motion === 'stepback' || motion === 'fade') add(release - up - 0.13, () => {
      const a = A(); if (!a) return;
      if (this.ball.holder !== actor && !this.ball.fly) this.give(actor);
      a.beh = { k: 'spot' }; a.tx = S.x; a.td = S.d; a.spd = WALK; this.setPose(a, 'gather', 0.16);
    });
    add(release - up, () => {
      const a = A(); if (!a) return;
      if (this.ball.holder !== actor && !this.ball.fly) this.give(actor);
      this.label = { pid: a.pid, t: 1.6 }; this.hl = { pid: a.pid, t: 1.6 };
      switch (motion) {
        case 'dunk': {
          // take off a step or two out and glide to the rim
          a.beh = { k: 'arrive', x: B.x - s * 0.7, d: B.d + Math.max(-0.6, Math.min(0.6, (a.d - B.d) * 0.15)), at: abs(release) };
          this.jump(a, 3.1 + ath * 1.1, 0.95, 'dunk');
          break;
        }
        case 'layup': a.beh = { k: 'arrive', x: B.x - s * 1.3, d: B.d + Math.max(-1.2, Math.min(1.2, (a.d - B.d) * 0.3)), at: abs(release) }; this.jump(a, 2.6 + ath * 0.6, 0.8, 'layup'); break;
        case 'floater': this.go(a, a.x + s * 1.5, a.d, JOG); this.jump(a, 1.9, 0.7, 'layup'); break;
        case 'hook': this.go(a, a.x + s * 0.6, a.d + (B.d - a.d) * 0.1, WALK); this.jump(a, 1.3, 0.6, 'hook'); break;
        case 'tip': a.beh = { k: 'arrive', x: B.x - s * 1.1, d: B.d, at: abs(release) }; this.jump(a, 3.0, 0.6, 'reb'); break;
        case 'fade': this.go(a, a.x - s * 2.2, a.d, JOG); this.jump(a, 1.9, 0.68, 'fade'); break;
        default: this.go(a, S.x, S.d, WALK); this.jump(a, three ? 1.9 : 2.1, 0.62, 'shoot');
      }
      const da = DA();
      if (da && !blocker) { da.beh = { k: 'mark', pid: a.pid, dist: rim ? 1.4 : 2.6 }; this.label2 = { pid: da.pid, t: 1.4 }; }
    });
    // the defender contests: a jump with a hand up when he is close, a raised hand otherwise
    add(release - 0.12, () => {
      const da = DA(), a = A(); if (!da || !a || blocker) return;
      const dd = hyp(da.x - a.x, da.d - a.d);
      if (dd < 5) this.jump(da, rim ? 2.8 : 1.8, 0.6, rim ? 'block' : 'contest');
      else if (dd < 10) this.setPose(da, 'contest', 0.7);
    });
    // the shot
    add(release, () => {
      const a = A();
      if (a && this.dbg) this.dbg({ L, release, type, three, rim, dist: hyp(a.x - S.x, a.d - S.d), fromRim: hyp(a.x - B.x, a.d - B.d), want: hyp(S.x - B.x, S.d - B.d) });
      if (blocker) {
        const bp = this.P(blocker);
        if (bp && a) { this.go(bp, a.x + s * 1.2, a.d, SPRINT); this.jump(bp, 3.6, 0.6, 'block'); }
        this.flyBall((a?.x ?? S.x) + s * 1.2, a?.d ?? S.d, 11, 12, 0.18, () => {
          this.sayAt(blocker, 'BLOCKED!', '#ff6b6b', 1.3);
          this.flyBall((a?.x ?? S.x) - s * (3 + r() * 6), (a?.d ?? S.d) + (r() - 0.5) * 12, 0.5, 6, 0.55);
        });
        this.label2 = { pid: blocker, t: 1.5 };
      } else {
        this.trail = [];
        if (motion === 'dunk' && a) {
          // the slam: from above the rim straight through it
          this.ball.holder = null;
          this.ball.fly = { x0: B.x - s * 0.5, d0: B.d, z0: 11.4, x1: made ? B.x : B.x + s * 0.7, d1: B.d, z1: made ? 9.6 : 10.3, peak: 11.4, t: 0, dur: fl };
          if (made) { a.hang = (ath > 0.45 || star > 0) && r() < 0.7 ? 0.42 : 0.12; this.setPose(a, 'hang', 0.6); if (star > 0 || r() < 0.4) a.next = ['celebrate', 0.9]; }
        } else {
          // makes drop through the middle; misses catch the front or the back of the rim
          const front = r() < 0.6 ? 1 : -1;
          const tx = made ? B.x : B.x - s * 0.62 * front, td = made ? B.d : B.d + (r() - 0.5) * 0.9;
          const peak = rim ? 11.6 : motion === 'floater' ? 14.5 : motion === 'hook' ? 13.5 : 12.5 + hyp(S.x - B.x, S.d - B.d) * 0.22;
          this.flyBall(tx, td, made ? 10.1 : 10.4, peak, fl);
          if (a && (motion === 'jumper' || motion === 'stepback')) this.setPose(a, 'follow', 0.55);
        }
      }
    });
    // everyone reacts to the shot: bigs crash, guards get back, the defence boxes out
    add(release + 0.15, () => {
      for (const p of this.on(off)) {
        if (p.pid === actor) continue;
        if (this.posN(p.pid) >= 3.75) this.go(p, B.x - s * (4 + r() * 2), 25 + (r() - 0.5) * 12, RUN);
        else if (this.posN(p.pid) <= 2) this.go(p, B.x - s * 30, 25 + (r() - 0.5) * 16, JOG);
      }
      for (const [o, d] of this.match) { const dp = this.P(d), op = this.P(o); if (dp && op && dp.side === def && hyp(op.x - B.x, op.d - B.d) < 24) dp.beh = { k: 'box', man: o }; }
    });
    // result at the rim
    add(L, () => {
      const mark = () => { if (!this.ff) { this.marks.push({ x: S.x, d: S.d, made, side: off, t: 0, three }); if (this.marks.length > 10) this.marks.shift(); } };
      const atRim = { x: B.x, d: B.d, z: 17 };
      mark();
      if (made) {
        this.rimFx = { side: off, made, t: 0 };
        this.ball.fly = { x0: B.x, d0: B.d, z0: 10, x1: B.x - s * 0.5, d1: B.d, z1: 0.3, peak: 10, t: 0, dur: 0.35 };
        this.ball.holder = null;
        this.net[off] = 0.4;
        this.cheer = off === 'h' ? 1.2 : 0.5;
        this.say(three ? '+3' : '+2', '#5dff8a', true, 1.3, atRim);
        if (motion === 'dunk') { this.shake = star > 0 || ath > 0.6 ? 0.6 : 0.35; this.cheer = 2; this.net[off] = 0.8; this.sayAt(actor, star > 0 ? 'SLAM!' : 'DUNK!', '#ffd34d', 1.3); }
        this.scored(actor, three ? 3 : 2, made);
        const lateClose = e.p >= 4 && e.c < 120 && Math.abs(e.hs - e.as) <= 5;
        if (three || lateClose || type === 'fb') { this.setPose(A(), 'celebrate', 1.4); if (lateClose) this.cheer = 2; }
        if (andOne) this.say('AND ONE!', '#ffd34d', false, 1.4, { x: S.x, d: S.d, z: 24 });
        // the scorers jog back on defence
        const back = other(off);
        for (const p of this.on(off)) if (p.pid !== actor || !andOne) this.go(p, this.basket(back).x + this.dir(back) * (10 + r() * 14), 12 + r() * 26, JOG);
      } else if (!blocker) {
        this.rimFx = { side: off, made, t: 0 };
        this.say('MISS', '#ff6b6b', true, 1.1, atRim);
        // the rebound comes off toward the man who gets it
        const reb = next && (next.k === 'orb' || next.k === 'drb') ? this.P(this.pidOf(next, next.k)) : null;
        let tx = B.x - s * (3 + r() * 6), td = B.d + (r() - 0.5) * 12;
        if (reb) { const dx = reb.x - B.x, dd = reb.d - B.d, dist = hyp(dx, dd) || 1; const g = Math.min(dist, 3 + r() * 7); tx = B.x + dx / dist * g; td = B.d + dd / dist * g; }
        this.ball.holder = null;
        const b = this.ball;
        this.ball.fly = { x0: b.x, d0: b.d, z0: Math.max(10, b.z), x1: tx, d1: td, z1: 7, peak: 13 + r() * 2, t: 0, dur: 0.7 };
        this.scored(actor, 0, false);
      }
    });
  }

  /** running points and hot streaks: stars and hot hands get noticed */
  private scored(pid: string | null, pts: number, made: boolean) {
    if (!pid || this.replaying) return;
    const n = made ? (this.streak.get(pid) ?? 0) + 1 : 0;
    this.streak.set(pid, n);
    const was = this.hot.get(pid);
    this.hot.set(pid, n >= 3);
    if (!made || this.ff) return;
    if (n >= 3 && !was) this.sayAt(pid, 'ON FIRE!', '#ff9a2e', 1.6);
    const tot = this.ptsNow(pid);
    if (this.starOf(pid) > 0 || tot >= 20) this.say(`${surname(this.o.names[pid] ?? '')} · ${tot} PTS`, this.starOf(pid) > 1 ? '#ffd34d' : '#ffffff', false, 1.6);
  }
  /** points so far (play-by-play up to the event on screen) */
  private ptsNow(pid: string) {
    let t = 0;
    const items = this.tl?.items ?? [];
    for (let i = 0; i <= Math.min(this.cur, items.length - 1); i++) for (const d of items[i].e.d ?? []) if (d[0] === pid && d[1] === 'pts') t += d[2];
    return t;
  }

  // ------------------------------------------------------------ rebounds
  private planReb(k: number, L: number, add: Add) {
    const e = this.tl!.items[k].e;
    const pid = this.pidOf(e, e.k);
    add(0, () => {
      const p = this.P(pid);
      const f = this.ball.fly;
      if (p) this.go(p, f ? f.x1 : this.ball.x, f ? f.d1 : this.ball.d, SPRINT);
      // nobody else chases it: the shooting team's guards are already back
    });
    add(Math.max(0, L - 0.45), () => { const p = this.P(pid); if (p) { this.jump(p, 3, 0.55, 'reb'); this.label = { pid: p.pid, t: 0.9 }; } });
    add(L, () => {
      this.give(pid);
      if (e.k === 'orb') this.sayAt(pid, 'OFF. BOARD', '#9fd3ff', 0.9);
      const side = e.s as Side;
      if (e.k === 'drb') for (const p of this.on(other(side))) if (p.beh.k === 'spot' && this.posN(p.pid) >= 3.75) this.go(p, 47, p.d, JOG);
    });
  }

  // ------------------------------------------------------------ turnovers
  private planTov(k: number, L: number, add: Add, r: () => number) {
    const e = this.tl!.items[k].e;
    const off = e.s as Side, B = this.basket(off), s = this.dir(off);
    const pid = this.pidOf(e, 'tov'), stl = this.pidOf(e, 'stl');
    const v = e.v ?? (stl ? 'pick' : 'bad');
    const md = e.m && this.players.has(e.m) ? e.m : null;
    const nm = (p: string | null | undefined) => (p ? surname(this.o.names[p] ?? '').toLowerCase().replace(/(^|[ -])\w/g, ch => ch.toUpperCase()) : '');
    const finDur = v === 'clock' ? 1.2 : v === 'pick' || v === 'bad' ? 1.3 : 1.6;
    const P = this.possession(k, L, finDur, pid, add, r, { fb: !!(e as any).fb });
    const T = (x: number) => P.tD + x * P.sc;
    const A = () => this.P(pid);
    const pressure = () => this.P(md) ?? this.defOf(pid);
    // who the pass was meant for: the man the thief was guarding, if he is out there
    const mates = this.ord(off).filter(p => p.pid !== pid);
    const stMan = stl ? [...this.match].find(([, d]) => d === stl)?.[0] : null;
    const tgt = mates.find(p => p.pid === stMan) ?? mates[Math.floor(r() * mates.length)];
    const why: Record<string, string> = {
      pick: `${nm(stl)} reads ${nm(pid)}'s pass${tgt ? ` to ${nm(tgt.pid)}` : ''} and jumps the lane`,
      strip: `${nm(stl)} reaches in and pokes it away from ${nm(pid)} on the drive`,
      bad: `${nm(pid)}'s pass${tgt ? ` for ${nm(tgt.pid)}` : ''} sails out of bounds${md ? ` – pressure from ${nm(md)}` : ''}`,
      travel: `${nm(pid)} shuffles his feet under pressure${md ? ` from ${nm(md)}` : ''} – travel`,
      oob: `${nm(pid)} drives into ${md ? nm(md) : 'traffic'} and loses it over the line`,
      clock: `${md ? `${nm(md)} and the defence` : 'The defence'} take away every option – no shot in time`,
    };
    this.notes.set(k, why[v] ?? '');
    if (v === 'strip' || v === 'travel' || v === 'oob') {
      add(T(0), () => {
        const a = A(); if (!a) return;
        const d0 = v === 'oob' ? (a.d < 25 ? 0.5 : WID - 0.5) : 25 + (r() - 0.5) * 10;
        this.go(a, B.x - s * (v === 'oob' ? 8 : 12), d0, RUN / P.sc);
        const da = pressure(); if (da) { da.beh = { k: 'follow', pid: a.pid, dx: s * 1.4, dd: 0.6 }; this.label2 = { pid: da.pid, t: 1.8 }; }
        this.label = { pid: a.pid, t: 1.8 };
      });
      if (v === 'strip') add(L - 0.25, () => { const st = this.P(stl); if (st) { this.setPose(st, 'block', 0.35); const a = A(); if (a) st.face = Math.sign(a.x - st.x) || st.face; } });
      if (v === 'travel') add(L - 0.5, () => { const a = A(); if (a) { this.go(a, a.x + s * 1.5, a.d, WALK); this.setPose(a, 'gather', 0.45); } });
    }
    if (v === 'pick' || v === 'bad') {
      add(T(0), () => { this.label = pid ? { pid, t: 2 } : null; const st = this.P(stl); if (st && tgt) { const a = A(); if (a) this.go(st, (a.x + tgt.x) / 2 + s * 2.5, (a.d + tgt.d) / 2, JOG); this.label2 = { pid: st.pid, t: 2 }; } });
      add(L - 0.5, () => {
        const a = A(), st = this.P(stl);
        if (!a || !tgt) return;
        this.setPose(a, 'pass', 0.3);
        if (v === 'pick' && st) { const ix = a.x + (tgt.x - a.x) * 0.55, id = a.d + (tgt.d - a.d) * 0.55; this.go(st, ix, id, SPRINT * 1.2); this.flyBall(ix, id, 4.2, 4.8, 0.45); }
        else { const outD = tgt.d < 25 ? -5 : WID + 5; this.flyBall(tgt.x - s * 5, outD, 3, 9, 0.55); this.jump(tgt, 1.8, 0.5, 'reb'); }
      });
    }
    add(L, () => {
      const st = this.P(stl);
      if (v === 'strip' && st) {
        // the ball pops loose and he scoops it up
        const a = A(); const bx = (a?.x ?? st.x) - s * 2, bd = (a?.d ?? st.d) + (r() - 0.5) * 3;
        this.flyBall(bx, bd, 0.6, 3, 0.35, () => { this.give(stl); });
        this.go(st, bx, bd, SPRINT); this.sayAt(stl, 'STRIPPED!', '#ffd34d', 1.3);
      } else if (v === 'pick' && st) { this.give(stl); this.sayAt(stl, 'STEAL!', '#ffd34d', 1.3); }
      else if (v === 'travel') { this.sayAt(pid, 'TRAVELING', '#ffd34d', 1.2); this.ball.holder = null; this.ball.z = 3; }
      else if (v === 'clock') { this.say('SHOT CLOCK VIOLATION', '#ff6b6b', true, 1.5); this.ball.holder = null; }
      else { this.sayAt(pid, v === 'bad' ? 'BAD PASS' : 'OUT OF BOUNDS', '#ffd34d', 1.2); if (v === 'oob') this.flyBall(this.ball.x, this.ball.d < 25 ? -4 : WID + 4, 0.5, 3, 0.4); }
      // the other team takes over; their guards leak out on a steal
      if (st && (v === 'strip' || v === 'pick')) for (const p of this.on(other(off))) if (p !== st && this.posN(p.pid) <= 2.5) this.go(p, 47 - s * 8, p.d, RUN);
    });
  }

  // ------------------------------------------------------------ fouls
  private planFoul(k: number, L: number, add: Add, r: () => number) {
    const items = this.tl!.items, it = items[k], e = it.e;
    const fouler = this.pidOf(e, 'pf');
    const next = items[k + 1]?.e;
    const shooter = next && (next.k === 'ft' || next.k === 'ftm') ? this.pidOf(next, 'fta') : null;
    const prev = items[k - 1]?.e;
    const nm = (p: string | null | undefined) => (p ? surname(this.o.names[p] ?? '').toLowerCase().replace(/(^|[ -])\w/g, ch => ch.toUpperCase()) : '');
    const n = e.txt.match(/\((\d+)\)/)?.[1];
    if (fouler) this.notes.set(k, prev && isShot(prev.k) && prev.k.startsWith('make') && shooter ? `${nm(fouler)} fouls ${nm(shooter)} on the make – and one!${n ? ` (${n} fouls)` : ''}`
      : shooter ? `${nm(fouler)} fouls ${nm(shooter)}${prev && isShot(prev.k) ? ' on the shot' : ' on the drive'}${n ? ` – his ${n}${n === '1' ? 'st' : n === '2' ? 'nd' : n === '3' ? 'rd' : 'th'} foul` : ''}`
      : `Foul on ${nm(fouler)}${n ? ` (${n})` : ''}`);
    if (!it.live || it.g1 - it.g0 <= 0) {
      if (prev && isShot(prev.k) && prev.k.startsWith('make') && shooter) add(0.05, () => { const f = this.P(fouler); if (f) this.setPose(f, 'stance', 0.8); });
      else add(0.05, () => this.sayAt(fouler, 'FOUL', '#ffd34d', 1.0));
      return;
    }
    const off = this.possSide(k), def = other(off), B = this.basket(off), s = this.dir(off);
    if (e.txt.startsWith('Intentional')) {
      const P = this.possession(k, L, 0.9, shooter, add, r, { receiver: shooter, quick: true });
      add(0, () => this.call(def, `${this.abbr(def)} foul to stop the clock`));
      add(Math.max(0, P.tD - 0.6), () => { const f = this.P(fouler); if (f && shooter) f.beh = { k: 'mark', pid: shooter, dist: 0.6 }; });
      add(L, () => { this.sayAt(fouler, 'INTENTIONAL FOUL', '#ffd34d', 1.3); this.setPose(this.P(shooter), 'rest', 0.6); });
      return;
    }
    // shooting foul on a drive
    const P = this.possession(k, L, 1.8, shooter, add, r);
    const T = (x: number) => P.tD + x * P.sc;
    add(T(0), () => {
      const a = this.P(shooter); if (!a) return;
      this.go(a, B.x - s * 5, 25 + (r() - 0.5) * 8, SPRINT / P.sc);
      const f = this.P(fouler); if (f) f.beh = { k: 'mark', pid: a.pid, dist: 1.2 };
      this.label = { pid: a.pid, t: 1.6 }; if (f) this.label2 = { pid: f.pid, t: 1.6 };
    });
    add(L - 0.35, () => { const a = this.P(shooter); this.jump(a, 3, 0.55, 'shoot'); const f = this.P(fouler); this.jump(f, 2.4, 0.5); });
    add(L, () => {
      this.sayAt(fouler, 'FOUL', '#ffd34d', 1.1);
      this.flyBall(B.x - s * 2, 25 + (r() - 0.5) * 6, 0, 8, 0.5);
    });
  }

  // ------------------------------------------------------------ free throws
  private planFt(k: number, L: number, add: Add, r: () => number) {
    const items = this.tl!.items, e = items[k].e;
    const side = e.s as Side, B = this.basket(side), s = this.dir(side);
    const sh = this.pidOf(e, 'fta');
    const made = e.k === 'ft';
    const last = this.tl!.lastFt(k);
    const next = items[k + 1]?.e;
    const firstFt = !items[k - 1] || (items[k - 1].e.k !== 'ft' && items[k - 1].e.k !== 'ftm');
    add(0, () => { this.ftFormation(side, sh, firstFt ? JOG : WALK); if (this.ball.holder !== sh) { const p = this.P(sh); if (p) { this.ball.holder = null; this.ball.fly = { x0: this.ball.x, d0: this.ball.d, z0: this.ball.z, x1: B.x - s * 15, d1: 25, z1: 5, peak: 7, t: 0, dur: Math.min(0.8, L * 0.3), done: () => this.give(sh) }; } } this.label = sh ? { pid: sh, t: 1.6 } : null; this.hl = sh ? { pid: sh, t: L } : null; });
    add(L - 1.0, () => { const p = this.P(sh); if (p) { this.give(sh); this.setPose(p, 'gather', 0.2); } });
    add(L - 0.8, () => { const p = this.P(sh); if (p) { this.give(sh); this.jump(p, 0.6, 0.45, 'shoot'); } });
    add(L - 0.6, () => this.setPose(this.P(sh), 'follow', 0.6));
    add(L - 0.65, () => this.flyBall(B.x, B.d, 10.2, 14, 0.62));
    if (last && !made) add(L - 0.4, () => { for (const p of [...this.on('h'), ...this.on('a')]) if (p.pid !== sh && hyp(p.x - B.x, p.d - B.d) < 16) this.go(p, B.x - s * 4, 25 + (p.d - 25) * 0.4, RUN); });
    add(L, () => {
      this.rimFx = { side, made, t: 0 };
      if (made) {
        this.ball.fly = { x0: B.x, d0: B.d, z0: 10, x1: B.x, d1: B.d, z1: 0.3, peak: 10, t: 0, dur: 0.3 }; this.ball.holder = null;
        this.net[side] = 0.3; this.say('+1', '#5dff8a', false, 0.9, { x: B.x, d: B.d, z: 17 });
      } else {
        const reb = next && (next.k === 'orb' || next.k === 'drb') ? this.P(this.pidOf(next, next.k)) : null;
        const tx = reb ? B.x + (reb.x - B.x) * 0.6 : B.x - s * 6, td = reb ? B.d + (reb.d - B.d) * 0.6 : 25;
        this.ball.holder = null;
        this.ball.fly = { x0: B.x, d0: B.d, z0: 10, x1: tx, d1: td, z1: 7, peak: 12, t: 0, dur: 0.55 };
        this.say('MISS', '#ff6b6b', false, 0.9, { x: B.x, d: B.d, z: 17 });
      }
      if (last && made) { const back = other(side); for (const p of this.on(side)) this.go(p, this.basket(back).x + this.dir(back) * (12 + r() * 10), 12 + r() * 26, JOG); }
    });
  }

  // ------------------------------------------------------------ drawing
  private px(x: number, y: number, w: number, h: number, c: string) { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  private line(pts: [number, number][], c: string) {
    const ctx = this.ctx;
    ctx.fillStyle = c;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let j = 0; j <= n; j++) ctx.fillRect(Math.round(x0 + (x1 - x0) * j / n), Math.round(y0 + (y1 - y0) * j / n), 1, 1);
    }
  }
  private courtLine(f: (u: number) => [number, number], n = 40, c = '#f3efe6') {
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const [x, d] = f(i / n); const p = this.proj(x, d); pts.push([p.x, p.y]); }
    this.line(pts, c);
  }

  draw(time: number) {
    const ctx = this.ctx;
    const Zz = this.z;
    const kk = S * Zz * this.R;
    ctx.setTransform(kk, 0, 0, kk, -this.camX * kk, -this.camY * kk);
    if (this.arena) { this.drawArena(time); return; }
    // arena
    this.px(0, 0, VW, VH, '#141821');
    this.px(0, 0, VW, 17, '#0c0f15');
    // crowd
    for (const c of this.crowd) {
      const jump = this.cheer > 0 ? Math.max(0, Math.sin(time * 14 + c.ph)) * 2 * Math.min(1, this.cheer) : Math.sin(time * 1.5 + c.ph) > 0.97 ? 1 : 0;
      this.px(c.x, c.y - jump, 2, 2, c.c);
      this.px(c.x, c.y + 2 - jump, 2, 1, '#0d1016');
    }
    // ad board
    this.px(0, FAR_Y - 12, VW, 9, '#1b2433');
    const hc = teamColor(this.o.home.tid);
    for (let x = 0; x < VW; x += 40) this.px(x + 4, FAR_Y - 10, 30, 5, x % 80 ? hc[1] : hc[0]);
    this.px(0, FAR_Y - 3, VW, 3, '#0b0e14');
    // floor
    for (let y = FAR_Y; y <= NEAR_Y + 10; y++) {
      const t = (y - FAR_Y) / (NEAR_Y - FAR_Y);
      const l = FAR_L + t * (NEAR_L - FAR_L) - 18, r = FAR_R + t * (NEAR_R - FAR_R) + 18;
      const plank = Math.floor((y - FAR_Y) / 3) % 2;
      this.px(Math.max(0, l), y, Math.min(VW, r) - Math.max(0, l), 1, plank ? '#c98d4f' : '#c2864a');
      if ((y + Math.floor(t * 7)) % 5 === 0) for (let x = (y * 37) % 23; x < VW; x += 23) this.px(x, y, 4, 1, '#b57b43');
    }
    this.px(0, NEAR_Y + 11, VW, VH - NEAR_Y - 11, '#1a1f2b');
    // paint
    for (const side of ['h', 'a'] as const) {
      const B = this.basket(side), s = this.dir(side);
      for (let d = 17; d <= 33; d += 0.5) {
        const a = this.proj(B.x + s * 5.25, d), b2 = this.proj(B.x + s * 5.25 - s * 19, d);
        const x0 = Math.min(a.x, b2.x), x1 = Math.max(a.x, b2.x);
        this.px(x0, a.y, x1 - x0, 1, side === 'h' ? '#a8683a' : '#a8683a');
      }
    }
    // lines
    this.courtLine(u => [u * LEN, 0], 60); this.courtLine(u => [u * LEN, WID], 60);
    this.courtLine(u => [0, u * WID], 30); this.courtLine(u => [LEN, u * WID], 30);
    this.courtLine(u => [47, u * WID], 30);
    this.courtLine(u => [47 + 6 * Math.cos(u * 6.283), 25 + 6 * Math.sin(u * 6.283)], 50);
    for (const side of ['h', 'a'] as const) {
      const B = this.basket(side), s = this.dir(side);
      const base = B.x + s * 5.25;
      this.courtLine(u => [base - s * 19 * u, 17]); this.courtLine(u => [base - s * 19 * u, 33]);
      this.courtLine(u => [base - s * 19, 17 + 16 * u], 20);
      this.courtLine(u => [base - s * 19 - s * 6 * Math.cos(u * Math.PI - Math.PI / 2), 25 + 6 * Math.sin(u * Math.PI - Math.PI / 2)], 30);
      this.courtLine(u => [base - s * 14 * u, 3]); this.courtLine(u => [base - s * 14 * u, 47]);
      const a0 = Math.asin(22 / 23.75);
      this.courtLine(u => { const a = -a0 + 2 * a0 * u; return [B.x - s * 23.75 * Math.cos(a), 25 + 23.75 * Math.sin(a)]; }, 60);
    }
    // recent shots on the floor: dot = made, cross = missed (fade out)
    for (const m of this.marks) {
      const q = this.proj(m.x, m.d);
      ctx.globalAlpha = Math.max(0, 1 - m.t / 9) * 0.95;
      const c = m.side === 'h' ? '#ffffff' : teamColor(this.o.away.tid)[0];
      if (m.made) {
        this.px(q.x - 2, q.y - 1, 5, 3, '#0b0d12'); this.px(q.x - 1, q.y - 2, 3, 5, '#0b0d12');
        this.px(q.x - 1, q.y - 1, 3, 3, '#3ddc6e');
        this.px(q.x, q.y, 1, 1, c);
      } else {
        for (let i = -2; i <= 2; i++) { this.px(q.x + i, q.y + i, 1, 1, '#ff4d4d'); this.px(q.x + i, q.y - i, 1, 1, '#ff4d4d'); }
      }
      ctx.globalAlpha = 1;
    }
    // center logo dot
    const cc = this.proj(47, 25);
    this.px(cc.x - 3, cc.y - 1, 7, 3, hc[0]);
    // far basket stanchions first (behind players)
    this.drawBasket('a', time); this.drawBasket('h', time);
    // shadows + players sorted by depth
    const list = [...this.players.values()].sort((p, q) => p.d - q.d);
    const b = this.ball;
    const bs = this.proj(b.x, b.d);
    let ballDrawn = false;
    for (const p of list) {
      if (!ballDrawn && b.d < p.d) { this.drawBall(); ballDrawn = true; }
      this.drawPlayer(p, time);
    }
    // shot trail
    for (const q of this.trail) { ctx.globalAlpha = Math.max(0, 0.7 - q.t * 1.4); this.px(q.x, q.y - 1, 1, 1, '#ffd9a8'); }
    ctx.globalAlpha = 1;
    if (!ballDrawn) this.drawBall();
    void bs;
    // rim feedback
    if (this.rimFx) {
      const B = this.basket(this.rimFx.side), r = this.proj(B.x, B.d, 10);
      const u = this.rimFx.t / 0.7;
      if (this.rimFx.made) {
        ctx.globalAlpha = 1 - u;
        const rad = 3 + u * 9;
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; this.px(r.x + Math.cos(a) * rad, r.y + 2 + Math.sin(a) * rad * 0.6, 1, 1, '#5dff8a'); }
        ctx.globalAlpha = 1;
      } else if (Math.floor(this.rimFx.t * 12) % 2 === 0) this.px(r.x - 4, r.y - 1, 9, 2, '#ff4d4d');
    }
    // ball handler marker
    if (b.holder && !b.fly) {
      const p = this.players.get(b.holder);
      if (p) { const q = this.proj(p.x, p.d); const yy = q.y - 21 + Math.round(Math.sin(time * 6)); this.px(q.x - 1, yy, 3, 1, '#ffd34d'); this.px(q.x, yy + 1, 1, 1, '#ffd34d'); }
    }
    // labels
    if (this.label) {
      const p = this.players.get(this.label.pid);
      if (p) this.text(surname(this.o.names[p.pid] ?? ''), this.proj(p.x, p.d).x, this.proj(p.x, p.d).y - 24, '#ffffff', 7, true);
    }
    if (this.label2 && this.label2.pid !== this.label?.pid) {
      const p = this.players.get(this.label2.pid);
      if (p) this.text(surname(this.o.names[p.pid] ?? ''), this.proj(p.x, p.d).x, this.proj(p.x, p.d).y + 5, '#ffb0b0', 6, true);
    }
    // floaters: anchored ones rise above their spot, the rest in the middle of the court
    for (const f of this.floaters) {
      const u = f.t / f.dur;
      const alpha = 1 - Math.max(0, u - 0.7) / 0.3;
      if (f.at) { const q = this.proj(f.at.x, f.at.d, f.at.z); this.text(f.text, Math.max(this.camX + 18, Math.min(this.camX + VW / this.z - 18, q.x)), Math.max(this.camY + 24, q.y - u * 8), f.color, f.big ? 13 : 9, true, alpha); }
      else this.text(f.text, VW / 2, (f.big ? 80 : 92) - u * 10, f.color, f.big ? 16 : 8, true, alpha, true);
    }
    this.drawCaption();
    this.drawShotClock();
    this.drawReplay(time);
  }

  /** classic view: a small shot clock under the caption band */
  private drawShotClock() {
    if (!this.tl || !this.tl.items.length) return;
    const c = this.tl.clockAt(this.v);
    if (c.shot == null) return;
    const ctx = this.ctx;
    ctx.setTransform(this.R, 0, 0, this.R, 0, 0);
    const x = VW * S - 52, y = 17 * S + 6;
    ctx.fillStyle = c.shot <= 5 ? '#7a1010' : 'rgba(10,13,19,0.85)'; ctx.fillRect(x, y, 44, 26);
    ctx.fillStyle = c.shot <= 5 ? '#ffffff' : '#ff9a3c'; ctx.font = `18px ${this.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(c.shot - 1e-6)), x + 22, y + 14);
  }

  /** Top band: what is happening right now, in plain words. */
  private drawCaption(bottom = false) {
    const ctx = this.ctx;
    const c = this.caption;
    ctx.setTransform(this.R, 0, 0, this.R, 0, 0);
    const H = 17 * S;
    if (bottom) ctx.translate(0, VH * S - H);
    ctx.fillStyle = 'rgba(10,13,19,0.88)'; ctx.fillRect(0, 0, VW * S, H);
    if (!c) return;
    const fade = Math.min(1, c.t * 6);
    ctx.globalAlpha = fade;
    const side = c.side === 'h' ? this.o.home : c.side === 'a' ? this.o.away : null;
    let x = 10;
    if (side) {
      const col = side === this.o.home ? teamColor(this.o.home.tid) : teamColor(this.o.away.tid);
      ctx.fillStyle = col[0]; ctx.fillRect(x, 7, 44, H - 14);
      ctx.font = `600 14px "IBM Plex Sans", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff'; ctx.fillText(side.abbr, x + 22, H / 2 + 1);
      x += 54;
    }
    const isCall = c.kind === 'call';
    const good = c.kind === 'make2' || c.kind === 'make3' || c.kind === 'ft';
    const bad = c.kind === 'miss2' || c.kind === 'miss3' || c.kind === 'ftm' || c.kind === 'tov';
    if (good || bad) {
      ctx.fillStyle = good ? '#3ddc6e' : '#ff5c5c';
      ctx.font = `700 16px "IBM Plex Sans", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(good ? '✓' : '✗', x, H / 2 + 1); x += 18;
    }
    ctx.font = `${isCall ? 'italic 600' : '500'} 15px "IBM Plex Sans", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let t = c.text;
    const max = VW * S - x - 10;
    while (t.length > 4 && ctx.measureText(t).width > max) t = t.slice(0, -2);
    if (t !== c.text) t = t.slice(0, -1) + '…';
    ctx.fillStyle = isCall ? '#ffd88a' : good ? '#d9ffe4' : bad ? '#ffe0e0' : '#f4efe2';
    ctx.fillText(t, x, H / 2 + 1);
    ctx.globalAlpha = 1;
    ctx.setTransform(this.R, 0, 0, this.R, 0, 0);
  }

  private drawBasket(side: 'h' | 'a', time: number) {
    const B = this.basket(side), s = this.dir(side);
    const pole = this.proj(B.x + s * 9, 25), top = this.proj(B.x + s * 9, 25, 13.5);
    this.px(pole.x - 2, pole.y - 2, 5, 3, '#2b2f38');
    this.px(pole.x - 1, top.y, 2, pole.y - top.y, '#7d8594');
    const arm = this.proj(B.x + s * 1.2, 25, 12.5);
    this.line([[pole.x, top.y + 1], [arm.x, arm.y]], '#7d8594');
    // backboard
    const bb1 = this.proj(B.x + s * 1.2, 22, 13.5), bb2 = this.proj(B.x + s * 1.2, 28, 9.5);
    this.px(Math.min(bb1.x, bb2.x) - 1, bb1.y, 3, bb2.y - bb1.y + 1, '#e8eef6');
    this.px(Math.min(bb1.x, bb2.x) - 1, bb1.y, 3, 1, '#c33');
    // rim + net
    const r = this.proj(B.x, B.d, 10);
    this.px(r.x - 3, r.y, 7, 1, '#ff6a1a');
    const sway = this.net[side] > 0 ? Math.round(Math.sin(time * 40)) : 0;
    for (let i = 0; i < 4; i++) this.px(r.x - 3 + i * 2 + (i > 1 ? sway : 0), r.y + 1, 1, 4 - (i % 2), '#f2f2f2');
    this.px(r.x - 2 + sway, r.y + 4, 5, 1, '#f2f2f2');
  }

  private drawBall() {
    const b = this.ball;
    const g = this.proj(b.x, b.d), p = this.proj(b.x, b.d, b.z);
    this.px(g.x - 1, g.y, 3, 1, 'rgba(0,0,0,0.35)');
    this.px(p.x - 1, p.y - 2, 3, 3, '#e8762c');
    this.px(p.x, p.y - 2, 1, 3, '#7a3510');
    this.px(p.x - 1, p.y - 2, 1, 1, '#f5a25c');
  }

  private drawPlayer(p: PSprite, time: number) {
    const s = this.proj(p.x, p.d);
    const x = Math.round(s.x), y = Math.round(s.y);
    if (this.hl?.pid === p.pid) { this.px(x - 5, y - 1, 11, 1, '#ffd34d'); this.px(x - 4, y + 1, 9, 1, '#ffd34d'); this.px(x - 6, y, 1, 1, '#ffd34d'); this.px(x + 5, y, 1, 1, '#ffd34d'); }
    const [prim, sec] = teamColor(p.side === 'h' ? this.o.home.tid : this.o.away.tid);
    const jersey = p.side === 'h' ? '#f4f4f4' : prim, trim = p.side === 'h' ? prim : sec;
    const shorts = p.side === 'h' ? '#f4f4f4' : prim;
    const sp = Math.hypot(p.vx, p.vd);
    const moving = sp > 1.5;
    const step = moving ? Math.floor(time * (6 + sp * 0.5) + hash01(p.pid) * 4) % 2 : 0;
    const pose = this.poseOf(p);
    const jumpZ = Math.round(p.z * s.sc * 0.9);
    this.px(x - 3, y, 7, 1, 'rgba(0,0,0,0.35)');
    const Y = y - jumpZ;
    // legs + shoes
    this.px(x - 2, Y - 4 + (step ? 1 : 0), 2, 3 - (step ? 1 : 0), p.skin);
    this.px(x + 1, Y - 4 + (step ? 0 : 1), 2, 3 - (step ? 0 : 1), p.skin);
    this.px(x - 2, Y - 1, 2, 1, '#fafafa'); this.px(x + 1, Y - 1, 2, 1, '#fafafa');
    // shorts
    this.px(x - 3, Y - 7, 6, 3, shorts);
    this.px(x - 3, Y - 7, 6, 1, trim);
    // jersey
    this.px(x - 3, Y - 12, 6, 5, jersey);
    this.px(x - 3, Y - 12, 1, 5, trim); this.px(x + 2, Y - 12, 1, 5, trim);
    // arms
    if (pose === 'shoot' || pose === 'jump' || pose === 'celebrate') { this.px(x - 3, Y - 16, 1, 4, p.skin); this.px(x + 2, Y - 16, 1, 4, p.skin); }
    else if (pose === 'stance') { this.px(x - 5, Y - 10, 2, 1, p.skin); this.px(x + 3, Y - 10, 2, 1, p.skin); }
    else { this.px(x - 4, Y - 11, 1, 4, p.skin); this.px(x + 3, Y - 11, 1, 4, p.skin); }
    // head + hair
    this.px(x - 1, Y - 15, 3, 3, p.skin);
    if (p.hair) this.px(x - 1, Y - 16, 3, 1, p.hair);
  }

  // ------------------------------------------------------------ arena mode
  /** buffer pixels per view unit */
  private get K() { return this.z * S * this.Rw; }
  private layers() {
    if (this.courtL || typeof document === 'undefined') return;
    const [p, s2] = teamColor(this.o.home.tid);
    const name = (this.o.homeName ?? this.o.home.abbr).split(' ').slice(-1)[0];
    this.courtL = renderCourt(this.K, { primary: p, secondary: s2, abbr: this.o.home.abbr, name, season: this.o.season ?? 2000, font: this.font });
    this.standsL = renderStands(this.K, { primary: p, secondary: s2, font: this.font, label: name.toUpperCase() });
  }
  private drawLayer(L: { img: HTMLCanvasElement; x0: number; y0: number }, img = L.img) {
    const K = this.K;
    this.ctx.drawImage(img, Math.round((L.x0 - this.camX) * K), Math.round((L.y0 - this.camY) * K));
  }

  private drawArena(time: number) {
    const main = this.ctx;
    if (!this.buf && typeof document !== 'undefined') {
      this.buf = document.createElement('canvas');
      this.buf.width = VW * S * this.Rw; this.buf.height = VH * S * this.Rw;
    }
    if (!this.buf) return;
    const g = this.buf.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    this.ctx = g;
    try {
      this.layers();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0a0d14'; g.fillRect(0, 0, this.buf.width, this.buf.height);
      // stands (cheering fans bob in waves), courtside, floor
      if (this.standsL) {
        if (this.cheer > 0.15) {
          const L = this.standsL, K = this.K, cols = 24, w = Math.ceil(L.img.width / cols);
          for (let i = 0; i < cols; i++) {
            const up = Math.sin(time * 9 + i * 1.7) > -0.2;
            g.drawImage(up ? L.cheer : L.img, i * w, 0, w, L.img.height, Math.round((L.x0 - this.camX) * K) + i * w, Math.round((L.y0 - this.camY) * K) - (up ? 1 : 0), w, L.img.height);
          }
        } else this.drawLayer(this.standsL);
      }
      if (this.courtL) this.drawLayer(this.courtL);
      this.drawCourtside(time);
      // recent shots on the floor
      for (const m of this.marks) {
        const q = this.proj(m.x, m.d), P = this.toCanvas(q.x, q.y), r = Math.max(2, Math.round(this.K * 0.9));
        g.globalAlpha = Math.max(0, 1 - m.t / 9) * 0.9;
        if (m.made) { g.fillStyle = '#0b0d12'; g.fillRect(Math.round(P.X - r - 1), Math.round(P.Y - r * 0.6 - 1), 2 * r + 2, Math.round(r * 1.2) + 2); g.fillStyle = '#3ddc6e'; g.fillRect(Math.round(P.X - r), Math.round(P.Y - r * 0.6), 2 * r, Math.round(r * 1.2)); }
        else { g.fillStyle = '#e02828'; for (let i = -r; i <= r; i++) { g.fillRect(Math.round(P.X + i), Math.round(P.Y + i * 0.6), 1, 1); g.fillRect(Math.round(P.X + i), Math.round(P.Y - i * 0.6), 1, 1); } }
        g.globalAlpha = 1;
      }
      // shadows first, then everything by depth (the basket's back half, players, the ball, the front of the rim)
      for (const p of this.players.values()) this.drawShadow(p);
      this.drawBallShadow();
      const items: { d: number; f: () => void }[] = [];
      for (const side of ['a', 'h'] as const) {
        items.push({ d: 24.6, f: () => this.drawHoop(side, time, false) });
        items.push({ d: 25.4, f: () => this.drawHoop(side, time, true) });
      }
      for (const p of this.players.values()) items.push({ d: p.d, f: () => this.drawArenaPlayer(p, time) });
      const b = this.ball;
      if (!(b.holder && !b.fly)) items.push({ d: b.d + 0.01, f: () => this.drawBallArena() });
      items.sort((a, c) => a.d - c.d);
      for (const it of items) it.f();
      // shot trail and rim feedback
      for (const q of this.trail) { const P = this.toCanvas(q.x, q.y); g.globalAlpha = Math.max(0, 0.55 - q.t * 1.2); g.fillStyle = '#ffd9a8'; g.fillRect(Math.round(P.X), Math.round(P.Y), 2, 2); }
      g.globalAlpha = 1;
      if (this.rimFx && !this.rimFx.made && Math.floor(this.rimFx.t * 12) % 2 === 0) {
        const B = this.basket(this.rimFx.side), r = this.proj(B.x, B.d, 10), P = this.toCanvas(r.x, r.y);
        g.fillStyle = '#ff4d4d'; g.fillRect(Math.round(P.X - 3 * this.K * 0.6), Math.round(P.Y - 2), Math.round(6 * this.K * 0.6), 3);
      }
    } finally { this.ctx = main; }
    // scale the pixel buffer up, then crisp overlays on top
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.imageSmoothingEnabled = false;
    const shake = this.shake > 0 ? Math.round(Math.sin(time * 70) * this.shake * 6) : 0;
    main.drawImage(this.buf, 0, shake, this.canvas.width, this.canvas.height);
    const kk = S * this.z * this.R;
    main.setTransform(kk, 0, 0, kk, -this.camX * kk, -this.camY * kk);
    this.drawOverlays(time);
    this.drawScoreBug();
    this.drawCaption(true);
    this.drawReplay(time);
  }

  /** "REPLAY" bug and letterbox while a replay runs */
  private drawReplay(time: number) {
    if (!this.replaying) return;
    const g = this.ctx;
    g.setTransform(this.R, 0, 0, this.R, 0, 0);
    const W = VW * S, H = VH * S;
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, H);
    const x = 14, y = 50;
    g.fillStyle = 'rgba(10,13,19,0.88)'; g.fillRect(x, y, 112, 26);
    g.fillStyle = Math.floor(time * 2) % 2 ? '#ff3b3b' : '#7a1010'; g.beginPath(); g.arc(x + 14, y + 13, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = `16px ${this.font}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('REPLAY', x + 28, y + 14);
  }

  /** benches, scorer's table and the camera crews along the far sideline */
  private drawCourtside(time: number) {
    const g = this.ctx, K = this.K;
    const [hc1, hc2] = teamColor(this.o.home.tid);
    const T = (vx: number, vy: number) => this.toCanvas(vx, vy);
    // scorer's table
    const a = T(AXC - 22, AYF - 8.2), b = T(AXC + 22, AYF - 3.2);
    g.fillStyle = '#0d111c'; g.fillRect(Math.round(a.X), Math.round(a.Y), Math.round(b.X - a.X), Math.round(b.Y - a.Y));
    g.fillStyle = hc1; g.fillRect(Math.round(a.X), Math.round(a.Y), Math.round(b.X - a.X), Math.max(2, Math.round(0.8 * K)));
    g.fillStyle = '#1f3a8a'; g.fillRect(Math.round(a.X + 2 * K), Math.round(a.Y + 1.6 * K), Math.round(b.X - a.X - 4 * K), Math.round(2 * K));
    g.font = `${Math.round(1.7 * K)}px ${this.font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = hc2 === '#111111' ? '#ffffff' : hc2;
    g.fillText(this.o.home.abbr + ' · ' + this.o.away.abbr, Math.round((a.X + b.X) / 2), Math.round(a.Y + 2.7 * K));
    // benches
    this.drawBench('h', AXC - 96, time); this.drawBench('a', AXC + 36, time);
  }

  /** Substitutes sitting on the bench, in team colours. */
  private drawBench(side: 'h' | 'a', x0: number, time: number) {
    const g = this.ctx, K = this.K;
    const pids = Object.keys(this.o.side).filter(pid => this.o.side[pid] === side && !this.players.has(pid)).slice(0, 8);
    const n = Math.max(5, pids.length), gap = 7.4;
    const a = this.toCanvas(x0 - 3, AYF - 5.2), b = this.toCanvas(x0 + n * gap, AYF - 3.6);
    g.fillStyle = '#3a2a1c'; g.fillRect(Math.round(a.X), Math.round(a.Y), Math.round(b.X - a.X), Math.round(b.Y - a.Y));
    g.fillStyle = teamColor(side === 'h' ? this.o.home.tid : this.o.away.tid)[0]; g.fillRect(Math.round(a.X), Math.round(a.Y), Math.round(b.X - a.X), Math.max(1, Math.round(0.5 * K)));
    pids.forEach((pid, i) => {
      const { X, Y } = this.toCanvas(x0 + i * gap + 2, AYF - 4.2);
      const lk = this.looksOf(pid);
      const pose: AthPose = this.cheer > 0.6 && hash01(pid + 'c') < 0.6 ? 'celebrate' : 'sit';
      const H = this.heightPx(lk, -6) * 0.92;
      const key = `${pid}|${pose}|${H.toFixed(1)}`;
      let img = this.benchCache.get(key);
      if (!img && typeof document !== 'undefined') {
        const c = document.createElement('canvas'); c.width = Math.ceil(H * 1.5); c.height = Math.ceil(H * 1.5);
        drawAthlete(c.getContext('2d')!, c.width / 2, c.height - 4, { H, face: hash01(pid + 'f') < 0.5 ? 1 : -1, pose, ph: 0, amp: 0, air: false, kit: this.kitOf(side), body: lk, shorts: this.shortsLen(), font: this.font, num: false, view: 'front' });
        this.benchCache.set(key, img = c);
      }
      if (img) g.drawImage(img, Math.round(X - img.width / 2), Math.round(Y - img.height + 4));
    });
  }

  private looksOf(pid: string): Look {
    const l = this.o.looks?.[pid];
    if (l) return l;
    const r = hash01(pid);
    return { skin: SKIN[Math.floor(r * SKIN.length)], hair: 'short', hairColor: '#1b1410', facial: 'none', band: false, num: Math.floor(hash01(pid + 'n') * 45), ht: 79, build: 0.5 };
  }

  /** what the sprite looks like right now */
  private poseOf(p: PSprite): Pose {
    if (p.pt > 0) return p.pose;
    if (p.leaving) return 'stand';
    if (this.ball.holder === p.pid && !this.ball.fly) return 'dribble';
    if (p.beh.k === 'guard' && this.ball.holder === p.beh.man) { const m = this.players.get(p.beh.man); if (m) { const dm = Math.hypot(m.x - p.x, m.d - p.d), v = Math.hypot(p.vx, p.vd); if (dm < 9 && v > 6 && dm > 4) return 'contest'; if (dm < 7) return 'stance'; } }
    // off the ball, a defender near the action stays down in his stance
    if (p.beh.k === 'guard' && Math.hypot(p.vx, p.vd) < 4) { const h = this.P(this.ball.holder); if (h && h.side !== p.side && Math.hypot(h.x - p.x, h.d - p.d) < 16) return 'stance'; }
    if (p.beh.k === 'box') return 'boxout';
    if (p.beh.k === 'mark') return 'stance';
    return Math.hypot(p.vx, p.vd) > 1.5 ? 'run' : 'stand';
  }

  /** 2 = superstar, 1 = star, 0 = everybody else */
  starOf(pid: string) { const o = this.o.looks?.[pid]?.ovr ?? 0; return o >= 88 ? 2 : o >= 82 ? 1 : 0; }
  /** player height on the buffer (pixels) at depth d */
  private heightPx(lk: Look, d = 25) { return ((lk.ht || 79) / 12) * VZ * depthScale(d) * this.K * 1.08; }
  private kitOf(side: Side) {
    const [prim, sec] = teamColor(side === 'h' ? this.o.home.tid : this.o.away.tid);
    return side === 'h'
      ? { jersey: '#f4f4f2', trim: prim, trim2: sec, shorts: '#f4f4f2' }
      : { jersey: prim, trim: sec === '#111111' || sec === '#2a2a2a' ? '#f4f4f4' : sec, trim2: shade(prim, 0.55), shorts: prim };
  }
  private shortsLen() { const s = this.o.season ?? 2000; return s < 1985 ? 0.3 : s < 1992 ? 0.45 : s < 2000 ? 0.75 : 0.95; }
  /** view units → buffer pixels */
  private toCanvas(wx: number, wy: number) { const k = this.K; return { X: (wx - this.camX) * k, Y: (wy - this.camY) * k }; }

  private drawShadow(p: PSprite) {
    const g = this.ctx;
    const q = this.proj(p.x, p.d), { X, Y } = this.toCanvas(q.x, q.y);
    const H = this.heightPx(this.looksOf(p.pid), p.d);
    const sh = Math.max(0.45, 1 - p.z / 6);
    g.globalAlpha = 0.32 * sh; g.fillStyle = '#1a0d04';
    g.beginPath(); g.ellipse(Math.round(X), Math.round(Y), H * 0.2 * sh, H * 0.05 * sh, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    if (this.hl?.pid === p.pid) { g.strokeStyle = '#ffd34d'; g.lineWidth = 2; g.beginPath(); g.ellipse(Math.round(X), Math.round(Y), H * 0.26, H * 0.075, 0, 0, Math.PI * 2); g.stroke(); }
    const star = this.starOf(p.pid);
    if (star > 0 && this.hl?.pid !== p.pid) { g.globalAlpha = 0.18 + 0.1 * star; g.strokeStyle = '#ffd34d'; g.lineWidth = 1; g.beginPath(); g.ellipse(Math.round(X), Math.round(Y), H * 0.23, H * 0.062, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
  }
  private drawBallShadow() {
    const b = this.ball; if (b.holder && !b.fly) return;
    const g = this.ctx, q = this.proj(b.x, b.d), { X, Y } = this.toCanvas(q.x, q.y);
    const r = this.heightPx({ ht: 79 } as Look, b.d) * 0.06 * Math.max(0.5, 1 - b.z / 25);
    g.globalAlpha = 0.3; g.fillStyle = '#1a0d04'; g.beginPath(); g.ellipse(Math.round(X), Math.round(Y), r * 1.1, r * 0.4, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  }

  private drawArenaPlayer(p: PSprite, time: number) {
    const q = this.proj(p.x, p.d);
    const { X, Y } = this.toCanvas(q.x, q.y);
    const lk = this.looksOf(p.pid);
    const pose = this.poseOf(p);
    const sp = Math.hypot(p.vx, p.vd);
    const lift = p.z * VZ * depthScale(p.d) * this.K;
    const H = this.heightPx(lk, p.d);
    const g = this.ctx;
    const B = this.basket(p.side);
    const face = pose === 'shoot' || pose === 'layup' || pose === 'dunk' ? Math.sign(B.x - p.x) || 1 : p.face;
    const ap: AthPose = pose === 'run' && sp < 1.5 ? 'stand' : (pose as AthPose);
    // running toward or away from the camera shows the front or the back
    const along = Math.abs(p.vx) * AFX, across = Math.abs(p.vd) * AFY * 2.2;
    const view = pose === 'stance' || pose === 'shoot' || pose === 'layup' || pose === 'dunk' || pose === 'hook' ? 'side' : sp > 3 && across > along * 1.4 ? (p.vd < 0 ? 'back' : 'front') : 'side';
    const nm = (this.o.names[p.pid] ?? '').split(' ').slice(1).join(' ').toUpperCase();
    const hands = drawAthlete(g, Math.round(X), Math.round(Y - lift), { H, face, pose: ap, ph: ap === 'stand' || ap === 'stance' ? time * 2.6 + hash01(p.pid) * 6 : p.ph, amp: Math.min(1, sp / 15), air: lift > 2, kit: this.kitOf(p.side), body: lk, shorts: this.shortsLen(), font: this.font, view, name: nm, hand: p.hand ?? 1, t: p.pt > 0 ? p.pt : 0 });
    if (this.ball.holder === p.pid && !this.ball.fly) this.drawHeldBall(p, hands, Y, pose, H);
    // on fire: a flicker of flames around a hot shooter
    if (this.hot.get(p.pid) && !this.ff) {
      g.globalAlpha = 0.55;
      for (let i = 0; i < 6; i++) {
        const fx = X + Math.sin(time * 7 + i * 2.1) * H * 0.18, fy = Y - lift - H * (0.15 + 0.13 * i) + Math.sin(time * 13 + i) * 2;
        g.fillStyle = i % 2 ? '#ff9a2e' : '#ffd34d'; g.fillRect(Math.round(fx), Math.round(fy), 2, 3);
      }
      g.globalAlpha = 1;
    }
  }

  /** the ball in the hands: bounced on a dribble (switching hands on a crossover), above the head on a shot */
  private drawHeldBall(p: PSprite, h: Hands, floorY: number, pose: Pose, H: number) {
    const r = H * 0.062;
    let x = h.front.x, y = h.front.y + r * 0.6;
    if (pose === 'dribble' || pose === 'run' || pose === 'stand') {
      const hand = (p.hand ?? 1) > 0 ? h.front : h.back;
      const top = hand.y + r, bottom = floorY - r;
      const t = Math.abs(Math.sin(p.dph ?? this.v * 7.5));
      x = hand.x; y = bottom - (bottom - top) * t;
      if (p.xover && p.xover > 0) { const u = 1 - p.xover / 0.28; x = h.back.x + (h.front.x - h.back.x) * ((p.hand ?? 1) > 0 ? u : 1 - u); y = bottom - r * 0.4 - Math.sin(u * Math.PI) * r * 2; }
    } else if (pose === 'shoot' || pose === 'jump' || pose === 'celebrate' || pose === 'dunk' || pose === 'layup' || pose === 'hook') y = h.front.y - r * 0.9;
    else if (pose === 'gather') { x = (h.front.x + h.back.x) / 2; y = (h.front.y + h.back.y) / 2 - r * 0.2; }
    this.ballHD(x, y, r);
  }
  private ballHD(x: number, y: number, r: number) {
    const g = this.ctx;
    r = Math.max(2, r);
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = '#4a1c06'; g.beginPath(); g.arc(x, y, r + 1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8762c'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f7a35e'; g.fillRect(Math.round(x - r * 0.55), Math.round(y - r * 0.6), Math.max(1, Math.round(r * 0.5)), Math.max(1, Math.round(r * 0.45)));
    g.fillStyle = '#5a2208'; g.fillRect(Math.round(x - r), y, Math.round(2 * r), 1); g.fillRect(x, Math.round(y - r), 1, Math.round(2 * r));
  }
  /** loose or flying ball (arena) */
  private drawBallArena() {
    const b = this.ball;
    const p = this.proj(b.x, b.d, b.z);
    const P = this.toCanvas(p.x, p.y);
    const r = this.heightPx({ ht: 79 } as Look, b.d) * 0.062;
    this.ballHD(P.X, P.Y - r, r);
  }

  /** The hoop seen from the side: stanchion, backboard, rim (back half before the ball, front half and net after). */
  private drawHoop(side: 'h' | 'a', time: number, front: boolean) {
    const g = this.ctx, K = this.K;
    const B = this.basket(side), s = this.dir(side);
    const C = (x: number, d: number, z: number) => { const q = this.proj(x, d, z); return this.toCanvas(q.x, q.y); };
    const rr = 0.75; // rim radius, feet
    if (!front) {
      // stanchion: padded base out of bounds, pole, arm
      const bx = B.x + s * 8.6;
      const b0 = C(bx - s * 1.3, 25, 0), b1 = C(bx + s * 1.3, 25, 0), bt = C(bx, 25, 2.6);
      const [pc] = teamColor(this.o.home.tid);
      const bw = Math.round(Math.abs(b1.X - b0.X)), bxl = Math.round(Math.min(b0.X, b1.X));
      g.fillStyle = '#262b36'; g.fillRect(bxl, Math.round(bt.Y), bw, Math.round(b0.Y - bt.Y));
      g.fillStyle = pc; g.fillRect(bxl, Math.round(bt.Y), bw, Math.max(2, Math.round(0.45 * K)));
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(bxl, Math.round(b0.Y) - 2, bw, 2);
      const p0 = C(bx, 25, 3.2), p1 = C(bx, 25, 12.6);
      const pw = Math.max(3, Math.round(0.35 * K));
      g.fillStyle = '#4d5462'; g.fillRect(Math.round(p0.X - pw / 2), Math.round(p1.Y), pw, Math.round(p0.Y - p1.Y));
      g.fillStyle = '#6c7586'; g.fillRect(Math.round(p0.X - pw / 2), Math.round(p1.Y), 1, Math.round(p0.Y - p1.Y));
      // arm to the backboard
      const a0 = C(bx, 25, 12.4), a1 = C(B.x + s * 1.4, 25, 11.6);
      g.strokeStyle = '#4d5462'; g.lineWidth = Math.max(2, Math.round(0.3 * K)); g.beginPath(); g.moveTo(Math.round(a0.X), Math.round(a0.Y)); g.lineTo(Math.round(a1.X), Math.round(a1.Y)); g.stroke();
      // backboard: glass edge-on, frame, the shooter's square
      const bb = (d: number, z: number) => C(B.x + s * 1.25, d, z);
      const q = [bb(22, 13.5), bb(28, 13.5), bb(28, 10), bb(22, 10)];
      g.fillStyle = 'rgba(210,230,255,0.35)'; g.beginPath(); q.forEach((v, i) => (i ? g.lineTo(v.X, v.Y) : g.moveTo(v.X, v.Y))); g.closePath(); g.fill();
      g.strokeStyle = '#f2f5fa'; g.lineWidth = Math.max(1, Math.round(0.18 * K)); g.stroke();
      const sq = [bb(24, 11.5), bb(26, 11.5), bb(26, 10), bb(24, 10)];
      g.strokeStyle = '#e03b3b'; g.lineWidth = 1; g.beginPath(); sq.forEach((v, i) => (i ? g.lineTo(v.X, v.Y) : g.moveTo(v.X, v.Y))); g.closePath(); g.stroke();
      // back half of the rim
      g.fillStyle = '#c94f12';
      for (let i = 0; i <= 24; i++) { const a = Math.PI + Math.PI * i / 24; const v = C(B.x + Math.cos(a) * rr, 25 + Math.sin(a) * rr, 10); g.fillRect(Math.round(v.X - 1), Math.round(v.Y), 2, 2); }
      return;
    }
    // net: strings from the rim to a narrower ring, swaying after a make
    const sway = this.net[side] > 0 ? Math.sin(time * 38) * this.net[side] * 2.2 : 0;
    const drop = this.net[side] > 0 ? this.net[side] * 0.8 : 0;
    g.fillStyle = 'rgba(245,245,245,0.92)';
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * 2 * i / 12;
      const top = C(B.x + Math.cos(a) * rr, 25 + Math.sin(a) * rr, 10);
      const bot = C(B.x + Math.cos(a) * rr * 0.55, 25 + Math.sin(a) * rr * 0.55, 8.2 - drop);
      const n = Math.max(3, Math.round(Math.abs(bot.Y - top.Y)));
      for (let j = 0; j <= n; j++) { const u = j / n; g.fillRect(Math.round(top.X + (bot.X - top.X) * u + sway * u), Math.round(top.Y + (bot.Y - top.Y) * u), 1, 1); }
    }
    for (const zz of [9.4, 8.8]) for (let i = 0; i < 16; i++) { const a = Math.PI * 2 * i / 16, f = zz > 9 ? 0.8 : 0.66; const v = C(B.x + Math.cos(a) * rr * f, 25 + Math.sin(a) * rr * f, zz - drop * (10 - zz) / 1.8); g.fillRect(Math.round(v.X + sway * (10 - zz) / 1.8), Math.round(v.Y), 1, 1); }
    // front half of the rim
    g.fillStyle = '#ff6a1a';
    for (let i = 0; i <= 24; i++) { const a = Math.PI * i / 24; const v = C(B.x + Math.cos(a) * rr, 25 + Math.sin(a) * rr, 10); g.fillRect(Math.round(v.X - 1), Math.round(v.Y), 2, 2); }
  }

  /** crisp overlays drawn at full resolution: the ball handler's name, labels, floaters */
  private drawOverlays(time: number) {
    const b = this.ball;
    const topOf = (p: PSprite) => { const q = this.proj(p.x, p.d); return { x: q.x, y: q.y - ((this.looksOf(p.pid).ht || 79) / 12) * VZ * depthScale(p.d) - p.z * VZ * depthScale(p.d) }; };
    if (b.holder && !b.fly) {
      const p = this.players.get(b.holder);
      if (p) {
        const t = topOf(p);
        const yy = t.y - 3 + Math.round(Math.sin(time * 6) * 0.6);
        this.px(t.x - 1.5, yy, 3, 1, '#ffd34d'); this.px(t.x - 0.5, yy + 1, 1, 1, '#ffd34d');
        if (this.label?.pid !== p.pid) this.text(surname(this.o.names[p.pid] ?? ''), t.x, yy - 3.5, this.starOf(p.pid) > 0 ? '#ffd34d' : '#ffffff', 5, true);
      }
    }
    if (this.label) { const p = this.players.get(this.label.pid); if (p) { const t = topOf(p); this.text(surname(this.o.names[p.pid] ?? ''), t.x, t.y - 5, '#ffffff', 6, true); } }
    if (this.label2 && this.label2.pid !== this.label?.pid) { const p = this.players.get(this.label2.pid); if (p) { const q = this.proj(p.x, p.d); this.text(surname(this.o.names[p.pid] ?? ''), q.x, q.y + 4, '#ffb0b0', 5, true); } }
    for (const f of this.floaters) {
      const u = f.t / f.dur, alpha = 1 - Math.max(0, u - 0.7) / 0.3;
      if (f.at) { const q = this.proj(f.at.x, f.at.d, f.at.z); this.text(f.text, Math.max(this.camX + 22, Math.min(this.camX + VW / this.z - 22, q.x)), Math.max(this.camY + 22, q.y - 6 - u * 6), f.color, f.big ? 11 : 7, true, alpha); }
      else this.text(f.text, VW / 2, (f.big ? 70 : 84) - u * 10, f.color, f.big ? 16 : 8, true, alpha, true);
    }
  }

  /** Broadcast score bug at the top: team blocks, score, quarter, clock, shot clock. */
  private drawScoreBug() {
    if (!this.tl || !this.tl.items.length) return;
    const ctx = this.ctx;
    ctx.setTransform(this.R, 0, 0, this.R, 0, 0);
    const c = this.tl.clockAt(this.v);
    const W = 470, H = 34, x0 = (VW * S - W) / 2, y0 = 6;
    const [hc] = teamColor(this.o.home.tid), [ac] = teamColor(this.o.away.tid);
    ctx.fillStyle = '#0b0e16'; ctx.fillRect(x0 - 3, y0 - 3, W + 6, H + 6);
    ctx.fillStyle = '#2d6cdf'; ctx.fillRect(x0 - 3, y0 - 3, W + 6, 2);
    const seg = (x: number, w: number, bg: string, t: string, color = '#ffffff', align: CanvasTextAlign = 'center', size = 20) => {
      ctx.fillStyle = bg; ctx.fillRect(x0 + x, y0, w, H);
      ctx.fillStyle = color; ctx.font = `${size}px ${this.font}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.fillText(t, x0 + x + (align === 'center' ? w / 2 : 8), y0 + H / 2 + 1);
    };
    seg(0, 90, ac, this.o.away.abbr, '#ffffff', 'left'); seg(90, 46, '#141a28', String(c.as));
    seg(136, 90, hc, this.o.home.abbr, '#ffffff', 'left'); seg(226, 46, '#141a28', String(c.hs));
    const q = c.period <= 4 ? `Q${c.period}` : c.period === 5 ? 'OT' : `${c.period - 4}OT`;
    seg(272, 50, '#0b0e16', q);
    const left = c.left;
    const clk = left >= 60 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : left.toFixed(1);
    seg(322, 92, '#0b0e16', clk, '#ffd34d');
    if (c.shot != null) seg(414, 56, c.shot <= 5 ? '#7a1010' : '#1d2433', String(Math.ceil(c.shot - 1e-6)), c.shot <= 5 ? '#ffffff' : '#ff9a3c', 'center', 18);
    else seg(414, 56, '#1d2433', '', '#ffffff');
  }

  private text(t: string, x: number, y: number, color: string, size: number, outline: boolean, alpha = 1, screen = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.R, 0, 0, this.R, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `${size * S}px ${this.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const X = Math.round(screen ? x * S : (x - this.camX) * this.z * S), Y = Math.round(screen ? y * S : (y - this.camY) * this.z * S);
    if (outline) {
      ctx.fillStyle = '#0b0d12';
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) ctx.fillText(t, X + dx, Y + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(t, X, Y);
    ctx.restore();
  }
}
