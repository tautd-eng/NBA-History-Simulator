// @ts-nocheck
import { PlayoffPreviews, SeriesDialog } from './preview';
import { useNavState, navSubs, restoreSubs } from './nav';
import { MyBoard, BoardToggle, boardOf } from './myboard';
import { run } from '../league/commands';
import { money, usd, showDollars, setShowDollars } from './money';
import { Linkify, PL, TL, nav } from './nav';
import { TeamHistory, TeamRecords, LeagueRecords, Retirements, SeasonArchive } from './history';
import { StandingsHistory, TeamStatsExplorer, FaMoves } from './leaguehist';
import { Logo, TLogo, PFace } from './art';
import { RoleBadge } from './roles';
import { SeasonPreview } from './seasonpreview';
import { StepBar, RecapStep, RetireStep, DevStep, PreviewStep, HallOfFameView } from './offsteps';
import { Progression } from './rankings';
import { offStep } from '../league/offseason';
import { Devices } from './devices';
import { PlayingAs, HumansPanel } from './humans';
import { SalaryView } from './salaries';
import { OnlinePanel, OnlineBar, useOnline } from './online';
import { openOnline, bindApp, slotOf } from '../online/sync';
import { currentUser } from '../online/client';
import { installTableExport } from './export';
import { isHuman } from '../league/humans';
import { roleOf } from '../archetypes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadHistory, H, RATING_LABELS, shownOvr as ovrOf, shownFromRaw, shownFromBpm, ratingOf, seasonInfo, bpmOf, LAST_SEASON } from '../data';
import { setEraCal } from '../engine/game';
import { newLeague, standings, playoffFormat, realChampion, simDayWatching, watchableToday, playedToday, seasonGames, applySettings, startClutch, finishClutch, todayIndex, awaitingPlayoffs } from '../league/league';
import { AwardsStep } from './awardsstep';
import { TeamMgmt } from './mgmt';
import { ensurePicks, deadlineDay, boardScore } from '../ai/trades';
import { planOf } from '../ai/plan';
import { LiveGame } from './live';
import { SortTable, f1 } from './sorttable';
import { ClutchGame } from './clutch';
import { FantasyRoom } from './fantasy';
import { GameModal } from './gamebox';
import { PlayerPanel } from './player';
import { StatsView } from './stats';
import { Reporter } from './reporter';
import { fantasyAdvance } from '../league/fantasy';
import { Trades } from './trades';
import { DraftRoom, FAHub, FreeAgentsView, potOf, attrCols, AttrMode } from './offseason';
import { recallStash } from '../league/offseason';
import { Rankings, offRating, defRating } from './rankings';
import { fatigueAt, nextCal, fatigueExcess, fatigueLabel } from '../league/fatigue';
import { injName } from '../league/injuries';
import { optLabel } from '../league/contracts';

function FatigueBar({ f }: any) {
  const s = fatigueExcess(f);
  const pctv = Math.min(100, (s / 20) * 100);
  const cls = s < 2 ? 'ok' : s < 8 ? 'mild' : s < 15 ? 'mid' : 'high';
  return <span className={`fbar ${cls}`} title={`${fatigueLabel(f)} (${Math.round(f)})`}><span style={{ width: `${Math.max(4, pctv)}%` }}></span></span>;
}
import { CLASS_MODES, FUTURE_MODES } from '../league/classes';
import { advance, saveLeague, loadLeague, Target, listSaves, setSlot, newSlotId, deleteSave, renameSave, currentSlot } from '../api';
import { ageIn } from '../players';
import { payroll, peakBpm, hardCap } from '../ai/value';
import cal from '../engine/eracal.json';
declare const __BUILD__: string;
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

setEraCal(cal as any);

// ---------------------------------------------------------------- helpers
const per = (v: number, gp: number) => (gp ? (v / gp).toFixed(1) : '–');
const pct = (m: number, a: number) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '–');
const seasonLabel = (s: number) => `${s - 1}–${String(s).slice(2)}`;

function Ovr({ v, small }: { v: number; small?: boolean }) {
  const tier = v >= 90 ? 'star' : v >= 80 ? 'good' : v >= 70 ? 'mid' : 'low';
  return <span className={`ovr ${tier}${small ? ' sm' : ''}`}>{v}</span>;
}

// ---------------------------------------------------------------- app
/**
 * Every panel in the app can be folded: click its heading (▾ / ▸). Which headings are folded is remembered per
 * browser by the heading's text, so "Standings" stays folded wherever it appears. Dialogs and panels that
 * fold on their own (the season preview) are left alone.
 */
