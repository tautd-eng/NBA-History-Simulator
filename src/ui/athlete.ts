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
  view?: 'side' | 'front' | 'back'; // profile, facing the camera, or running away from it
  name?: string;      // surname on the back of the jersey
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
function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) { ctx.fillStyle = c; ctx.fillRect(x, y, Math.max(0.8, w), Math.max(0.8, h)); }
/** a tapered limb: a quad with round ends (native paths are fast) */
function limb(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: string) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / l, ny = dx / l, r0 = w0 / 2, r1 = w1 / 2;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
  ctx.lineTo(x1 + nx * r1, y1 + ny * r1);
  ctx.arc(x1, y1, r1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), dx * ny - dy * nx > 0);
  ctx.lineTo(x0 - nx * r0, y0 - ny * r0);
  ctx.arc(x0, y0, r0, Math.atan2(-ny, -nx), Math.atan2(ny, nx), dx * ny - dy * nx > 0);
  ctx.fill();
}
/** filled polygon */
function poly(ctx: Ctx, pts: [number, number][], c: string) {
  ctx.fillStyle = c;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath(); ctx.fill();
}
/** ellipse, optionally only the part inside the band ya..yb, xa..xb */
function oval(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string, ya = -1e9, yb = 1e9, xa = -1e9, xb = 1e9) {
  ctx.fillStyle = c;
  const clip = ya > -1e8 || yb < 1e8 || xa > -1e8 || xb < 1e8;
  if (clip) {
    ctx.save(); ctx.beginPath();
    const l = Math.max(xa, cx - rx - 1), r = Math.min(xb, cx + rx + 1), t = Math.max(ya, cy - ry - 1), b = Math.min(yb, cy + ry + 1);
    if (r <= l || b <= t) { ctx.restore(); return; }
    ctx.rect(l, t, r - l, b - t); ctx.clip();
  }
  ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); ctx.fill();
  if (clip) ctx.restore();
}

