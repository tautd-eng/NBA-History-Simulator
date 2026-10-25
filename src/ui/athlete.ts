// Player sprites for the arena view: a small skeleton (hips, knees, ankles,
// shoulders, elbows, hands, head) posed for running, dribbling, defending,
// shooting, jumping, celebrating or sitting, then drawn as crisp pixel shapes
// in canvas pixels — realistic proportions, era kits, skin shading, hair,
// facial hair, socks, shoes, sleeves and knee pads.

export interface Kit { jersey: string; trim: string; trim2: string; shorts: string }
export interface Body {
  skin: string; hair: string; hairColor: string; facial: string; band: boolean; num: number; ht: number;
  build?: number; socks?: string; sockH?: number; shoe?: string; sleeve?: number; knee?: boolean; wrist?: boolean;
}
export type AthPose = 'stand' | 'run' | 'shoot' | 'jump' | 'stance' | 'celebrate' | 'rest' | 'dribble' | 'sit';
export interface AthOpts {
  H: number;          // standing height in canvas pixels
  face: number;       // 1 = facing right, -1 = left
  pose: AthPose;
  ph: number;         // stride phase (radians)
  amp: number;        // stride amplitude 0..1 (speed)
  air: boolean;
  kit: Kit; body: Body;
  shorts: number;     // shorts length as a share of the thigh (short 1980s … baggy 2000s)
  font: string;
  num?: boolean;      // draw the jersey number
}
export interface Hands { front: { x: number; y: number }; back: { x: number; y: number }; head: { x: number; y: number } }

export const shade = (hex: string, f: number) => {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

type Ctx = CanvasRenderingContext2D;
const R = Math.round;
function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) { ctx.fillStyle = c; ctx.fillRect(R(x), R(y), Math.max(1, R(w)), Math.max(1, R(h))); }
/** a tapered limb stamped pixel by pixel */
function limb(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: string) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  ctx.fillStyle = c;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, w = w0 + (w1 - w0) * t;
    ctx.fillRect(R(x - w / 2), R(y - w / 2), Math.max(1, R(w)), Math.max(1, R(w)));
  }
}
/** filled polygon, scanline by scanline (crisp edges) */
function poly(ctx: Ctx, pts: [number, number][], c: string) {
  ctx.fillStyle = c;
  const ys = pts.map(p => p[1]);
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  for (let y = y0; y < y1; y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) ctx.fillRect(R(xs[i]), y, Math.max(1, R(xs[i + 1]) - R(xs[i])), 1);
  }
}
/** ellipse, optionally only rows inside [ya, yb] (absolute) */
function oval(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string, ya = -1e9, yb = 1e9, xa = -1e9, xb = 1e9) {
  ctx.fillStyle = c;
  const t = Math.floor(cy - ry), b = Math.ceil(cy + ry);
  for (let y = t; y < b; y++) {
    const yc = y + 0.5;
    if (yc < ya || yc > yb) continue;
    const k = (yc - cy) / ry;
    if (Math.abs(k) > 1) continue;
    const h = rx * Math.sqrt(1 - k * k);
    const l = Math.max(cx - h, xa), r = Math.min(cx + h, xb);
    if (r - l >= 0.5) ctx.fillRect(R(l), y, Math.max(1, R(r) - R(l)), 1);
  }
}

