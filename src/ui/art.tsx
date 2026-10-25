// @ts-nocheck
// Original team emblems and generated player faces (simple SVG, no real marks).
// Emblems: team colours, a shape and the abbreviation. Faces: drawn from a
// stable hash of the player, with hairstyles and facial hair typical of the
// era he entered the league; face length follows his height.
import { memo } from 'react';
import { hash01 } from '../rng';
import { teamColor } from './pixel';

// colours of historical abbreviations whose franchise later changed identity
const ERA_COLORS: Record<string, [string, string]> = {
  SEA: ['#00653a', '#ffc200'], NJN: ['#002a60', '#cd1041'], VAN: ['#00b2a9', '#e43c40'], KCK: ['#0b3d91', '#e03a3e'],
  SDC: ['#1d428a', '#e03a3e'], WSB: ['#002b5c', '#e31837'], CHH: ['#00778b', '#3f2a73'], NOH: ['#0c2340', '#b4975a'],
  NOK: ['#0c2340', '#b4975a'], CHA: ['#f26532', '#1d8cab'], NOJ: ['#4b2f87', '#00a19b'], BUF: ['#002b5c', '#e31837'],
};
export const colorsOf = (tid: string, abbr?: string): [string, string] => (abbr && ERA_COLORS[abbr]) || teamColor(tid);

const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

/** Original emblem: one of four shapes in the team colours with the abbreviation. */
export const Logo = memo(function Logo({ t, size = 18 }: { t: { tid: string; abbr: string }; size?: number }) {
  if (!t) return null;
  const [a, b] = colorsOf(t.tid, t.abbr);
  const shape = Math.floor(hash01(t.tid + 'shape') * 4);
  const text = lum(a) > 0.6 ? '#111' : lum(b) > 0.45 ? b : '#fff';
  const paths = [
    <circle key="s" cx="20" cy="20" r="18" />,
    <path key="s" d="M20 2 L36 8 V20 C36 30 28 36 20 39 C12 36 4 30 4 20 V8 Z" />,
    <path key="s" d="M20 2 L36 11 V29 L20 38 L4 29 V11 Z" />,
    <rect key="s" x="3" y="3" width="34" height="34" rx="9" />,
  ];
  const inner = [
    <circle key="i" cx="20" cy="20" r="14.5" />,
    <path key="i" d="M20 6 L32.5 10.5 V20 C32.5 28 26.5 32.5 20 35 C13.5 32.5 7.5 28 7.5 20 V10.5 Z" />,
    <path key="i" d="M20 6 L32.5 13 V27 L20 34 L7.5 27 V13 Z" />,
    <rect key="i" x="6.5" y="6.5" width="27" height="27" rx="6.5" />,
  ];
  const fs = t.abbr.length > 3 ? 9 : 11;
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <g fill={a} stroke={b} strokeWidth="2.5">{paths[shape]}</g>
      <g fill="none" stroke={b} strokeOpacity="0.55" strokeWidth="1">{inner[shape]}</g>
      <path d="M8 21 Q20 15 32 21" fill="none" stroke={b} strokeOpacity="0.35" strokeWidth="1" />
      <text x="20" y="24.5" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize={fs} fill={text} letterSpacing="-0.3">{t.abbr}</text>
    </svg>
  );
});

// ---------------------------------------------------------------- faces
export const SKINS = ['#f3d2b3', '#e8b98f', '#d19a6f', '#b07850', '#8d5a3a', '#6e4329', '#553222', '#3f2418'];
const pick = <T,>(arr: T[], r: number) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
function weighted<T>(opts: [T, number][], r: number): T {
  const tot = opts.reduce((s, o) => s + o[1], 0);
  let x = r * tot;
  for (const [v, w] of opts) { if ((x -= w) < 0) return v; }
  return opts[opts.length - 1][0];
}

export interface FaceSpec {
  skin: string; dark: boolean; headW: number; headH: number; jaw: number;
  hair: string; hairColor: string; facial: string; brow: number; eyeGap: number; eyeSize: number;
  nose: number; mouth: number; ears: number; band: boolean; grey: boolean;
}