/** Draws the player with feet at (X, Y) and returns where his hands and head are. */
export function drawAthlete(ctx: Ctx, X: number, Y: number, o: AthOpts): Hands {
  const u = o.H / 100, f = o.face || 1;
  const view = o.view ?? 'side';
  const side = view === 'side';
  const sx = side ? 1 : 0.3;                 // swing seen across (profile) or foreshortened (front/back)
  const b = o.body, build = b.build ?? 0.5;
  const skin = b.skin, skinD = shade(skin, 0.8), skinDD = shade(skin, 0.66), skinL = shade(skin, 1.13);
  const k = o.kit;
  const pose = o.pose;
  // ---- skeleton
  const Lt = 24 * u, Ls = 24 * u, Lu = 16.5 * u, Lf = 15.5 * u, torso = 31 * u;
  let hipY = -50 * u, lean = 0;
  let thA = 0.04, bdA = 0.06, thB = -0.04, bdB = 0.06;      // A = front leg, B = back leg
  let uA = 0.12, fA = 0.3, uB = -0.12, fB = 0.1;             // arm angles: 0 = hanging, + = forward, π = straight up
  let spreadA = 0, spreadB = 0;                               // arms out to the side (front/back views)
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
      uA = 0.35; fA = 0.75;
      uB = 0.55 + 0.2 * amp; fB = 1.25; spreadB = 0.5;
      break;
    case 'stance':
      hipY += 9 * u; lean = 0.28;
      thA = 0.5; bdA = 0.95; thB = -0.5; bdB = 0.35;
      uA = 1.25; fA = 1.55; uB = -1.15; fB = -1.45; spreadA = 1.1; spreadB = 1.1;
      break;
    case 'shoot':
      thA = 0.12; bdA = air ? 0.45 : 0.25; thB = -0.05; bdB = air ? 0.55 : 0.2;
      uA = Math.PI - 0.32; fA = Math.PI - 0.06;
      uB = Math.PI - 0.75; fB = Math.PI - 0.25;
      lean = -0.04;
      break;
    case 'jump':
      thA = 0.2; bdA = 0.6; thB = -0.1; bdB = 0.5;
      uA = Math.PI - 0.2; fA = Math.PI - 0.1; uB = Math.PI - 0.45; fB = Math.PI - 0.2;
      break;
    case 'celebrate':
      thA = 0.15; bdA = 0.2; thB = -0.1; bdB = 0.1;
      uA = Math.PI - 0.55; fA = Math.PI - 0.15; uB = -(Math.PI - 0.55); fB = -(Math.PI - 0.15); spreadA = 0.5; spreadB = 0.5;
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
  const legSide = (s: number) => side ? s * 2.6 * u * f : s * 4 * u * (view === 'back' ? -1 : 1);
  const leg = (s: number, th: number, bd: number) => {
    const h = { x: hx + legSide(s), y: hy };
    const kn = { x: h.x + Math.sin(th) * Lt * f * sx, y: h.y + Math.cos(th) * Lt };
    const sa = th - bd;
    const an = { x: kn.x + Math.sin(sa) * Ls * f * sx, y: kn.y + Math.cos(sa) * Ls };
    return { h, kn, an, sa };
  };
  const LA = leg(1, thA, bdA), LB = leg(-1, thB, bdB);
  if (pose !== 'sit' && !air) {
    const low = Math.max(LA.an.y, LB.an.y) + 2.6 * u;
    const dy = Y - low;
    for (const L of [LA, LB]) { L.h.y += dy; L.kn.y += dy; L.an.y += dy; }
  }
  const hipC = { x: hx, y: (LA.h.y + LB.h.y) / 2 };
  const leanX = Math.sin(lean) * torso * f * sx;
  const sh = { x: hipC.x + leanX, y: hipC.y - Math.cos(lean) * torso };
  const shW = (17.5 + 5 * build) * u * (side ? 0.92 : 1.08), hipW = (12 + 2 * build) * u * (side ? 1 : 1.15);
  const lw = 1.0 + 0.28 * build;
  const shoulder = (s: number) => side ? { x: sh.x + s * shW * 0.42 * f, y: sh.y + 1.5 * u } : { x: sh.x + s * shW * 0.47 * (view === 'back' ? -1 : 1), y: sh.y + 1.5 * u };
  const arm = (s: number, ua: number, fa: number, spread: number) => {
    const s0 = shoulder(s);
    const out = side ? 0 : s * (view === 'back' ? -1 : 1);
    const ex = side ? Math.sin(ua) * Lu * f : Math.sin(ua) * Lu * 0.3 * f + out * (Math.sin(Math.min(1.4, spread + 0.12)) * Lu * 0.9);
    const el = { x: s0.x + ex, y: s0.y + Math.cos(side ? ua : Math.max(ua, spread)) * Lu };
    const fx = side ? Math.sin(fa) * Lf * f : Math.sin(fa) * Lf * 0.3 * f + out * Math.sin(Math.min(1.5, spread * 1.1 + 0.15)) * Lf * 0.9;
    const ha = { x: el.x + fx, y: el.y + Math.cos(side ? fa : Math.max(fa, spread)) * Lf };
    return { s0, el, ha };
  };
  const AA = arm(1, uA, fA, spreadA), AB = arm(-1, uB, fB, spreadB);
  const head = { x: sh.x + Math.sin(lean) * 4 * u * f * sx, y: sh.y - 11.2 * u + (side ? 0 : Math.sin(lean) * 2 * u) };

  // ---- parts
  const drawLeg = (L: typeof LA, back: boolean) => {
    const sk = back ? skinD : skin;
    const thW = 7.6 * u * lw, knW = 5.6 * u * lw;
    limb(ctx, L.h.x, L.h.y, L.kn.x, L.kn.y, thW, knW, sk);
    // calf: thicker below the knee, thin at the ankle
    const cx = L.kn.x + (L.an.x - L.kn.x) * 0.3, cy = L.kn.y + (L.an.y - L.kn.y) * 0.3;
    limb(ctx, L.kn.x, L.kn.y, cx, cy, knW, 6.3 * u * lw, sk);
    limb(ctx, cx, cy, L.an.x, L.an.y, 6.3 * u * lw, 3.9 * u, sk);
    if (!back) {
      // muscle shading: back of the calf and the thigh, a highlight down the shin
      const bx = -1.9 * u * (side ? f : 1);
      limb(ctx, L.kn.x + bx, L.kn.y + 2 * u, cx + bx * 1.1, cy + 2 * u, 1.3 * u, 1.6 * u, skinD);
      limb(ctx, cx + bx * 1.1, cy + 2 * u, L.an.x + bx * 0.6, L.an.y - 3 * u, 1.6 * u, 1 * u, skinD);
      limb(ctx, L.kn.x - bx * 0.7, L.kn.y + 1.5 * u, L.an.x - bx * 0.5, L.an.y - 4 * u, 0.9 * u, 0.7 * u, skinL);
      limb(ctx, L.kn.x - 0.6 * u, L.kn.y - 0.6 * u, L.kn.x + 0.6 * u, L.kn.y - 0.6 * u, 1.2 * u, 1.2 * u, skinD); // kneecap
    }
    if (b.knee) limb(ctx, L.kn.x, L.kn.y - 1.2 * u, L.kn.x + Math.sin(L.sa) * 4 * u * f * sx, L.kn.y + 4 * u, 6.4 * u, 5.8 * u, back ? '#222' : '#333');
    // socks (tube socks with stripes in the early years)
    const sockH = (b.sockH ?? 6) * u;
    const sxk = L.an.x - Math.sin(L.sa) * sockH * f * sx, syk = L.an.y - Math.cos(L.sa) * sockH;
    const sc = b.socks ?? '#f2f2f2';
    limb(ctx, sxk, syk, L.an.x, L.an.y, 4.6 * u, 4.4 * u, back ? shade(sc, 0.86) : sc);
    if (sockH > 9 * u) for (const t of [0.12, 0.3]) { const yy = syk + (L.an.y - syk) * t, xx = sxk + (L.an.x - sxk) * t; limb(ctx, xx - 2.3 * u, yy, xx + 2.3 * u, yy, 1.1 * u, 1.1 * u, t < 0.2 ? k.trim : k.trim2 === '#ffffff' ? k.trim : shade(k.trim, 0.7)); }
    // shoe: upper, toe cap, sole, laces, accent stripe
    const shoe = b.shoe ?? '#f4f4f4';
    const dir = side ? f : (L === LA ? 0.35 : -0.35) * (view === 'back' ? -1 : 1);
    const len = side ? 6.6 * u : 3.8 * u;
    const toe = L.an.x + len * Math.sign(dir || 1) * (side ? 1 : Math.abs(dir) * 2.6), heel = L.an.x - (side ? 2.2 * u * f : 1.6 * u * Math.sign(dir || 1));
    const fy = L.an.y + 2.8 * u;
    const sh2 = back ? shade(shoe, 0.82) : shoe;
    if (side) poly(ctx, [[heel, L.an.y - 1 * u], [L.an.x + 2 * u * f, L.an.y - 1.2 * u], [toe, fy - 1.8 * u], [toe + 0.5 * u * f, fy], [heel, fy]], sh2);
    else poly(ctx, [[L.an.x - 2.6 * u, L.an.y - 1 * u], [L.an.x + 2.6 * u, L.an.y - 1 * u], [L.an.x + 2.9 * u, fy], [L.an.x - 2.9 * u, fy]], sh2);
    const x0 = side ? Math.min(heel, toe) : L.an.x - 2.9 * u, w0 = side ? Math.abs(toe - heel) + 0.5 * u : 5.8 * u;
    rect(ctx, x0, fy - 1.1 * u, w0, 1.1 * u, back ? '#8e8e8e' : '#e2e2e2');
    if (!back && side) {
      limb(ctx, L.an.x + 0.4 * u * f, L.an.y - 0.6 * u, L.an.x + 2.6 * u * f, fy - 2.2 * u, 0.6 * u, 0.6 * u, shade(shoe, 0.6));
      limb(ctx, heel + 1.2 * u * f, fy - 2.2 * u, toe - 1.6 * u * f, fy - 1.6 * u, 0.9 * u, 0.9 * u, shoe === '#f4f4f4' ? k.trim : '#f4f4f4');
    }
  };
  const drawShorts = (L: typeof LA, back: boolean) => {
    const t = o.shorts;
    const ex = L.h.x + (L.kn.x - L.h.x) * t, ey = L.h.y + (L.kn.y - L.h.y) * t;
    const col = back ? shade(k.shorts, 0.82) : k.shorts;
    const w1 = (8.8 + 2.2 * t) * u * lw;
    limb(ctx, L.h.x, L.h.y - 1 * u, ex, ey, 9.6 * u * lw, w1, col);
    if (!back) {
      // side stripe, hem and a fold
      const ox = (side ? -f : (L === LA ? 1 : -1)) * w1 * 0.36;
      limb(ctx, L.h.x + ox, L.h.y, ex + ox, ey - 0.6 * u, 1.5 * u, 1.5 * u, k.trim);
      limb(ctx, ex - w1 * 0.45, ey + 0.3 * u, ex + w1 * 0.45, ey + 0.3 * u, 1 * u, 1 * u, shade(k.shorts, 0.75));
      limb(ctx, L.h.x - ox * 0.4, L.h.y + 3 * u, ex - ox * 0.3, ey - 1.5 * u, 0.7 * u, 0.7 * u, shade(k.shorts, 0.86));
    }
  };
  const drawArm = (A: typeof AA, back: boolean) => {
    const sk = back ? skinD : skin;
    const w = 4.8 * u * lw;
    const sleeve = !!b.sleeve && ((b.sleeve > 0) === !back);
    const sc = sleeve ? (back ? '#1b1b1b' : '#262626') : sk;
    limb(ctx, A.s0.x, A.s0.y, A.el.x, A.el.y, w * 1.05, w * 0.8, sc);
    // forearm: thicker near the elbow
    const mx = A.el.x + (A.ha.x - A.el.x) * 0.3, my = A.el.y + (A.ha.y - A.el.y) * 0.3;
    limb(ctx, A.el.x, A.el.y, mx, my, w * 0.8, w * 0.88, sc);
    limb(ctx, mx, my, A.ha.x, A.ha.y, w * 0.88, w * 0.6, sc);
    if (!back && !sleeve) {
      // bicep highlight and forearm shadow
      const nx2 = -(A.el.y - A.s0.y), ny2 = A.el.x - A.s0.x, nl = Math.hypot(nx2, ny2) || 1;
      const ox = nx2 / nl * w * 0.25, oy = ny2 / nl * w * 0.25;
      limb(ctx, A.s0.x + ox, A.s0.y + oy + 1.5 * u, A.el.x + ox, A.el.y + oy, 0.9 * u, 0.7 * u, skinL);
      limb(ctx, mx - ox, my - oy, A.ha.x - ox, A.ha.y - oy, 0.9 * u, 0.6 * u, skinD);
    }
    if (b.wrist) { const wx = A.el.x + (A.ha.x - A.el.x) * 0.8, wy = A.el.y + (A.ha.y - A.el.y) * 0.8; limb(ctx, wx, wy, A.ha.x - (A.ha.x - A.el.x) * 0.1, A.ha.y - (A.ha.y - A.el.y) * 0.1, w * 0.86, w * 0.86, k.trim); }
    // hand with fingers toward the end of the forearm
    const hx2 = A.ha.x + (A.ha.x - A.el.x) / Lf * 1.4 * u, hy2 = A.ha.y + (A.ha.y - A.el.y) / Lf * 1.4 * u;
    limb(ctx, A.ha.x, A.ha.y, hx2, hy2, 3.4 * u, 2.6 * u, back ? skinD : skin);
    oval(ctx, A.ha.x, A.ha.y, 2.3 * u, 2.4 * u, back ? skinD : skinL);
  };
  const drawTorso = () => {
    const s1 = shoulder(1), s2 = shoulder(-1);
    const lit = side ? (f > 0 ? s2 : s1) : (s1.x < s2.x ? s1 : s2);
    oval(ctx, s1.x, s1.y + 1 * u, 3.8 * u * lw, 3.6 * u, s1 === lit ? skinL : skinD);
    oval(ctx, s2.x, s2.y + 1 * u, 3.8 * u * lw, 3.6 * u, s2 === lit ? skinL : skinD);
    const wl = { x: hipC.x - hipW / 2, y: hipC.y - 1 * u }, wr = { x: hipC.x + hipW / 2, y: hipC.y - 1 * u };
    const tl = { x: sh.x - shW / 2 + 3 * u, y: sh.y - 0.5 * u }, tr = { x: sh.x + shW / 2 - 3 * u, y: sh.y - 0.5 * u };
    const al = { x: sh.x - shW / 2 + 1.2 * u, y: sh.y + 7.5 * u }, ar = { x: sh.x + shW / 2 - 1.2 * u, y: sh.y + 7.5 * u };
    poly(ctx, [[tl.x, tl.y], [tr.x, tr.y], [ar.x, ar.y], [wr.x + 0.6 * u, wr.y + 1.5 * u], [wl.x - 0.6 * u, wl.y + 1.5 * u], [al.x, al.y]], k.jersey);
    // light from the upper left: shade the right side, highlight the left, folds at the waist
    const dark = shade(k.jersey, 0.8), light = shade(k.jersey, 1.08);
    poly(ctx, [[tr.x - 1.2 * u, tr.y + 1], [ar.x, ar.y], [wr.x + 0.6 * u, wr.y + 1.5 * u], [wr.x - 2.6 * u, wr.y + 1.5 * u], [ar.x - 3.2 * u, ar.y + 2 * u], [tr.x - 2.6 * u, tr.y + 1]], dark);
    limb(ctx, al.x + 2 * u, al.y + 1 * u, wl.x + 2 * u, wl.y - 2 * u, 1.2 * u, 1.2 * u, light);
    for (const t of [0.35, 0.62]) limb(ctx, wl.x + hipW * t, wl.y - 6 * u, wl.x + hipW * t + 0.8 * u, wl.y + 0.5 * u, 0.6 * u, 0.6 * u, dark);
    // armholes, collar
    limb(ctx, tl.x, tl.y, al.x, al.y, 1.4 * u, 1.4 * u, k.trim);
    limb(ctx, tr.x, tr.y, ar.x, ar.y, 1.4 * u, 1.4 * u, k.trim);
    const nx = sh.x + (side ? 0.8 * u * f : 0);
    if (view !== 'back') {
      oval(ctx, nx, sh.y + 0.5 * u, 2.8 * u, 3.4 * u, skinD, -1e9, sh.y + 3.8 * u);
      limb(ctx, nx - 3.4 * u, sh.y - 0.3 * u, nx, sh.y + 4.8 * u, 1.4 * u, 1.4 * u, k.trim);
      limb(ctx, nx + 3.4 * u, sh.y - 0.3 * u, nx, sh.y + 4.8 * u, 1.4 * u, 1.4 * u, k.trim);
    } else limb(ctx, nx - 3.6 * u, sh.y, nx + 3.6 * u, sh.y, 1.4 * u, 1.4 * u, k.trim);
    // waistband
    limb(ctx, wl.x - 0.6 * u, wl.y + 1.4 * u, wr.x + 0.6 * u, wr.y + 1.4 * u, 2.6 * u, 2.6 * u, k.shorts);
    limb(ctx, wl.x - 0.6 * u, wl.y + 0.4 * u, wr.x + 0.6 * u, wr.y + 0.4 * u, 0.7 * u, 0.7 * u, k.trim);
    // number (and the name on the back)
    if (o.num !== false && pose !== 'sit') {
      const big = view === 'back';
      const ty = sh.y + (big ? 15 : 13) * u + Math.sin(lean) * 2 * u;
      const tx = sh.x + (side ? 1.5 * u * f : 0);
      const fs = Math.max(8, R((big ? 12 : 9.5) * u));
      ctx.font = `${fs}px ${o.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = k.trim2; ctx.fillText(String(b.num), R(tx + Math.max(1, u * 0.7)), R(ty + Math.max(1, u * 0.7)));
      ctx.fillStyle = k.trim; ctx.fillText(String(b.num), R(tx), R(ty));
      if (big && o.name) { ctx.font = `${Math.max(6, R(3.6 * u))}px ${o.font}`; ctx.fillStyle = k.trim; ctx.fillText(o.name, R(tx), R(sh.y + 6.2 * u)); }
    }
  };

  // ---- draw back to front
  if (side) {
    drawArm(AB, true);
    drawLeg(LB, true);
    drawShorts(LB, true);
    drawLeg(LA, false);
    drawTorso();
    drawShorts(LA, false);
  } else {
    drawLeg(LB, false); drawLeg(LA, false);
    drawShorts(LB, false); drawShorts(LA, false);
    drawTorso();
  }
  // neck and head
  limb(ctx, sh.x + (side ? 0.5 * u * f : 0), sh.y + 1 * u, head.x, head.y + 5 * u, 4.8 * u, 4.4 * u, skinD);
  if (view !== 'back') limb(ctx, sh.x + (side ? 1.4 * u * f : 0), sh.y, head.x + (side ? 1.4 * u * f : 0), head.y + 5 * u, 1.1 * u, 1.1 * u, skinDD);
  drawHead(ctx, head.x, head.y, u, f, b, skin, skinD, skinL, k, view);
  if (side) drawArm(AA, false); else { drawArm(AB, false); drawArm(AA, false); }
  return { front: AA.ha, back: AB.ha, head: { x: head.x, y: head.y - 8 * u } };
}

function drawHead(ctx: Ctx, cx: number, cy: number, u: number, f: number, b: Body, skin: string, skinD: string, skinL: string, k: Kit, view: 'side' | 'front' | 'back') {
  const rx = 6.1 * u, ry = 7.3 * u;
  const hc = b.hairColor, hcL = shade(hc, 1.4), hcD = shade(hc, 0.7);
  const style = b.hair;
  const side = view === 'side', back = view === 'back';
  const fx = side ? f : 0; // horizontal direction of the face
  // hair mass behind the head
  if (style === 'afro' || style === 'fro') oval(ctx, cx - 0.8 * u * fx, cy - 2.2 * u, rx + 2.8 * u, ry + 1.6 * u, hc);
  if (style === 'dreads') for (let i = 0; i < 6; i++) { const sxx = side ? -f * (1.5 + i * 0.9) : (i - 2.5) * 2.1; limb(ctx, cx + sxx * u, cy - 3 * u, cx + sxx * 1.15 * u, cy + (5 + (i % 3) * 1.8) * u, 1.9 * u, 1.5 * u, i % 2 ? hcL : hc); }
  // head and jaw
  oval(ctx, cx, cy, rx, ry, skin);
  if (side) oval(ctx, cx, cy, rx, ry, shade(skin, 0.88), -1e9, 1e9, f > 0 ? -1e9 : cx + rx * 0.45, f > 0 ? cx - rx * 0.45 : 1e9);
  else oval(ctx, cx, cy, rx, ry, shade(skin, 0.9), -1e9, 1e9, cx + rx * 0.5);
  if (!back) oval(ctx, cx + fx * 1.2 * u, cy + 3.6 * u, rx * (side ? 0.72 : 0.8), ry * 0.42, skin, cy + 2 * u);
  // cheekbone light
  if (!back) oval(ctx, cx + (side ? f * 1.8 : -2.2) * u, cy + 0.8 * u, 1.4 * u, 1 * u, skinL);
  // ears
  if (side) { oval(ctx, cx - f * 1.6 * u, cy + 0.6 * u, 1.4 * u, 2 * u, skinD); oval(ctx, cx - f * 1.4 * u, cy + 0.6 * u, 0.6 * u, 1.1 * u, shade(skin, 0.65)); }
  else { oval(ctx, cx - rx - 0.3 * u, cy + 0.6 * u, 1.2 * u, 1.9 * u, skinD); oval(ctx, cx + rx + 0.3 * u, cy + 0.6 * u, 1.2 * u, 1.9 * u, skinD); }
  // hair
  const cap = (lift: number, line: number) => {
    if (back) { oval(ctx, cx, cy - lift, rx + 0.5 * u, ry + 0.3 * u, hc, -1e9, cy + 2.5 * u); return; }
    oval(ctx, cx, cy - lift, rx + 0.5 * u, ry + 0.3 * u, hc, -1e9, cy - line);
    if (side) oval(ctx, cx, cy - lift, rx + 0.5 * u, ry + 0.3 * u, hc, -1e9, cy + 1.5 * u, f > 0 ? -1e9 : cx + 0.8 * u, f > 0 ? cx - 0.8 * u : 1e9);
    else { oval(ctx, cx - rx + 0.6 * u, cy - 1 * u, 1.2 * u, 2.4 * u, hc); oval(ctx, cx + rx - 0.6 * u, cy - 1 * u, 1.2 * u, 2.4 * u, hc); }
  };
  const texture = () => { for (let i = 0; i < 7; i++) rect(ctx, cx + (((i * 37) % 11) - 5) * u, cy - ry + (1 + ((i * 13) % 5)) * u * 0.8, 0.8 * u, 0.6 * u, i % 2 ? hcL : hcD); };
  switch (style) {
    case 'bald': oval(ctx, cx - (fx || -0.6) * 1.2 * u, cy - 4.6 * u, 1.8 * u, 1 * u, skinL); break;
    case 'afro': case 'fro': oval(ctx, cx, cy - 1.5 * u, rx + 1.4 * u, ry, hc, -1e9, back ? cy + 3 * u : cy - 2.6 * u); texture(); break;
    case 'dreads': cap(0.6 * u, 2.6 * u); texture(); break;
    case 'cornrows': cap(0, 3.4 * u); for (let i = -2; i <= 2; i++) limb(ctx, cx + i * 1.7 * u, cy - 6.4 * u, cx + i * 2 * u - fx * 1.5 * u, cy - 1.5 * u, 0.6 * u, 0.6 * u, hcL); break;
    case 'flattop': cap(0, 3.2 * u); rect(ctx, cx - rx, cy - ry - 2.9 * u, rx * 2, 3.8 * u, hc); rect(ctx, cx - rx, cy - ry - 2.9 * u, rx * 2, 0.9 * u, hcL); break;
    case 'spiky': case 'quiff': cap(0.8 * u, 3 * u); for (let i = 0; i < 4; i++) limb(ctx, cx + (i - 1.5) * 2.2 * u, cy - ry + 0.8 * u, cx + (i - 1.2) * 2.2 * u + fx * 1.2 * u, cy - ry - 2.2 * u, 1.9 * u, 0.8 * u, i % 2 ? hcL : hc); break;
    case 'bun': cap(0, 3.2 * u); oval(ctx, cx - fx * 1.5 * u, cy - ry - 1.6 * u, 2.4 * u, 2.2 * u, hc); oval(ctx, cx - fx * 1.9 * u, cy - ry - 2.1 * u, 0.9 * u, 0.7 * u, hcL); break;
    case 'mop': case 'curly': cap(0.9 * u, 2.2 * u); for (let i = 0; i < 6; i++) oval(ctx, cx + (i - 2.5) * 2.1 * u, cy - ry + 0.4 * u + (i % 2) * 0.6 * u, 1.6 * u, 1.5 * u, i % 2 ? hcL : hc); break;
    case 'parted': cap(0.4 * u, 3 * u); limb(ctx, cx + (fx || 0.4) * 1.5 * u, cy - ry, cx + (fx || 0.4) * 0.6 * u, cy - ry + 2.6 * u, 0.6 * u, 0.6 * u, back ? hcD : skin); break;
    case 'buzz': case 'fade': cap(-0.2 * u, 3.6 * u); for (let i = 0; i < 5; i++) rect(ctx, cx + (i - 2) * 2.2 * u, cy - ry + 1.2 * u, 0.5 * u, 0.5 * u, hcL); break;
    default: cap(0.3 * u, 3.2 * u); texture();
  }
  if (b.band) limb(ctx, cx - rx - 0.3 * u, cy - 3.2 * u, cx + rx + 0.3 * u, cy - 3.2 * u, 1.9 * u, 1.9 * u, '#f4f4f4');
  if (back) return;
  // face: eyes with whites, brows, nose, lips
  const brow = shade(hc === '#9a9a9a' ? '#5a5a5a' : hc, 0.9);
  const eye = (ex: number) => {
    rect(ctx, ex - 0.9 * u, cy - 0.9 * u, 1.9 * u, 1.4 * u, '#f2ece4');
    rect(ctx, ex - 0.2 * u + (side ? f * 0.4 * u : 0), cy - 0.9 * u, 0.95 * u, 1.4 * u, '#1a1210');
    rect(ctx, ex - 1.2 * u, cy - 2.4 * u, 2.5 * u, 0.85 * u, brow);
  };
  if (side) eye(cx + f * 2.6 * u); else { eye(cx - 2.3 * u); eye(cx + 2.3 * u); }
  // nose
  if (side) { rect(ctx, cx + f * 5.2 * u - (f > 0 ? 0 : 1.2 * u), cy + 0.2 * u, 1.2 * u, 2.2 * u, skin); rect(ctx, cx + f * 4.2 * u - (f > 0 ? 0 : 1 * u), cy + 2.1 * u, 1.2 * u, 0.6 * u, skinD); }
  else { rect(ctx, cx - 0.5 * u, cy + 0.2 * u, 1 * u, 2.2 * u, skinD); rect(ctx, cx - 1.1 * u, cy + 2.2 * u, 2.2 * u, 0.6 * u, shade(skin, 0.7)); }
  const fac = b.facial;
  const mx = side ? cx + f * 2.4 * u - (f > 0 ? 0 : 2 * u) : cx - 1.4 * u, mw = side ? 2 * u : 2.8 * u;
  if (fac === 'beard') oval(ctx, cx + fx * 0.8 * u, cy + 3.4 * u, rx * 0.95, ry * 0.58, hc, cy + 1.9 * u, 1e9, side && f > 0 ? cx - rx * 0.4 : -1e9, side && f < 0 ? cx + rx * 0.4 : 1e9);
  else if (fac === 'goatee' || fac === 'chin') oval(ctx, cx + fx * 2.4 * u, cy + 5.6 * u, 1.9 * u, 1.5 * u, hc);
  else if (fac === 'stubble') oval(ctx, cx + fx * 0.8 * u, cy + 3.6 * u, rx * 0.9, ry * 0.5, shade(skin, 0.84), cy + 2.2 * u);
  if (fac === 'mustache' || fac === 'goatee' || fac === 'beard') rect(ctx, mx - 0.4 * u, cy + 2.8 * u, mw + 0.8 * u, 0.9 * u, hc);
  rect(ctx, mx, cy + 4 * u, mw, 0.7 * u, shade(skin, 0.58));
  rect(ctx, mx + 0.3 * u, cy + 4.7 * u, mw - 0.6 * u, 0.5 * u, shade(skin, 0.75));
}

/** The player with a dark pixel outline (drawn through an off-screen buffer). */
let bufA: HTMLCanvasElement | null = null, bufB: HTMLCanvasElement | null = null;
export function drawAthleteOutlined(ctx: Ctx, X: number, Y: number, o: AthOpts, line = 'rgba(14,12,18,0.85)'): Hands {
  if (typeof document === 'undefined') return drawAthlete(ctx, X, Y, o);
  const W = Math.ceil(o.H * 1.4) + 8, Hh = Math.ceil(o.H * 1.45) + 8;
  if (!bufA) { bufA = document.createElement('canvas'); bufB = document.createElement('canvas'); }
  for (const c of [bufA, bufB!]) if (c.width < W || c.height < Hh) { c.width = Math.max(c.width, W); c.height = Math.max(c.height, Hh); }
  const a = bufA.getContext('2d')!, bb = bufB!.getContext('2d')!;
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, W, Hh);
  const ox = Math.round(W / 2), oy = Hh - 4;
  const fx = X - Math.round(X), fy = Y - Math.round(Y);
  const hands = drawAthlete(a, ox + fx, oy + fy, o);
  bb.setTransform(1, 0, 0, 1, 0, 0); bb.globalCompositeOperation = 'source-over'; bb.clearRect(0, 0, W, Hh);
  bb.drawImage(bufA, 0, 0);
  bb.globalCompositeOperation = 'source-in'; bb.fillStyle = line; bb.fillRect(0, 0, W, Hh);
  bb.globalCompositeOperation = 'source-over';
  const x0 = Math.round(X) - ox, y0 = Math.round(Y) - oy;
  const t = Math.max(1, Math.round(o.H / 90));
  for (const [dx, dy] of [[-t, 0], [t, 0], [0, -t], [0, t]]) ctx.drawImage(bufB!, 0, 0, W, Hh, x0 + dx, y0 + dy, W, Hh);
  ctx.drawImage(bufA, 0, 0, W, Hh, x0, y0, W, Hh);
  const sh = (p: { x: number; y: number }) => ({ x: p.x + x0, y: p.y + y0 });
  return { front: sh(hands.front), back: sh(hands.back), head: sh(hands.head) };
}
