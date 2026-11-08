// Salaries are shares of each season's cap – the same model in every era. They are shown as a percentage of the cap;
// dollar amounts (that season's real cap) only if the player turns them on.
import { seasonInfo } from '../data';

let dollars = false;
try { dollars = localStorage.getItem('showDollars') === '1'; } catch { /* no storage */ }
export const showDollars = () => dollars;
export function setShowDollars(on: boolean) { dollars = on; try { localStorage.setItem('showDollars', on ? '1' : '0'); } catch { /* ignore */ } }

/** Dollars in that season's money. */
export function dollarsOf(frac: number, s: number, fine = false) {
  const m = frac * seasonInfo(s).cap;
  return m >= 1 ? `$${m.toFixed(fine ? 2 : 1)}M` : `$${Math.round(m * 1000)}K`;
}
/** A salary as shown: % of the cap (or dollars, if turned on). */
export function money(frac: number, s: number) {
  return dollars ? dollarsOf(frac, s) : `${(frac * 100).toFixed(1)}%`;
}
/** " ($2.4M)" after a percentage when dollars are on, else nothing. */
export const usd = (frac: number, s: number) => (dollars ? ` (${dollarsOf(frac, s, true)})` : '');
