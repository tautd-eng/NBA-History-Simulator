// Rotations from a spreadsheet: one row per player – team, player, position, minutes, starter.
import { League } from '../types';
import { isHuman } from './humans';
import { rotationPreview } from './league';
import { GROUPS, SYSTEMS, tacFrom, defaultChoice } from './tactics';

const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DEF = () => ({ mode: 'auto' as const, depth: 10, youth: 0, minutes: {} as Record<string, number>, tac: { pace: 0, three: 0, crash: 0, press: 0 } });

export interface ImportReport { teams: { tid: string; players: number; minutes: number; scaled: boolean; starters: number; ai: boolean }[]; problems: string[] }

/** Find the columns by their headers (English or Lithuanian, any order). */
function columns(head: string[]) {
  const h = head.map(norm);
  const find = (...keys: string[]) => h.findIndex(x => keys.some(k => x === k || x.startsWith(k)));
  return {
    team: find('team', 'komanda', 'tm'), player: find('player', 'zaidejas', 'name', 'vardas'),
    pos: find('position', 'pos', 'pozicija'), min: find('minutes', 'min', 'minutes'), start: find('starter', 'start', 'gs', 'startinis'),
  };
}

/** Apply the sheet. Teams it lists get those minutes, positions and starters (an AI team follows them too). */
const isTacHead = (r: string[]) => r.some(c => /^(tactic|tactics|setting|taktika|nustatymas)$/i.test(c.trim()));
const isRotHead = (r: string[]) => r.some(c => /^(player|žaidėjas|zaidejas|name|vardas)$/i.test(c.trim()));

/** Apply the sheet: a rotation block (Team, Player, Position, Minutes, Starter) and/or a tactics block (Team, Tactic, Choice). */
export function importRotations(lg: League, rows: string[][], only?: string): ImportReport {
  const rep: ImportReport = { teams: [], problems: [] };
  const ti = rows.findIndex(isTacHead);
  const ri = rows.findIndex(isRotHead);
  const tacRep = ti >= 0 ? importTactics(lg, rows.slice(ti, ri > ti ? ri : undefined), rep, only) : new Set<string>();
  const rotRows = ri >= 0 ? rows.slice(ri, ti > ri ? ti : undefined) : [];
  if (ri < 0) {
    if (ti < 0) rep.problems.push('No header row – the sheet needs columns Team, Player, Position, Minutes, Starter (and/or Team, Tactic, Choice).');
    for (const tid of tacRep) rep.teams.push({ tid, players: 0, minutes: 0, scaled: false, starters: 0, ai: !isHuman(lg, tid), tactics: true } as any);
    return rep;
  }
  importRotRows(lg, rotRows, rep, only);
  for (const tid of tacRep) { const t = rep.teams.find(x => x.tid === tid); if (t) (t as any).tactics = true; else rep.teams.push({ tid, players: 0, minutes: 0, scaled: false, starters: 0, ai: !isHuman(lg, tid), tactics: true } as any); }
  return rep;
}

function teamFinder(lg: League, only?: string) {
  return (s: string) => {
    if (!s) return only ?? lg.userTid;
    const n = norm(s);
    return Object.values(lg.teams).find(t => t.active && (norm(t.tid) === n || norm(t.abbr) === n || norm(t.name) === n || norm(t.name).endsWith(n)))?.tid ?? null;
  };
}