/** Draws the player with feet at (X, Y) and returns where his hands and head are. */
export function drawAthlete(ctx: Ctx, X: number, Y: number, o: AthOpts): Hands {
  const u = o.H / 100, f = o.face || 1;
  const b = o.body, build = b.build ?? 0.5;
  const skin = b.skin, skinD = shade(skin, 0.78), skinL = shade(skin, 1.12);
  const k = o.kit;
  const pose = o.pose;
  // ---- skeleton
  const Lt = 24 * u, Ls = 24 * u, Lu = 16.5 * u, Lf = 15.5 * u, torso = 31 * u;
  let hipY = -50 * u, lean = 0;
  let thA = 0.04, bdA = 0.06, thB = -0.04, bdB = 0.06;      // A = front leg, B = back leg
  let uA = 0.12, fA = 0.3, uB = -0.12, fB = 0.1;             // arm angles: 0 = hanging, + = forward, π = straight up
  const amp = Math.min(1, o.amp);
  const ps = o.ph, pb = o.ph + Math.PI;
  const air = o.air;
  const runLegs = () => {
    thA = 0.62 * amp * Math.sin(ps); bdA = amp * (0.2 + 1.25 * Math.max(0, Math.cos(ps))) + 0.06;
    thB = 0.62 * amp * Math.sin(pb); bdB = amp * (0.2 + 1.25 * Math.max(0, Math.cos(pb))) + 0.06;
    hipY -= 2 * u * amp * Math.abs(Math.sin(ps));
    lean = 0.14 * amp;
  };
  switch (pose) {
    case 'run':
      runLegs();
      uA = -0.6 * amp * Math.sin(ps); fA = uA + 0.9 * amp + 0.25;
      uB = -0.6 * amp * Math.sin(pb); fB = uB + 0.9 * amp + 0.25;
      break;
    case 'dribble':
      if (amp > 0.15) runLegs(); else { thA = 0.18; bdA = 0.45; thB = -0.15; bdB = 0.3; hipY += 3 * u; lean = 0.12; }
      uA = 0.35; fA = 0.75;                     // ball hand, low and in front
      uB = 0.55 + 0.2 * amp; fB = 1.25;         // off arm out, protecting the ball
      break;
    case 'stance':
      hipY += 9 * u; lean = 0.28;
      thA = 0.5; bdA = 0.95; thB = -0.5; bdB = 0.35;
      uA = 1.25; fA = 1.55; uB = -1.15; fB = -1.45;
      break;
    case 'shoot':
      thA = 0.12; bdA = air ? 0.45 : 0.25; thB = -0.05; bdB = air ? 0.55 : 0.2;
      uA = Math.PI - 0.32; fA = Math.PI - 0.06;  // shooting arm up, elbow under the ball
      uB = Math.PI - 0.75; fB = Math.PI - 0.25;  // guide hand
      lean = -0.04;
      break;
    case 'jump':
      thA = 0.2; bdA = 0.6; thB = -0.1; bdB = 0.5;
      uA = Math.PI - 0.2; fA = Math.PI - 0.1; uB = Math.PI - 0.45; fB = Math.PI - 0.2;
      break;
    case 'celebrate':
      thA = 0.15; bdA = 0.2; thB = -0.1; bdB = 0.1;
      uA = Math.PI - 0.55; fA = Math.PI - 0.15; uB = -(Math.PI - 0.55); fB = -(Math.PI - 0.15);
      break;
    case 'rest':
      hipY += 5 * u; lean = 0.62;
      thA = 0.25; bdA = 0.55; thB = -0.1; bdB = 0.35;
      uA = 0.55; fA = 0.2; uB = 0.35; fB = 0.15;
      break;
    case 'sit':
      hipY = -22 * u; lean = -0.05;
      thA = Math.PI / 2 - 0.08; bdA = Math.PI / 2 - 0.05; thB = Math.PI / 2 - 0.12; bdB = Math.PI / 2 - 0.1;
      uA = 0.35; fA = 1.3; uB = 0.25; fB = 1.2;
      break;
  }
  const hx = X, hy = Y + hipY;
  const legHip = (side: number) => ({ x: hx + side * 2.6 * u * f, y: hy });
  const leg = (side: number, th: number, bd: number) => {
    const h = legHip(side);
    const kn = { x: h.x + Math.sin(th) * Lt * f, y: h.y + Math.cos(th) * Lt };
    const sa = th - bd;
    const an = { x: kn.x + Math.sin(sa) * Ls * f, y: kn.y + Math.cos(sa) * Ls };
    return { h, kn, an, sa };
  };
  const LA = leg(1, thA, bdA), LB = leg(-1, thB, bdB);
  // standing: put the lowest foot on the floor
  if (pose !== 'sit') {
    const low = Math.max(LA.an.y, LB.an.y) + 2.6 * u;
    const dy = Y - low;
    if (!air) for (const L of [LA, LB]) { L.h.y += dy; L.kn.y += dy; L.an.y += dy; }
  }
  const hipC = { x: hx, y: (LA.h.y + LB.h.y) / 2 };
  const sh = { x: hipC.x + Math.sin(lean) * torso * f, y: hipC.y - Math.cos(lean) * torso };
  const shW = (17.5 + 5 * build) * u, hipW = (12 + 2 * build) * u;
  const lw = 1.0 + 0.28 * build;
  const shoulder = (side: number) => ({ x: sh.x + side * shW * 0.42 * f, y: sh.y + 1.5 * u });
  const arm = (side: number, ua: number, fa: number) => {
    const s0 = shoulder(side);
    const el = { x: s0.x + Math.sin(ua) * Lu * f, y: s0.y + Math.cos(ua) * Lu };
    const ha = { x: el.x + Math.sin(fa) * Lf * f, y: el.y + Math.cos(fa) * Lf };
    return { s0, el, ha };
  };
  const AA = arm(1, uA, fA), AB = arm(-1, uB, fB);
  const head = { x: sh.x + Math.sin(lean) * 4 * u * f, y: sh.y - 11.2 * u };

  // ---- drawing helpers
  const drawLeg = (L: typeof LA, back: boolean) => {
    const sk = back ? skinD : skin;
    limb(ctx, L.h.x, L.h.y, L.kn.x, L.kn.y, 7.4 * u * lw, 5.8 * u * lw, sk);
    limb(ctx, L.kn.x, L.kn.y, L.an.x, L.an.y, 5.6 * u * lw, 4 * u, sk);
    if (!back) limb(ctx, L.kn.x - 1.6 * u * f, L.kn.y + 2 * u, L.an.x - 1.4 * u * f, L.an.y - 3 * u, 1.2 * u, 1 * u, skinD);
    if (b.knee) limb(ctx, L.kn.x, L.kn.y - 1 * u, L.kn.x + Math.sin(L.sa) * 4 * u * f, L.kn.y + 4 * u, 6.2 * u, 5.6 * u, back ? '#2a2a2a' : '#3a3a3a');
    // socks
    const sockH = (b.sockH ?? 6) * u;
    const sx = L.an.x - Math.sin(L.sa) * sockH * f, sy = L.an.y - Math.cos(L.sa) * sockH;
    limb(ctx, sx, sy, L.an.x, L.an.y, 4.4 * u, 4.3 * u, back ? shade(b.socks ?? '#f2f2f2', 0.85) : (b.socks ?? '#f2f2f2'));
    // shoe
    const shoe = b.shoe ?? '#f4f4f4';
    const toe = L.an.x + 6.2 * u * f, heel = L.an.x - 2 * u * f;
    const fy = L.an.y + 2.6 * u;
    poly(ctx, [[heel, L.an.y - 0.6 * u], [L.an.x + 2 * u * f, L.an.y - 0.8 * u], [toe, fy - 1.6 * u], [toe, fy], [heel, fy]], back ? shade(shoe, 0.8) : shoe);
    rect(ctx, Math.min(heel, toe), fy - 0.9 * u, Math.abs(toe - heel), 0.9 * u, back ? '#9a9a9a' : '#d8d8d8');
  };
  const drawShorts = (L: typeof LA, back: boolean) => {
    const t = o.shorts;
    const ex = L.h.x + (L.kn.x - L.h.x) * t, ey = L.h.y + (L.kn.y - L.h.y) * t;
    const col = back ? shade(k.shorts, 0.82) : k.shorts;
    limb(ctx, L.h.x, L.h.y - 1 * u, ex, ey, 9.5 * u * lw, (8.6 + 2 * t) * u * lw, col);
    if (!back) limb(ctx, L.h.x - 3.6 * u * f * 0.3, L.h.y, ex - Math.cos(0) * 0, ey, 1.4 * u, 1.4 * u, k.trim);
  };
  const drawArm = (A: typeof AA, back: boolean, wrist: boolean) => {
    const sk = back ? skinD : skin;
    const w = 4.7 * u * lw;
    const sleeve = b.sleeve && ((b.sleeve > 0) === !back);
    limb(ctx, A.s0.x, A.s0.y, A.el.x, A.el.y, w, w * 0.82, sleeve ? (back ? '#1b1b1b' : '#232323') : sk);
    limb(ctx, A.el.x, A.el.y, A.ha.x, A.ha.y, w * 0.82, w * 0.66, sleeve ? (back ? '#1b1b1b' : '#232323') : sk);
    if (wrist) { const wx = A.el.x + (A.ha.x - A.el.x) * 0.82, wy = A.el.y + (A.ha.y - A.el.y) * 0.82; limb(ctx, wx, wy, A.ha.x - (A.ha.x - A.el.x) * 0.08, A.ha.y - (A.ha.y - A.el.y) * 0.08, w * 0.85, w * 0.85, k.trim); }
    oval(ctx, A.ha.x, A.ha.y, 2.4 * u, 2.6 * u, back ? skinD : skinL);
  };

  // ---- back arm and leg first
  drawArm(AB, true, !!b.wrist);
  drawLeg(LB, true);
  drawShorts(LB, true);
  drawLeg(LA, false);
  // torso: deltoids, jersey, collar, side trim, number
  const s1 = shoulder(1), s2 = shoulder(-1);
  oval(ctx, s1.x, s1.y + 1 * u, 3.6 * u * lw, 3.4 * u, skin);
  oval(ctx, s2.x, s2.y + 1 * u, 3.6 * u * lw, 3.4 * u, skinD);
  const wl = { x: hipC.x - hipW / 2, y: hipC.y - 1 * u }, wr = { x: hipC.x + hipW / 2, y: hipC.y - 1 * u };
  const tl = { x: sh.x - shW / 2 + 3 * u, y: sh.y - 0.5 * u }, tr = { x: sh.x + shW / 2 - 3 * u, y: sh.y - 0.5 * u };
  const al = { x: sh.x - shW / 2 + 1.2 * u, y: sh.y + 7 * u }, ar = { x: sh.x + shW / 2 - 1.2 * u, y: sh.y + 7 * u };
  poly(ctx, [[tl.x, tl.y], [tr.x, tr.y], [ar.x, ar.y], [wr.x + 0.5 * u, wr.y], [wl.x - 0.5 * u, wl.y], [al.x, al.y]], k.jersey);
  // shading on the side away from the light
  const dark = shade(k.jersey, 0.82);
  const sideX = f > 0 ? -1 : 1;
  poly(ctx, [[sh.x + sideX * (shW / 2 - 3.2 * u), tl.y + 1], [sh.x + sideX * (shW / 2 - 1.4 * u), ar.y], [hipC.x + sideX * (hipW / 2 + 0.4 * u), wl.y], [hipC.x + sideX * (hipW / 2 - 2.2 * u), wl.y], [sh.x + sideX * (shW / 2 - 4.4 * u), ar.y], [sh.x + sideX * (shW / 2 - 4.6 * u), tl.y + 1]], dark);
  // armhole and collar trim
  limb(ctx, tl.x, tl.y, al.x, al.y, 1.3 * u, 1.3 * u, k.trim);
  limb(ctx, tr.x, tr.y, ar.x, ar.y, 1.3 * u, 1.3 * u, k.trim);
  const nx = sh.x + 0.6 * u * f;
  limb(ctx, nx - 3.2 * u, sh.y - 0.3 * u, nx, sh.y + 4.5 * u, 1.3 * u, 1.3 * u, k.trim);
  limb(ctx, nx + 3.2 * u, sh.y - 0.3 * u, nx, sh.y + 4.5 * u, 1.3 * u, 1.3 * u, k.trim);
  oval(ctx, nx, sh.y + 0.5 * u, 2.6 * u, 3 * u, skinD, -1e9, sh.y + 3.5 * u);
  // waistband
  limb(ctx, wl.x - 0.5 * u, wl.y + 0.5 * u, wr.x + 0.5 * u, wr.y + 0.5 * u, 2.4 * u, 2.4 * u, k.shorts);
  if (o.num !== false && pose !== 'sit') {
    const ty = sh.y + 13 * u + Math.sin(lean) * 2 * u;
    ctx.font = `${Math.max(7, R(9.5 * u))}px ${o.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = k.trim2; ctx.fillText(String(b.num), R(sh.x + 1.5 * u * f + 1), R(ty + 1));
    ctx.fillStyle = k.trim; ctx.fillText(String(b.num), R(sh.x + 1.5 * u * f), R(ty));
  }
  drawShorts(LA, false);
  // neck and head
  limb(ctx, sh.x + 0.5 * u * f, sh.y + 1 * u, head.x, head.y + 5 * u, 4.6 * u, 4.2 * u, skinD);
  drawHead(ctx, head.x, head.y, u, f, b, skin, skinD, skinL, k);
  drawArm(AA, false, !!b.wrist);
  return { front: AA.ha, back: AB.ha, head: { x: head.x, y: head.y - 8 * u } };
}

function drawHead(ctx: Ctx, cx: number, cy: number, u: number, f: number, b: Body, skin: string, skinD: string, skinL: string, k: Kit) {
  const rx = 6.1 * u, ry = 7.3 * u;
  const hc = b.hairColor, hcL = shade(hc, 1.35);
  const style = b.hair;
  // big hair behind the head
  if (style === 'afro' || style === 'fro') oval(ctx, cx - 0.8 * u * f, cy - 2.2 * u, rx + 2.8 * u, ry + 1.6 * u, hc);
  if (style === 'dreads') for (let i = 0; i < 4; i++) limb(ctx, cx - f * (2 + i * 1.1) * u, cy - 3 * u, cx - f * (3 + i * 1.3) * u, cy + (5 + i % 2 * 2) * u, 1.8 * u, 1.5 * u, i % 2 ? hcL : hc);
  // face
  oval(ctx, cx, cy, rx, ry, skin);
  oval(ctx, cx, cy, rx, ry, shade(skin, 0.88), -1e9, 1e9, f > 0 ? -1e9 : cx + rx * 0.45, f > 0 ? cx - rx * 0.45 : 1e9); // shaded back of the head
  oval(ctx, cx + f * 1.2 * u, cy + 3.6 * u, rx * 0.72, ry * 0.42, skin, cy + 2 * u);             // jaw toward the front
  // ear
  oval(ctx, cx - f * 1.6 * u, cy + 0.6 * u, 1.3 * u, 1.9 * u, skinD);
  // hair on top
  const hairCap = (lift: number, line: number) => {
    oval(ctx, cx, cy - lift, rx + 0.5 * u, ry + 0.3 * u, hc, -1e9, cy - line);
    // hair over the back of the head comes down further
    oval(ctx, cx, cy - lift, rx + 0.5 * u, ry + 0.3 * u, hc, -1e9, cy + 1.5 * u, f > 0 ? -1e9 : cx + 0.8 * u, f > 0 ? cx - 0.8 * u : 1e9);
  };
  switch (style) {
    case 'bald': oval(ctx, cx - f * 1 * u, cy - 4.4 * u, 1.6 * u, 0.9 * u, skinL); break;
    case 'afro': case 'fro': oval(ctx, cx, cy - 1.5 * u, rx + 1.4 * u, ry, hc, -1e9, cy - 2.4 * u); break;
    case 'dreads': hairCap(0.6 * u, 2.6 * u); break;
    case 'cornrows': hairCap(0, 3.4 * u); for (let i = -2; i <= 2; i++) limb(ctx, cx + i * 1.6 * u, cy - 6.2 * u, cx + i * 1.9 * u - f * 1.5 * u, cy - 1.5 * u, 0.6 * u, 0.6 * u, hcL); break;
    case 'flattop': hairCap(0, 3.2 * u); rect(ctx, cx - rx, cy - ry - 2.8 * u, rx * 2, 3.6 * u, hc); rect(ctx, cx - rx, cy - ry - 2.8 * u, rx * 2, 0.8 * u, hcL); break;
    case 'spiky': case 'quiff': hairCap(0.8 * u, 3 * u); for (let i = 0; i < 3; i++) limb(ctx, cx + (i - 1) * 2.4 * u, cy - ry + 0.6 * u, cx + (i - 0.6) * 2.4 * u + f * 1.2 * u, cy - ry - 2.2 * u, 1.8 * u, 0.8 * u, hc); break;
    case 'bun': hairCap(0, 3.2 * u); oval(ctx, cx - f * 1.5 * u, cy - ry - 1.4 * u, 2.2 * u, 2 * u, hc); break;
    case 'mop': case 'curly': hairCap(0.9 * u, 2.2 * u); for (let i = 0; i < 5; i++) oval(ctx, cx + (i - 2) * 2.4 * u, cy - ry + 0.4 * u, 1.6 * u, 1.5 * u, i % 2 ? hcL : hc); break;
    case 'parted': hairCap(0.4 * u, 3 * u); limb(ctx, cx + f * 1.5 * u, cy - ry, cx + f * 0.6 * u, cy - ry + 2.6 * u, 0.6 * u, 0.6 * u, skin); break;
    case 'buzz': case 'fade': hairCap(-0.2 * u, 3.6 * u); break;
    default: hairCap(0.3 * u, 3.2 * u);
  }
  if (b.band) { limb(ctx, cx - rx - 0.3 * u, cy - 3.2 * u, cx + rx + 0.3 * u, cy - 3.2 * u, 1.8 * u, 1.8 * u, k.trim === '#ffffff' ? '#f2f2f2' : '#f4f4f4'); }
  // eyes, brow, nose, mouth on the side he faces
  const ex = cx + f * 2.5 * u;
  rect(ctx, ex - 0.6 * u, cy - 0.8 * u, 1.3 * u, 1.6 * u, '#1a1210');
  rect(ctx, ex - 1.4 * u, cy - 2.4 * u, 2.6 * u, 0.8 * u, shade(hc === '#9a9a9a' ? '#6a6a6a' : hc, 1));
  rect(ctx, cx + f * 5.1 * u - (f > 0 ? 0 : 1.1 * u), cy + 0.6 * u, 1.1 * u, 1.6 * u, skinD);
  const fac = b.facial;
  if (fac === 'beard') oval(ctx, cx + f * 0.8 * u, cy + 3.4 * u, rx * 0.95, ry * 0.58, hc, cy + 1.9 * u, 1e9, f > 0 ? cx - rx * 0.4 : -1e9, f > 0 ? 1e9 : cx + rx * 0.4);
  else if (fac === 'goatee' || fac === 'chin') oval(ctx, cx + f * 2.6 * u, cy + 5.4 * u, 1.9 * u, 1.4 * u, hc);
  else if (fac === 'stubble') oval(ctx, cx + f * 0.8 * u, cy + 3.6 * u, rx * 0.9, ry * 0.5, shade(skin, 0.82), cy + 2.2 * u);
  if (fac === 'mustache' || fac === 'goatee' || fac === 'beard') rect(ctx, cx + f * 1.6 * u - (f > 0 ? 0 : 2.8 * u), cy + 2.6 * u, 2.8 * u, 0.9 * u, hc);
  rect(ctx, cx + f * 2.2 * u - (f > 0 ? 0 : 1.8 * u), cy + 3.9 * u, 1.8 * u, 0.6 * u, shade(skin, 0.62));
}
