// Retro pixel-art court (side view, drawn at 320×180 and scaled up with crisp
// pixels). It replays play-by-play events: players run to formations, the ball
// is passed and shot in an arc, makes drop through the net, the crowd jumps.
import type { PbpEv } from '../engine/game';
import { hash01 } from '../rng';

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
}

interface PSprite { pid: string; side: 'h' | 'a'; x: number; d: number; tx: number; td: number; z: number; pose: 'run' | 'shoot' | 'stand'; skin: string; hair: string | null; leaving?: boolean }
interface Ball { x: number; d: number; z: number; holder: string | null; fly: null | { x0: number; d0: number; z0: number; x1: number; d1: number; z1: number; peak: number; t: number; dur: number; done?: () => void } }
interface Step { at: number; fn: () => void; fired?: boolean }
interface Anim { dur: number; t: number; steps: Step[] }
interface Floater { text: string; color: string; t: number; dur: number; big: boolean; at?: { x: number; d: number; z: number } }
interface Mark { x: number; d: number; made: boolean; side: 'h' | 'a'; t: number; three: boolean }

const surname = (n: string) => { const p = n.split(' '); return (p.length > 1 ? p.slice(1).join(' ') : n).toUpperCase(); };
function posNumOf(pos: string) {
  const m: Record<string, number> = { PG: 1, SG: 2, G: 1.5, GF: 2.5, SF: 3, F: 3.5, FC: 4.5, PF: 4, C: 5 };
  return m[pos] ?? m[pos.split('-')[0]] ?? 3;
}
export { posNumOf };

export class PixelCourt {
  ctx: CanvasRenderingContext2D;
  o: CourtOpts;
  players = new Map<string, PSprite>();
  ball: Ball = { x: 47, d: 25, z: 3, holder: null, fly: null };
  queue: PbpEv[] = [];
  anim: Anim | null = null;
  floaters: Floater[] = [];
  speed = 1;
  cheer = 0;
  net = { h: 0, a: 0 };
  last = 0;
  raf = 0;
  crowd: { x: number; y: number; c: string; ph: number }[] = [];
  onIdle: (() => void) | null = null;
  idleFired = true;
  label: { pid: string; t: number } | null = null;
  label2: { pid: string; t: number } | null = null; // the defender on the shot
  match = new Map<string, string>(); // offensive pid → defender pid
  marks: Mark[] = [];                       // recent shot spots on the floor
  trail: { x: number; y: number; t: number }[] = [];
  rimFx: { side: 'h' | 'a'; made: boolean; t: number } | null = null;
  hl: { pid: string; t: number } | null = null; // shooter highlight
  caption: { text: string; side: 'h' | 'a' | ''; kind: string; t: number } | null = null;
  camX = (VW - VW / Z) / 2;
  camY = VH - VH / Z;
  font = '"Silkscreen", "Courier New", monospace';