/** Tactics rows: Team | Tactic (e.g. "Offensive focus", or "System") | Choice (e.g. "Play through star"). */
function importTactics(lg: League, rows: string[][], rep: ImportReport, only?: string) {
  const h = rows[0].map(norm);
  const ct = h.findIndex(x => /^(team|komanda|tm)$/.test(x)), cs = h.findIndex(x => /^(tactic|tactics|setting|taktika|nustatymas)$/.test(x)), cv = h.findIndex(x => /^(choice|value|option|pasirinkimas|reiksme)$/.test(x));
  const done = new Set<string>();
  if (cs < 0 || cv < 0) { rep.problems.push('Tactics: needs columns Tactic and Choice.'); return done; }
  const teamOf = teamFinder(lg, only);
  for (const r of rows.slice(1)) {
    const st = r[cs] ?? '', val = r[cv] ?? '';
    if (!st && !val) continue;
    const tid = teamOf(ct >= 0 ? r[ct] ?? '' : '');
    if (!tid) { rep.problems.push(`Tactics: unknown team “${r[ct]}”.`); continue; }
    if (only && tid !== only) continue;
    const t = lg.teams[tid];
    const m: any = (t.mgmt ??= DEF() as any);
    const ch: Record<string, string> = (m.choice ??= {});
    const ns = norm(st), nv = norm(val);
    if (/^(system|sistema|preset)$/.test(ns)) {
      const sys = SYSTEMS.find(x => norm(x.t) === nv || norm(x.k) === nv);
      if (!sys) { rep.problems.push(`${t.abbr}: no system “${val}” – ${SYSTEMS.map(x => x.t).join(', ')}.`); continue; }
      for (const g of GROUPS) ch[g.k] = sys.set[g.k] ?? defaultChoice(g);
      ch.system = sys.k;
    } else {
      const g = GROUPS.find(x => norm(x.t) === ns || norm(x.k) === ns);
      if (!g) { rep.problems.push(`${t.abbr}: no tactic “${st}” – ${GROUPS.map(x => x.t).join(', ')}, System.`); continue; }
      const o = g.opts.find(x => norm(x.t) === nv || norm(x.k) === nv);
      if (!o) { rep.problems.push(`${t.abbr} ${g.t}: no choice “${val}” – ${g.opts.map(x => x.t).join(', ')}.`); continue; }
      ch[g.k] = o.k; ch.system = '';
    }
    m.tac = tacFrom(ch);
    if (!isHuman(lg, tid)) m.imported = true;
    done.add(tid);
  }
  return done;
}

