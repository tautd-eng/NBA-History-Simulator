// @ts-nocheck
// "Daily roundup": a ~100-word sports-desk intro about the last day of games.
// Claude writes it (sample capability, on the viewer's account); when that is
// not available a short text is put together from the same facts.
import { Linkify, PL, TL, nav } from './nav';
import { useEffect, useRef, useState } from 'react';
import { standings } from '../league/league';

const gmsc = (l: any) => l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.orb + 0.3 * l.drb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;

/** The most recent day with games, and what happened on it. */
export function lastDay(lg: any) {
  const last = lg.recent[lg.recent.length - 1];
  if (!last) return null;
  const games = lg.recent.filter((r: any) => r.season === last.season && r.po === last.po && r.day === last.day);
  const key = `${last.season}-${last.po ? 'p' : 'r'}-${last.day}`;
  return { key, season: last.season, po: last.po, day: last.day, games };
}

function streak(lg: any, tid: string) {
  const gs = lg.schedule.filter((g: any) => g.done && (g.home === tid || g.away === tid));
  let n = 0, w: boolean | null = null;
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    const won = g.home === tid ? g.hs > g.as : g.as > g.hs;
    if (w === null) w = won;
    if (won !== w) break;
    n++;
  }
  return { n, w };
}

export function digest(lg: any) {
  const d = lastDay(lg);
  if (!d) return null;
  const T = (tid: string) => lg.teams[tid]?.name ?? tid;
  const games = d.games.map((r: any) => {
    const hw = r.home.pts > r.away.pts;
    const W = hw ? r.home : r.away, L = hw ? r.away : r.home;
    const top = (b: any) => [...b.players].sort((x, y) => gmsc(y.st) - gmsc(x.st))[0];
    return { r, W, L, margin: W.pts - L.pts, ot: r.ot, topW: top(W), topL: top(L) };
  });
  const lines = games.flatMap((g: any) => [g.r.home, g.r.away].flatMap((b: any) => b.players.map((p: any) => ({ ...p, tid: b.tid, won: b === g.W }))));
  const star = [...lines].sort((a, b) => gmsc(b.st) - gmsc(a.st))[0];
  const closest = [...games].sort((a, b) => a.margin - b.margin || b.ot - a.ot)[0];
  const blowout = [...games].sort((a, b) => b.margin - a.margin)[0];
  const teams = new Set(games.flatMap((g: any) => [g.W.tid, g.L.tid]));
  const streaks = [...teams].map(t => ({ t, ...streak(lg, t) })).filter(s => !d.po && s.n >= 4).sort((a, b) => b.n - a.n);
  const conf = ['E', 'W'].map(c => standings(lg, c)[0]).filter(Boolean);
  const series = d.po ? lg.series.filter((s: any) => d.games.some((r: any) => [r.home.tid, r.away.tid].includes(s.hi) && [r.home.tid, r.away.tid].includes(s.lo))) : [];
  const trades = (lg.trades ?? []).filter((t: any) => t.s === d.season && t.day === d.day && t.phase === (d.po ? 'playoffs' : 'regular'));
  return { d, T, games, star, closest, blowout, streaks, conf, series, trades };
}