/** A stable face for a player (same every time), shaped by era, height and age. */
export function faceOf(p: { id: string; entered: number; ht: number; born?: number }, season: number): FaceSpec {
  const o = (p as any).face ?? {};
  const h = (k: string) => hash01(p.id + 'f' + (o.seed ?? '') + k);
  const era = p.entered;
  const s = Math.floor(h('skin') * 1000) / 1000;
  const lightShare = era < 1990 ? 0.3 : era < 2005 ? 0.24 : 0.28;
  const skinIdx = s < lightShare ? Math.floor((s / lightShare) * 3) : 2 + Math.floor(((s - lightShare) / (1 - lightShare)) * 6);
  const si = o.skin ?? Math.max(0, Math.min(SKINS.length - 1, skinIdx));
  const skin = SKINS[si];
  const dark = si >= 3;
  const age = season - (p.born ?? era - 21);
  const hairOpts: [string, number][] = era < 1986
    ? [['afro', dark ? 5 : 0.5], ['short', 4], ['curly', 2], ['parted', dark ? 0.5 : 4], ['mop', dark ? 0 : 2], ['bald', 0.4]]
    : era < 1996
      ? [['flattop', dark ? 3 : 0.3], ['short', 4], ['fade', dark ? 3 : 1], ['parted', dark ? 0.3 : 3], ['bald', 1.5], ['curly', 1]]
      : era < 2008
        ? [['bald', 3.5], ['buzz', 4], ['cornrows', dark ? 2 : 0], ['short', 3], ['spiky', dark ? 0.3 : 2], ['fro', dark ? 1 : 0]]
        : [['buzz', 3], ['fade', 3], ['dreads', dark ? 2 : 0.3], ['bun', dark ? 0.5 : 1.5], ['fro', dark ? 1.5 : 0], ['bald', 1.5], ['quiff', dark ? 0.5 : 3], ['short', 2]];
  let hair = weighted(hairOpts, h('hair'));
  const grey = age >= 34 && h('grey') < 0.5;
  if (age >= 33 && hair !== 'bald' && h('recede') < 0.25) hair = 'bald';
  if (o.hair) hair = o.hair;
  const hairColor = dark ? '#16110d' : pick(['#1b1410', '#3b2414', '#5a3a22', '#8a6a3a', '#c9a35b', '#7a3b1e'], h('hc'));
  const facialOpts: [string, number][] = era < 1990
    ? [['none', 5], ['mustache', 3], ['stubble', 0.5]]
    : era < 2005
      ? [['none', 5], ['goatee', 3], ['stubble', 1.5], ['mustache', 0.6], ['chin', 1]]
      : [['none', 3], ['beard', 4], ['stubble', 2.5], ['goatee', 1.5], ['chin', 1]];
  const facial = o.facial ?? (age < 21 && h('young') < 0.6 ? 'none' : weighted(facialOpts, h('facial')));
  const tall = Math.max(-1, Math.min(1, (p.ht - 79) / 6)); // centres and guards
  return {
    skin, dark, grey,
    headW: 25 + 4 * h('hw') - tall * 1.2,
    headH: 31 + 3 * h('hh') + tall * 1.5,
    jaw: 0.2 + 0.6 * h('jaw'),
    hair, hairColor: grey ? '#9a9a9a' : hairColor, facial,
    brow: h('brow'), eyeGap: 9 + 3 * h('eg'), eyeSize: 1.7 + 0.9 * h('es'),
    nose: h('nose'), mouth: h('mouth'), ears: h('ears'),
    band: o.band ?? (era >= 1998 && h('band') < 0.12),
  };
}

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