function importRotRows(lg: League, rows: string[][], rep: ImportReport, only?: string) {
  const hi = 0;
  const c = columns(rows[hi]);
  if (c.player < 0) { rep.problems.push('No “Player” column.'); return; }
  const teamOf = teamFinder(lg, only);
  const byTeam = new Map<string, { pid: string; pos: number; min: number | null; st: boolean }[]>();
  for (const r of rows.slice(hi + 1)) {
    const name = r[c.player] ?? '';
    if (!name) continue;
    const tid = teamOf(c.team >= 0 ? r[c.team] ?? '' : '');
    if (!tid) { rep.problems.push(`Unknown team “${r[c.team]}” (row for ${name}).`); continue; }
    if (only && tid !== only) continue;
    const t = lg.teams[tid];
    const n = norm(name);
    const ps = t.roster.map(pid => lg.players[pid]);
    const p = ps.find(q => norm(q.name) === n) ?? ps.find(q => norm(q.name).includes(n) || n.includes(norm(q.name))) ?? ps.find(q => norm(q.name.split(' ').slice(-1)[0]) === n);
    if (!p) { rep.problems.push(`${t.abbr}: no “${name}” on the roster.`); continue; }
    const posTxt = c.pos >= 0 ? (r[c.pos] ?? '').toUpperCase().replace(/\s/g, '') : '';
    const pos = posTxt ? (SLOTS.indexOf(posTxt) + 1 || (/^[1-5]$/.test(posTxt) ? +posTxt : 0)) : 0;
    if (posTxt && !pos) rep.problems.push(`${t.abbr} ${p.name}: position “${r[c.pos]}” – use PG, SG, SF, PF or C.`);
    const mTxt = c.min >= 0 ? (r[c.min] ?? '').replace(',', '.') : '';
    const min = mTxt === '' ? null : Math.max(0, Math.min(48, +mTxt || 0));
    const st = c.start >= 0 && /^(1|y|yes|x|taip|t|true|s|starter)$/i.test(r[c.start] ?? '');
    (byTeam.get(tid) ?? byTeam.set(tid, []).get(tid)!).push({ pid: p.id, pos, min, st });
  }
  for (const [tid, list] of byTeam) {
    const t = lg.teams[tid];
    const m: any = (t.mgmt ??= DEF() as any);
    const withMin = list.filter(x => x.min !== null);
    let scaled = false;
    if (withMin.length) {
      const sum = withMin.reduce((a, x) => a + x.min!, 0);
      const listed = new Set(withMin.map(x => x.pid));
      // players the sheet leaves out share what is left of the 240, as the coach would play them
      const auto = rotationPreview(lg, tid, { ...DEF(), mode: 'auto' });
      const rest = t.roster.filter(pid => !listed.has(pid));
      const restAuto = rest.reduce((a, pid) => a + (auto[pid] ?? 0), 0);
      const left = Math.max(0, 240 - sum);
      const f = sum > 240 + 2 || (left > 2 && restAuto < 1) ? 240 / sum : 1;
      scaled = f !== 1;
      m.minutes = Object.fromEntries(t.roster.map(pid => [pid, 0]));
      for (const x of withMin) m.minutes[x.pid] = Math.min(48, Math.round(x.min! * f));
      if (f === 1 && left > 2) {
        for (const pid of rest) m.minutes[pid] = Math.round(left * (auto[pid] ?? 0) / restAuto);
        rep.problems.push(`${t.abbr}: the sheet gives ${Math.round(sum)} minutes – the other ${Math.round(left)} go to the players it leaves out, as the coach would split them.`);
      }
      m.mode = 'manual';
      if (scaled) rep.problems.push(`${t.abbr}: minutes added up to ${Math.round(sum)} – scaled to 240.`);
    }
    m.pos = { ...(m.pos ?? {}) };
    for (const x of list) { if (x.pos) m.pos[x.pid] = x.pos; else delete m.pos[x.pid]; }
    const st = list.filter(x => x.st);
    if (st.length) {
      const five = ['', '', '', '', ''];
      for (const x of st) { const slot = (x.pos || m.pos[x.pid] || 0) - 1; if (slot >= 0 && !five[slot]) five[slot] = x.pid; }
      for (const x of st) if (!five.includes(x.pid)) { const i = five.indexOf(''); if (i >= 0) five[i] = x.pid; }
      if (st.length > 5) rep.problems.push(`${t.abbr}: ${st.length} starters marked – the first five count.`);
      m.starters = five;
    }
    const ai = !isHuman(lg, tid);
    if (ai) m.imported = true;
    rep.teams.push({ tid, players: list.length, minutes: withMin.reduce((a, x) => a + (m.minutes[x.pid] ?? 0), 0), scaled, starters: st.length, ai });
  }
  if (!byTeam.size && !rep.problems.length) rep.problems.push('No player rows found.');
}

/** A sheet to fill in: the team's players with their current minutes and positions (CSV – Excel opens it). */
export function rotationTemplate(lg: League, tids: string[], plan: (tid: string) => Record<string, number>) {
  const rows = [['Team', 'Player', 'Position', 'Minutes', 'Starter']];
  for (const tid of tids) {
    const t = lg.teams[tid], m: any = t.mgmt ?? {};
    const pl = plan(tid);
    const ps = t.roster.map(pid => lg.players[pid]).sort((a, b) => (pl[b.id] ?? 0) - (pl[a.id] ?? 0));
    for (const p of ps) {
      const si = (m.starters ?? []).indexOf(p.id);
      const pos = si >= 0 ? si + 1 : m.pos?.[p.id] ?? 0;
      rows.push([t.abbr, p.name, pos ? SLOTS[pos - 1] : '', String(Math.round(pl[p.id] ?? 0)), si >= 0 ? 'Y' : '']);
    }
  }
  rows.push([], ['Team', 'Tactic', 'Choice']);
  for (const tid of tids) {
    const ch = (lg.teams[tid].mgmt as any)?.choice ?? {};
    const sys = SYSTEMS.find(x => x.k === ch.system);
    if (sys && sys.k !== 'balanced') rows.push([lg.teams[tid].abbr, 'System', sys.t]);
    for (const g of GROUPS) { const o = g.opts.find(x => x.k === (ch[g.k] ?? defaultChoice(g))) ?? g.opts[0]; rows.push([lg.teams[tid].abbr, g.t, o.t]); }
  }
  return rows.map(r => r.map(x => /[",;]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x).join(',')).join('\r\n');
}