  constructor(canvas: HTMLCanvasElement, o: CourtOpts) {
    canvas.width = VW * S; canvas.height = VH * S;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.o = o;
    // crowd
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

  // ------------------------------------------------------------ geometry
  proj(x: number, d: number, z = 0) {
    const t = Math.max(-0.15, Math.min(1.2, d / WID));
    const l = FAR_L + t * (NEAR_L - FAR_L), r = FAR_R + t * (NEAR_R - FAR_R);
    const sc = (r - l) / LEN;
    return { x: l + (x / LEN) * (r - l), y: FAR_Y + t * (NEAR_Y - FAR_Y) - z * sc * 0.9, sc };
  }
  basket(side: 'h' | 'a') { return side === 'h' ? { x: LEN - 5.25, d: 25 } : { x: 5.25, d: 25 }; }
  dir(side: 'h' | 'a') { return side === 'h' ? 1 : -1; } // home attacks the right basket

  // ------------------------------------------------------------ lineups
  setLineups(h: string[], a: string[], snap = false) {
    const keep = new Set([...h, ...a]);
    for (const [pid, p] of this.players) if (!keep.has(pid)) { p.leaving = true; p.tx = 47 + (p.side === 'h' ? 6 : -6); p.td = 56; }
    for (const pid of [...h, ...a]) {
      if (this.players.has(pid)) { this.players.get(pid)!.leaving = false; continue; }
      const side = h.includes(pid) ? 'h' : 'a';
      const r = hash01(pid);
      const sp: PSprite = {
        pid, side, x: 47 + (side === 'h' ? 5 : -5), d: 56, tx: 47, td: 25, z: 0, pose: 'run',
        skin: SKIN[Math.floor(r * SKIN.length)], hair: HAIR[Math.floor(hash01(pid + 'h') * HAIR.length)],
      };
      this.players.set(pid, sp);
    }
    this.formation(this.ball.holder ? this.players.get(this.ball.holder)?.side ?? 'h' : 'h', snap);
  }
  on(side: 'h' | 'a') { return [...this.players.values()].filter(p => p.side === side && !p.leaving); }

  /** offence of `side` sets up; defenders take their man */
  formation(side: 'h' | 'a', snap = false, jitter = 2) {
    const B = this.basket(side), s = this.dir(side);
    const off = this.on(side).sort((p, q) => (this.o.pos[p.pid] ?? 3) - (this.o.pos[q.pid] ?? 3));
    const def = this.on(side === 'h' ? 'a' : 'h').sort((p, q) => (this.o.pos[p.pid] ?? 3) - (this.o.pos[q.pid] ?? 3));
    const spots = [[24, 25], [20, 8], [20, 42], [8, 17], [8, 33]];
    off.forEach((p, i) => {
      const [rel, d] = spots[i] ?? [15, 25];
      p.tx = B.x - s * (rel + (Math.random() - 0.5) * jitter);
      p.td = d + (Math.random() - 0.5) * jitter;
    });
    this.match.clear();
    def.forEach((p, i) => {
      const m = off[i];
      if (m) this.match.set(m.pid, p.pid);
      const mx = m ? m.tx : B.x - s * 15, md = m ? m.td : 25;
      p.tx = mx + (B.x - mx) * 0.28; p.td = md + (B.d - md) * 0.28;
    });
    if (snap) for (const p of this.players.values()) { p.x = p.tx; p.d = p.td; }
  }
  /** defenders stay with their man (between him and the basket) */
  private guardUp(side: 'h' | 'a', tight = 0.28) {
    const B = this.basket(side);
    for (const [o, d] of this.match) {
      const op = this.players.get(o), dp = this.players.get(d);
      if (!op || !dp) continue;
      dp.tx = op.tx + (B.x - op.tx) * tight; dp.td = op.td + (B.d - op.td) * tight;
    }
  }
  /** make `def` the man guarding `off` (swap assignments) */
  private assign(off: string, def: string) {
    const cur = this.match.get(off);
    if (cur === def) return;
    for (const [o, d] of this.match) if (d === def) { if (cur) this.match.set(o, cur); else this.match.delete(o); }
    this.match.set(off, def);
  }

  ftFormation(side: 'h' | 'a', shooter: string) {
    const B = this.basket(side), s = this.dir(side);
    const lane = [[7, 16.5], [7, 33.5], [11, 16.5], [11, 33.5], [14, 16.5], [14, 33.5]];
    let i = 0;
    for (const p of this.players.values()) {
      if (p.leaving) continue;
      if (p.pid === shooter) { p.tx = B.x - s * 15; p.td = 25; continue; }
      const sp = lane[i++];
      if (sp) { p.tx = B.x - s * sp[0]; p.td = sp[1]; } else { p.tx = B.x - s * 30; p.td = 25 + (i - 7) * 6; }
    }
  }

  // ------------------------------------------------------------ events
  push(evs: PbpEv[]) { this.queue.push(...evs); this.idleFired = false; }
  get busy() { return !!this.anim || this.queue.length > 0; }

  private pidOf(e: PbpEv, k: string) { return e.d?.find(x => x[1] === k)?.[0] ?? null; }
  private say(text: string, color = '#ffffff', big = true, dur = 1.1, at?: { x: number; d: number; z: number }) { this.floaters.push({ text, color, t: 0, dur, big, at }); }
  private sayAtPlayer(pid: string | null, text: string, color: string, dur = 1.1) {
    const p = pid ? this.players.get(pid) : null;
    this.say(text, color, false, dur, p ? { x: p.x, d: p.d, z: 22 } : undefined);
  }
  private setCaption(e: PbpEv) {
    const txt = e.txt.replace('{h}', this.o.home.abbr).replace('{a}', this.o.away.abbr);
    const d = e.m && e.k.startsWith('m') ? this.o.names[e.m] : null;
    this.caption = { text: d ? `${txt} · guarded by ${d.split(' ').slice(-1)[0]}` : txt, side: e.s, kind: e.k, t: 0 };
  }
  private sideColor(s: 'h' | 'a' | '') { return s === 'h' ? teamColor(this.o.home.tid)[0] : s === 'a' ? teamColor(this.o.away.tid)[0] : '#ffffff'; }

  private flyBall(x1: number, d1: number, z1: number, peak: number, dur: number, done?: () => void) {
    const b = this.ball;
    const from = b.holder ? this.players.get(b.holder) : null;
    const x0 = from ? from.x : b.x, d0 = from ? from.d : b.d, z0 = from ? 7 : b.z;
    b.holder = null;
    b.fly = { x0, d0, z0, x1, d1, z1, peak, t: 0, dur, done };
  }
  private give(pid: string | null) {
    if (!pid) return;
    this.ball.fly = null;
    this.ball.holder = pid;
  }

  private startEvent(e: PbpEv) {
    const steps: Step[] = [];
    let dur = 0.25;
    const k = e.k;
    const side = (e.s || 'h') as 'h' | 'a';
    const other = side === 'h' ? 'a' : 'h';
    if (e.on) this.setLineups(e.on.h, e.on.a);
    if (k === 'make2' || k === 'make3' || k === 'miss2' || k === 'miss3') {
      const actor = this.pidOf(e, 'fga');
      const blocker = this.pidOf(e, 'blk');
      const assist = this.pidOf(e, 'ast');
      const made = k.startsWith('make');
      const B = this.basket(side);
      // shot spot (event coordinates are a half court: x across, y from the baseline)
      const ex = e.x ?? 25, ey = e.y ?? 12;
      const sx = side === 'h' ? LEN - ey : ey, sd = side === 'h' ? ex : WID - ex;
      const transition = !this.ball.holder || this.players.get(this.ball.holder)?.side !== side || Math.sign(this.ball.x - 47) !== Math.sign(B.x - 47);
      this.formation(side);
      const a = actor ? this.players.get(actor) : null;
      const md = e.m && this.players.has(e.m) ? e.m : actor ? this.match.get(actor) ?? null : null;
      if (actor && md) this.assign(actor, md);
      const three = k.endsWith('3');
      const mark = () => { this.marks.push({ x: sx, d: sd, made, side, t: 0, three }); if (this.marks.length > 10) this.marks.shift(); };
      const rimShot = Math.hypot(sx - B.x, sd - B.d) < 9;
      // the shooter sets up: jump shooters relocate to their spot, slashers start from the wing
      if (a) {
        if (rimShot) { const sgn = this.dir(side); a.tx = B.x - sgn * 20; a.td = sd < 25 ? 10 : 40; }
        else { a.tx = sx; a.td = sd; }
      }
      this.guardUp(side);
      const pg = this.on(side).sort((p, q) => (this.o.pos[p.pid] ?? 3) - (this.o.pos[q.pid] ?? 3))[0];
      // after a score or a turnover the point guard brings it up; after a rebound the rebounder starts it
      if (!this.ball.holder || this.players.get(this.ball.holder)?.side !== side) { if (pg) this.give(pg.pid); }
      this.setCaption({ ...e, txt: `${side === 'h' ? this.o.home.abbr : this.o.away.abbr} ball`, k: 'poss' } as any);
      let t = Math.min(1.6, Math.max(0.5, this.maxDist() / 24));
      // ball movement: a few passes around the perimeter, the last one to the shooter (from the assister if any)
      const mates = this.on(side).filter(p => p.pid !== actor && p.pid !== assist);
      const busy = this.queue.length > 2;
      const nPass = busy ? 0 : Math.floor(Math.random() * 3);
      const chain: string[] = [];
      for (let i = 0; i < nPass && mates.length; i++) { const m = mates[Math.floor(Math.random() * mates.length)]; if (chain[chain.length - 1] !== m.pid) chain.push(m.pid); }
      if (transition && pg && this.ball.holder !== pg.pid && pg.pid !== actor && chain[0] !== pg.pid) chain.unshift(pg.pid); // outlet to the point guard
      if (assist && this.players.has(assist) && chain[chain.length - 1] !== assist) chain.push(assist);
      if (actor) chain.push(actor);
      for (const to of chain) {
        const at = t;
        steps.push({ at, fn: () => {
          if (this.ball.holder === to) return;
          const p = this.players.get(to);
          if (!p) return;
          // off-ball movement: everyone else shifts a little, defenders stay with their man
          for (const q of this.on(side)) if (q.pid !== to && q.pid !== actor) { q.tx += (Math.random() - 0.5) * 4; q.td += (Math.random() - 0.5) * 4; }
          this.guardUp(side);
          this.flyBall(p.x, p.d, 6, 7, 0.26, () => this.give(to));
        } });
        t += 0.55;
      }
      // the move: drive to the rim with the defender trailing, or a closeout on the jump shooter
      if (a) {
        const drive = t;
        steps.push({ at: drive, fn: () => {
          a.tx = sx; a.td = sd;
          const dp = md ? this.players.get(md) : null;
          if (dp) {
            if (rimShot) { dp.tx = sx - this.dir(side) * 2.5; dp.td = sd + (sd < 25 ? -1.5 : 1.5); }
            else { dp.tx = sx + (B.x - sx) * 0.12; dp.td = sd + (B.d - sd) * 0.12; }
          }
          if (md) this.label2 = { pid: md, t: 1.6 };
        } });
        t += rimShot ? 0.6 : 0.3;
      }
      const setup = t;
      const fl = k.endsWith('3') ? 0.75 : 0.55;
      steps.push({ at: setup, fn: () => {
        if (a) a.pose = 'shoot';
        const dp = md ? this.players.get(md) : null;
        if (dp) dp.pose = 'shoot'; // the contest
        this.label = actor ? { pid: actor, t: 1.6 } : null;
        this.hl = actor ? { pid: actor, t: 1.6 } : null;
        this.setCaption(e);
        if (blocker) {
          const bp = this.players.get(blocker);
          if (bp) { bp.tx = (a?.x ?? sx) + (B.x - (a?.x ?? sx)) * 0.15; bp.td = a?.d ?? sd; }
          this.flyBall((a?.x ?? sx) + (B.x - (a?.x ?? sx)) * 0.2, (a?.d ?? sd), 11, 12, 0.22, () => {
            this.sayAtPlayer(blocker, 'BLOCKED!', '#ff6b6b', 1.3);
            mark();
            this.flyBall((a?.x ?? sx) + (Math.random() - 0.5) * 12, (a?.d ?? sd) + (Math.random() - 0.5) * 12, 0, 6, 0.45);
          });
        } else {
          this.trail = [];
          this.flyBall(B.x, B.d, 10.2, k.endsWith('3') ? 19 : 15, fl, () => {
            mark();
            this.rimFx = { side, made, t: 0 };
            const atRim = { x: B.x, d: B.d, z: 17 };
            if (made) {
              this.ball.fly = { x0: B.x, d0: B.d, z0: 10, x1: B.x, d1: B.d, z1: 0.5, peak: 10, t: 0, dur: 0.35 };
              this.net[side === 'h' ? 'h' : 'a'] = 0.4;
              this.cheer = side === 'h' ? 1.2 : 0.5;
              this.say(k.endsWith('3') ? '+3' : '+2', '#5dff8a', true, 1.3, atRim);
            } else {
              this.say('MISS', '#ff6b6b', true, 1.1, atRim);
              const ang = Math.random() * Math.PI - Math.PI / 2;
              const r = 5 + Math.random() * 8;
              this.flyBall(B.x - this.dir(side) * Math.cos(ang) * r, B.d + Math.sin(ang) * r, 2, 13, 0.5);
            }
          });
        }
      } });
      steps.push({ at: setup + fl + 0.1, fn: () => { if (a) a.pose = 'run'; const dp = md ? this.players.get(md) : null; if (dp) dp.pose = 'run'; } });
      dur = setup + fl + (made ? 0.55 : 0.45);
    } else if (k === 'orb' || k === 'drb') {
      const pid = this.pidOf(e, k);
      const p = pid ? this.players.get(pid) : null;
      const target = this.ball.fly ? { x: this.ball.fly.x1, d: this.ball.fly.d1 } : { x: this.ball.x, d: this.ball.d };
      if (p) { p.tx = target.x; p.td = target.d; }
      steps.push({ at: 0.35, fn: () => { this.give(pid); this.label = pid ? { pid, t: 0.8 } : null; this.setCaption(e); } });
      if (k === 'drb') steps.push({ at: 0.45, fn: () => this.formation(side) });
      dur = 0.55;
    } else if (k === 'tov') {
      const pid = this.pidOf(e, 'tov'), stl = this.pidOf(e, 'stl');
      const v = (e as any).v ?? (stl ? 'pick' : 'bad');
      const B = this.basket(side);
      this.formation(side);
      const a = pid ? this.players.get(pid) : null;
      const md = (e as any).m && this.players.has((e as any).m) ? (e as any).m : pid ? this.match.get(pid) ?? null : null;
      if (pid && md) this.assign(pid, md);
      this.guardUp(side);
      if (!this.ball.holder || this.players.get(this.ball.holder)?.side !== side) { const pg = this.on(side).sort((p, q) => (this.o.pos[p.pid] ?? 3) - (this.o.pos[q.pid] ?? 3))[0]; if (pg) this.give(pg.pid); }
      this.setCaption({ ...e, txt: `${side === 'h' ? this.o.home.abbr : this.o.away.abbr} ball`, k: 'poss' } as any);
      let t = Math.min(1.4, Math.max(0.45, this.maxDist() / 24));
      // the ball gets to the player who loses it
      if (pid && this.ball.holder !== pid) {
        steps.push({ at: t, fn: () => { const p = this.players.get(pid); if (p && this.ball.holder !== pid) this.flyBall(p.x, p.d, 6, 7, 0.26, () => this.give(pid)); } });
        t += 0.55;
      }
      const sp = stl ? this.players.get(stl) : null;
      const pressure = t;
      steps.push({ at: pressure, fn: () => {
        if (!a) return;
        // he attacks; his defender crowds him
        a.tx = a.x + (B.x - a.x) * 0.25; a.td = a.d + (B.d - a.d) * 0.25;
        const dp = md ? this.players.get(md) : null;
        if (dp) { dp.tx = a.tx + (B.x - a.tx) * 0.08; dp.td = a.td + (B.d - a.td) * 0.08; }
        if (md) this.label2 = { pid: md, t: 1.4 };
        this.label = pid ? { pid, t: 1.4 } : null;
      } });
      t += 0.45;
      steps.push({ at: t, fn: () => {
        this.setCaption(e);
        if (v === 'strip' && sp) {
          sp.pose = 'shoot';
          this.flyBall(sp.x + (Math.random() - 0.5) * 3, sp.d + 2, 0.5, 3, 0.25, () => { this.give(stl); sp.pose = 'run'; });
          this.sayAtPlayer(stl, 'STRIPPED!', '#ffd34d', 1.3);
        } else if (v === 'pick' && sp) {
          // the pass is thrown to a teammate, the defender jumps the lane
          const mates = this.on(side).filter(p => p.pid !== pid);
          const target = mates[Math.floor(Math.random() * mates.length)];
          const mx = target ? (this.ball.x + target.x) / 2 : sp.x, mdd = target ? (this.ball.d + target.d) / 2 : sp.d;
          sp.tx = mx; sp.td = mdd;
          this.flyBall(mx, mdd, 5, 6, 0.35, () => this.give(stl));
          this.sayAtPlayer(stl, 'PICKED OFF!', '#ffd34d', 1.3);
        } else if (v === 'travel') {
          this.sayAtPlayer(pid, 'TRAVELING', '#ffd34d', 1.2);
        } else {
          // thrown away / lost out of bounds: the ball flies over the near sideline
          const outD = this.ball.d > 25 ? WID + 5 : -5;
          this.flyBall(this.ball.x + (Math.random() - 0.5) * 14, outD, 1, v === 'bad' ? 7 : 3, 0.5);
          this.sayAtPlayer(pid, v === 'bad' ? 'BAD PASS' : 'OUT OF BOUNDS', '#ffd34d', 1.2);
        }
      } });
      steps.push({ at: t + 0.7, fn: () => { this.formation(other); if (!sp) { const pg = this.on(other).sort((p, q) => (this.o.pos[p.pid] ?? 3) - (this.o.pos[q.pid] ?? 3))[0]; if (pg) this.give(pg.pid); } } });
      dur = t + 0.9;
    } else if (k === 'foul') {
      const pid = this.pidOf(e, 'pf');
      this.sayAtPlayer(pid, e.txt.startsWith('Intentional') ? 'INTENTIONAL FOUL' : 'FOUL', '#ffd34d', 1.0);
      if (pid) this.label = { pid, t: 0.9 };
      this.setCaption(e);
      dur = 0.55;
    } else if (k === 'ft' || k === 'ftm') {
      const pid = this.pidOf(e, 'fta');
      if (pid) { this.ftFormation(side, pid); this.give(pid); this.label = { pid, t: 1.2 }; this.hl = { pid, t: 1.4 }; }
      this.setCaption(e);
      const B = this.basket(side);
      const setup = Math.min(1.2, Math.max(0.35, this.maxDist() / 24));
      steps.push({ at: setup, fn: () => {
        const p = pid ? this.players.get(pid) : null;
        if (p) p.pose = 'shoot';
        this.flyBall(B.x, B.d, 10.2, 13, 0.5, () => {
          this.rimFx = { side, made: k === 'ft', t: 0 };
          if (k === 'ft') { this.ball.fly = { x0: B.x, d0: B.d, z0: 10, x1: B.x, d1: B.d, z1: 0.5, peak: 10, t: 0, dur: 0.3 }; this.net[side] = 0.3; this.say('+1', '#5dff8a', false, 0.9, { x: B.x, d: B.d, z: 17 }); }
          else { this.flyBall(B.x - this.dir(side) * 6, B.d + (Math.random() - 0.5) * 10, 2, 12, 0.45); this.say('MISS', '#ff6b6b', false, 0.9, { x: B.x, d: B.d, z: 17 }); }
          if (p) p.pose = 'stand';
        });
      } });
      dur = setup + 0.85;
    } else if (k === 'timeout') {
      this.say('TIMEOUT', '#ffffff', false, 1.2);
      this.setCaption(e);
      dur = 1.1;
    } else if (k === 'period' || k === 'end') {
      this.say(k === 'end' ? 'FINAL' : e.txt.toUpperCase(), '#ffd34d', true, 1.6);
      this.setCaption(e);
      dur = 1.4;
    } else if (k === 'sub') {
      dur = e.on && this.players.size ? 0.35 : 0.05;
    }
    this.anim = { dur, t: 0, steps };
  }

  private maxDist() {
    let m = 0;
    for (const p of this.players.values()) m = Math.max(m, Math.hypot(p.tx - p.x, p.td - p.d));
    return m;
  }

  /** apply an event without animation (catching up) */
  private snapEvent(e: PbpEv) {
    if (e.on) this.setLineups(e.on.h, e.on.a, true);
    if (e.k !== 'sub') this.setCaption(e);
    const k = e.k;
    const side = (e.s || 'h') as 'h' | 'a';
    if (k === 'drb' || k === 'orb') this.give(this.pidOf(e, k));
    if (k === 'tov') this.give(this.pidOf(e, 'stl'));
    if (k.startsWith('make') || k === 'ft') {
      const other = side === 'h' ? 'a' : 'h';
      const pg = this.on(other)[0];
      if (pg) this.give(pg.pid);
    }
  }

  update(dt: number) {
    // catch up when the queue gets long
    if (this.queue.length > 14) {
      while (this.queue.length > 3) this.snapEvent(this.queue.shift()!);
      this.anim = null;
      for (const p of this.players.values()) { p.x = p.tx; p.d = p.td; }
      const last = [...this.queue].reverse().find(e => e.s) ?? null;
      if (last) this.formation(last.s as 'h' | 'a', true, 0);
    }
    const sp = this.speed * (1 + Math.max(0, this.queue.length - 1) * 0.6);
    const sdt = dt * sp;
    if (!this.anim && this.queue.length) this.startEvent(this.queue.shift()!);
    if (this.anim) {
      this.anim.t += sdt;
      for (const st of this.anim.steps) if (!st.fired && this.anim.t >= st.at) { st.fired = true; st.fn(); }
      if (this.anim.t >= this.anim.dur) {
        for (const st of this.anim.steps) if (!st.fired) { st.fired = true; st.fn(); }
        this.anim = null;
      }
    }
    if (!this.anim && !this.queue.length && !this.idleFired) { this.idleFired = true; this.onIdle?.(); }
    // players
    for (const [pid, p] of this.players) {
      const dx = p.tx - p.x, dd = p.td - p.d, dist = Math.hypot(dx, dd);
      const v = 24 * sdt;
      if (dist > 0.05) { const f = Math.min(1, v / dist); p.x += dx * f; p.d += dd * f; }
      if (p.leaving && dist < 1) this.players.delete(pid);
    }
    // ball
    const b = this.ball;
    if (b.fly) {
      const f = b.fly;
      f.t += sdt;
      const u = Math.min(1, f.t / f.dur);
      b.x = f.x0 + (f.x1 - f.x0) * u; b.d = f.d0 + (f.d1 - f.d0) * u;
      const lin = f.z0 + (f.z1 - f.z0) * u;
      b.z = lin + 4 * (Math.max(f.peak, f.z0, f.z1) - Math.max(f.z0, f.z1)) * u * (1 - u);
      if (f.peak >= 10) { const pp = this.proj(b.x, b.d, b.z); this.trail.push({ x: pp.x, y: pp.y, t: 0 }); }
      if (u >= 1) { b.fly = null; f.done?.(); }
    } else if (b.holder) {
      const p = this.players.get(b.holder);
      if (p) { b.x = p.x + 0.8; b.d = p.d + 0.6; b.z = p.pose === 'shoot' ? 9 : 2 + Math.abs(Math.sin(performance.now() / 110)) * 2; }
    }
    this.floaters = this.floaters.filter(f => (f.t += dt) < f.dur);
    this.trail = this.trail.filter(q => (q.t += dt) < 0.5);
    this.marks = this.marks.filter(m => (m.t += dt) < 9);
    if (this.rimFx && (this.rimFx.t += dt) > 0.7) this.rimFx = null;
    if (this.hl && (this.hl.t -= dt) <= 0) this.hl = null;
    if (this.caption) this.caption.t += dt;
    // camera: keep the ball (or the action) in view, pan smoothly
    const bp = this.proj(this.ball.x, this.ball.d);
    const target = Math.max(0, Math.min(VW - VW / Z, bp.x - VW / Z / 2));
    this.camX += (target - this.camX) * Math.min(1, dt * 3);
    if (this.label) { this.label.t -= dt; if (this.label.t <= 0) this.label = null; }
    if (this.label2) { this.label2.t -= dt; if (this.label2.t <= 0) this.label2 = null; }
    this.cheer = Math.max(0, this.cheer - dt);
    this.net.h = Math.max(0, this.net.h - dt); this.net.a = Math.max(0, this.net.a - dt);
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
    ctx.setTransform(S * Z, 0, 0, S * Z, -this.camX * S * Z, -this.camY * S * Z);
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
      if (f.at) { const q = this.proj(f.at.x, f.at.d, f.at.z); this.text(f.text, Math.max(this.camX + 18, Math.min(this.camX + VW / Z - 18, q.x)), Math.max(this.camY + 24, q.y - u * 8), f.color, f.big ? 13 : 9, true, alpha); }
      else this.text(f.text, VW / 2, (f.big ? 80 : 92) - u * 10, f.color, f.big ? 16 : 8, true, alpha, true);
    }
    this.drawCaption();
  }

