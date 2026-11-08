// Team tactics as a coach sets them (NBA 2K-style points of emphasis) and the engine's numbers they turn into.
// tactics as a coach sets them (NBA 2K-style points of emphasis), turned into the engine's numbers
type Opt = { k: string; t: string; v: Record<string, any>; d?: string };
export const GROUPS: { k: string; t: string; side: 'o' | 'd'; d: string; opts: Opt[]; from?: number }[] = [
  { k: 'of', t: 'Offensive focus', side: 'o', d: 'Who takes the shots and from where.', opts: [
    { k: 'neutral', t: 'Neutral', v: {} },
    { k: 'star', t: 'Play through star', v: { focus: 1 }, d: 'Your best scorers take more of the shots.' },
    { k: 'ball', t: 'Ball movement', v: { focus: -1 }, d: 'Shots spread out and come a little cleaner – more passes, more turnovers.' },
    { k: 'basket', t: 'Get to basket', v: { three: -1 }, d: 'Fewer threes, more drives and free throws.' },
    { k: 'shooters', t: 'Get shooters open', v: { three: 1 }, d: 'Many more threes – more points per make, more variance.' },
    { k: 'post', t: 'Feed the post', v: { post: 1, three: -0.4 }, d: 'The bigs get it inside: their shots, more fouls drawn.' },
    { k: 'pnr', t: 'Pick & roll', v: { pnr: 1 }, d: 'Guards and bigs run it: easier twos, a few more turnovers.' },
  ] },
  { k: 'tempo', t: 'Offensive tempo', side: 'o', d: 'How fast you play.', opts: [
    { k: 'patient', t: 'Patient', v: { pace: -1 } }, { k: 'avg', t: 'Average', v: {} }, { k: 'push', t: 'Push', v: { pace: 0.5 } }, { k: 'will', t: 'Shoot at will', v: { pace: 1 } },
  ] },
  { k: 'oreb', t: 'Offensive rebounding', side: 'o', d: 'After your misses: go for the board or get back.', opts: [
    { k: 'limit', t: 'Limit transition', v: { crash: -1 }, d: 'Fewer second chances, fewer breaks against you.' },
    { k: 'some', t: 'Some crash, others run', v: {} },
    { k: 'crash', t: 'Crash the glass', v: { crash: 1 }, d: 'More second chances – more fast breaks against you.' },
  ] },
  { k: 'df', t: 'Defensive focus', side: 'd', d: 'What you take away.', opts: [
    { k: 'paint', t: 'Protect the paint', v: { scheme: -1 }, d: 'Fewer and harder twos for them – more threes.' },
    { k: 'neutral', t: 'Neutral', v: {} },
    { k: 'perim', t: 'Limit perimeter', v: { scheme: 1 }, d: 'Fewer and harder threes – easier twos.' },
  ] },
  { k: 'aggr', t: 'Defensive aggression', side: 'd', d: 'How hard you guard.', opts: [
    { k: 'cons', t: 'Conservative', v: { press: -1, phys: -0.5 }, d: 'Few fouls and few turnovers forced – easier shots for them.' },
    { k: 'neutral', t: 'Neutral', v: {} },
    { k: 'phys', t: 'Physical', v: { phys: 1 }, d: 'Every shot contested – more fouls, foul trouble.' },
    { k: 'press', t: 'Pressure', v: { press: 1, phys: 0.3 }, d: 'Gamble for steals – more turnovers, more fouls.' },
  ] },
  { k: 'dreb', t: 'Defensive rebounding', side: 'd', d: 'After their misses.', opts: [
    { k: 'run', t: 'Run in transition', v: { dreb: -1 }, d: 'Leak out for breaks – they get more offensive rebounds.' },
    { k: 'neutral', t: 'Some crash, others run', v: {} },
    { k: 'crash', t: 'Crash the glass', v: { dreb: 1 }, d: 'Everybody boxes out – fewer breaks for you.' },
  ] },
  { k: 'cover', t: 'Pick & roll coverage', side: 'd', d: 'How your bigs and guards play the screen.', opts: [
    { k: 'auto', t: 'Auto', v: {} },
    { k: 'drop', t: 'Drop', v: { cover: 'drop' }, d: 'The big stays back: the rim is protected, guards get pull-up threes.' },
    { k: 'switch', t: 'Switch', v: { cover: 'switch' }, d: 'No open man – but their bigs post up smaller defenders.' },
    { k: 'blitz', t: 'Blitz', v: { cover: 'blitz' }, d: 'Trap the ball-handler: turnovers – and open shooters when it fails.' },
  ] },
  { k: 'dbl', t: 'Double the star', side: 'd', d: 'Their top scorer.', opts: [
    { k: 'never', t: 'Never', v: { dbl: -1 }, d: 'He gets his – but nobody else gets open looks.' },
    { k: 'auto', t: 'Auto', v: {} },
    { k: 'always', t: 'Always', v: { dbl: 1 }, d: 'The ball goes elsewhere or he turns it over – kick-out threes are open.' },
  ] },
  { k: 'zone', t: 'Zone defense', side: 'd', d: 'Zone instead of man-to-man (legal from 2001–02).', from: 2002, opts: [
    { k: 'never', t: 'Never', v: { zone: -1 } }, { k: 'auto', t: 'Auto', v: {} }, { k: 'often', t: 'Often', v: { zone: 1 } },
  ] },
];
export const SYSTEMS: { k: string; t: string; d: string; set: Record<string, string> }[] = [
  { k: 'balanced', t: 'Balanced', d: 'Nothing forced.', set: {} },
  { k: 'grit', t: 'Grit and Grind', d: 'Slow, inside, physical, every board.', set: { of: 'post', tempo: 'patient', oreb: 'crash', df: 'paint', aggr: 'phys', dreb: 'crash' } },
  { k: 'space', t: 'Pace and Space', d: 'Push it, shooters open, get back.', set: { of: 'shooters', tempo: 'push', oreb: 'limit', df: 'perim', dreb: 'run' } },
  { k: 'seven', t: '7 seconds', d: 'Shoot early, threes, run, switch everything.', set: { of: 'shooters', tempo: 'will', oreb: 'limit', dreb: 'run', cover: 'switch' } },
  { k: 'triangle', t: 'Triangle', d: 'Patient ball movement.', set: { of: 'ball', tempo: 'patient' } },
  { k: 'postc', t: 'Post centric', d: 'Through the bigs.', set: { of: 'post', oreb: 'crash' } },
  { k: 'perim', t: 'Perimeter centric', d: 'Pick and roll and the guards.', set: { of: 'pnr', tempo: 'push' } },
  { k: 'star', t: 'Star system', d: 'The ball goes to your best player.', set: { of: 'star' } },
  { k: 'defense', t: 'Defense first', d: 'Slow, physical, protect the rim, double the star.', set: { tempo: 'patient', df: 'paint', aggr: 'phys', dreb: 'crash', dbl: 'always' } },
];
/** The engine's numbers from the coach's choices. */
export function tacFrom(ch: Record<string, string>) {
  const t: any = { pace: 0, three: 0, crash: 0, press: 0 };
  for (const g of GROUPS) Object.assign(t, (g.opts.find(o => o.k === ch[g.k]) ?? g.opts.find(o => !Object.keys(o.v).length) ?? g.opts[0]).v);
  return t;
}
export const defaultChoice = (g: typeof GROUPS[number]) => (g.opts.find(o => !Object.keys(o.v).length) ?? g.opts[0]).k;

