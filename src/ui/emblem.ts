// Original team emblems: geometric badges and lettering in the team colours (no real marks).
// Each franchise gets its own style from a stable hash; the same SVG is used in the menus and,
// as an image, painted on the centre circle in the arena.
import { hash01 } from '../rng';

// colours of historical abbreviations whose franchise later changed identity
const ERA_COLORS: Record<string, [string, string]> = {
  SEA: ['#00653a', '#ffc200'], NJN: ['#002a60', '#cd1041'], VAN: ['#00b2a9', '#e43c40'], KCK: ['#0b3d91', '#e03a3e'],
  SDC: ['#1d428a', '#e03a3e'], WSB: ['#002b5c', '#e31837'], CHH: ['#00778b', '#3f2a73'], NOH: ['#0c2340', '#b4975a'],
  NOK: ['#0c2340', '#b4975a'], CHA: ['#f26532', '#1d8cab'], NOJ: ['#4b2f87', '#00a19b'], BUF: ['#002b5c', '#e31837'],
};
/** Colours of a historical abbreviation whose franchise later changed identity, if any. */
export const eraColors = (abbr: string): [string, string] | null => ERA_COLORS[abbr] ?? null;

const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const MULTI = ['Trail Blazers'];
/** City and nickname from a full team name ("Los Angeles Lakers" → Los Angeles / Lakers). */
export function splitName(name: string) {
  const m = MULTI.find(x => name.endsWith(' ' + x));
  const nick = m ?? name.split(' ').slice(-1)[0];
  return { city: name.slice(0, name.length - nick.length).trim(), nick };
}
/** One or two letters: city initials for two-word cities (LA, NY, SA), else the city's first letter. */
function monogram(city: string, abbr: string) {
  const w = city.split(/\s+/).filter(Boolean);
  if (w.length >= 2 && w[0].length <= 4) return (w[0][0] + w[1][0]).toUpperCase();
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return (w[0]?.[0] ?? abbr[0]).toUpperCase();
}

export const EMBLEM_STYLES = 8;
/** An even spread of the eight styles over the franchises. */
const STYLE_OF: Record<string, number> = {
  ATL: 1, BOS: 7, CHI: 4, CLE: 0, DAL: 3, DEN: 2, DET: 1, GSW: 0, HOU: 5, IND: 6, SAC: 1, LAC: 2, LAL: 6, MIL: 0, BRK: 5,
  NYK: 3, PHI: 7, PHO: 4, POR: 3, SAS: 5, OKC: 1, UTA: 0, WAS: 6, NOP: 4, MIA: 2, MIN: 7, ORL: 4, TOR: 5, MEM: 6, CHA: 3,
};
const FONT = `font-family="'Arial Black','Helvetica Neue',Arial,system-ui,sans-serif" font-weight="900"`;

/**
 * SVG markup of a team's emblem on a 100×100 canvas. `small` drops fine lettering
 * so it still reads at 16–24 px.
 */
