// Hidden boost (box +/- points) for players whose standing in their own time – All-NBA teams, MVP voting –
// beats what their numbers say: half of the gap, capped. Not shown in the overall; the engine and the GMs use it.
// Built by test/hboost.py from the award data.
import HBOOST from './hboost.json';
const HB = HBOOST as Record<string, number>;
/** Copies of historical players (id~year) inherit the original's boost. */
export const hiddenBoost = (id: string) => HB[id.split('~')[0]] ?? 0;