/** Generated portrait in the player's team colours. */
export const Face = memo(function Face({ p, season, tid, abbr, size = 28 }: any) {
  if (!p) return null;
  const f = faceOf(p, season);
  const [ja, jb] = tid ? colorsOf(tid, abbr) : ['#7a7f87', '#c9cdd3'];
  const cx = 32, top = 14, W = f.headW, H = f.headH, bottom = top + H;
  const eyeY = top + H * 0.5, ex = f.eyeGap / 2;
  const jawW = W * (0.55 + 0.25 * f.jaw);
  const head = `M${cx - W / 2} ${top + H * 0.42} C${cx - W / 2} ${top - 1}, ${cx + W / 2} ${top - 1}, ${cx + W / 2} ${top + H * 0.42} C${cx + W / 2} ${top + H * 0.78}, ${cx + jawW / 2} ${bottom}, ${cx} ${bottom} C${cx - jawW / 2} ${bottom}, ${cx - W / 2} ${top + H * 0.78}, ${cx - W / 2} ${top + H * 0.42} Z`;
  const hc = f.hairColor, skinD = shade(f.skin, 0.82);
  const hairTop = top + 1;
  const cap = (extra = 0, low = 0.3) => `M${cx - W / 2 - extra} ${top + H * low} C${cx - W / 2 - extra} ${hairTop - 6 - extra * 2}, ${cx + W / 2 + extra} ${hairTop - 6 - extra * 2}, ${cx + W / 2 + extra} ${top + H * low} C${cx + W / 4} ${top + H * 0.14}, ${cx - W / 4} ${top + H * 0.14}, ${cx - W / 2 - extra} ${top + H * low} Z`;
  const hairEl = () => {
    switch (f.hair) {
      case 'bald': return <ellipse cx={cx - 4} cy={top + 5} rx="4" ry="1.6" fill="#fff" opacity="0.18" />;
      case 'afro': return <ellipse cx={cx} cy={top + H * 0.2} rx={W / 2 + 6} ry={H * 0.42} fill={hc} />;
      case 'fro': return <ellipse cx={cx} cy={top + H * 0.17} rx={W / 2 + 3.5} ry={H * 0.33} fill={hc} />;
      case 'flattop': return <path d={`M${cx - W / 2} ${top + H * 0.32} L${cx - W / 2 + 1} ${top - 7} L${cx + W / 2 - 1} ${top - 7} L${cx + W / 2} ${top + H * 0.32} C${cx + W / 4} ${top + H * 0.16}, ${cx - W / 4} ${top + H * 0.16}, ${cx - W / 2} ${top + H * 0.32} Z`} fill={hc} />;
      case 'curly': return <g fill={hc}><path d={cap(1.5)} />{[-10, -5, 0, 5, 10].map(d => <circle key={d} cx={cx + d} cy={top - 1 + Math.abs(d) * 0.15} r="3.4" />)}</g>;
      case 'mop': return <path d={`M${cx - W / 2 - 1.5} ${top + H * 0.45} C${cx - W / 2 - 3} ${top - 8}, ${cx + W / 2 + 3} ${top - 8}, ${cx + W / 2 + 1.5} ${top + H * 0.45} L${cx + W / 2 - 2} ${top + H * 0.3} C${cx + 4} ${top + H * 0.26}, ${cx - 6} ${top + H * 0.3}, ${cx - W / 2 + 2} ${top + H * 0.33} Z`} fill={hc} />;
      case 'parted': return <g fill={hc}><path d={cap(1, 0.33)} /><path d={`M${cx - 3} ${top - 3} L${cx - 1} ${top + 2}`} stroke={shade(hc, 1.6)} strokeWidth="0.8" /></g>;
      case 'spiky': return <g fill={hc}><path d={cap(0.5)} />{[-9, -3, 3, 9].map(d => <path key={d} d={`M${cx + d - 3} ${top - 2} L${cx + d} ${top - 8} L${cx + d + 3} ${top - 2} Z`} />)}</g>;
      case 'quiff': return <g fill={hc}><path d={cap(0.5)} /><path d={`M${cx - 8} ${top - 2} C${cx - 6} ${top - 11}, ${cx + 10} ${top - 10}, ${cx + 9} ${top - 1} Z`} /></g>;
      case 'bun': return <g fill={hc}><path d={cap(0.5)} /><circle cx={cx} cy={top - 7} r="4.5" /></g>;
      case 'cornrows': return <g><path d={cap(0.3)} fill={hc} />{[-8, -4, 0, 4, 8].map(d => <path key={d} d={`M${cx + d * 0.6} ${top - 3} L${cx + d} ${top + H * 0.26}`} stroke={shade(f.skin, 0.9)} strokeWidth="0.6" />)}</g>;
      case 'dreads': return <g fill={hc}><path d={cap(1)} />{[-1, 1].map(sd => [0, 1, 2].map(i => <rect key={sd + '' + i} x={cx + sd * (W / 2 + 0.5) - 1.6 - (sd < 0 ? 1.6 * i : -1.6 * i) * 0.6} y={top + H * 0.2 + i} width="3" height={H * 0.55 - i * 2} rx="1.5" />))}</g>;
      case 'buzz': return <path d={cap(0, 0.28)} fill={hc} opacity="0.75" />;
      case 'fade': return <g><path d={cap(0, 0.3)} fill={hc} opacity="0.55" /><path d={`M${cx - W / 2 + 2} ${top + 2} C${cx - W / 4} ${top - 6}, ${cx + W / 4} ${top - 6}, ${cx + W / 2 - 2} ${top + 2} C${cx + W / 4} ${top + 3}, ${cx - W / 4} ${top + 3}, ${cx - W / 2 + 2} ${top + 2} Z`} fill={hc} /></g>;
      default: return <path d={cap(0.6)} fill={hc} />;
    }
  };
  const browY = eyeY - 4.5 - f.brow;
  const nw = 2.5 + 2 * f.nose;
  const mouthY = top + H * 0.79;
  const mw = 4 + 2.5 * f.mouth;
  const facialEl = () => {
    const fc = f.grey ? '#8d8d8d' : f.dark ? '#120d0a' : hc;
    switch (f.facial) {
      case 'mustache': return <path d={`M${cx - mw - 1} ${mouthY - 1} Q${cx} ${mouthY - 5} ${cx + mw + 1} ${mouthY - 1} Q${cx} ${mouthY - 2.5} ${cx - mw - 1} ${mouthY - 1} Z`} fill={fc} />;
      case 'goatee': return <g fill={fc}><path d={`M${cx - mw} ${mouthY - 1.2} Q${cx} ${mouthY - 4} ${cx + mw} ${mouthY - 1.2} Q${cx} ${mouthY - 2.4} ${cx - mw} ${mouthY - 1.2} Z`} /><path d={`M${cx - 3.5} ${mouthY + 2} Q${cx} ${bottom + 1.5} ${cx + 3.5} ${mouthY + 2} Q${cx} ${mouthY + 3.5} ${cx - 3.5} ${mouthY + 2} Z`} /></g>;
      case 'chin': return <path d={`M${cx - 3} ${mouthY + 2.5} Q${cx} ${bottom + 1} ${cx + 3} ${mouthY + 2.5} Z`} fill={fc} />;
      case 'beard': return <path d={`M${cx - W / 2 + 0.5} ${top + H * 0.55} C${cx - W / 2 + 1} ${top + H * 0.85}, ${cx - jawW / 2} ${bottom + 2.5}, ${cx} ${bottom + 2.5} C${cx + jawW / 2} ${bottom + 2.5}, ${cx + W / 2 - 1} ${top + H * 0.85}, ${cx + W / 2 - 0.5} ${top + H * 0.55} L${cx + W / 2 - 3} ${top + H * 0.62} C${cx + 6} ${mouthY - 5}, ${cx - 6} ${mouthY - 5}, ${cx - W / 2 + 3} ${top + H * 0.62} Z`} fill={fc} opacity="0.92" />;
      case 'stubble': return <path d={`M${cx - W / 2 + 1.5} ${top + H * 0.6} C${cx - W / 2 + 2} ${top + H * 0.88}, ${cx - jawW / 2} ${bottom}, ${cx} ${bottom} C${cx + jawW / 2} ${bottom}, ${cx + W / 2 - 2} ${top + H * 0.88}, ${cx + W / 2 - 1.5} ${top + H * 0.6} C${cx + 6} ${mouthY - 4}, ${cx - 6} ${mouthY - 4}, ${cx - W / 2 + 1.5} ${top + H * 0.6} Z`} fill={fc} opacity="0.25" />;
      default: return null;
    }
  };
  const back = f.hair === 'afro' || f.hair === 'fro' || f.hair === 'dreads';
  return (
    <svg className="face" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs><clipPath id="fclip"><circle cx="32" cy="32" r="32" /></clipPath></defs>
      <g clipPath="url(#fclip)">
        <rect width="64" height="64" fill="var(--sunk)" />
        {/* shoulders and jersey */}
        <path d={`M2 64 C4 52, 18 ${bottom + 3}, 32 ${bottom + 3} C46 ${bottom + 3}, 60 52, 62 64 Z`} fill={ja} />
        <path d={`M${cx - 7} ${bottom - 1} L${cx + 7} ${bottom - 1} L${cx + 7} ${bottom + 4} L${cx - 7} ${bottom + 4} Z`} fill={skinD} />
        <path d={`M${cx - 9} ${bottom + 2.5} Q${cx} ${bottom + 11} ${cx + 9} ${bottom + 2.5}`} fill="none" stroke={jb} strokeWidth="2.2" />
        {back && <g>{hairEl()}</g>}
        {/* ears */}
        <ellipse cx={cx - W / 2} cy={eyeY + 1} rx={2 + f.ears} ry="3.6" fill={skinD} />
        <ellipse cx={cx + W / 2} cy={eyeY + 1} rx={2 + f.ears} ry="3.6" fill={skinD} />
        <path d={head} fill={f.skin} />
        {facialEl()}
        {!back && hairEl()}
        {f.band && <rect x={cx - W / 2 - 0.5} y={top + H * 0.2} width={W + 1} height="3.6" rx="1" fill={jb} />}
        {/* brows, eyes, nose, mouth */}
        <g stroke={f.grey ? '#777' : f.dark ? '#0d0907' : shade(hc, 0.8)} strokeWidth={1.3 + f.brow * 0.6} strokeLinecap="round" fill="none">
          <path d={`M${cx - ex - 3} ${browY + 0.6} L${cx - ex + 2.5} ${browY - 0.2 * f.brow}`} />
          <path d={`M${cx + ex - 2.5} ${browY - 0.2 * f.brow} L${cx + ex + 3} ${browY + 0.6}`} />
        </g>
        <ellipse cx={cx - ex} cy={eyeY} rx={f.eyeSize} ry={f.eyeSize * 0.75} fill="#fff" />
        <ellipse cx={cx + ex} cy={eyeY} rx={f.eyeSize} ry={f.eyeSize * 0.75} fill="#fff" />
        <circle cx={cx - ex} cy={eyeY} r={f.eyeSize * 0.55} fill="#2a1d14" />
        <circle cx={cx + ex} cy={eyeY} r={f.eyeSize * 0.55} fill="#2a1d14" />
        <path d={`M${cx} ${eyeY + 1} L${cx - 0.6} ${eyeY + 6} Q${cx - nw} ${eyeY + 7.5} ${cx - nw * 0.6} ${eyeY + 8.3} Q${cx} ${eyeY + 9} ${cx + nw * 0.6} ${eyeY + 8.3} Q${cx + nw} ${eyeY + 7.5} ${cx + 0.6} ${eyeY + 6}`} fill="none" stroke={shade(f.skin, 0.62)} strokeWidth="0.9" strokeLinecap="round" />
        <path d={`M${cx - mw} ${mouthY} Q${cx} ${mouthY + 1.6 + f.mouth} ${cx + mw} ${mouthY}`} fill="none" stroke={shade(f.skin, 0.5)} strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
});

export const HAIR_STYLES: [string, string][] = [
  ['short', 'Short'], ['buzz', 'Buzz cut'], ['fade', 'Fade'], ['bald', 'Bald'], ['afro', 'Afro'], ['fro', 'Small afro'],
  ['flattop', 'Flattop'], ['cornrows', 'Cornrows'], ['dreads', 'Dreads'], ['curly', 'Curly'], ['parted', 'Parted'],
  ['mop', 'Longer'], ['spiky', 'Spiky'], ['quiff', 'Quiff'], ['bun', 'Bun'],
];
export const FACIAL_STYLES: [string, string][] = [
  ['none', 'None'], ['stubble', 'Stubble'], ['mustache', 'Mustache'], ['goatee', 'Goatee'], ['chin', 'Chin strap'], ['beard', 'Beard'],
];

/** Face of a player in his current team's colours. */
export function PFace({ lg, p, size = 26 }: any) {
  const t = p?.tid ? lg.teams[p.tid] : null;
  return <Face p={p} season={lg.season} tid={t?.tid} abbr={t?.abbr} size={size} />;
}
/** Emblem of a team by id. */
export function TLogo({ lg, tid, size = 20 }: any) {
  const t = lg.teams[tid];
  return t ? <Logo t={t} size={size} /> : null;
}