export function emblemSVG(tid: string, abbr: string, name: string, colors: [string, string], small = false): string {
  let [a, b] = colors;
  if (lum(a) > 0.82 && lum(b) < 0.82) [a, b] = [b, a]; // a white primary reads badly as a field
  const ink = lum(a) > 0.6 ? '#141414' : '#ffffff';
  const inkB = lum(b) > 0.6 ? '#141414' : '#ffffff';
  const dk = shade(a, 0.62);
  const style = STYLE_OF[tid] ?? Math.floor(hash01(tid + 'emblem' + tid.length) * EMBLEM_STYLES);
  const { city, nick } = splitName(name || abbr);
  const NICK = esc(nick.toUpperCase()), CITY = esc(city.toUpperCase()), MONO = esc(monogram(city, abbr)), ABBR = esc(abbr);
  const fit = (s: string, max: number, base: number) => Math.min(base, (max / Math.max(1, s.length)) * 1.3);
  const text = (x: number, y: number, size: number, fill: string, s: string, extra = '') =>
    `<text x="${x}" y="${y}" text-anchor="middle" ${FONT} font-size="${size.toFixed(1)}" fill="${fill}" ${extra}>${s}</text>`;
  let body = '';
  switch (style) {
    case 0: { // roundel: lettered ring around a monogram
      body = `<circle cx="50" cy="50" r="47" fill="${a}" stroke="${dk}" stroke-width="3"/>`
        + `<circle cx="50" cy="50" r="31" fill="${b}"/><circle cx="50" cy="50" r="27" fill="${a}"/>`
        + text(50, 50 + fit(MONO, 30, 30) * 0.36, fit(MONO, 30, 30), ink, MONO);
      if (!small) body += `<defs><path id="t${tid}" d="M 13 50 A 37 37 0 0 1 87 50"/><path id="b${tid}" d="M 11 50 A 39 39 0 0 0 89 50"/></defs>`
        + `<text ${FONT} font-size="${fit(NICK, 70, 11)}" fill="${inkB === '#141414' && lum(a) < 0.5 ? b : ink}" letter-spacing="1.5"><textPath href="#t${tid}" startOffset="50%" text-anchor="middle">${NICK}</textPath></text>`
        + `<text ${FONT} font-size="${fit(CITY, 60, 8.5)}" fill="${ink}" opacity="0.85" letter-spacing="1"><textPath href="#b${tid}" startOffset="50%" text-anchor="middle" dominant-baseline="hanging">${CITY}</textPath></text>`;
      break;
    }
    case 1: { // shield split on the diagonal, big monogram, banner with the nickname
      body = `<defs><clipPath id="c${tid}"><path d="M50 4 L92 16 V48 C92 72 74 88 50 97 C26 88 8 72 8 48 V16 Z"/></clipPath></defs>`
        + `<g clip-path="url(#c${tid})"><rect width="100" height="100" fill="${a}"/><path d="M0 100 L100 18 V100 Z" fill="${dk}"/></g>`
        + `<path d="M50 4 L92 16 V48 C92 72 74 88 50 97 C26 88 8 72 8 48 V16 Z" fill="none" stroke="${b}" stroke-width="4"/>`
        + text(50, small ? 64 : 56, small ? 44 : 38, b, MONO, `stroke="${dk}" stroke-width="1.5"`);
      if (!small) body += `<path d="M4 64 H96 L90 72 L96 80 H4 L10 72 Z" fill="${b}"/>` + text(50, 76.5, fit(NICK, 80, 11), inkB, NICK);
      break;
    }
    case 2: { // basketball badge: seams over the field, abbreviation on a plate
      body = `<circle cx="50" cy="50" r="46" fill="${a}" stroke="${b}" stroke-width="4"/>`
        + `<g fill="none" stroke="${b}" stroke-width="3" opacity="0.75"><path d="M50 4 V96"/><path d="M4 50 H96"/><path d="M18 17 C36 34 36 66 18 83"/><path d="M82 17 C64 34 64 66 82 83"/></g>`
        + `<rect x="${small ? 8 : 14}" y="${small ? 34 : 38}" width="${small ? 84 : 72}" height="${small ? 32 : 24}" rx="6" fill="${b}" stroke="${dk}" stroke-width="2"/>`
        + text(50, small ? 59 : 56.5, small ? 25 : fit(ABBR, 60, 19), inkB, ABBR);
      break;
    }
    case 3: { // hexagon with chevrons and a stacked wordmark
      body = `<path d="M50 3 L91 26 V74 L50 97 L9 74 V26 Z" fill="${a}" stroke="${b}" stroke-width="4"/>`
        + `<path d="M22 30 L50 18 L78 30" fill="none" stroke="${b}" stroke-width="5"/><path d="M22 82 L50 70 L78 82" fill="none" stroke="${b}" stroke-width="3" opacity="0.6"/>`;
      body += small ? text(50, 62, 34, ink, MONO) : text(50, 50, fit(CITY, 70, 12), ink, CITY, 'opacity="0.9"') + text(50, 64, fit(NICK, 74, 15), b, NICK, `stroke="${dk}" stroke-width="0.8"`);
      break;
    }
    case 4: { // italic wordmark on a rounded plate with a swoosh and a ball
      body = `<rect x="3" y="14" width="94" height="72" rx="16" fill="${a}" stroke="${b}" stroke-width="3.5"/>`
        + `<path d="M12 70 C40 82 70 78 90 62" fill="none" stroke="${b}" stroke-width="4" stroke-linecap="round"/>`
        + `<circle cx="80" cy="30" r="7" fill="${b}"/><path d="M73 30 H87 M80 23 V37" stroke="${dk}" stroke-width="1.4"/>`;
      body += small ? text(46, 64, 36, ink, MONO, 'font-style="italic"') : text(48, 60, fit(NICK, 78, 20), ink, NICK, `font-style="italic" transform="skewX(-8) translate(5 0)"`);
      break;
    }
    case 5: { // diamond with three stars and a monogram
      body = `<path d="M50 2 L98 50 L50 98 L2 50 Z" fill="${a}" stroke="${b}" stroke-width="4"/><path d="M50 14 L86 50 L50 86 L14 50 Z" fill="none" stroke="${b}" stroke-width="1.5" opacity="0.6"/>`
        + [30, 50, 70].map(x => `<path transform="translate(${x} ${small ? 26 : 30}) scale(${small ? 0 : 0.42})" d="M0 -10 L2.9 -3.1 L9.5 -3.1 L4.2 1.2 L5.9 8.1 L0 4 L-5.9 8.1 L-4.2 1.2 L-9.5 -3.1 L-2.9 -3.1 Z" fill="${b}"/>`).join('')
        + text(50, small ? 63 : 64, small ? 36 : fit(MONO, 32, 30), ink, MONO);
      break;
    }
    case 6: { // pennant with the nickname, city on the pole band
      body = `<path d="M6 12 H96 L70 50 L96 88 H6 Z" fill="${a}" stroke="${b}" stroke-width="3.5"/><rect x="6" y="12" width="14" height="76" fill="${b}"/>`;
      body += small ? text(44, 62, 34, ink, MONO) : text(44, 50 + fit(NICK, 44, 15) * 0.36, fit(NICK, 44, 15), ink, NICK) + `<text transform="translate(16.5 50) rotate(-90)" text-anchor="middle" ${FONT} font-size="${fit(CITY, 64, 8)}" fill="${inkB}">${CITY}</text>`;
      break;
    }
    default: { // rounded square with stripes and a monogram
      body = `<rect x="4" y="4" width="92" height="92" rx="20" fill="${a}" stroke="${b}" stroke-width="4"/>`
        + `<g fill="${b}" opacity="0.9"><rect x="4" y="22" width="92" height="5"/><rect x="4" y="73" width="92" height="5"/></g>`
        + text(50, small ? 64 : 61, small ? 40 : fit(MONO, 34, 34), ink, MONO);
      if (!small) body += text(50, 91, fit(NICK, 70, 9), b, NICK);
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
}

const urlCache = new Map<string, string>();
/** data: URL of an emblem (cached). */
export function emblemURL(tid: string, abbr: string, name: string, colors: [string, string], small = false) {
  const k = `${tid}|${abbr}|${name}|${colors.join()}|${small}`;
  let u = urlCache.get(k);
  if (!u) { u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(emblemSVG(tid, abbr, name, colors, small)); urlCache.set(k, u); }
  return u;
}
