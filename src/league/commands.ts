// Everything a person does for his team, as a command: { t: kind, …args }.
// Locally a command is applied at once. Online (shared league) the same command is also sent to the host,
// who applies it to the league before simulating – so every person's moves go through this one door.
import { League, TradeAsset } from '../types';
import { faOffer, withdrawOffer, faRenounce, faRelease, faDecide, faMatch, draftPick, draftOnClock, expPick, expOnClock, recallStash } from './offseason';
import { userExtend } from './extensions';
import { fantasyOnClock, fantasyUserPick } from './fantasy';
import { aiResponse, executeTrade, fillRoster, tradeRules, pickUsed } from '../ai/trades';
import { propose, answer, withdraw } from './proposals';
import { isHuman } from './humans';

export type Cmd =
  | { t: 'mgmt'; mgmt: any }                                         // rotation, positions, matchups, tactics
  | { t: 'faOffer'; pid: string; sal: number; yrs: number }
  | { t: 'faWithdraw'; pid: string }
  | { t: 'faRenounce'; pid: string }
  | { t: 'release'; pid: string }
  | { t: 'decide'; pid: string; yes: boolean }                       // team option / qualifying offer
  | { t: 'match'; pid: string; yes: boolean }                        // offer sheet for his RFA
  | { t: 'draftPick'; pid?: string }
  | { t: 'expPick'; pid: string }
  | { t: 'fantasyPick'; pid: string }
  | { t: 'trade'; partner: string; gives: TradeAsset[]; gets: TradeAsset[] }   // with an AI team: goes through if its GM accepts
  | { t: 'propose'; to: string; gives: TradeAsset[]; gets: TradeAsset[] }      // to another person's team
  | { t: 'answer'; id: number; yes: boolean }
  | { t: 'withdrawProposal'; id: number }
  | { t: 'extend'; pid: string; sal: number; yrs: number }
  | { t: 'recall'; pid: string };

export interface Envelope { cmd: Cmd; tid: string; at: number }
export interface Result { ok: boolean; msg: string }

const own = (lg: League, tid: string, xs: TradeAsset[]) => xs.every(x =>
  x.pid ? lg.players[x.pid]?.tid === tid
    : x.pick ? (lg.picks ?? []).some(p => p.season === x.pick!.season && p.round === x.pick!.round && p.orig === x.pick!.orig && p.owner === tid && !pickUsed(lg, p)) : true);
const no = (msg: string): Result => ({ ok: false, msg });

/** Apply one command for team `tid` (checked: a person can only act for his own team). */
export function apply(lg: League, env: Envelope): Result {
  const { cmd, tid } = env;
  if (!lg.teams[tid]?.active) return no('No such team.');
  const prev = lg.userTid;
  lg.userTid = tid; // the league's functions act for the team being played
  try {
    const p = 'pid' in cmd && cmd.pid ? lg.players[cmd.pid] : null;
    switch (cmd.t) {
      case 'mgmt': lg.teams[tid].mgmt = JSON.parse(JSON.stringify(cmd.mgmt)); return { ok: true, msg: '' };
      case 'faOffer': return faOffer(lg, cmd.pid, cmd.sal, cmd.yrs);
      case 'faWithdraw': withdrawOffer(lg, cmd.pid, tid); return { ok: true, msg: 'Offer withdrawn.' };
      case 'faRenounce': if (p?.bird !== tid) return no('Not your free agent.'); faRenounce(lg, cmd.pid); return { ok: true, msg: `${p.name} – you let him go.` };
      case 'release': if (p?.tid !== tid) return no('Not your player.'); return faRelease(lg, cmd.pid);
      case 'decide': {
        const d = lg.fa?.decisions?.find(x => x.pid === cmd.pid);
        if (!d || ((d.tid ?? prev) !== tid && !(d.kind === 'team' && p?.tid === tid))) return no('Not your decision.');
        faDecide(lg, cmd.pid, cmd.yes); return { ok: true, msg: '' };
      }
      case 'match': if (p?.rfa !== tid) return no('Not your restricted free agent.'); return faMatch(lg, cmd.pid, cmd.yes);
      case 'draftPick': if (draftOnClock(lg)?.tid !== tid) return no('Not your pick.'); draftPick(lg, cmd.pid); return { ok: true, msg: '' };
      case 'expPick': if (expOnClock(lg)?.nt !== tid) return no('Not your pick.'); expPick(lg, cmd.pid); return { ok: true, msg: '' };
      case 'fantasyPick': if (fantasyOnClock(lg)?.tid !== tid) return no('Not your pick.'); fantasyUserPick(lg, cmd.pid); return { ok: true, msg: '' };
      case 'trade': {
        if (!own(lg, tid, cmd.gives) || !own(lg, cmd.partner, cmd.gets)) return no('Some of those players or picks have moved since.');
        if (isHuman(lg, cmd.partner)) return no('That team is run by a person – send them an offer.');
        const bad = tradeRules(lg, tid, cmd.partner, cmd.gets, cmd.gives);
        if (bad) return no(bad);
        const r = aiResponse(lg, tid, cmd.partner, cmd.gets, cmd.gives);
        if (!r.accept) return no(r.text);
        const rec = executeTrade(lg, tid, cmd.partner, cmd.gets, cmd.gives, true);
        fillRoster(lg, tid); fillRoster(lg, cmd.partner);
        return { ok: true, msg: `Trade done: ${rec.desc}` };
      }
      case 'propose': if (!own(lg, tid, cmd.gives)) return no('Not yours to trade.'); return propose(lg, tid, cmd.to, cmd.gives, cmd.gets);
      case 'answer': { const pr = lg.proposals?.find(x => x.id === cmd.id); if (pr?.to !== tid) return no('Not your offer to answer.'); return answer(lg, cmd.id, cmd.yes); }
      case 'withdrawProposal': { const pr = lg.proposals?.find(x => x.id === cmd.id); if (pr?.from !== tid) return no('Not your offer.'); withdraw(lg, cmd.id); return { ok: true, msg: 'Offer withdrawn.' }; }
      case 'extend': if (p?.tid !== tid) return no('Not your player.'); return userExtend(lg, cmd.pid, cmd.sal, cmd.yrs);
      case 'recall': if ((p as any)?.rights !== tid) return no('Not your draft rights.'); return recallStash(lg, cmd.pid);
    }
    return no('Unknown command.');
  } finally {
    lg.userTid = prev;
  }
}

/** Where commands also go (online play sets this; locally nothing). */
let sink: ((env: Envelope) => void) | null = null;
export function setCommandSink(fn: ((env: Envelope) => void) | null) { sink = fn; }

/** A person acts for the team he is playing: apply now, and pass it on. */
export function run(lg: League, cmd: Cmd): Result {
  const tid = lg.userTid;
  if (!tid) return no('You have no team.');
  const env: Envelope = { cmd, tid, at: Date.now() };
  const r = apply(lg, env);
  if (r.ok !== false) sink?.(env);
  return r;
}
