export interface StatLine {
  gp: number; gs: number; min: number; pts: number;
  fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  orb: number; drb: number; ast: number; stl: number; blk: number; tov: number; pf: number; pm: number;
}
export const STAT_KEYS: (keyof StatLine)[] = [
  'gp', 'gs', 'min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm',
];
export function emptyLine(): StatLine {
  return { gp: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 };
}
export function addLine(a: StatLine, b: StatLine) {
  for (const k of STAT_KEYS) a[k] += b[k];
}

export interface CareerSeason extends StatLine { s: number; tid: string; po: boolean; ovr: number; age: number }

/** sal = fraction of the season's cap; exp = last season; opts = option years still to be decided; rookie = first contract (restricted free agency when it ends) */
export interface Contract { sal: number; exp: number; opts?: { s: number; k: 'team' | 'player' }[]; rookie?: boolean }

export interface Player {
  id: string;
  name: string;
  born: number;          // birth year + fraction
  ht: number;            // inches
  face?: { seed?: number; skin?: number; hair?: string; facial?: string; band?: boolean }; // user edits to the generated portrait
  pos: string;
  z: number[];           // current skill z-scores
  tid: string | null;    // franchise id, null = free agent
  retired?: number;      // season of retirement
  contract: Contract;
  draft?: { year: number; pick: number; round: number; tid: string; realPick: number; realTid: string };
  injury: number;        // games out
  endur: number;         // endurance z
  cur: StatLine;         // current regular season
  curPo: StatLine;       // current playoffs
  career: CareerSeason[];
  ovrHist: [number, number][]; // [season, ovr]
  awards: string[];
  real: boolean;         // has historical data
  entered: number;       // season the player joined the league universe
  scout: number;         // persistent scouting bias for draft (per player)
  dev?: { pot: number; peak: number; vol: number; e: number[] }; // hidden development traits
  rh?: number[][];       // ratings history: [season, ...RATING_LABELS ratings]
  prospect?: boolean;    // on the draft board, not yet in the league
  bird?: string;         // team holding this free agent's re-signing rights
  shift?: number;        // years between his real draft and this league's (shuffled or mixed classes)
  fat?: number; fatDay?: number; // fatigue after his last game and its calendar day
  fatNow?: number;       // fatigue at tip-off of the game being played (set before each game)
  inj?: { k: string; until: number };  // current injury: type and calendar day it heals
  injHist?: { s: number; k: string; g: number; w: 'game' | 'off'; lasting?: boolean }[];
  injAt?: number;        // set before a game: gets hurt after this many of his minutes
  rfa?: string;          // restricted free agent: team that may match offers
  qo?: number;           // his qualifying offer (salary he gets from that team if nobody else signs him)
  noRfa?: boolean;       // option declined: unrestricted
  ext?: { sal: number; exp: number }; // extension signed: replaces the contract when it ends
  tradeLock?: { s: number; f: number }; // newly signed: not tradeable until this share of season s's regular season
  tx?: { s: number; t: string; d?: number }[]; // career transactions; d orders them within the season (-1 summer before it, game day, 999 after it)
}

export interface Team {
  tid: string;
  abbr: string;
  name: string;
  conf: 'E' | 'W';
  roster: string[];
  w: number; l: number;
  homeW: number; homeL: number;
  pf: number; pa: number;
  confW: number; confL: number;
  strategy: 'contend' | 'middle' | 'rebuild';
  mode?: 'allin' | 'tank' | 'rising' | 'capclear' | 'retool'; // all-in, tanking, rising young team, clearing salary, stuck in the middle and retooling
  gm: { risk: number; patience: number; scouting: number };
  paceZ: number;
  active: boolean;
  st?: StatLine; opp?: StatLine; gp?: number; // team season totals (own, opponents)
  stPo?: StatLine; oppPo?: StatLine; gpPo?: number;
}

export interface Box {
  tid: string;
  pts: number;
  q: number[];
  players: { pid: string; name: string; st: StatLine; starter: boolean; hurt?: boolean }[];
}
export interface GameResult {
  id: number;
  season: number;
  day: number;
  po: boolean;
  home: Box;
  away: Box;
  ot: number;
  ser?: string;          // playoff series after this game, e.g. "Game 3 · BOS leads 2–1"
}

export interface Game { id: number; day: number; home: string; away: string; done?: boolean; hs?: number; as?: number; rid?: number }

export interface Series {
  round: number; conf: string; hi: string; lo: string; hiSeed: number; loSeed: number;
  hw: number; lw: number; bestOf: number; winner?: string;
  games?: number[]; lastDay?: number;
}
export interface PlayInGame { a: string; b: string; winner?: string; label: string; txt?: string; rid?: number }

export interface SeasonSummary {
  season: number;
  champion?: string;
  runnerUp?: string;
  mvp?: string; roy?: string; fmvp?: string;
  awards?: { mvp?: string; dpoy?: string; roy?: string; smoy?: string; mip?: string; fmvp?: string; allNba: string[][]; allDef: string[][]; allRookie: string[][]; votes: Record<string, { pid: string; v: number }[]> };
  standings: { tid: string; name: string; abbr: string; w: number; l: number; conf: string }[];
  draft?: { pick: number; pid: string; tid: string; realPick: number; realTid: string; via?: string }[];
  lottery?: string;
  leaders?: Record<string, { pid: string; v: number }>;
  notes: string[];
  po?: Record<string, number>; poRounds?: number; // playoff finish per team (rounds reached, rounds+1 = champion, -1 = play-in)
  teamStats?: Record<string, { st: StatLine; opp: StatLine; gp: number; w: number; l: number; stPo?: StatLine; oppPo?: StatLine; gpPo?: number }>;
  bracket?: { series: { round: number; conf: string; hi: string; lo: string; hiSeed: number; loSeed: number; hw: number; lw: number; winner?: string; bestOf: number }[]; playIn: { label: string; txt?: string; a: string; b: string; winner?: string }[] };
}

