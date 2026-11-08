// Hot seat: trade offers between two human-run teams wait in the other team's inbox until that team is played.
import { League, Proposal, TradeAsset } from '../types';
import { tradeRules, executeTrade, fillRoster, pickUsed, describeAssets } from '../ai/trades';
import { isHuman } from './humans';

const owned = (lg: League, tid: string, xs: TradeAsset[]) => xs.every(x =>
  x.pid ? lg.players[x.pid]?.tid === tid
    : x.pick ? (lg.picks ?? []).some(p => p.season === x.pick!.season && p.round === x.pick!.round && p.orig === x.pick!.orig && p.owner === tid && !pickUsed(lg, p))
      : true);

/** Why the offer can no longer go through (null = it still can). */
export function proposalProblem(lg: League, pr: Proposal): string | null {
  if (!isHuman(lg, pr.from) || !isHuman(lg, pr.to)) return 'One of the teams is no longer run by a person.';
  if (!owned(lg, pr.from, pr.fromGives) || !owned(lg, pr.to, pr.toGives)) return 'Some of the players or picks have moved since.';
  return tradeRules(lg, pr.from, pr.to, pr.toGives, pr.fromGives);
}

export function propose(lg: League, from: string, to: string, fromGives: TradeAsset[], toGives: TradeAsset[], note?: string) {
  const pr: Proposal = { id: (lg.proposals ?? []).reduce((a, x) => Math.max(a, x.id), 0) + 1, from, to, fromGives, toGives, s: lg.season, day: lg.day, phase: lg.phase, note };
  const bad = proposalProblem(lg, pr);
  if (bad) return { ok: false, msg: bad };
  (lg.proposals ??= []).push(pr);
  return { ok: true, msg: `Offer sent to the ${lg.teams[to].name}. They answer when their team is played.` };
}

export function answer(lg: League, id: number, accept: boolean) {
  const pr = (lg.proposals ?? []).find(x => x.id === id);
  if (!pr) return { ok: false, msg: 'The offer is gone.' };
  lg.proposals = lg.proposals!.filter(x => x !== pr);
  if (!accept) {
    lg.news.push({ s: lg.season, t: `The ${lg.teams[pr.to].name} turned down a trade offer from the ${lg.teams[pr.from].name}.` });
    return { ok: true, msg: 'Offer declined.' };
  }
  const bad = proposalProblem(lg, pr);
  if (bad) return { ok: false, msg: `The trade can't go through: ${bad}` };
  const rec = executeTrade(lg, pr.from, pr.to, pr.toGives, pr.fromGives, true);
  fillRoster(lg, pr.from); fillRoster(lg, pr.to);
  return { ok: true, msg: `Trade done: ${rec.desc}` };
}

export const withdraw = (lg: League, id: number) => { lg.proposals = (lg.proposals ?? []).filter(x => x.id !== id); };
export const inbox = (lg: League, tid: string | null) => (lg.proposals ?? []).filter(x => x.to === tid);
export const outbox = (lg: League, tid: string | null) => (lg.proposals ?? []).filter(x => x.from === tid);
export const describeSide = (lg: League, xs: TradeAsset[]) => (xs.length ? describeAssets(lg, xs) : 'nothing');