const FOLD_KEY = 'nba-folded';
function foldedSet(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')); } catch { return new Set(); } }
const foldName = (h: Element) => (h.textContent ?? '').split('·')[0].replace(/[▸▾]/g, '').replace(/[0-9–\-]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function panelHeading(panel: Element): [Element, Element] | null {
  const kids = Array.from(panel.children).slice(0, 4);
  for (const c of kids) {
    if (c.matches('h2, .eyebrow')) return [c, c];
    const h = c.querySelector(':scope > h2');
    if (h) return [h, c];
  }
  // a header row without a title (team page, stats): the row itself is the handle
  const head = kids.find(c => /(^|\s)[\w-]*-head(\s|$)/.test(c.className));
  return head ? [head, head] : null;
}
function usePanelFolding() {
  useEffect(() => {
    let folded = foldedSet(), raf = 0;
    const apply = () => {
      raf = 0;
      document.querySelectorAll('.panel').forEach(panel => {
        if (panel.tagName === 'DETAILS' || panel.closest('.overlay, .dialog')) return;
        const hk = panelHeading(panel);
        if (!hk) return;
        const [h, keep] = hk;
        h.classList.add('fold-h'); keep.classList.add('fold-keep');
        const name = h.tagName === 'DIV' ? 'head:' + (h.className.match(/[\w-]*-head/)?.[0] ?? '') : foldName(h);
        (panel as HTMLElement).dataset.fold = name;
        panel.classList.toggle('collapsed', folded.has(name));
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('a, button, select, input, label, textarea')) return;
      const h = t.closest('.fold-h');
      const panel = h?.closest('.panel') as HTMLElement | null;
      if (!h || !panel?.dataset.fold) return;
      const name = panel.dataset.fold;
      folded.has(name) ? folded.delete(name) : folded.add(name);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch { /* storage unavailable */ }
      apply();
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', click);
    apply();
    return () => { mo.disconnect(); document.removeEventListener('click', click); if (raf) cancelAnimationFrame(raf); };
  }, []);
}

function App() {
  usePanelFolding();
  useEffect(() => { installTableExport(); }, []);
  const [lg, setLg] = useState<any>(null);
  useEffect(() => { try { (window as any).__lg = lg; } catch { /* debugging handle */ } }, [lg]);
  const [ready, setReady] = useState(false);
  const [rev, setRev] = useState(0);
  const [tab, setTab] = useState(() => {
    const h = location.hash.replace('#', '');
    return ['apzvalga', 'komandos', 'reitingai', 'laisvieji', 'mainai', 'statistika', 'draftai', 'istorija', 'rungtynes'].includes(h) ? h : 'apzvalga';
  });
  const [team, setTeam] = useState<string | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<'ok' | 'fail' | null>(null);
  const [live, setLive] = useState<any>(null);
  const [clutch, setClutch] = useState<any>(null);
  const [gameView, setGameView] = useState<any>(null);
  const [sampler, setSampler] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = (window as any).claude;
        if (!c?.use) return;
        const smp = await c.use('sample');
        if (alive && smp) setSampler(() => smp);
      } catch { /* not available */ }
    })();
    return () => { alive = false; };
  }, []);
  const openGame = (rid: number) => { const r = lg?.recent.find((x: any) => x.id === rid); if (r) setGameView(r); };
  const [showSettings, setShowSettings] = useState(false);
  const [showHumans, setShowHumans] = useState(false);
  const [showSaves, setShowSaves] = useState(false);
  const [showOnline, setShowOnline] = useState(() => /[?&]join=/.test(location.search));
  const joinCode = (/[?&]join=([A-Za-z0-9]+)/.exec(location.search) ?? [])[1];
  const octx = useOnline();
  const stop = useRef(false);
  // going back: every move to another section, team or player card is remembered (the browser's Back works too)
  const views = useRef<{ tab: string; team: string | null; player: string | null; y: number; subs: Record<string, any> }[]>([]);
  const [depth, setDepth] = useState(0);
  const restore = () => {
    const v = views.current.pop();
    setDepth(views.current.length);
    if (!v) return;
    setTab(v.tab); setTeam(v.team); setPlayer(v.player); restoreSubs(v.subs);
    try { history.replaceState(history.state, '', '#' + v.tab); } catch { /* ignore */ }
    // the page may still be filling in: keep trying for a moment until the old position exists
    let n = 0; const tryScroll = () => { window.scrollTo(0, v.y); if (Math.abs(window.scrollY - v.y) > 4 && ++n < 25) setTimeout(tryScroll, 40); };
    setTimeout(tryScroll, 0);
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
    const on = () => { if (views.current.length) restoreRef.current(); };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  useEffect(() => {
    (async () => {
      // an online league reopens online (its newest version), not from the copy in this browser
      const sl = currentSlot();
      if (sl.startsWith('online-') && currentUser()) {
        try { const l = await openOnline(sl.slice(7)); ensurePicks(l); l.trades ??= []; setLg(l); setTeam(l.userTid ?? Object.keys(l.teams)[0]); setReady(true); return; } catch { /* fall back to the local copy */ }
      }
      const l = await loadLeague();
      if (l) { ensurePicks(l); l.trades ??= []; setLg(l); setTeam(l.userTid ?? Object.keys(l.teams)[0]); }
      setReady(true);
    })();
  }, []);
  // a new version of the online league arrived / the host applied others' moves
  useEffect(() => {
    bindApp({
      replace: (l: any) => { ensurePicks(l); l.trades ??= []; setLg(l); setRev(x => x + 1); saveLeague(l); },
      refresh: () => { setRev(x => x + 1); },
      status: (l: any) => `${seasonLabel(l.season)} · ${phaseLabel(l)}`,
    });
  }, []);
  useEffect(() => { document.body.classList.toggle('online-player', octx?.role === 'player' || lg?.online?.role === 'player'); }, [octx?.role, lg]);

  const bump = () => setRev(r => r + 1);

  async function run(target: Target, label: string) {
    if (!lg || busy) return;
    stop.current = false;
    setBusy(label);
    await advance(lg, target, bump, () => stop.current);
    setBusy(null);
    bump();
    setSaved((await saveLeague(lg)) ? 'ok' : 'fail');
  }

  function clutchStart(home: string, away: string, side: 'h' | 'a') {
    if (!lg || busy) return;
    const cs = startClutch(lg, home, away, side);
    bump();
    if (cs) setClutch(cs);
  }

  async function watch(home: string, away: string, startAt = 0, show = true) {
    if (!lg || busy) return;
    // a watched game is recorded only when the viewer closes: no spoilers in profiles, standings or the bracket
    const w = simDayWatching(lg, home, away, { defer: show });
    if (w && show) { setLive({ ...w, startAt }); return; }
    bump();
    setSaved((await saveLeague(lg)) ? 'ok' : 'fail');
  }
  async function closeLive() {
    if (live?.commit) live.commit();
    setLive(null);
    bump();
    if (lg) setSaved((await saveLeague(lg)) ? 'ok' : 'fail');
  }

  function start(destiny: number, seed: number, userTid: string | null, settings: any, fantasy = false, startYear = 1980, classMode: any = 'real', futureMode: any = 'shuffle') {
    const l = newLeague(destiny, seed, settings, { fantasy, start: startYear, classMode, futureMode });
    l.userTid = userTid;
    setLg(l); setTeam(userTid ?? 'LAL'); setTab('apzvalga');
    saveLeague(l).then(ok => setSaved(ok ? 'ok' : 'fail'));
  }

  const [more, setMore] = useState(false);
  const [tradeSeed, setTradeSeed] = useState<{ pid: string; n: number } | null>(null);
  if (!ready) return <div className="loading">Loading league…</div>;
  const switchTo = async (id: string) => {
    if (id.startsWith('online-') && currentUser()) {
      try { const l = await openOnline(id.slice(7)); setSlot(id); ensurePicks(l); l.trades ??= []; setLg(l); setTeam(l.userTid ?? Object.keys(l.teams)[0]); setTab('apzvalga'); setPlayer(null); setShowSaves(false); return; } catch { /* the copy in this browser */ }
    }
    setSlot(id);
    const l = await loadLeague(id);
    if (l) { ensurePicks(l); l.trades ??= []; setLg(l); setTeam(l.userTid ?? Object.keys(l.teams)[0]); setTab('apzvalga'); setPlayer(null); setShowSaves(false); }
  };
  const startNew = () => { setSlot(newSlotId()); setLg(null); setShowSaves(false); };
  const onlinePanel = showOnline && <OnlinePanel lg={lg} joinCode={joinCode} close={() => { setShowOnline(false); if (joinCode) try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ } }}
    onOpen={(l: any, id: string) => { setSlot(slotOf(id)); ensurePicks(l); l.trades ??= []; setLg(l); setTeam(l.userTid ?? Object.keys(l.teams)[0]); setTab('apzvalga'); setPlayer(null); saveLeague(l, slotOf(id)); }} />;
  if (!lg) return <><div className="setup-online"><button onClick={() => setShowOnline(true)}>🌐 Online league – join with a code or open yours</button></div><Setup onStart={start} onLoad={switchTo} />{onlinePanel}</>;

  const remember = () => {
    views.current.push({ tab, team, player, y: window.scrollY, subs: navSubs() });
    if (views.current.length > 60) views.current.shift();
    setDepth(views.current.length);
    try { history.pushState({ nba: views.current.length }, '', location.hash); } catch { /* ignore */ }
  };
  const goBack = () => { if (!views.current.length) return; try { history.back(); } catch { restore(); } };
  const openPlayer = (pid: string) => { if (pid !== player) remember(); setPlayer(pid); };
  const closePlayer = () => { const top = views.current[views.current.length - 1]; if (top && top.player !== player && top.tab === tab) goBack(); else setPlayer(null); };
  const openTeam = (tid: string) => { if (tab !== 'komandos' || team !== tid || player) remember(); setTeam(tid); setPlayer(null); setTab('komandos'); try { history.replaceState(history.state, '', '#komandos'); } catch { /* ignore */ } window.scrollTo(0, 0); };
  nav.remember = remember;
  nav.lg = lg; nav.player = openPlayer; nav.team = (tid: string) => { setPlayer(null); if (live) closeLive(); setGameView(null); openTeam(tid); };
  const go = (t: string) => { if (t !== tab) { remember(); window.scrollTo(0, 0); } setTab(t); try { history.replaceState(history.state, '', '#' + t); } catch { /* ignore */ } };

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <button className="back-top" onClick={goBack} disabled={depth === 0} aria-label="Back to the previous screen" title={depth ? 'Back to the previous screen (the browser\'s Back works too)' : 'Nothing to go back to yet'}>←</button>
          <span className="ball" aria-hidden="true"></span>
          <div>
            <div className="name">NBA History Simulator</div>
            <div className="meta">{seasonLabel(lg.season)} · {phaseLabel(lg)} · destiny {Math.round(lg.destiny * 100)}%</div>
          </div>
          <PlayingAs lg={lg} onChange={async () => { if (lg.userTid) setTeam(lg.userTid); bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />
        </div>
        <Controls lg={lg} busy={busy} run={run} stop={() => (stop.current = true)} saved={saved} />
      </header>
      {octx && <OnlineBar lg={lg} openPanel={() => setShowOnline(true)} onLeave={() => { setSlot(newSlotId()); setLg(null); }} />}
      <nav className="tabs" aria-label="Sections">
        {tabsFor(lg).map(([k, l, main]) => (
          <button key={k} className={`${tab === k ? 'on' : ''} ${main ? '' : 'sec'}`} onClick={() => { go(k); setMore(false); }} aria-label={l}><TabIcon k={k} /><span className="tl">{l}</span></button>
        ))}
        <button className={`more-btn ${more || tabsFor(lg).some(([k, , m]) => !m && k === tab) ? 'on' : ''}`} onClick={() => setMore(m => !m)} aria-label="More" aria-expanded={more}><TabIcon k="more" /><span className="tl">More</span></button>
      </nav>
      {more && <div className="more-sheet-bg" onClick={() => setMore(false)}>
        <div className="more-sheet" role="menu" onClick={e => e.stopPropagation()}>
          {tabsFor(lg).filter(([, , m]) => !m).map(([k, l]) => <button key={k} role="menuitem" className={tab === k ? 'on' : ''} onClick={() => { go(k); setMore(false); }}><TabIcon k={k} /><span>{l}</span></button>)}
          <p className="more-ver">Version {BUILD}</p>
        </div>
      </div>}
      <main className={tab === 'laisvieji' || (tab === 'apzvalga' && (lg.phase === 'freeagency' || lg.phase === 'draft')) ? 'wide' : ''}>
        {lg.phase === 'fantasy' && <FantasyRoom lg={lg} openPlayer={openPlayer} onTick={bump} onChange={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
        {lg.phase !== 'fantasy' && tab === 'apzvalga' && <Overview lg={lg} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} watch={watch} clutch={clutchStart} busy={!!busy || !!clutch || octx?.role === 'player'} sampler={sampler} goFA={() => go('laisvieji')} onTick={bump} onSaved={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
        {lg.phase !== 'fantasy' && tab === 'valdymas' && <TeamMgmt key={lg.userTid ?? ''} lg={lg} openPlayer={openPlayer} onChange={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
        {lg.phase !== 'fantasy' && tab === 'reitingai' && <Rankings lg={lg} openPlayer={openPlayer} openTeam={openTeam} />}
        {lg.phase !== 'fantasy' && tab === 'laisvieji' && <FreeAgentsView lg={lg} openPlayer={openPlayer} onChange={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
        {lg.phase !== 'fantasy' && tab === 'mainai' && <Trades key={(lg.userTid ?? '') + (tradeSeed?.n ?? '')} seed={tradeSeed?.pid} lg={lg} openPlayer={openPlayer} onDone={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
        {lg.phase !== 'fantasy' && tab === 'komandos' && <TeamView lg={lg} tid={team ?? 'LAL'} setTid={(t: string) => { if (t !== team) remember(); setTeam(t); }} openPlayer={openPlayer} openGame={openGame} />}
        {lg.phase !== 'fantasy' && tab === 'algos' && <SalaryView lg={lg} openPlayer={openPlayer} openTeam={openTeam} />}
        {lg.phase !== 'fantasy' && tab === 'draftai' && <div className="col"><Drafts lg={lg} openPlayer={openPlayer} openTeam={openTeam} onChange={async () => { setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />{lg.fantasy?.done && <FantasyResults lg={lg} openPlayer={openPlayer} />}</div>}
        {lg.phase !== 'fantasy' && tab === 'istorija' && <HistoryView lg={lg} openPlayer={openPlayer} openTeam={openTeam} onSaved={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
        {lg.phase !== 'fantasy' && tab === 'statistika' && <StatsView lg={lg} openPlayer={openPlayer} openTeam={openTeam} />}
        {lg.phase !== 'fantasy' && tab === 'rungtynes' && <Games lg={lg} openPlayer={openPlayer} />}
      </main>
      <footer className="foot">
        <span>Data: Basketball-Reference (via sumitrodatta/bball-reference-datasets). The league is saved in this browser. <span className="dim">Version {BUILD}</span></span>
        <span className="foot-actions">
          <button className="ghost small host-only" onClick={() => setShowSettings(true)}>Season format</button>
          <button className="ghost small" onClick={() => setShowOnline(true)}>Online league</button>
          {!octx && <button className="ghost small" onClick={() => setShowHumans(true)}>Players & teams</button>}
          <button className="ghost small" onClick={() => setShowSaves(true)}>Saves</button>
          <button className="ghost small" onClick={startNew}>New league</button>
        </span>
      </footer>
      {showSaves && <SavesPanel lg={lg} close={() => setShowSaves(false)} onLoad={switchTo} onNew={startNew} />}
      {onlinePanel}
      {showHumans && <HumansPanel lg={lg} close={() => setShowHumans(false)} onChange={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
      {showSettings && <SettingsPanel lg={lg} close={() => setShowSettings(false)} onSaved={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
      {clutch && <ClutchGame lg={lg} cs={clutch} close={() => setClutch(null)} openPlayer={() => {}}
        onFinish={async () => { finishClutch(lg, clutch); bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
      {gameView && <GameModal lg={lg} res={gameView} close={() => setGameView(null)} hold={!!player} openPlayer={(pid: string) => setPlayer(pid)} />}
      {live && <LiveGame lg={lg} data={live} close={closeLive} hold={!!player} openPlayer={(pid: string) => setPlayer(pid)} />}
      {player && <PlayerPanel lg={lg} pid={player} findTrades={(pid: string) => { setPlayer(null); setTradeSeed({ pid, n: Date.now() }); go('mainai'); }} close={closePlayer} openTeam={(t) => { openTeam(t); }} onChange={async () => { bump(); setSaved((await saveLeague(lg)) ? 'ok' : 'fail'); }} />}
    </div>
  );
}

/** Sections: [key, label, shown in the phone's bottom bar (the rest go under "More")] */
const TABS: [string, string, boolean][] = [
  ['apzvalga', 'Overview', true], ['komandos', 'Teams', true], ['reitingai', 'Rankings', true], ['mainai', 'Trades', true],
  ['statistika', 'Stats', false], ['laisvieji', 'Free agents', false], ['algos', 'Salaries', false], ['draftai', 'Draft classes', false], ['istorija', 'History', false], ['rungtynes', 'Games', false],
];

/** The sections for this league: Team management only when the user runs a team. */
const tabsFor = (lg: any): [string, string, boolean][] => lg?.userTid ? [TABS[0], ['valdymas', 'Team management', true], ...TABS.slice(1).map(([k, l, m]) => [k, l, k === 'mainai' ? false : m] as [string, string, boolean])] : TABS;

/** Small line icons for the tab bar (bottom bar on phones). */
function TabIcon({ k }: { k: string }) {
  const d: Record<string, string> = {
    apzvalga: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    komandos: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
    reitingai: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    valdymas: 'M4 6h16M4 12h10M4 18h6M18 10l3 2-3 2',
    statistika: 'M3 3v18h18M7 15l4-4 3 3 6-7',
    mainai: 'M4 8h13l-3-3M20 16H7l3 3',
    laisvieji: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6M19 4v4M17 6h4',
    draftai: 'M4 5h16v14H4zM8 9h8M8 13h5',
    algos: 'M12 3v18M16 7c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3',
    istorija: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
    rungtynes: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    more: 'M5 12h.01M12 12h.01M19 12h.01M4 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0M11 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0M18 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  };
  return <svg className="ti" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={d[k]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function phaseLabel(lg: any) {
  if (lg.ended) return 'history complete';
  if (lg.phase === 'fantasy') return 'fantasy draft';
  if (lg.phase === 'regular') { const dl = deadlineDay(lg); return `regular season, day ${lg.day + 1} · ${lg.day < dl ? `trade deadline in ${dl - lg.day} day${dl - lg.day === 1 ? '' : 's'}` : lg.day === dl ? 'trade deadline today' : 'past the trade deadline'}`; }
  if (awaitingPlayoffs(lg)) return 'regular season over · awards';
  if (lg.phase === 'playoffs') return 'playoffs';
  if (lg.phase === 'draft' && offStep(lg) === 'recap') return 'season over';
  if (lg.phase === 'draft' && offStep(lg) === 'retire') return 'offseason · retirements';
  if (lg.phase === 'draft' && offStep(lg) === 'dev') return 'offseason · player development';
  if (lg.phase === 'regular' && lg.previewOpen === lg.season && lg.day === 0) return 'season preview';
  if (lg.phase === 'draft') return lg.draftDay?.year === lg.season ? (lg.draftDay.done ? 'draft complete' : lg.draftDay.stage === 'expansion' ? 'expansion draft' : lg.draftDay.stage === 'lottery' ? 'draft lottery' : 'draft day') : 'season over, draft ahead';
  if (lg.phase === 'freeagency') return !lg.fa ? 'offseason' : lg.fa.stage === 0 ? 'contract decisions' : lg.fa.stage <= 3 ? `free agency, wave ${lg.fa.stage}` : 'free agency over';
  return 'offseason';
}

function Controls({ lg, busy, run, stop, saved }: any) {
  if (busy) return (
    <div className="controls host-only">
      <span className="busy"><span className="dot"></span>{busy}…</span>
      <button className="ghost" onClick={stop}>Stop</button>
    </div>
  );
  if (lg.phase === 'fantasy') return <div className="controls host-only"><span className="hint">Fantasy draft in progress – the season starts when it ends.</span></div>;
  if (lg.ended) return <div className="controls host-only"><span className="hint">Reached the {seasonLabel(LAST_SEASON)} season – the historical data ends here.</span></div>;
  const b = (t: Target, l: string, primary = false) => <button className={primary ? 'primary' : ''} onClick={() => run(t, l)}>{l}</button>;
  return (
    <div className="controls host-only">
      {awaitingPlayoffs(lg) && b('day', 'Start the playoffs', true)}
      {(lg.phase === 'regular' || lg.phase === 'playoffs') && !awaitingPlayoffs(lg) && <>
        {b('day', 'Day')}
        {b('week', 'Week')}
        {lg.phase === 'playoffs' && b('round', 'Sim round')}
        {lg.phase === 'regular' && lg.day < deadlineDay(lg) && b('deadline', 'To trade deadline')}
        {lg.phase === 'regular' && b('playoffs', 'To end of regular season')}
        {b('seasonEnd', 'To season end', true)}
      </>}
      {lg.phase === 'draft' && offStep(lg) === 'recap' && b('day', 'Start the offseason', true)}
      {lg.phase === 'draft' && offStep(lg) === 'retire' && b('day', 'To player development', true)}
      {lg.phase === 'draft' && offStep(lg) === 'dev' && b('day', 'To draft day', true)}
      {lg.phase === 'draft' && offStep(lg) === 'draft' && (lg.draftDay?.year !== lg.season ? b('day', 'Start draft day', true)
        : !lg.draftDay.done ? b('day', 'Finish the draft') : b('day', 'To free agency', true))}
      {lg.phase === 'offseason' && b('day', 'To free agency', true)}
      {lg.phase === 'freeagency' && (lg.fa && lg.fa.stage === 0 ? b('day', 'Confirm decisions', true) : lg.fa && lg.fa.stage === 1 && !lg.fa.sumSeen ? b('day', 'Open the market', true) : lg.fa && lg.fa.stage <= 3 ? b('day', `Finish FA wave ${lg.fa.stage}`, true) : b('day', 'To the season preview', true))}
      {b('nextSeason', 'Full year')}
      {b('years5', '5 years')}
      {saved === 'fail' && <span className="hint warn">This browser doesn't allow saving the league.</span>}
    </div>
  );
}

function SettingsPanel({ lg, close, onSaved }: any) {
  const [form, setForm] = useState(() => formOf(lg.settings));
  const [result, setResult] = useState<string | null>(null);
  const f = playoffFormat(lg.season, lg);
  const save = () => {
    const when = applySettings(lg, settingsOf(form));
    setResult(when === 'now'
      ? `Saved. This season's schedule was rebuilt: ${seasonGames(lg)} games per team.`
      : 'Saved. Season length changes from next season; the playoff format applies from the next playoffs that haven\'t started yet.');
    onSaved();
  };
  return (
    <div className="overlay center" onClick={close}>
      <div className="dialog" role="dialog" aria-label="Season format" onClick={e => e.stopPropagation()}>
        <h2>Season format</h2>
        <label className="commish"><input type="checkbox" defaultChecked={showDollars()} onChange={e => { setShowDollars(e.target.checked); onSaved(); }} /> Show salaries in dollars too (that season's money). Off: everything is a share of the salary cap – the same in every era.</label>
        <p className="note">Now: {seasonGames(lg)} games per season, {f.perConf} playoff teams per conference{f.playIn ? ' with a play-in' : ''}, series {f.bestOf.map(b => b === 1 ? '1 game' : `best of ${b}`).join(' / ')}.</p>
        <SeasonFields form={form} setForm={setForm} idp="set-" />
        {result && <p className="ok-msg">{result}</p>}
        <div className="dialog-actions">
          <button className="ghost" onClick={close}>Close</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function SavesPanel({ lg, close, onLoad, onNew }: any) {
  const [saves, setSaves] = useState<any[]>([]);
  const [edit, setEdit] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [ask, setAsk] = useState<string | null>(null);
  const refresh = () => listSaves().then(setSaves);
  useEffect(() => { refresh(); }, []);
  const cur = currentSlot();
  const copy = async () => { const id = newSlotId(); const c = JSON.parse(JSON.stringify(lg)); c.saveName = `${lg.saveName ?? 'League'} (copy)`; await saveLeague(c, id); refresh(); };
  return (
    <div className="overlay center" onClick={close}>
      <div className="dialog saves" role="dialog" aria-label="Saved leagues" onClick={e => e.stopPropagation()}>
        <h2>Saved leagues</h2>
        <p className="note">Every league is saved automatically in this browser. Keep as many as you like and switch between them.</p>
        <ul className="save-list">{saves.map(sv => (
          <li key={sv.id} className={sv.id === cur ? 'mine' : ''}>
            {edit === sv.id
              ? <span className="save-edit"><input value={name} onChange={e => setName(e.target.value)} aria-label="Save name" /><button className="small primary" onClick={async () => { const nm = name.trim() || sv.name; if (sv.id === cur) { lg.saveName = nm; await saveLeague(lg); } else await renameSave(sv.id, nm); setEdit(null); refresh(); }}>OK</button></span>
              : <span><b>{sv.name}</b>{sv.id === cur ? <span className="chip tiny">playing</span> : null}<br /><span className="dim">{sv.label} · saved {new Date(sv.updated).toLocaleString()}</span></span>}
            <span className="save-actions">
              {sv.id !== cur && <button className="small primary" onClick={() => onLoad(sv.id)}>Load</button>}
              <button className="small" onClick={() => { setEdit(sv.id); setName(sv.name); }}>Rename</button>
              {ask === sv.id
                ? <><button className="small danger" onClick={async () => { await deleteSave(sv.id); setAsk(null); if (sv.id === cur) onNew(); else refresh(); }}>Delete for good</button> <button className="small ghost" onClick={() => setAsk(null)}>Cancel</button></>
                : <button className="small ghost" onClick={() => setAsk(sv.id)}>Delete</button>}
            </span>
          </li>
        ))}</ul>
        <Devices lg={lg} onLoad={onLoad} />
        <div className="dialog-actions">
          <button onClick={copy}>Save a copy of this league</button>
          <button onClick={onNew}>Start a new league</button>
          <button className="ghost" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ResetButton({ onReset }: any) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button className="ghost small" onClick={() => setAsk(true)}>New league</button>;
  return <span className="confirm">Delete the current league? <button className="danger small" onClick={onReset}>Yes, delete</button> <button className="ghost small" onClick={() => setAsk(false)}>Cancel</button></span>;
}

// ---------------------------------------------------------------- setup
const GAME_OPTS: [string, string][] = [['', 'As in history (82; 1998–99 – 50, 2011–12 – 66)'], ['rr1', 'Each team once'], ['rr2', 'Each team twice (home and away)'], ['82', '82 games'], ['72', '72'], ['66', '66'], ['58', '58'], ['50', '50'], ['41', '41 (half season)'], ['30', '30'], ['20', '20'], ['12', '12'], ['custom', 'Other number…']];
const LEN_OPTS: [string, string][] = [['', 'As in history'], ['1', '1 game'], ['3', 'Best of 3'], ['5', 'Best of 5'], ['7', 'Best of 7'], ['9', 'Best of 9']];
const ROUND_NAMES = ['First round', 'Second round', 'Conference finals', 'Finals'];

/** form state ⇄ league settings */
function formOf(st: any) {
  const g = st?.games;
  const preset = st?.rr ? `rr${st.rr}` : g == null ? '' : GAME_OPTS.some(([v]) => v === String(g)) ? String(g) : 'custom';
  const rounds = (st?.poRounds ?? [null, null, null, null]).map((x: any, i: number) => (x ?? st?.series ?? '') === '' ? '' : String(x ?? st?.series));
  return { games: preset, custom: g ? String(g) : '60', poTeams: st?.poTeams ? String(st.poTeams) : '', playIn: st?.playIn == null ? '' : st.playIn ? 'on' : 'off', rounds, hardCap: st?.hardCap === null ? 'none' : st?.hardCap ? String(st.hardCap) : '', rfa: st?.rfaHistoric ? 'all' : '', inj: st?.noInjuries ? 'off' : '' };
}
function settingsOf(f: any) {
  const rr = f.games.startsWith('rr') ? +f.games.slice(2) : null;
  const games = rr || f.games === '' ? null : f.games === 'custom' ? Math.max(4, Math.min(120, Math.round(+f.custom || 60))) : +f.games;
  return {
    games, rr, series: null,
    poTeams: f.poTeams ? +f.poTeams : null,
    playIn: f.playIn === '' ? null : f.playIn === 'on',
    poRounds: f.rounds.map((x: string) => (x ? +x : null)),
    hardCap: f.hardCap === 'none' ? null : f.hardCap ? +f.hardCap : undefined,
    rfaHistoric: f.rfa === 'all',
    noInjuries: f.inj === 'off',
  };
}

function SeasonFields({ form, setForm, idp = '' }: any) {
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const teams = form.poTeams ? +form.poTeams : 8;
  const used = teams === 2 ? 2 : teams === 4 ? 3 : 4;
  return <>
    <label className="field" htmlFor={idp + 'games'}>
      <span>Regular season</span>
      <select id={idp + 'games'} value={form.games} onChange={e => set('games', e.target.value)}>
        {GAME_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {form.games === 'custom' && <input id={idp + 'games-n'} type="number" min="4" max="120" value={form.custom} onChange={e => set('custom', e.target.value)} aria-label="Number of games" />}
      <small>{form.games.startsWith('rr') ? 'The number of games adapts to the number of teams: 22 teams in 1980 – 21 games, 29 teams after 1995 – 28.' : 'Award thresholds and injury lengths adapt to the season length.'}</small>
    </label>
    <div className="field-row">
      <label className="field" htmlFor={idp + 'poteams'}>
        <span>Playoff teams</span>
        <select id={idp + 'poteams'} value={form.poTeams} onChange={e => set('poTeams', e.target.value)}>
          <option value="">As in history</option>
          <option value="2">2 per conference</option>
          <option value="4">4 per conference</option>
          <option value="6">6 (top 2 get a bye)</option>
          <option value="8">8 per conference</option>
        </select>
      </label>
      <label className="field" htmlFor={idp + 'playin'}>
        <span>Play-in tournament</span>
        <select id={idp + 'playin'} value={form.playIn} onChange={e => set('playIn', e.target.value)}>
          <option value="">As in history (from 2021)</option>
          <option value="on">Always</option>
          <option value="off">Never</option>
        </select>
      </label>
    </div>
    <div className="field">
      <span>Series length</span>
      <div className="rounds">
        {ROUND_NAMES.map((n, i) => {
          const active = i >= 4 - used;
          return (
            <label key={n} htmlFor={idp + 'r' + i} className={active ? '' : 'unused'}>
              <small>{n}</small>
              <select id={idp + 'r' + i} value={form.rounds[i]} disabled={!active} onChange={e => { const r = [...form.rounds]; r[i] = e.target.value; set('rounds', r); }}>
                {LEN_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      <small>Historically the first round was best of 3 in 1980–83 and best of 5 in 1984–2002; later all series are best of 7. The play-in decides the last two spots.</small>
    </div>
    <label className="field" htmlFor={idp + 'hardcap'}>
      <span>Hard cap</span>
      <select id={idp + 'hardcap'} value={form.hardCap ?? ''} onChange={e => set('hardCap', e.target.value)}>
        <option value="">135% of the cap (default)</option>
        <option value="1.15">115% of the cap</option>
        <option value="1.25">125% of the cap</option>
        <option value="1.5">150% of the cap</option>
        <option value="none">None</option>
      </select>
      <small>No team may carry a higher payroll: signings, extensions and trades that would exceed it are not allowed. Teams near the limit look for ways to shed salary themselves (moving contracts to teams with room, attaching picks), and before the season the last resort is releasing a player (half of his salary stays on the books until his contract ends).</small>
    </label>
    <label className="field" htmlFor={idp + 'rfa'}>
      <span>Restricted free agency</span>
      <select id={idp + 'rfa'} value={form.rfa ?? ''} onChange={e => set('rfa', e.target.value)}>
        <option value="">Only after the first (rookie) contract</option>
        <option value="all">Historical: every free agent before 1988–89</option>
      </select>
      <small>A restricted free agent's old team can match any offer sheet. Until the 1988 agreement real NBA teams had this right of first refusal over all their free agents.</small>
    </label>
    <label className="field" htmlFor={idp + 'inj'}>
      <span>Injuries</span>
      <select id={idp + 'inj'} value={form.inj ?? ''} onChange={e => set('inj', e.target.value)}>
        <option value="">On – players get hurt, as in real seasons</option>
        <option value="off">Off – nobody gets hurt</option>
      </select>
      <small>Turning them off also heals everyone who is injured now. It takes effect right away.</small>
    </label>
  </>;
}

function Setup({ onStart, onLoad }: any) {
  const [saves, setSaves] = useState<any[]>([]);
  useEffect(() => { listSaves().then(setSaves); }, []);
  const [d, setD] = useState(0);
  const [form, setForm] = useState(() => formOf(null));
  const [fantasy, setFantasy] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [user, setUser] = useState('');
  const [start, setStart] = useState(1980);
  const [mode, setMode] = useState<'real' | 'shuffle' | 'mixed'>('real');
  const [fmode, setFmode] = useState<'shuffle' | 'chrono' | 'mixed'>('shuffle');
  const si = seasonInfo(start);
  const teams = Object.entries(si.teams).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const years: number[] = [];
  for (let y = 1980; y <= LAST_SEASON + 1; y++) years.push(y);
  const future = start > LAST_SEASON;
  const label = `${start - 1}–${String(start).slice(2)}`;
  const desc = d >= 90 ? 'Players develop almost exactly as in reality. Only teams, roles and results differ.'
    : d >= 60 ? 'Real careers pull strongly, but not everyone will reach their real level.'
    : d >= 30 ? 'The real career is hidden potential. Stars usually grow, but there are plenty of surprises.'
    : 'Alternate history: only the draft-day profile is known. Jordan might not become Jordan.';
  const pickYear = (y: number) => { setStart(y); if (user && !seasonInfo(y).teams[user]) setUser(''); };
  return (
    <div className="setup">
      <div className="setup-card">
        <p className="eyebrow">{label} season · {teams.length} teams · real rosters</p>
        <h1>NBA History Simulator</h1>
        {saves.length > 0 && <div className="saves-mini">
          <b>Continue a saved league</b>
          <ul>{saves.slice(0, 6).map(sv => <li key={sv.id}><span><b>{sv.name}</b> <span className="dim">{sv.label} · {new Date(sv.updated).toLocaleDateString()}</span></span><button className="small primary" onClick={() => onLoad(sv.id)}>Load</button></li>)}</ul>
        </div>}
        <details className="more"><summary>Continue from another device</summary><Devices lg={null} onLoad={onLoad} /></details>
        <p className="lede">Rewrite NBA history. The league starts with the real players of {label}. New draft classes arrive every year, and how they develop is up to the simulation and the destiny slider.</p>
        <label className="field" htmlFor="start">
          <span>Starting season</span>
          <select id="start" value={start} onChange={e => pickYear(+e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y - 1}–{String(y).slice(2)}{y > LAST_SEASON ? ' – today\'s rosters' : ''}</option>)}
          </select>
          <small>{future ? `Today's NBA: the real ${LAST_SEASON}–${String(LAST_SEASON + 1).slice(2)} opening-night rosters, ${LAST_SEASON} rookies included (rated from their draft slot; everyone else from his ${LAST_SEASON - 1}–${String(LAST_SEASON).slice(2)} season). From the next draft on, the rookies are historical ones coming round again (copies of the players, developing like the originals did) – choose how below.` : 'Teams and rosters are as they were that season. The league has no stats from earlier years: history starts here.'}</small>
        </label>
        {future && <fieldset className="field radio-set">
          <legend>Draft classes from {LAST_SEASON + 1} on</legend>
          {FUTURE_MODES.map(([k, l, txt]) => (
            <label key={k} className={`radio ${fmode === k ? 'on' : ''}`}>
              <input type="radio" name="futuremode" value={k} checked={fmode === k} onChange={() => setFmode(k)} />
              <span><b>{l}</b><small>{txt}</small></span>
            </label>
          ))}
          <small>A class (or, mixed, a player) only comes round again once every one of its players has retired – nobody plays against his own copy.</small>
        </fieldset>}
        {!future && <fieldset className="field radio-set">
          <legend>Draft classes</legend>
          {CLASS_MODES.map(([k, l, txt]) => (
            <label key={k} className={`radio ${mode === k ? 'on' : ''}`}>
              <input type="radio" name="classmode" value={k} checked={mode === k} onChange={() => setMode(k)} />
              <span><b>{l}</b><small>{txt}</small></span>
            </label>
          ))}
        </fieldset>}
        <label className="field" htmlFor="destiny">
          <span>Destiny slider <b>{d}%</b></span>
          <input id="destiny" type="range" min="0" max="100" step="5" value={d} onChange={e => setD(+e.target.value)} />
          <small>{desc}{mode !== 'real' ? ' With mixed classes, destiny works by career year: a rookie develops like the real player did in the same year of his career.' : ''}</small>
        </label>
        <label className="field" htmlFor="team">
          <span>Your team (highlighted)</span>
          <select id="team" value={user} onChange={e => setUser(e.target.value)}>
            <option value="">None – just watching</option>
            {teams.map(([tid, t]) => <option key={tid} value={tid}>{t.name}</option>)}
          </select>
        </label>
        <label className="field" htmlFor="seed">
          <span>Random seed</span>
          <input id="seed" type="number" value={seed} onChange={e => setSeed(+e.target.value)} />
          <small>The same seed and settings produce the same history.</small>
        </label>
        <label className="field check" htmlFor="fantasy">
          <span><input id="fantasy" type="checkbox" checked={fantasy} onChange={e => setFantasy(e.target.checked)} /> Fantasy draft</span>
          <small>All {label} players go into one pool and teams draft their rosters from scratch. You pick for your own team.</small>
        </label>
        <details className="more">
          <summary>Season and playoff format</summary>
          <SeasonFields form={form} setForm={setForm} />
        </details>
        <button className="primary big" onClick={() => onStart(d / 100, seed, user || null, settingsOf(form), fantasy, start, mode, fmode)}>{fantasy ? 'To the fantasy draft' : 'Start the league'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- overview
/** Overview panels fold like every other panel (see usePanelFolding); kept as a plain wrapper. */
function Fold({ children }: any) { return children ?? null; }

function Overview({ lg, openTeam, openPlayer, openGame, watch, clutch, busy, sampler, onSaved, goFA, onTick }: any) {
  const last = lg.history[lg.history.length - 1];
  const step = lg.phase === 'draft' ? offStep(lg) : null;
  if (step === 'recap') return (
    <div className="col">
      <StepBar lg={lg} />
      <RecapStep lg={lg} onChange={onSaved}>
        <div className="grid-2">
          <section className="col">{last && <SeasonCard lg={lg} s={last} openPlayer={openPlayer} />}<Fold id="standings" title="Standings"><Standings lg={lg} openTeam={openTeam} /></Fold></section>
          <section className="col">{lg.series.length ? <Bracket lg={lg} openTeam={openTeam} openGame={openGame} /> : null}<Fold id="news" title="League news"><News lg={lg} /></Fold></section>
        </div>
      </RecapStep>
    </div>
  );
  if (awaitingPlayoffs(lg)) return (
    <div className="col">
      <AwardsStep lg={lg} onChange={onSaved} openPlayer={openPlayer} />
      <Fold id="standings" title="Standings"><Standings lg={lg} openTeam={openTeam} /></Fold>
    </div>
  );
  if (step === 'retire') return <div className="col"><StepBar lg={lg} /><RetireStep lg={lg} onChange={onSaved} openPlayer={openPlayer} /></div>;
  if (step === 'dev') return <div className="col"><StepBar lg={lg} /><DevStep lg={lg} onChange={onSaved}><Progression lg={lg} openPlayer={openPlayer} openTeam={openTeam} /></DevStep></div>;
  if (lg.phase === 'regular' && lg.previewOpen === lg.season && !lg.schedule.some((g: any) => g.done)) return (
    <div className="col">
      <StepBar lg={lg} />
      <PreviewStep lg={lg} onChange={onSaved}>
        <SeasonPreview lg={lg} openTeam={openTeam} />
        <div className="grid-2">
          <section className="col"><Fold id="today" title="Opening night"><Today lg={lg} watch={watch} clutch={clutch} busy={busy} openGame={openGame} /></Fold></section>
          <section className="col"><Fold id="news" title="League news"><News lg={lg} /></Fold></section>
        </div>
      </PreviewStep>
    </div>
  );
  if (lg.phase === 'draft') return (
    <div className="col">
      <StepBar lg={lg} />
      <DraftRoom lg={lg} onChange={onSaved} onTick={onTick} openPlayer={openPlayer} openTeam={openTeam} />
      <div className="grid-2">
        <section className="col">{last && <Fold id="results" title="Season results"><SeasonCard lg={lg} s={last} openPlayer={openPlayer} /></Fold>}<Fold id="standings" title="Standings"><Standings lg={lg} openTeam={openTeam} /></Fold></section>
        <section className="col"><Fold id="reporter" title="Daily roundup" sel=".eyebrow"><Reporter lg={lg} sampler={sampler} busy={busy} onSaved={onSaved} /></Fold><Fold id="news" title="League news"><News lg={lg} /></Fold></section>
      </div>
    </div>
  );
  if (lg.phase === 'freeagency' || lg.phase === 'offseason') return (
    <div className="col">
      <StepBar lg={lg} />
      {lg.phase === 'freeagency' ? <FAHub lg={lg} onChange={onSaved} openPlayer={openPlayer} openTeam={openTeam} goFA={goFA} />
        : <div className="panel accent"><h2>Draft complete</h2><p className="note">Click “To free agency” at the top.</p></div>}
      <div className="grid-2">
        <section className="col">{last && <Fold id="results" title="Season results"><SeasonCard lg={lg} s={last} openPlayer={openPlayer} /></Fold>}</section>
        <section className="col"><Fold id="news" title="League news"><News lg={lg} /></Fold></section>
      </div>
    </div>
  );
  return (
    <div className="grid-2">
      <section className="col">
        <Fold id="today" title={lg.phase === 'playoffs' ? 'Next playoff games' : 'Today\'s games'}><Today lg={lg} watch={watch} clutch={clutch} busy={busy} openGame={openGame} /></Fold>
        {lg.phase === 'playoffs' || (lg.series.length && lg.phase !== 'regular') ? <Fold id="bracket" title={`${lg.season} Playoffs`}><Bracket lg={lg} openTeam={openTeam} openGame={openGame} /></Fold> : null}
        <Fold id="standings" title="Standings"><Standings lg={lg} openTeam={openTeam} /></Fold>
      </section>
      <section className="col">
        {lg.phase === 'regular' && <SeasonPreview lg={lg} openTeam={openTeam} />}
        {lg.phase === 'playoffs' && <Fold id="series" title="Series previews"><PlayoffPreviews lg={lg} openGame={openGame} /></Fold>}
        {lg.phase === 'playoffs' && lg.seasonAwards && <Fold id="awards" title="Awards"><RegAwardsCard lg={lg} a={lg.seasonAwards} openPlayer={openPlayer} /></Fold>}
        {last && (lg.phase === 'draft' || lg.phase === 'offseason') && <Fold id="results" title="Season results"><SeasonCard lg={lg} s={last} openPlayer={openPlayer} /></Fold>}
        <Fold id="latest" title="Latest games"><TodayGames lg={lg} openGame={openGame} /></Fold>
        <Fold id="reporter" title="Daily roundup" sel=".eyebrow"><Reporter lg={lg} sampler={sampler} busy={busy} onSaved={onSaved} /></Fold>
        <Fold id="news" title="League news"><News lg={lg} /></Fold>
      </section>
    </div>
  );
}

/** Current streak and last-ten record of every team, from this season's finished games. */
function streakOf(lg: any) {
  const res: Record<string, boolean[]> = {};
  const games = lg.schedule.filter((g: any) => g.done && g.hs != null).sort((a: any, b: any) => a.day - b.day || a.id - b.id);
  for (const g of games) { (res[g.home] ??= []).push(g.hs > g.as); (res[g.away] ??= []).push(g.as > g.hs); }
  const out: Record<string, { strk: string; n: number; win: boolean; l10: string }> = {};
  for (const [tid, r] of Object.entries(res)) {
    if (!r.length) continue;
    const last = r[r.length - 1];
    let n = 0; for (let i = r.length - 1; i >= 0 && r[i] === last; i--) n++;
    const ten = r.slice(-10), w = ten.filter(Boolean).length;
    out[tid] = { strk: `${last ? 'W' : 'L'}${n}`, n, win: last, l10: `${w}–${ten.length - w}` };
  }
  return out;
}

function Standings({ lg, openTeam }: any) {
  const f = playoffFormat(lg.season, lg);
  const form = useMemo(() => streakOf(lg), [lg, lg.day]);
  return (
    <div className="panel">
      <h2>Standings</h2>
      <div className="conf-wrap">
        {['E', 'W'].map(c => (
          <div key={c} className="tbl-wrap">
            <table className="tbl">
              <caption>{c === 'E' ? 'Eastern Conference' : 'Western Conference'}</caption>
              <thead><tr><th>#</th><th className="l">Team</th><th>W</th><th>L</th><th>%</th><th title="Games behind the conference leader">GB</th><th title="Current streak">Strk</th><th title="Last 10 games">L10</th><th>+/−</th></tr></thead>
              <tbody>
                {standings(lg, c).map((t: any, i: number, arr: any[]) => {
                  const gb = ((arr[0].w - t.w) + (t.l - arr[0].l)) / 2;
                  const fm = form[t.tid];
                  const cut = i + 1 === f.perConf || (f.playIn && i + 1 === 10);
                  return (
                    <tr key={t.tid} className={`${t.tid === lg.userTid ? 'mine' : ''} ${cut ? 'cut' : ''}`}>
                      <td className="dim">{i + 1}</td>
                      <td className="l"><TLogo lg={lg} tid={t.tid} /><button className="link" onClick={() => openTeam(t.tid)}>{t.name}</button></td>
                      <td>{t.w}</td><td>{t.l}</td>
                      <td>{pct(t.w, t.w + t.l)}</td>
                      <td className="dim">{gb > 0 ? gb.toFixed(1).replace('.0', '') : '–'}</td>
                      <td className={fm ? (fm.win ? (fm.n >= 3 ? 'pos' : '') : (fm.n >= 3 ? 'neg' : '')) : 'dim'}>{fm ? fm.strk : '–'}</td>
                      <td className="dim">{fm ? fm.l10 : '–'}</td>
                      <td className={t.pf - t.pa >= 0 ? 'pos' : 'neg'}>{t.w + t.l ? ((t.pf - t.pa) / (t.w + t.l)).toFixed(1) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="note">The line marks the playoff cutoff ({f.perConf} teams per conference{f.playIn ? ', seeds 7–10 play the play-in' : ''}).</p>
    </div>
  );
}

function Bracket({ lg, openTeam, openGame }: any) {
  const [prev, setPrev] = useState<any>(null);
  const ab = (tid: string) => (tid ? lg.teams[tid].abbr : '…');
  const rounds = [...new Set(lg.series.map((s: any) => s.round))].sort();
  const names = ['First round', 'Conference semifinals', 'Conference finals', 'Finals'];
  const f = playoffFormat(lg.season, lg);
  const R = f.bestOf.length;
  const nameOf = (r: number) => ['Finals', 'Conference finals', 'Conference semifinals', 'First round'][Math.max(0, R - r)] ?? `Round ${r}`;
  return (
    <div className="panel">
      <h2>{lg.season} Playoffs</h2>
      {lg.playIn.length > 0 && (
        <div className="playin">
          {lg.playIn.map((g: any) => <span key={g.label} className="chip">{g.txt ?? g.label}: {ab(g.a)}–{ab(g.b)} {g.winner ? `→ ${ab(g.winner)}` : ''}</span>)}
        </div>
      )}
      <div className="bracket">
        {rounds.map((r: any) => (
          <div key={r} className="round">
            <h3>{nameOf(r)}</h3>
            {lg.series.filter((s: any) => s.round === r).map((s: any, i: number) => (
              <div key={i} className={`series ${s.winner ? 'done' : ''} ${s.hi && s.lo ? 'clickable' : ''}`} title={s.hi && s.lo ? 'Series: preview and games' : undefined} onClick={() => s.hi && s.lo && setPrev(s)}>
                {[['hi', s.hiSeed, s.hw], ['lo', s.loSeed, s.lw]].map(([k, seed, w]: any) => (
                  <div key={k} className={`side ${s.winner && s.winner === s[k] ? 'win' : ''} ${s[k] === lg.userTid ? 'mine' : ''}`}>
                    <span className="seed">{s[k] ? seed : ''}</span>
                    <button className="link" disabled={!s[k]} onClick={e => { e.stopPropagation(); openTeam(s[k]); }}>{ab(s[k])}</button>
                    <span className="w">{s[k] ? w : ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {prev && <SeriesDialog lg={lg} s={prev} close={() => setPrev(null)} openGame={openGame} />}
    </div>
  );
}

function SeasonCard({ lg, s, openPlayer }: any) {
  const P = (pid: string) => pid ? <button className="link" onClick={() => openPlayer(pid)}>{lg.players[pid]?.name}</button> : '–';
  const titles = lg.history.filter((h: any) => h.champion === s.champion).length;
  const a = s.awards;
  return (
    <div className="panel accent">
      <h2>{seasonLabel(s.season)} season results</h2>
      <dl className="facts">
        <dt>Champion</dt><dd><b><TL tid={s.champion} /></b> <span className="dim">(title No. {titles} in this league)</span></dd>
        {s.runnerUp && <><dt>Finals</dt><dd>vs <TL tid={s.runnerUp} /></dd>
        <dt>Finals MVP</dt><dd>{P(s.fmvp)}</dd></>}
        <dt>MVP</dt><dd>{P(s.mvp)}</dd>
        {a && <><dt>DPOY</dt><dd>{P(a.dpoy)}</dd><dt>ROY</dt><dd>{P(a.roy)}</dd><dt>6MOY</dt><dd>{P(a.smoy)}</dd><dt>MIP</dt><dd>{P(a.mip)}</dd></>}
        {!a && <><dt>Rookie of the Year</dt><dd>{P(s.roy)}</dd></>}
      </dl>
      {a && <AwardTeams lg={lg} a={a} openPlayer={openPlayer} compact />}
      {s.draft && s.draft[0] && <p className="note">Draft done: No. 1 – {P(s.draft[0].pid)}. The full list is under “Draft classes”.</p>}
      {s.lottery && <p className="note"><Linkify text={s.lottery} /></p>}
      {s.notes.map((n: string, i: number) => <p key={i} className="note"><Linkify text={n} /></p>)}
    </div>
  );
}

function RegAwardsCard({ lg, a, openPlayer }: any) {
  const P = (pid: string) => pid ? <button className="link" onClick={() => openPlayer(pid)}>{lg.players[pid]?.name}</button> : '–';
  return (
    <div className="panel accent">
      <h2>{seasonLabel(lg.season)} awards</h2>
      <p className="note">Handed out after the regular season. The Finals MVP is decided after the Finals.</p>
      <dl className="facts">
        <dt>MVP</dt><dd>{P(a.mvp)}</dd>
        <dt>DPOY</dt><dd>{P(a.dpoy)}</dd>
        <dt>ROY</dt><dd>{P(a.roy)}</dd>
        <dt>6MOY</dt><dd>{P(a.smoy)}</dd>
        <dt>MIP</dt><dd>{a.mip ? P(a.mip) : <span className="dim">not awarded</span>}</dd>
      </dl>
      <AwardTeams lg={lg} a={a} openPlayer={openPlayer} compact />
    </div>
  );
}

function AwardTeams({ lg, a, openPlayer, compact }: any) {
  const P = (pid: string) => <button className="link" onClick={() => openPlayer(pid)}>{lg.players[pid]?.name ?? pid}</button>;
  const groups = [['All-League', a.allNba], ['All-Defensive', a.allDef], ['All-Rookie', a.allRookie]];
  return (
    <details className="more" open={!compact}>
      <summary>All-League teams</summary>
      <div className="award-teams">
        {groups.map(([name, teams]: any) => teams.map((t: string[], i: number) => (
          <div key={name + i} className="award-team">
            <h3>{name} – {['1st', '2nd', '3rd'][i] ?? i + 1} team</h3>
            <ul>{t.map(pid => <li key={pid}>{P(pid)} <span className="dim">{lg.players[pid]?.pos}</span></li>)}</ul>
          </div>
        )))}
      </div>
    </details>
  );
}

function Today({ lg, watch, clutch, busy, openGame }: any) {
  const games = watchableToday(lg);
  const done = playedToday(lg);
  if (!games.length && !done.length) return null;
  const mine = (g: any) => g.home === lg.userTid || g.away === lg.userTid;
  const sorted = [...games].sort((x, y) => Number(mine(y)) - Number(mine(x)));
  const rec = (tid: string) => `${lg.teams[tid].w}–${lg.teams[tid].l}`;
  const b2b = (tid: string, day?: number) => lg.phase === 'regular' && day !== undefined && lg.schedule.some((x: any) => x.day === day - 1 && (x.home === tid || x.away === tid));
  const [ser, setSer] = useState<any>(null);
  const seriesOf = (g: any) => lg.phase === 'playoffs' ? lg.series.find((s: any) => (s.hi === g.home && s.lo === g.away) || (s.hi === g.away && s.lo === g.home)) : null;
  return (
    <div className="panel today">
      {ser && <SeriesDialog lg={lg} s={ser} close={() => setSer(null)} openGame={openGame} />}
      <div className="today-head">
        <h2>{lg.phase === 'playoffs' ? 'Next playoff games' : 'Today\'s games'}</h2>
        <span className="dim">Watch a game, sim it straight to the result, or jump to the last 5 minutes. Your own games can also be coached in the last 5 minutes. Games wait until you play or sim them.</span>
      </div>
      <ul className="watch-list">
        {sorted.map((g: any) => (
          <li key={g.home + g.away} className={mine(g) ? 'mine' : ''}>
            <span className="wl-teams">
              <span><TLogo lg={lg} tid={g.away} /><TL tid={g.away} /> <span className="dim">{lg.phase === 'regular' ? rec(g.away) : ''}</span>{b2b(g.away, g.day) && <span className="chip tiny b2b" title="Played yesterday – second game in a row">B2B</span>}</span>
              <span className="at">@</span>
              <span><TLogo lg={lg} tid={g.home} /><TL tid={g.home} /> <span className="dim">{lg.phase === 'regular' ? rec(g.home) : ''}</span>{b2b(g.home, g.day) && <span className="chip tiny b2b" title="Played yesterday – second game in a row">B2B</span>}</span>
              {g.label && (seriesOf(g) ? <button className="chip tiny series-chip" title="Series: preview and games so far" onClick={() => setSer(seriesOf(g))}>{g.label} ›</button> : <span className="chip tiny">{g.label}</span>)}
            </span>
            <span className="wl-actions">
              <button disabled={busy} onClick={() => watch(g.home, g.away)}>Watch live</button>
              <button disabled={busy} title="Play this game now and see the result" onClick={() => watch(g.home, g.away, 0, false)}>Sim game</button>
              <button disabled={busy} title="Watch from 5:00 left in the 4th quarter" onClick={() => watch(g.home, g.away, 2580)}>Go to last 5 min</button>
              {g.label !== 'Play-in' && (g.home === lg.userTid || g.away === lg.userTid) &&
                <button className="primary" disabled={busy} title="Coach the last five minutes yourself" onClick={() => clutch(g.home, g.away, g.home === lg.userTid ? 'h' : 'a')}>Coach last 5 min</button>}
            </span>
          </li>
        ))}
        {done.map((r: any) => {
          const hw = r.home.pts > r.away.pts;
          return (
            <li key={r.id} className="played">
              <span className="wl-teams">
                <span className={!hw ? 'win' : 'dim'}><TLogo lg={lg} tid={r.away.tid} /><TL tid={r.away.tid} /> {r.away.pts}</span>
                <span className="at">@</span>
                <span className={hw ? 'win' : 'dim'}><TLogo lg={lg} tid={r.home.tid} /><TL tid={r.home.tid} /> {r.home.pts}</span>
                <span className="chip tiny">final{r.ot ? ' · OT' : ''}</span>{r.ser && <span className="chip tiny">{r.ser}</span>}
              </span>
              <span className="wl-actions"><button onClick={() => openGame(r.id)}>Box score</button></span>
            </li>
          );
        })}
      </ul>
      {games.length > 0 && done.length > 0 && <p className="note">The rest of the day's games are played when you click “Day” or another sim button.</p>}
    </div>
  );
}

function TodayGames({ lg, openGame }: any) {
  const games = lg.recent.slice(-8).reverse();
  if (!games.length) return null;
  return (
    <div className="panel">
      <h2>Latest games</h2>
      <p className="note">Click a score to open the box score.</p>
      <ul className="scores">
        {games.map((g: any) => {
          const hw = g.home.pts > g.away.pts;
          return (
            <li key={g.id}><button className="score-btn" onClick={() => openGame(g.id)} title="Box score">
              <span className={!hw ? 'win' : ''}><TLogo lg={lg} tid={g.away.tid} size={16} />{lg.teams[g.away.tid].abbr} {g.away.pts}</span>
              <span className="at">@</span>
              <span className={hw ? 'win' : ''}><TLogo lg={lg} tid={g.home.tid} size={16} />{lg.teams[g.home.tid].abbr} {g.home.pts}</span>
              {g.ot ? <span className="ot">{g.ot > 1 ? `${g.ot}OT` : 'OT'}</span> : null}
              {g.po ? <span className="chip tiny">PO</span> : null}
            </button></li>
          );
        })}
      </ul>
    </div>
  );
}

function News({ lg }: any) {
  const items = lg.news.slice(-14).reverse();
  return (
    <div className="panel">
      <h2>League news</h2>
      <ul className="news">
        {items.map((n: any, i: number) => <li key={i}><span className="yr">{n.s}</span><span><Linkify text={n.t} /></span></li>)}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- team
function TeamView({ lg, tid, setTid, openPlayer, openGame }: any) {
  const t = lg.teams[tid] ?? Object.values(lg.teams)[0];
  const teams = Object.values(lg.teams).filter((x: any) => x.active).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const roster = t.roster.map((pid: string) => lg.players[pid]).sort((a: any, b: any) => ovrOf(b.z) - ovrOf(a.z));
  const pay = payroll(lg, t.tid);
  const strat = t.mode ? { allin: 'All-in', tank: 'Tanking', rising: 'Rising', capclear: 'Clearing salary', retool: 'Retooling' }[t.mode] : { contend: 'Contender', middle: 'Middle of the pack', rebuild: 'Rebuilding' }[t.strategy];
  const titles = lg.history.filter((s: any) => s.champion === t.tid).map((s: any) => s.season);
  const plan = !isHuman(lg, t.tid) ? planOf(lg, t.tid) : null;
  const [view, setView] = useNavState<'stats' | 'attr' | 'hist' | 'rec'>('team.view', 'stats');
  const inSeason = lg.phase === 'regular' || lg.phase === 'playoffs';
  const calNow = inSeason ? nextCal(lg, todayIndex(lg)) : 0;
  const RT = (p: any, i: number) => ratingOf(p.z[RATING_LABELS[i].k], RATING_LABELS[i].inv);
  const attrCols = [
    { key: 'name', label: 'Player', left: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><PFace lg={lg} p={r.p} /><button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button>{r.p.injury > 0 && <span className="inj" title={r.p.inj ? `${injName(r.p.inj.k)} – out ~${r.p.injury} more games` : 'Injured'}>+{r.p.injury}</span>}</> },
    { key: 'pos', label: 'Pos', get: (r: any) => r.p.pos, fmt: (v: any) => <span className="dim">{v}</span> },
    { key: 'role', label: 'Role', left: true, asc: true, get: (r: any) => roleOf(r.p.z, r.p.pos).arch.name, fmt: (_: any, r: any) => { const ro = roleOf(r.p.z, r.p.pos); return <><RoleBadge id={ro.arch.id} />{ro.second && <RoleBadge id={ro.second.id} small />}</>; } },
    { key: 'ht', label: 'Ht', title: 'Height, cm', get: (r: any) => Math.round(r.p.ht * 2.54) },
    { key: 'age', label: 'Age', asc: true, get: (r: any) => ageIn(r.p, lg.season) },
    { key: 'ovr', label: 'OVR', get: (r: any) => ovrOf(r.p.z), fmt: (v: any) => <Ovr v={v} small /> },
    { key: 'pot', label: 'Pot.', title: 'Potential', get: (r: any) => potOf(r.p, lg.season) },
    { key: 'off', label: 'Off', title: 'Offensive attribute rating (0–100, like OVR)', get: (r: any) => offRating(r.p) },
    { key: 'def', label: 'Def', title: 'Defensive attribute rating (0–100, like OVR)', get: (r: any) => defRating(r.p) },
    ...RATING_LABELS.map((L: any, i: number) => ({ key: 'r' + i, label: L.short, title: L.name + (L.tendency ? ' (tendency, not quality)' : ''), get: (r: any) => RT(r.p, i), cls: L.tendency ? 'dim' : '' })),
  ];
  return (
    <div className="panel">
      <div className="team-head">
        <Logo t={t} size={44} />
        <select aria-label="Team" value={t.tid} onChange={e => setTid(e.target.value)}>
          {teams.map((x: any) => <option key={x.tid} value={x.tid}>{x.name}</option>)}
        </select>
        <div className="team-facts">
          <span><b>{t.w}–{t.l}</b> record</span>
          <span>GM strategy: <b>{strat}</b></span>
          <span>Payroll: <b>{Math.round(pay * 100)}% of the cap</b>{usd(pay, lg.season)}{hardCap(lg) < Infinity ? <>, hard cap <b className={pay > hardCap(lg) ? 'neg' : pay > hardCap(lg) - 0.05 ? 'warn-t' : ''}>{Math.round(hardCap(lg) * 100)}%</b></> : null}</span>
          {titles.length > 0 && <span>Titles: <b>{titles.join(', ')}</b></span>}
        </div>
      </div>
      {plan && (
        <div className="fo-plan">
          <span className="fo-stage">Front office: <b>{({ contend: 'Contending', push: 'Pushing for more', build: 'Building around youth', rebuild: 'Rebuilding' } as any)[plan.stage]}</b> · {plan.act ? 'ready to spend future assets' : 'patient – keeping its picks and young players'}</span>
          <span className="dim">{plan.why.join('; ')}.</span>
          {plan.core.length > 0 && <span>Core: {plan.core.map((pid: string) => lg.players[pid]?.name).filter(Boolean).join(', ')}</span>}
          {plan.rising.length > 0 && <span>Young pieces: {plan.rising.map((pid: string) => lg.players[pid]?.name).filter(Boolean).join(', ')}</span>}
        </div>
      )}
      <div className="def-row">
        <div className="seg view-toggle-l" role="group" aria-label="View">
          <button className={view === 'stats' ? 'on' : ''} onClick={() => setView('stats')}>Stats</button>
          <button className={view === 'attr' ? 'on' : ''} onClick={() => setView('attr')}>Attributes</button>
          <button className={view === 'hist' ? 'on' : ''} onClick={() => setView('hist')}>History</button>
          <button className={view === 'rec' ? 'on' : ''} onClick={() => setView('rec')}>Records</button>
        </div>
      </div>
      {view === 'hist' ? <TeamHistory lg={lg} tid={t.tid} openPlayer={openPlayer} /> : view === 'rec' ? <TeamRecords lg={lg} tid={t.tid} openPlayer={openPlayer} /> : view === 'attr' ? <SortTable cols={attrCols} rows={roster.map((p: any) => ({ key: p.id, p }))} initial="ovr" rowClass={(r: any) => (r.p.injury > 0 ? 'inj-row' : '')} /> : (
      <div className="tbl-wrap">
          <table className="tbl roster">
            <thead><tr>
              <th className="l">Player</th><th>Pos</th><th className="l role-col">Role</th><th>Age</th><th>OVR</th><th>GP</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>FG%</th><th>3P%</th><th title="Fatigue before the next game">Fat.</th><th className="l">Contract</th>
            </tr></thead>
            <tbody>
              {roster.map((p: any) => (
                <tr key={p.id}>
                  <td className="l"><PFace lg={lg} p={p} /><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button>{plan?.core.includes(p.id) && <span className="chip tiny" title="Core player – the team builds around him">core</span>}{plan?.rising.includes(p.id) && <span className="chip tiny" title="Young piece – he gets minutes and is not shopped">young</span>}{p.injury > 0 && <span className="inj" title={p.inj ? `${injName(p.inj.k)} – out ~${p.injury} more games` : 'Injured'}>+{p.injury}</span>}{p.entered === (lg.phase === 'regular' || lg.phase === 'playoffs' || lg.phase === 'freeagency' ? lg.season : lg.season + 1) && <span className="chip tiny">R</span>}</td>
                  <td className="dim">{p.pos}</td>
                  <td className="l role-col">{(() => {
                    const ro = roleOf(p.z, p.pos);
                    const mpg = p.cur.gp ? p.cur.min / p.cur.gp : 0, gs = p.cur.gp ? p.cur.gs / p.cur.gp : 0;
                    const job = !p.cur.gp ? '' : gs >= 0.6 ? 'starter' : mpg >= 24 ? 'sixth man' : mpg >= 15 ? 'rotation' : mpg >= 8 ? 'spot minutes' : 'end of bench';
                    return <span title={`${ro.arch.name} – ${ro.arch.blurb}${job ? ` (${job})` : ''}`}><RoleBadge id={ro.arch.id} />{ro.second && <RoleBadge id={ro.second.id} />}</span>;
                  })()}</td>
                  <td>{ageIn(p, lg.season)}</td>
                  <td><Ovr v={ovrOf(p.z)} small /></td>
                  <td>{p.cur.gp || '–'}</td>
                  <td>{per(p.cur.min, p.cur.gp)}</td>
                  <td>{per(p.cur.pts, p.cur.gp)}</td>
                  <td>{per(p.cur.orb + p.cur.drb, p.cur.gp)}</td>
                  <td>{per(p.cur.ast, p.cur.gp)}</td>
                  <td>{pct(p.cur.fgm, p.cur.fga)}</td>
                  <td>{pct(p.cur.tpm, p.cur.tpa)}</td>
                  <td><FatigueBar f={inSeason ? fatigueAt(lg, p, calNow) : 0} /></td>
                  <td className="l dim">{money(p.contract.sal, lg.season)} through {p.contract.exp}{optLabel(p.contract) ? <span className="chip tiny" title="TO – team option, PO – player option (for that season)">{optLabel(p.contract)}</span> : null}{p.contract.rookie ? <span className="chip tiny" title="Rookie contract: he becomes a restricted free agent (RFA) when it ends">RFA</span> : null}{p.ext ? <span className="chip tiny ext" title={`Extended: ${money(p.ext.sal, lg.season + 1)} per season through ${p.ext.exp}`}>extended through {p.ext.exp}</span> : p.tid === lg.userTid && p.contract.exp === lg.season && lg.phase === 'regular' ? <span className="chip tiny" title="Open the player card to offer an extension">can extend</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(view === 'stats' || view === 'attr') && <p className="note">R – rookie. +number – games he'll still miss through injury (hover for the injury). {view === 'stats' ? 'Stats are this season\'s per-game averages. Fat. – fatigue before the next game: it builds with heavy minutes and back-to-back games and fades on rest days; tired players rebound, defend and play less.' : 'Attributes 1–99 (50 = league average). Off and Def – offensive and defensive ratings on the 0–100 OVR scale. Usg and 3PA% are tendencies (how often he shoots), not quality. Click a column to sort.'}</p>}
      <TeamGames lg={lg} tid={t.tid} openGame={openGame} />
      <OverseasRights lg={lg} tid={t.tid} openPlayer={openPlayer} />
    </div>
  );
}

/** Draft rights to players still overseas; the user's team can bring them over now. */
function OverseasRights({ lg, tid, openPlayer }: any) {
  const [msg, setMsg] = useState('');
  const [, bump] = useState(0);
  const ps = (Object.values(lg.players) as any[]).filter(p => p.stash && p.rights === tid && !p.retired).sort((a, b) => ovrOf(b.z) - ovrOf(a.z));
  if (!ps.length) return null;
  const mine = tid === lg.userTid;
  return (
    <details className="more" open={mine}>
      <summary>Draft rights overseas ({ps.length})</summary>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th className="l">Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Pot.</th><th className="l">Drafted</th><th className="l">Expected</th>{mine && <th></th>}</tr></thead>
        <tbody>{ps.map(p => (
          <tr key={p.id}>
            <td className="l"><PFace lg={lg} p={p} /><button className="link" onClick={() => openPlayer(p.id)}>{p.name}</button></td>
            <td>{p.pos}</td><td>{ageIn(p, lg.season)}</td><td><Ovr v={ovrOf(p.z)} /></td><td>{potOf(p, lg.season)}</td>
            <td className="l dim">{p.draft ? `${p.draft.year}, No. ${p.draft.pick}` : '–'}</td>
            <td className="l dim">{p.stash - 1}–{String(p.stash).slice(2)}</td>
            {mine && <td><button className="small primary" onClick={() => { const r = run(lg, { t: 'recall', pid: p.id }); setMsg(r.msg); bump(x => x + 1); if (r.ok) saveLeague(lg); }}>Bring over now</button></td>}
          </tr>
        ))}</tbody>
      </table></div>
      {msg && <p className="hint">{msg}</p>}
      <p className="note">Drafted players who in real life stayed overseas for years join when their real NBA careers began. You can bring yours over right away: he signs a rookie-scale deal (or what the market pays him, if more) and has to fit under the hard cap and the 15-man limit.</p>
    </details>
  );
}

// ---------------------------------------------------------------- player
function TeamGames({ lg, tid, openGame }: any) {
  const reg = lg.schedule.filter((g: any) => g.home === tid || g.away === tid);
  const po = lg.recent.filter((r: any) => r.season === lg.season && r.po && (r.home.tid === tid || r.away.tid === tid));
  const has = (rid: number) => lg.recent.some((r: any) => r.id === rid);
  const item = (key: any, home: boolean, opp: string, done: boolean, us: number, them: number, rid: number | undefined, label: string) => {
    const win = us > them;
    return (
      <li key={key} className={done ? (win ? 'w' : 'l') : 'up'}>
        <span className="g-day">{label}</span>
        <span className="g-opp">{home ? 'vs' : '@'} <TL tid={opp} abbr /></span>
        {done ? (rid && has(rid)
          ? <button className="g-res link" onClick={() => openGame(rid)}>{win ? 'W' : 'L'} {us}–{them}</button>
          : <span className="g-res">{win ? 'W' : 'L'} {us}–{them}</span>)
          : <span className="g-res dim">–</span>}
      </li>
    );
  };
  return (
    <details className="more">
      <summary>Season games ({reg.filter((g: any) => g.done).length}/{reg.length} played{po.length ? `, ${po.length} in the playoffs` : ''})</summary>
      <ul className="team-games">
        {reg.map((g: any, i: number) => {
          const home = g.home === tid;
          return item(g.id, home, home ? g.away : g.home, !!g.done, home ? g.hs : g.as, home ? g.as : g.hs, g.rid, `${i + 1}.`);
        })}
        {po.map((r: any, i: number) => {
          const home = r.home.tid === tid;
          return item('po' + r.id, home, home ? r.away.tid : r.home.tid, true, home ? r.home.pts : r.away.pts, home ? r.away.pts : r.home.pts, r.id, `PO${i + 1}`);
        })}
      </ul>
      <p className="note">Click a score to open the box score. The last 400 league games and all of your team's games this season are kept.</p>
    </details>
  );
}

function FantasyResults({ lg, openPlayer }: any) {
  const [open, setOpen] = useState(false);
  const picks = lg.fantasy.picks;
  return (
    <div className="panel">
      <div className="team-head"><h2>Fantasy draft {lg.start ?? 1980}</h2><button className="ghost small" onClick={() => setOpen(!open)}>{open ? 'Hide' : `Show all ${picks.length}`}</button></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>No.</th><th>Round</th><th className="l">Team</th><th className="l">Player</th><th>OVR then</th><th className="l">Now</th></tr></thead>
          <tbody>
            {picks.slice(0, open ? picks.length : 15).map((x: any) => {
              const p = lg.players[x.pid];
              return <tr key={x.pick} className={x.tid === lg.userTid ? 'mine' : ''}><td>{x.pick}</td><td>{x.round}</td><td className="l">{lg.teams[x.tid].abbr}</td><td className="l"><button className="link" onClick={() => openPlayer(x.pid)}>{p.name}</button></td><td>{p.ovrHist[0] ? shownFromRaw(p.ovrHist[0][1]) : '–'}</td><td className="l dim">{p.retired ? `retired ${p.retired}` : p.tid ? lg.teams[p.tid].abbr : 'FA'}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Next summer's class, public from the start of the season: consensus order and (with a team) your scouts' board. */
function UpcomingClass({ lg, openPlayer, onChange }: any) {
  const proj = false;
  const [, bump] = useState(0);
  const changed = () => { bump(x => x + 1); onChange?.(); };
  const c = lg.draftClass;
  if (!c) return null;
  const ps = c.pool.map((id: string) => lg.players[id]).filter((p: any) => p?.prospect);
  const cons = [...ps].sort((a: any, b: any) => a.draft.realPick - b.draft.realPick);
  const you = lg.userTid ? lg.teams[lg.userTid] : null;
  const yours = you ? new Map([...ps].map((p: any) => [p.id, boardScore(lg, p, you, c.year)]).sort((a: any, b: any) => b[1] - a[1]).map((x: any, i: number) => [x[0], i + 1])) : null;
  const rows = cons.map((p: any, i: number) => ({ key: p.id, p, cons: i + 1, mine: yours?.get(p.id) }));
  const cols = [
    { key: 'cons', label: 'Rank', title: 'Consensus rank of the scouts', asc: true, get: (r: any) => r.cons },
    ...(yours ? [{ key: 'mine', label: 'Your board', title: 'Where your own scouts rank him (talent, their projection and your needs) – other teams do not see this', asc: true, get: (r: any) => r.mine }] : []),
    { key: 'name', label: 'Prospect', left: true, asc: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button> },
    ...(you ? [{ key: 'my', label: 'My board', title: 'Your own board – + adds him, the number is his place on it', asc: true, get: (r: any) => { const i = boardOf(lg, c.year).indexOf(r.p.id); return i < 0 ? 999 : i; }, fmt: (_: any, r: any) => <BoardToggle lg={lg} year={c.year} pid={r.p.id} onChange={changed} /> }] : []),
    { key: 'pos', label: 'Pos', left: true, get: (r: any) => r.p.pos },
    { key: 'age', label: 'Age', get: (r: any) => Math.floor(c.year + 1 - r.p.born) },
    ...attrCols((r: any) => r.p, c.year + 1, proj),
  ];
  return (
    <div className="panel">
      <h2>{c.year} draft class</h2>
      <p className="dim">Announced at the start of the season – every front office scouts it all year and values this season's picks by how deep it is.{you ? ' Your board is your scouts\' view and your needs; other teams have their own, which you do not see.' : ''}</p>
      <SortTable cols={cols} rows={rows.slice(0, 60)} initial="cons" initialAsc={true} />
      {you && <MyBoard lg={lg} year={c.year} pool={c.pool} openPlayer={openPlayer} onChange={changed} />}
    </div>
  );
}

function Drafts({ lg, openPlayer, openTeam, onChange }: any) {
  const years = lg.history.filter((s: any) => s.draft?.length).map((s: any) => s.season);
  const [y, setY] = useState(years[years.length - 1] ?? null);
  if (!years.length) return <><UpcomingClass lg={lg} openPlayer={openPlayer} onChange={onChange} /><div className="panel empty"><h2>Draft classes</h2><p>The first draft takes place after the {(lg.start ?? 1980) - 1}–{String(lg.start ?? 1980).slice(2)} season. Sim the season to the end.</p></div></>;
  const s = lg.history.find((h: any) => h.season === y) ?? lg.history[lg.history.length - 1];
  const rows = s.draft.map((d: any) => {
    const p = lg.players[d.pid];
    const reg = p.career.filter((c: any) => !c.po);
    if ((lg.phase === 'regular' || lg.phase === 'playoffs') && p.cur.gp) reg.push(p.cur);
    const sum = (k: string) => reg.reduce((a: number, c: any) => a + c[k], 0);
    const gp = sum('gp');
    return {
      key: d.pid, d, p, gp, seasons: reg.length,
      ppg: gp ? sum('pts') / gp : NaN, rpg: gp ? (sum('orb') + sum('drb')) / gp : NaN, apg: gp ? sum('ast') / gp : NaN,
      peak: p.ovrHist.length ? shownFromRaw(Math.max(...p.ovrHist.map((o: any) => o[1]))) : ovrOf(p.z), now: ovrOf(p.z),
      awards: p.awards.filter((a: string) => !/(Champion|čempionas)/.test(a)).length, titles: p.awards.filter((a: string) => /(Champion|čempionas)/.test(a)).length,
    };
  });
  const cols = [
    { key: 'pick', label: 'No.', asc: true, get: (r: any) => r.d.pick },
    { key: 'name', label: 'Player', left: true, asc: true, get: (r: any) => r.p.name, fmt: (v: any, r: any) => <><button className="link" onClick={() => openPlayer(r.p.id)}>{v}</button>{r.p.retired ? <span className="chip tiny">retired</span> : null}</> },
    { key: 'team', label: 'Drafted by', left: true, asc: true, get: (r: any) => lg.teams[r.d.tid]?.abbr, fmt: (v: any, r: any) => <><button className="link" onClick={() => openTeam(r.d.tid)}>{v}</button>{r.d.via && <span className="dim"> (via {lg.teams[r.d.via]?.abbr})</span>}</> },
    { key: 'now', label: 'Now', left: true, asc: true, get: (r: any) => (r.p.retired ? 'retired' : r.p.tid ? lg.teams[r.p.tid].abbr : 'FA') },
    { key: 'peak', label: 'Peak OVR', get: (r: any) => r.peak, fmt: (v: any) => <Ovr v={v} small /> },
    { key: 'ovr', label: 'OVR', get: (r: any) => r.now },
    { key: 'seasons', label: 'Seasons', get: (r: any) => r.seasons },
    { key: 'gp', label: 'GP', get: (r: any) => r.gp },
    { key: 'ppg', label: 'Pts', get: (r: any) => r.ppg, fmt: f1 },
    { key: 'rpg', label: 'Reb', get: (r: any) => r.rpg, fmt: f1 },
    { key: 'apg', label: 'Ast', get: (r: any) => r.apg, fmt: f1 },
    { key: 'aw', label: 'Awards', title: 'Awards (MVP, ROY, Finals MVP, …)', get: (r: any) => r.awards },
    { key: 'ti', label: 'Titles', get: (r: any) => r.titles },
  ];
  return (
    <>
    <UpcomingClass lg={lg} openPlayer={openPlayer} onChange={onChange} />
    <div className="panel">
      <div className="team-head">
        <select aria-label="Draft year" value={s.season} onChange={e => setY(+e.target.value)}>
          {years.slice().reverse().map((x: number) => <option key={x} value={x}>{x} draft</option>)}
        </select>
        <span className="dim">How each pick's career is going in this league. Click a column to sort – e.g. by peak OVR to see who was the steal of the draft.</span>
      </div>
      <SortTable cols={cols} rows={rows} initial="pick" initialAsc={true} rowClass={(r: any) => (r.d.tid === lg.userTid ? 'mine' : '')} />
    </div>
    </>
  );
}

// ---------------------------------------------------------------- history
function AwardsExplorer({ lg, openPlayer }: any) {
  const withAw = lg.history.filter((h: any) => h.awards);
  const [y, setY] = useState(withAw.length ? withAw[withAw.length - 1].season : null);
  if (!withAw.length) return null;
  const h = withAw.find((x: any) => x.season === y) ?? withAw[withAw.length - 1];
  const a = h.awards;
  const P = (pid: string) => <button className="link" onClick={() => openPlayer(pid)}>{lg.players[pid]?.name ?? pid}</button>;
  const names: [string, string][] = [['mvp', 'MVP'], ['dpoy', 'Defensive Player of the Year'], ['roy', 'Rookie of the Year'], ['smoy', 'Sixth Man of the Year'], ['mip', 'Most Improved Player']];
  return (
    <div className="panel">
      <div className="team-head">
        <h2>Awards</h2>
        <select aria-label="Season" value={h.season} onChange={e => setY(+e.target.value)}>
          {withAw.slice().reverse().map((x: any) => <option key={x.season} value={x.season}>{seasonLabel(x.season)}</option>)}
        </select>
      </div>
      <div className="award-grid">
        {names.map(([k, n]) => (
          <div key={k} className="award-box">
            <h3>{n}</h3>
            {a[k] ? <p className="winner">{P(a[k])} <span className="dim">{lg.teams[lg.players[a[k]]?.career.find((c: any) => c.s === h.season && !c.po)?.tid]?.abbr ?? ''}</span></p> : <p className="dim">Not awarded{k === 'mip' ? ' (nothing to compare with)' : ''}</p>}
            {a.votes?.[k]?.length > 1 && <ol className="votes" start={2}>{a.votes[k].slice(1, 5).map((x: any) => <li key={x.pid}>{P(x.pid)}</li>)}</ol>}
          </div>
        ))}
        <div className="award-box"><h3>Finals MVP</h3><p className="winner">{a.fmvp ? P(a.fmvp) : '–'}</p></div>
      </div>
      <AwardTeams lg={lg} a={a} openPlayer={openPlayer} />
      <p className="note">Below the winner – the other candidates from the voting model (stats, games played, team results; for DPOY – defensive rating, steals and blocks).</p>
    </div>
  );
}

function HistoryView({ lg, openPlayer, openTeam, onSaved }: any) {
  const [tab, setTab] = useNavState<'main' | 'stand' | 'tstats' | 'fa' | 'hof'>('history.tab', 'main');
  const tabs = (
    <div className="seg hist-tabs" role="group" aria-label="History section">
      {([['main', 'Champions & records'], ['stand', 'Standings'], ['tstats', 'Team stats'], ['fa', 'Free agency'], ['hof', 'Hall of Fame']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
    </div>
  );
  if (tab === 'hof') return <div className="col">{tabs}<HallOfFameView lg={lg} openPlayer={openPlayer} onChange={onSaved} /></div>;
  if (tab !== 'main') return <div className="col">{tabs}{tab === 'stand' ? <StandingsHistory lg={lg} openTeam={openTeam} /> : tab === 'tstats' ? <TeamStatsExplorer lg={lg} openTeam={openTeam} /> : <FaMoves lg={lg} openPlayer={openPlayer} openTeam={openTeam} />}</div>;
  return <HistoryMain lg={lg} openPlayer={openPlayer} tabs={tabs} />;
}
function HistoryMain({ lg, openPlayer, tabs }: any) {
  const P = (pid: string) => pid ? <button className="link" onClick={() => openPlayer(pid)}>{lg.players[pid].name}</button> : '–';
  if (!lg.history.length) return <div className="col">{tabs}<div className="panel empty"><h2>History</h2><p>Once the first season ends, you'll see champions and awards here.</p></div><LeagueRecords lg={lg} openPlayer={openPlayer} /></div>;
  const titles: Record<string, number> = {};
  for (const s of lg.history) titles[s.champion] = (titles[s.champion] ?? 0) + 1;
  const mvps: Record<string, number> = {};
  for (const s of lg.history) if (s.mvp) mvps[s.mvp] = (mvps[s.mvp] ?? 0) + 1;
  const topMvp = Object.entries(mvps).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div className="col">
    {tabs}
    <LeagueRecords lg={lg} openPlayer={openPlayer} />
    <Retirements lg={lg} openPlayer={openPlayer} />
    <SeasonArchive lg={lg} openPlayer={openPlayer} />
    <AwardsExplorer lg={lg} openPlayer={openPlayer} />
    <div className="panel">
      <h2>Seasons</h2>
      <p className="note">Most titles: {Object.entries(titles).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${lg.teams[t].abbr} ${n}`).join(', ')}.{topMvp.length ? <> Most MVPs: {topMvp.map(([pid, n], i) => <span key={pid}>{i ? ', ' : ''}{P(pid)} {n}</span>)}.</> : null}</p>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Season</th><th className="l">Champion</th><th className="l">Finals MVP</th><th className="l">Best record</th><th className="l">MVP</th><th className="l">DPOY</th><th className="l">ROY</th><th className="l">6MOY</th><th className="l">MIP</th></tr></thead>
          <tbody>
            {lg.history.slice().reverse().map((s: any) => {
              const best = s.standings[0];
              return (
                <tr key={s.season}>
                  <td>{seasonLabel(s.season)}</td>
                  <td className="l"><b><TL tid={s.champion} abbr /></b> <span className="dim">vs <TL tid={s.runnerUp} abbr /></span></td>
                  <td className="l">{P(s.fmvp)}</td>
                  <td className="l"><TL tid={best.tid}>{best.abbr}</TL> {best.w}–{best.l}</td>
                  <td className="l">{P(s.mvp)}</td>
                  <td className="l">{P(s.awards?.dpoy)}</td>
                  <td className="l">{P(s.roy)}</td>
                  <td className="l">{P(s.awards?.smoy)}</td>
                  <td className="l">{P(s.awards?.mip)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}

function Games({ lg, openPlayer }: any) {
  const games = lg.recent.slice().reverse();
  const [gid, setGid] = useState(games[0]?.id ?? null);
  if (!games.length) return <div className="panel empty"><h2>Games</h2><p>No games played this season yet.</p></div>;
  const g = games.find((x: any) => x.id === gid) ?? games[0];
  return (
    <div className="grid-games">
      <div className="panel">
        <h2>Latest</h2>
        <ul className="game-list">
          {games.slice(0, 60).map((x: any) => (
            <li key={x.id}><button className={x.id === g.id ? 'on' : ''} onClick={() => setGid(x.id)}>
              <span>{lg.teams[x.away.tid].abbr} {x.away.pts} @ {lg.teams[x.home.tid].abbr} {x.home.pts}{x.ot ? ' (OT)' : ''}</span>
              <span className="dim">{x.po ? 'PO' : `day ${x.day + 1}`}</span>
            </button></li>
          ))}
        </ul>
      </div>
      <div className="panel">
        <div className="linescore">
          {[g.away, g.home].map((b: any) => (
            <div key={b.tid} className={b.pts > (b === g.home ? g.away.pts : g.home.pts) ? 'win' : ''}>
              <span className="tm"><TL tid={b.tid} /></span>
              {b.q.map((q: number, i: number) => <span key={i} className="q">{q}</span>)}
              <span className="tot">{b.pts}</span>
            </div>
          ))}
        </div>
        {[g.away, g.home].map((b: any) => (
          <div key={b.tid} className="tbl-wrap">
            <table className="tbl box">
              <caption><TL tid={b.tid} /></caption>
              <thead><tr><th className="l">Player</th><th>Min</th><th>Pts</th><th>FG</th><th>3P</th><th>FT</th><th>Reb</th><th>Ast</th><th>Stl</th><th>Blk</th><th>TOV</th><th>PF</th><th>+/−</th></tr></thead>
              <tbody>
                {b.players.filter((x: any) => x.st.min > 0).sort((a: any, c: any) => (c.starter - a.starter) || c.st.min - a.st.min).map((x: any) => (
                  <tr key={x.pid} className={x.starter ? '' : 'bench'}>
                    <td className="l"><button className="link" onClick={() => openPlayer(x.pid)}>{x.name}</button></td>
                    <td>{Math.round(x.st.min)}</td><td><b>{x.st.pts}</b></td>
                    <td>{x.st.fgm}-{x.st.fga}</td><td>{x.st.tpm}-{x.st.tpa}</td><td>{x.st.ftm}-{x.st.fta}</td>
                    <td>{x.st.orb + x.st.drb}</td><td>{x.st.ast}</td><td>{x.st.stl}</td><td>{x.st.blk}</td><td>{x.st.tov}</td><td>{x.st.pf}</td>
                    <td className={x.st.pm >= 0 ? 'pos' : 'neg'}>{x.st.pm > 0 ? '+' : ''}{x.st.pm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- boot
const histEl = document.getElementById('hist');
loadHistory(JSON.parse(histEl!.textContent!));
histEl!.remove();
createRoot(document.getElementById('app')!).render(<App />);