  /** Top band: what is happening right now, in plain words. */
  private drawCaption() {
    const ctx = this.ctx;
    const c = this.caption;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const H = 17 * S;
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
    const good = c.kind === 'make2' || c.kind === 'make3' || c.kind === 'ft';
    const bad = c.kind === 'miss2' || c.kind === 'miss3' || c.kind === 'ftm' || c.kind === 'tov';
    if (good || bad) {
      ctx.fillStyle = good ? '#3ddc6e' : '#ff5c5c';
      ctx.font = `700 16px "IBM Plex Sans", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(good ? '✓' : '✗', x, H / 2 + 1); x += 18;
    }
    ctx.font = `500 15px "IBM Plex Sans", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let t = c.text;
    const max = VW * S - x - 10;
    while (t.length > 4 && ctx.measureText(t).width > max) t = t.slice(0, -2);
    if (t !== c.text) t = t.slice(0, -1) + '…';
    ctx.fillStyle = good ? '#d9ffe4' : bad ? '#ffe0e0' : '#f4efe2';
    ctx.fillText(t, x, H / 2 + 1);
    ctx.globalAlpha = 1;
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
    const moving = Math.hypot(p.tx - p.x, p.td - p.d) > 0.3;
    const step = moving ? Math.floor(time * 10 + hash01(p.pid) * 4) % 2 : 0;
    const jumpZ = p.pose === 'shoot' ? 3 : 0;
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
    if (p.pose === 'shoot') { this.px(x - 3, Y - 16, 1, 4, p.skin); this.px(x + 2, Y - 16, 1, 4, p.skin); }
    else { this.px(x - 4, Y - 11, 1, 4, p.skin); this.px(x + 3, Y - 11, 1, 4, p.skin); }
    // head + hair
    this.px(x - 1, Y - 15, 3, 3, p.skin);
    if (p.hair) this.px(x - 1, Y - 16, 3, 1, p.hair);
  }

  private text(t: string, x: number, y: number, color: string, size: number, outline: boolean, alpha = 1, screen = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `${size * S}px ${this.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const X = Math.round(screen ? x * S : (x - this.camX) * Z * S), Y = Math.round(screen ? y * S : (y - this.camY) * Z * S);
    if (outline) {
      ctx.fillStyle = '#0b0d12';
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) ctx.fillText(t, X + dx, Y + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(t, X, Y);
    ctx.restore();
  }
}
