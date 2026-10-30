// Arena view: the camera geometry (a broadcast camera on the far side of the
// court, low and to the side, so the floor is foreshortened and the far side
// is narrower) and the static layers — hardwood, lines, paint, logos, apron,
// and the stands full of fans — pre-rendered once into off-screen canvases.
// Everything here is drawn at the pixel buffer's resolution, so the whole
// scene reads as pixel art when it is scaled up.
import { hash01 } from '../rng';

// world units: the same 320×180 "view" units as the classic court
export const AZ = 2.0;            // camera zoom
export const AXC = 160;            // screen x of mid-court
export const AFX = 3.23;           // view units per foot along the court (at the middle depth)
export const AYF = 62;             // y of the far sideline
export const AFY = 1.0;           // view units per foot of depth (foreshortened)
export const SF = 0.88, SN = 1.08; // perspective: scale at the far / near sideline
export const VZ = 2.5;             // view units per foot of height
export const LEN = 94, WID = 50;

export const depthScale = (d: number) => SF + (SN - SF) * Math.max(-12, Math.min(62, d)) / WID;
/** floor point (x along the court, d across, z up) → view units */
export function aproj(x: number, d: number, z = 0) {
  const s = depthScale(d), dc = Math.max(-12, Math.min(62, d));
  return { x: AXC + (x - 47) * AFX * s, y: AYF + AFY * (SF * dc + (SN - SF) * dc * dc / (2 * WID)) - z * VZ * s, sc: s };
}
/** depth of a floor point on screen row y (inverse of aproj for z = 0) */
export function depthAt(y: number) {
  const a = AFY * (SN - SF) / (2 * WID), b = AFY * SF, c = AYF - y;
  return a ? (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a) : -c / b;
}

export interface Layer { img: HTMLCanvasElement; x0: number; y0: number } // top-left in view units
type C2 = CanvasRenderingContext2D;

const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; return { c, x }; };
const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const shadeHex = (h: string, f: number) => { const A = hex(h); return `rgb(${A.map(v => Math.max(0, Math.min(255, Math.round(v * f)))).join(',')})`; };