/** Facts for the prompt, one per line. */
function factsText(lg: any, g: any) {
  const { d, T } = g;
  const out: string[] = [];
  out.push(`Season ${d.season - 1}–${String(d.season).slice(2)}, ${d.po ? 'playoffs' : `regular season day ${d.day + 1}`}.`);
  for (const x of g.games) {
    const ln = (p: any) => `${p.name} ${p.st.pts} pts, ${p.st.orb + p.st.drb} reb, ${p.st.ast} ast`;
    out.push(`${T(x.W.tid)} def. ${T(x.L.tid)} ${x.W.pts}–${x.L.pts}${x.ot ? ` (${x.ot > 1 ? x.ot + 'OT' : 'OT'})` : ''}. Winners' best: ${ln(x.topW)}. Losers' best: ${ln(x.topL)}.`);
  }
  if (g.star) out.push(`Star of the day: ${g.star.name} (${T(g.star.tid)}) – ${g.star.st.pts} pts, ${g.star.st.orb + g.star.st.drb} reb, ${g.star.st.ast} ast, ${g.star.st.fgm}/${g.star.st.fga} FG.`);
  for (const s of g.streaks.slice(0, 3)) out.push(`${T(s.t)}: ${s.n} ${s.w ? 'wins' : 'losses'} in a row.`);
  for (const s of g.series) out.push(`Series ${T(s.hi)} – ${T(s.lo)}: ${s.hw}–${s.lw}${s.winner ? `, won by ${T(s.winner)}` : ''} (${['', 'first round', 'second round', 'conference finals', 'finals'][Math.min(4, s.round)] || 'round ' + s.round}${s.conf === 'F' ? ', NBA Finals' : ''}).`);
  if (!d.po) for (const t of g.conf) out.push(`${t.conf === 'E' ? 'Eastern' : 'Western'} Conference leader: ${t.name} (${t.w}–${t.l}).`);
  for (const t of g.trades) out.push(`Trade: ${t.desc}`);
  return out.join('\n');
}

/** Local fallback: a short report assembled from the facts. */
export function autoArticle(lg: any, g: any) {
  const { T } = g;
  const n = g.games.length;
  const s: string[] = [];
  let title = '';
  const st = g.star?.st;
  if (st && st.pts >= 35) title = `${g.star.name} drops ${st.pts}`;
  else if (g.closest?.ot) title = `Overtime drama: ${T(g.closest.W.tid)} ${g.closest.W.pts}–${g.closest.L.pts}`;
  else if (g.blowout?.margin >= 25) title = `${T(g.blowout.W.tid)} roll in a rout`;
  else if (g.d.po && g.series[0]) title = `Playoffs: ${T(g.series[0].hi)} ${g.series[0].hw}–${g.series[0].lw} ${T(g.series[0].lo)}`;
  else title = `${n === 1 ? 'One game' : `${n} games`} and ${g.star ? g.star.name : 'a new leader'}`;
  s.push(n === 1 ? 'One game was played yesterday.' : `${n} games were played yesterday.`);
  if (st) s.push(`Star of the day: ${g.star.name} (${T(g.star.tid)}) with ${st.pts} points, ${st.orb + st.drb} rebounds and ${st.ast} assists${g.star.won ? ', and his team won' : ', but it wasn\'t enough for his team'}.`);
  if (g.closest && n > 1) s.push(`In the closest game the ${T(g.closest.W.tid)} beat the ${T(g.closest.L.tid)} ${g.closest.W.pts}–${g.closest.L.pts}${g.closest.ot ? ' in overtime' : ''}.`);
  if (g.blowout && g.blowout !== g.closest && g.blowout.margin >= 15) s.push(`The biggest win belonged to the ${T(g.blowout.W.tid)} – by ${g.blowout.margin} points.`);
  for (const k of g.streaks.slice(0, 1)) s.push(k.w ? `The ${T(k.t)} have now won ${k.n} straight.` : `The ${T(k.t)} have now lost ${k.n} straight.`);
  for (const x of g.series.slice(0, 2)) s.push(x.winner ? `The ${T(x.winner)} won the series ${Math.max(x.hw, x.lw)}–${Math.min(x.hw, x.lw)}.` : `The ${T(x.hi)}–${T(x.lo)} series stands at ${x.hw}–${x.lw}.`);
  if (!g.d.po && g.conf.length === 2) s.push(`The ${g.conf[0].name} lead the East (${g.conf[0].w}–${g.conf[0].l}), the ${g.conf[1].name} the West (${g.conf[1].w}–${g.conf[1].l}).`);
  if (g.trades.length) s.push(`The trade market was busy too: ${g.trades[0].desc}`);
  return { title, text: s.join(' ') };
}

function promptOf(lg: any, g: any) {
  return `You are a sportswriter covering a simulated (alternate) history of a basketball league. Using ONLY the facts below, write the intro to a daily roundup for a newspaper sports section.

Format: first line – a short, lively headline (up to 8 words, no quotes, no period at the end). Second line – one paragraph of about 100 words.
Rules: write vivid, natural English like a seasoned sportswriter; lead with the biggest story of the day; don't invent facts, numbers or quotes that aren't in the data; don't mention or compare with real NBA history – this is an alternate history; write team and player names exactly as given.

Facts:
${factsText(lg, g)}`;
}