export interface Pick { season: number; round: number; orig: string; owner: string }
export interface TradeAsset { pid?: string; pick?: { season: number; round: number; orig: string } }
export interface TradeRec { s: number; day: number; phase: string; a: string; b: string; aGets: TradeAsset[]; bGets: TradeAsset[]; user?: boolean; desc: string; info?: Record<string, [number, number]> }

/** games: regular-season games per team (null = as in that real season); series: playoff series length (null = as in that era). */
export interface Settings {
  games: number | null;
  rr?: number | null;                       // round robin: every team plays every other team rr times
  series: number | null;                    // all rounds (older setting)
  poTeams?: number | null;                  // playoff teams per conference: 2, 4, 6 or 8
  playIn?: boolean | null;
  poRounds?: (number | null)[];             // [first round, second round, conference finals, finals]
  hardCap?: number | null;                  // hard payroll limit as a share of the cap (null = none; default 1.35)
  rfaHistoric?: boolean;                    // before 1988–89 every free agent's team had the right of first refusal
}

export type Phase = 'fantasy' | 'regular' | 'playoffs' | 'draft' | 'offseason' | 'freeagency';
/** Draft day: the order of picks and who is still on the board (prospects live in lg.players with prospect=true). */
export interface DraftDay {
  year: number; order: { orig: string; round: number }[]; idx: number; pool: string[];
  picks: { pick: number; round: number; pid: string; tid: string; realPick: number; realTid: string; via?: string }[];
  lottery?: string; newTeams: string[]; done: boolean;
  stage?: 'expansion' | 'lottery' | 'draft';
  exp?: ExpansionDraft;
  lotto?: Lottery;
}
/** Expansion draft: old teams protect players, then the new teams pick in turns (each old team loses at most one). */
export interface ExpansionDraft {
  teams: string[]; protect: Record<string, string[]>; confirmed: boolean;
  order: string[]; idx: number; picks: { nt: string; pid: string; from: string; n: number }[]; lost: string[]; done: boolean;
}
/** Draft lottery before the draw (odds) and after it (result). */
export interface Lottery {
  kind: 'coin' | 'draw'; text: string;
  teams: { tid: string; w: number; l: number }[];   // non-playoff teams, worst first
  entrants: string[]; weights: number[]; draws: number;
  odds: number[][];                                  // per lottery team: chance of each final slot
  rest: string[];                                    // playoff teams, worst first
  drawn: boolean; result?: string[];
}
/** Free agency: stage 1..3 open, 4 = finished (ready to start the season). */
export interface FreeAgency {
  stage: number; pending: string[]; mle: string[];
  log: { st: number; kind: 'sign' | 'resign' | 'trade' | 'release' | 'leave' | 'option' | 'qo' | 'match' | 'sheet'; pid?: string; tid?: string; sal?: number; exp?: number; desc?: string; user?: boolean; from?: string }[];
  /** stage 0: the user's contract decisions (team options, qualifying offers) with the GM's recommendation */
  decisions?: { pid: string; kind: 'team' | 'qo'; rec: boolean; choice?: boolean; sal: number }[];
  /** offer sheets to the user's restricted free agents, waiting for match / no match */
  sheets?: { pid: string; tid: string; sal: number; exp: number }[];
  flushed?: number;                 // log entries already copied into the players' histories
}
export interface FantasyDraft { order: string[]; rounds: number; picks: { round: number; pick: number; tid: string; pid: string }[]; done: boolean }

export interface League {
  version: number;
  /** free-agency moves of past summers, by season: [pid, kind, to tid, from tid, salary, last season, OVR (shown), age] */
  faHist?: Record<number, [string, string, string, string, number, number, number, number][]>;
  seed: number;
  rng: [number, number, number, number];
  destiny: number;
  userTid: string | null;
  season: number;
  phase: Phase;
  day: number;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  schedule: Game[];
  playIn: PlayInGame[];
  series: Series[];
  history: SeasonSummary[];
  recent: GameResult[];
  news: { s: number; t: string }[];
  nextGameId: number;
  ended?: boolean;
  picks?: Pick[];
  trades?: TradeRec[];
  settings?: Settings;
  health?: { s: number; sim: any; real: any; shift: number; spread: number }[];
  fantasy?: FantasyDraft;
  articles?: { key: string; title: string; text: string; by: 'claude' | 'auto' }[];
  seasonAwards?: any; // regular-season awards, between the end of the regular season and the finals
  draftDay?: DraftDay;
  fa?: FreeAgency;
  dead?: { tid: string; sal: number; exp: number; pid: string }[]; // salaries of released players still on the books
  start?: number;                     // first season of this league
  classMode?: 'real' | 'shuffle' | 'mixed';
  classMap?: Record<string, string[]>; // draft year → prospects (shuffled or mixed classes)
  classSrc?: Record<string, number>;   // shuffled: draft year → real class year
  future?: { order: number[]; cls: Record<string, string[]>; mode?: 'shuffle' | 'chrono' | 'mixed'; used?: number[]; usedP?: string[] }; // after the data ends: historical classes coming round again
  injCal?: number;                     // last calendar day checked for injuries away from games
  endCal?: number;                     // calendar day the last season ended
  records?: import('./league/records').Records; // single-game record book
}