/** The floor: planks, sheen, apron, paint, lines, logos. k = buffer pixels per view unit. */
export function renderCourt(k: number, o: { primary: string; secondary: string; abbr: string; name: string; season: number; font: string; emblem?: CanvasImageSource | null }): Layer {
  const x0 = -30, x1 = 350, y0 = AYF - 9, y1 = AYF + 70;
  const { c, x: g } = mk((x1 - x0) * k, (y1 - y0) * k);
  const W = c.width, H = c.height;
  const P = (vx: number, vy: number) => [(vx - x0) * k, (vy - y0) * k] as const;
  const F = (fx: number, d: number) => { const q = aproj(fx, d); return P(q.x, q.y); };
  // hardwood: planks run along the court; each board row has its own tone and staggered joints
  const tones = ['#e3b67a', '#deb075', '#e8bc80', '#dcab6f', '#e5b97d', '#d9a86c'];
  for (let py = 0; py < H; py++) {
    const vy = y0 + py / k, d = depthAt(vy);
    const row = Math.floor(d / 0.62);
    const t = tones[((row % tones.length) + tones.length) % tones.length];
    g.fillStyle = t; g.fillRect(0, py, W, 1);
    // board ends
    const s = 0.25 + hash01('r' + row) * 0.5;
    g.fillStyle = 'rgba(120,70,30,0.22)';
    for (let fx = -20 + s * 9; fx < 115; fx += 7 + hash01('j' + row + '|' + Math.floor(fx)) * 6) { const [X] = F(fx, d); g.fillRect(Math.round(X), py, 1, 1); }
  }
  // grain specks
  for (let i = 0; i < W * H / 90; i++) { const X = Math.floor(hash01('gx' + i) * W), Y = Math.floor(hash01('gy' + i) * H); g.fillStyle = hash01('gc' + i) < 0.5 ? 'rgba(150,90,40,0.18)' : 'rgba(255,240,210,0.16)'; g.fillRect(X, Y, 1, 1); }
  // the apron outside the lines: stained darker, in the team's colour near the baselines
  const apron = shadeHex(o.primary, 0.75);
  const poly = (pts: (readonly [number, number])[], col: string) => { g.fillStyle = col; g.beginPath(); pts.forEach(([X, Y], i) => (i ? g.lineTo(X, Y) : g.moveTo(X, Y))); g.closePath(); g.fill(); };
  const quad = (xa: number, xb: number, da: number, db: number, col: string) => poly([F(xa, da), F(xb, da), F(xb, db), F(xa, db)], col);
  quad(-9, 0, -4, 54, apron); quad(94, 103, -4, 54, apron);
  quad(-9, 103, -4, 0, 'rgba(60,30,10,0.28)'); quad(-9, 103, 50, 56, 'rgba(60,30,10,0.28)');
  // the three-point area slightly lighter, the paint in the team colour
  const arcPts = (bx: number, s: number) => {
    const pts: (readonly [number, number])[] = [F(bx + s * 5.25, 3), F(bx - s * 8.8, 3)];
    const a0 = Math.asin(22 / 23.75);
    for (let i = 0; i <= 40; i++) { const a = -a0 + 2 * a0 * i / 40; pts.push(F(bx - s * 23.75 * Math.cos(a), 25 + 23.75 * Math.sin(a))); }
    pts.push(F(bx - s * 8.8, 47), F(bx + s * 5.25, 47));
    return pts;
  };
  for (const [bx, s] of [[5.25, -1], [88.75, 1]] as const) {
    poly(arcPts(bx, s), 'rgba(255,236,200,0.12)');
    const base = bx + s * 5.25;
    quad(base, base - s * 19, 17, 33, o.primary);
    quad(base - s * 0.4, base - s * 18.6, 17.5, 32.5, shadeHex(o.primary, 1.12));
    quad(base - s * 1, base - s * 18, 18.2, 31.8, o.primary);
  }
  // centre logo
  const cc = F(47, 25);
  const ry = (F(47, 31)[1] - F(47, 19)[1]) / 2, rx = 6 * AFX * depthScale(25) * k;
  if (o.emblem) {
    // the team's emblem painted on the floor, lying flat (squashed by the camera angle)
    const w = rx * 2.25, h = ry * 2.25;
    g.save(); g.globalAlpha = 0.95; g.imageSmoothingEnabled = true; g.drawImage(o.emblem, cc[0] - w / 2, cc[1] - h / 2, w, h); g.restore();
  } else {
    g.fillStyle = o.primary; g.beginPath(); g.ellipse(cc[0], cc[1], rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = o.secondary; g.beginPath(); g.ellipse(cc[0], cc[1], rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = o.primary; g.beginPath(); g.ellipse(cc[0], cc[1], rx * 0.68, ry * 0.68, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(cc[0], cc[1]); g.scale(1, ry / rx * 1.6);
    g.font = `${Math.round(rx * 0.62)}px ${o.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#111'; g.fillText(o.abbr, 1, 2); g.fillStyle = '#fff'; g.fillText(o.abbr, 0, 1);
    g.restore();
  }
  // team name on the baseline aprons, written along the depth
  for (const [fx, rot] of [[-4.6, -Math.PI / 2], [98.6, Math.PI / 2]] as const) {
    const a = F(fx, 25);
    g.save(); g.translate(a[0], a[1]); g.scale(1, 0.42); g.rotate(rot);
    g.font = `${Math.round(5.2 * k)}px ${o.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(o.name.toUpperCase(), 1, 1); g.fillStyle = shadeHex(o.secondary, 1); g.fillText(o.name.toUpperCase(), 0, 0);
    g.restore();
  }
  // lines: one buffer pixel, plotted point by point so they stay crisp
  const W1 = Math.max(1, Math.round(k * 0.38));
  const dot = (X: number, Y: number) => g.fillRect(Math.round(X - W1 / 2), Math.round(Y - W1 / 2), W1, W1);
  const curve = (f: (u: number) => [number, number], col = '#fbf7ee', dash = 0) => {
    g.fillStyle = col;
    const n = 600;
    for (let i = 0; i <= n; i++) { if (dash && Math.floor(i / dash) % 2) continue; const [fx, d] = f(i / n); const [X, Y] = F(fx, d); dot(X, Y); }
  };
  curve(u => [u * LEN, 0]); curve(u => [u * LEN, WID]); curve(u => [0, u * WID]); curve(u => [LEN, u * WID]);
  curve(u => [47, u * WID]);
  curve(u => [47 + 6 * Math.cos(u * 6.283), 25 + 6 * Math.sin(u * 6.283)]);
  curve(u => [47 + 2 * Math.cos(u * 6.283), 25 + 2 * Math.sin(u * 6.283)]);
  for (const [bx, s] of [[5.25, -1], [88.75, 1]] as const) {
    const base = bx + s * 5.25;
    curve(u => [base - s * 19 * u, 17]); curve(u => [base - s * 19 * u, 33]); curve(u => [base - s * 19, 17 + 16 * u]);
    curve(u => [base - s * 19 - s * 6 * Math.cos(u * Math.PI - Math.PI / 2), 25 + 6 * Math.sin(u * Math.PI - Math.PI / 2)]);
    curve(u => [base - s * 19 + s * 6 * Math.cos(u * Math.PI - Math.PI / 2), 25 + 6 * Math.sin(u * Math.PI - Math.PI / 2)], '#fbf7ee', 18);
    if (o.season >= 1980) {
      const a0 = Math.asin(22 / 23.75);
      curve(u => [base - s * 14 * u, 3]); curve(u => [base - s * 14 * u, 47]);
      curve(u => { const a = -a0 + 2 * a0 * u; return [bx - s * 23.75 * Math.cos(a), 25 + 23.75 * Math.sin(a)]; });
    }
    if (o.season >= 1998) curve(u => [bx - s * 4 * Math.cos(u * Math.PI - Math.PI / 2), 25 + 4 * Math.sin(u * Math.PI - Math.PI / 2)]); // restricted area
    // lane hash marks
    for (const t of [7, 8, 11, 14]) for (const dd of [17, 33]) curve(u => [base - s * t, dd + (dd < 25 ? -0.7 : 0.7) * u]);
    // coaching box / substitution marks on the sidelines
    curve(u => [bx - s * 23 + s * 0 * u, -0.8 * u]); curve(u => [bx - s * 23, WID + 0.8 * u]);
  }
  // arena lights: soft reflections on the varnish
  for (const fx of [24, 47, 70]) {
    const [X, Y] = F(fx, 22);
    const gr = g.createRadialGradient(X, Y, 0, X, Y, 22 * k);
    gr.addColorStop(0, 'rgba(255,250,235,0.22)'); gr.addColorStop(1, 'rgba(255,250,235,0)');
    g.save(); g.translate(X, Y); g.scale(1.9, 0.55); g.translate(-X, -Y); g.fillStyle = gr; g.fillRect(X - 30 * k, Y - 30 * k, 60 * k, 60 * k); g.restore();
  }
  // a little darker toward the near edge (out of the light)
  const vg = g.createLinearGradient(0, 0, 0, H); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(30,15,5,0.16)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return { img: c, x0, y0 };
}

const FAN_SHIRTS = ['#d94f4f', '#e8c547', '#4f86d9', '#e6e6e6', '#58b368', '#b05fd1', '#f08a3c', '#7a7a7a', '#2f2f2f', '#1e2a44', '#9c2b2b'];
const FAN_SKIN = ['#5b3a29', '#7a4b33', '#9c6644', '#c68863', '#e0ac85', '#f1c9a5'];
const FAN_HAIR = ['#1b1410', '#3b2414', '#6b4a2b', '#c9a35b', '#8a8a8a', '#1b1410'];

/** The stands behind the far sideline: ad boards, courtside seats, rows of fans. Two frames: seated and cheering. */
export function renderStands(k: number, o: { primary: string; secondary: string; font: string; label: string }): Layer & { cheer: HTMLCanvasElement } {
  const x0 = -30, x1 = 350, y0 = -10, y1 = AYF - 3;
  const out: HTMLCanvasElement[] = [];
  for (const cheer of [false, true]) {
    const { c, x: g } = mk((x1 - x0) * k, (y1 - y0) * k);
    const W = c.width, H = c.height;
    const V = (vy: number) => (vy - y0) * k;
    // the bowl: dark, lit from below
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#07090f'); bg.addColorStop(0.75, '#141a29'); bg.addColorStop(1, '#1b2233');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // rows of fans, smaller and darker toward the top
    const rows = 14;
    for (let r = 0; r < rows; r++) {
      const vy = AYF - 15 - r * 3.1;
      const sc = 0.72 - r * 0.022, dim = 0.62 - r * 0.03; // the crowd sits in the dark: the floor is where the light is
      const Y = V(vy);
      // seat row / riser
      g.fillStyle = shadeHex('#2a3244', dim); g.fillRect(0, Math.round(Y), W, Math.max(1, Math.round(1.1 * k)));
      g.fillStyle = shadeHex('#1a2030', dim); g.fillRect(0, Math.round(Y + 1.1 * k), W, Math.max(1, Math.round(0.6 * k)));
      const step = 3.2 * sc;
      for (let vx = x0 + (r % 2) * step / 2; vx < x1; vx += step) {
        const id = `${r}|${Math.round(vx * 10)}`;
        const h = hash01(id);
        if (h < 0.1) continue; // empty seat
        const X = (vx - x0) * k + (hash01(id + 'j') - 0.5) * k;
        const home = hash01(id + 't') < 0.45;
        const shirt = shadeHex(home ? (hash01(id + 'c') < 0.6 ? o.primary : o.secondary) : FAN_SHIRTS[Math.floor(hash01(id + 's') * FAN_SHIRTS.length)], dim * 0.95);
        const skin = shadeHex(FAN_SKIN[Math.floor(hash01(id + 'k') * FAN_SKIN.length)], dim * 0.95);
        const hair = FAN_HAIR[Math.floor(hash01(id + 'h') * FAN_HAIR.length)];
        const up = cheer && hash01(id + 'u') < 0.7;
        const bw = Math.round(2.3 * k * sc), bh = Math.round(2.4 * k * sc), hw = Math.round(1.5 * k * sc);
        const by = Math.round(Y - bh - (up ? 0.6 * k : 0));
        g.fillStyle = shirt; g.fillRect(Math.round(X - bw / 2), by, bw, bh);
        g.fillStyle = skin; g.fillRect(Math.round(X - hw / 2), by - hw, hw, hw);
        g.fillStyle = shadeHex(hair, dim); g.fillRect(Math.round(X - hw / 2), by - hw, hw, Math.max(1, Math.round(hw * 0.35)));
        if (up) { g.fillStyle = skin; g.fillRect(Math.round(X - bw / 2 - 1), by - hw - Math.round(0.9 * k), Math.max(1, Math.round(0.5 * k)), Math.round(1.6 * k)); g.fillRect(Math.round(X + bw / 2), by - hw - Math.round(0.9 * k), Math.max(1, Math.round(0.5 * k)), Math.round(1.6 * k)); }
      }
    }
    // aisles and portals
    for (const vx of [20, 100, 220, 300]) { g.fillStyle = 'rgba(8,10,16,0.75)'; g.fillRect(Math.round((vx - x0) * k), V(AYF - 52), Math.round(2.4 * k), V(AYF - 14) - V(AYF - 52)); }
    // glass railing above the floor seats
    g.fillStyle = 'rgba(160,200,255,0.10)'; g.fillRect(0, V(AYF - 15), W, Math.round(1.2 * k));
    // LED ad boards along the floor
    const ly = V(AYF - 13), lh = Math.round(4.2 * k);
    g.fillStyle = '#05070c'; g.fillRect(0, ly, W, lh);
    const panels = [[o.primary, o.label], ['#0d1b3d', 'NBA HISTORY'], [o.secondary, o.label], ['#101010', 'SIMULATOR']];
    let pi = 0;
    for (let vx = x0; vx < x1; vx += 46, pi++) {
      const [col, txt] = panels[pi % panels.length];
      const X = Math.round((vx - x0) * k);
      g.fillStyle = col; g.fillRect(X + 1, ly + 1, Math.round(45 * k) - 2, lh - 2);
      g.font = `${Math.round(2.6 * k)}px ${o.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffffff'; g.fillText(txt, X + 22.5 * k, ly + lh / 2 + 1);
    }
    // LED pixels
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let X = 0; X < W; X += 2) g.fillRect(X, ly, 1, lh);
    // the floor-level strip between the boards and the court
    g.fillStyle = '#20180f'; g.fillRect(0, ly + lh, W, H - ly - lh);
    out.push(c);
  }
  return { img: out[0], cheer: out[1], x0, y0 };
}