export function Reporter({ lg, sampler, busy, onSaved }: any) {
  const g = digest(lg);
  const [state, setState] = useState<{ key: string; text: string; status: string } | null>(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('reporter-auto') === '1'; } catch { return false; } });
  const ctl = useRef<AbortController | null>(null);
  const key = g?.d.key;
  const saved = key ? (lg.articles ?? []).find((a: any) => a.key === key) : null;

  async function write() {
    if (!sampler || !g) return;
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setState({ key: g.d.key, text: '', status: 'thinking' });
    try {
      const { text } = await sampler(promptOf(lg, g), { signal: c.signal, onText: ({ text }) => setState({ key: g.d.key, text, status: 'writing' }) });
      const [first, ...rest] = text.trim().split('\n');
      const art = { key: g.d.key, title: first.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim(), text: rest.join(' ').replace(/\s+/g, ' ').trim(), by: 'claude' as const };
      lg.articles = [...(lg.articles ?? []).filter((a: any) => a.key !== art.key), art].slice(-40);
      setState(null);
      onSaved();
    } catch (e: any) {
      if (e?.code === 'cancelled') { setState(null); return; }
      const msg = e?.code === 'not_granted' || e?.code === 'sampling_disabled' ? 'Claude is not available in this window – showing the automatic summary.'
        : e?.code === 'rate_limited' ? 'Too many requests – try again later.' : 'Could not write the roundup. Try again.';
      setState({ key: g.d.key, text: '', status: msg });
      if (e?.code === 'not_granted') { setAuto(false); try { localStorage.setItem('reporter-auto', '0'); } catch { /* ignore */ } }
    }
  }

  // auto mode: write once for a new day when the simulation is idle
  useEffect(() => {
    if (!auto || !sampler || busy || !g || saved || state?.key === g.d.key) return;
    const t = setTimeout(write, 600);
    return () => clearTimeout(t);
  }, [key, auto, busy, !!sampler]);
  useEffect(() => () => ctl.current?.abort(), []);

  if (!g) return (
    <div className="panel reporter">
      <p className="eyebrow">Daily roundup</p>
      <p className="note">Once the first games are played, a sports-desk roundup will appear here.</p>
    </div>
  );
  const fallback = autoArticle(lg, g);
  const writing = state && state.key === g.d.key && (state.status === 'thinking' || state.status === 'writing');
  const shown = writing ? null : saved ?? { ...fallback, by: 'auto' };
  const dateLine = g.d.po ? `${g.d.season} playoffs` : `${g.d.season - 1}–${String(g.d.season).slice(2)} season, day ${g.d.day + 1}`;
  return (
    <div className="panel reporter">
      <p className="eyebrow">Daily roundup · {dateLine}</p>
      {writing ? (
        <>
          <h2 className="headline">{state!.status === 'thinking' ? 'Writing…' : state!.text.split('\n')[0]}</h2>
          <p className="article">{state!.text.split('\n').slice(1).join(' ')}</p>
          <div className="def-row"><button className="ghost small" onClick={() => ctl.current?.abort()}>Stop</button></div>
        </>
      ) : (
        <>
          <h2 className="headline">{shown!.title}</h2>
          <p className="article"><Linkify text={shown!.text} /></p>
          <div className="def-row">
            <span className="byline">{shown!.by === 'claude' ? 'Written by Claude' : 'Automatic summary'}</span>
            {sampler && <button className="small" onClick={write}>{shown!.by === 'claude' ? 'Rewrite' : 'Write with Claude'}</button>}
            {sampler && <label className="chk" htmlFor="rep-auto"><input id="rep-auto" type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); try { localStorage.setItem('reporter-auto', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} /> Write after every day</label>}
          </div>
          {state && state.key === g.d.key && state.status && !writing && <p className="note">{state.status}</p>}
        </>
      )}
    </div>
  );
}
