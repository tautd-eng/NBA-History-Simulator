"""Builds data/history.json for the NBA history simulator.

Source: Basketball-Reference derived CSVs (github.com/sumitrodatta/bball-reference-datasets).

For every player-season since 1980 it computes era-relative skill z-scores
(shrunk toward a position prior for small samples). The game engine turns a
z-score back into a rate with the current era's league distribution, so a
player keeps his relative skill when the league around him changes.
"""
import csv, json, math, os, sys
from collections import defaultdict

D = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2]
FIRST, LAST = 1980, 2026


def rows(name):
    with open(D + name + '.csv', newline='') as f:
        return list(csv.DictReader(f))


def num(v, d=None):
    try:
        x = float(v)
        return x if math.isfinite(x) else d
    except (TypeError, ValueError):
        return d


def logit(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


# --------------------------------------------------------------- franchises
FR = {'KCK': 'SAC', 'SDC': 'LAC', 'NJN': 'BRK', 'SEA': 'OKC', 'WSB': 'WAS',
      'CHH': 'NOP', 'NOH': 'NOP', 'NOK': 'NOP', 'CHO': 'CHA', 'VAN': 'MEM'}
fr = lambda a: FR.get(a, a)

# Conference by franchise; a list of (from_season, conf). Approximate history.
CONF = {
    'ATL': [(1980, 'E')], 'BOS': [(1980, 'E')], 'CLE': [(1980, 'E')], 'DET': [(1980, 'E')],
    'IND': [(1980, 'E')], 'NYK': [(1980, 'E')], 'PHI': [(1980, 'E')], 'WAS': [(1980, 'E')],
    'BRK': [(1980, 'E')], 'CHI': [(1980, 'W'), (1981, 'E')], 'MIL': [(1980, 'W'), (1981, 'E')],
    'HOU': [(1980, 'E'), (1981, 'W')], 'SAS': [(1980, 'E'), (1981, 'W')],
    'DEN': [(1980, 'W')], 'SAC': [(1980, 'W')], 'UTA': [(1980, 'W')], 'LAL': [(1980, 'W')],
    'OKC': [(1980, 'W')], 'PHO': [(1980, 'W')], 'POR': [(1980, 'W')], 'LAC': [(1980, 'W')],
    'GSW': [(1980, 'W')], 'DAL': [(1981, 'W')],
    'NOP': [(1989, 'E'), (1990, 'W'), (1991, 'E'), (2005, 'W')],
    'MIA': [(1989, 'W'), (1990, 'E')], 'ORL': [(1990, 'E'), (1991, 'W'), (1992, 'E')],
    'MIN': [(1990, 'W')], 'TOR': [(1996, 'E')], 'MEM': [(1996, 'W')], 'CHA': [(2005, 'E')],
}

# Salary cap, $M (pre-1985: no cap; a payroll scale is used instead). Approximate.
CAP = {1980: 2.0, 1981: 2.2, 1982: 2.5, 1983: 2.8, 1984: 3.2, 1985: 3.6, 1986: 4.233, 1987: 4.945,
       1988: 6.164, 1989: 7.232, 1990: 9.802, 1991: 11.871, 1992: 12.5, 1993: 14.0, 1994: 15.175,
       1995: 15.964, 1996: 23.0, 1997: 24.363, 1998: 26.9, 1999: 30.0, 2000: 34.0, 2001: 35.5,
       2002: 42.5, 2003: 40.271, 2004: 43.84, 2005: 43.87, 2006: 49.5, 2007: 53.135, 2008: 55.63,
       2009: 58.68, 2010: 57.7, 2011: 58.044, 2012: 58.044, 2013: 58.044, 2014: 58.679,
       2015: 63.065, 2016: 70.0, 2017: 94.143, 2018: 99.093, 2019: 101.869, 2020: 109.14,
       2021: 109.14, 2022: 112.414, 2023: 123.655, 2024: 136.021, 2025: 140.588, 2026: 154.647}

# ------------------------------------------------------------------- load
career = {r['player_id']: r for r in rows('Player Career Info')}
tot = [r for r in rows('Player Totals') if r['lg'] == 'NBA' and FIRST <= int(r['season']) <= LAST]
adv = {(r['season'], r['player_id'], r['team']): r for r in rows('Advanced')
       if r['lg'] == 'NBA' and FIRST <= int(r['season']) <= LAST}
teams_raw = [r for r in rows('Team Summaries') if r['lg'] == 'NBA' and FIRST <= int(r['season']) <= LAST]
team_tot = [r for r in rows('Team Totals') if r['lg'] == 'NBA' and FIRST <= int(r['season']) <= LAST]
drafts = [r for r in rows('Draft Pick History') if r['lg'] in ('NBA', 'BAA')]

# combined row per player-season + team history (chronological)
comb, teams_of = {}, defaultdict(list)
for r in tot:
    k = (r['season'], r['player_id'])
    if r['team'].endswith('TM') or r['team'] == 'TOT':
        comb[k] = r
    else:
        teams_of[k].append(r['team'])
        comb.setdefault(k, r)

def posgrp(p):
    p = (p or '').split('-')[0]
    return 'G' if p in ('PG', 'SG', 'G') else 'C' if p == 'C' else 'F'

# -------------------------------------------------------- stat definitions
# key: (transform, getter returning (value, weight) or None, prior strength)
# value is the raw rate; shrinkage = (value*w + prior*k)/(w+k)
def g_adv(field, scale=100.0, wfield='mp'):
    def f(t, a):
        v = num(a.get(field)); w = num(t.get(wfield), 0)
        return (0.0, 0.0) if v is None else (v / scale, w)
    return f

def g_pct(made, att):
    def f(t, a):
        m, n = num(t.get(made), 0), num(t.get(att), 0)
        return (m / n, n) if n > 0 else (0.0, 0.0)
    return f

def g_rate(numf, denf):
    def f(t, a):
        n, d = num(t.get(numf), 0), num(t.get(denf), 0)
        return (n / d, d) if d > 0 else (0.0, 0.0)
    return f

STATS = {
    # skill                          transform  getter                        k
    'ins': ('logit', g_pct('x2p', 'x2pa'),            180),  # 2P%
    'tp':  ('logit', g_pct('x3p', 'x3pa'),            220),  # 3P%
    'ft':  ('logit', g_pct('ft', 'fta'),               80),  # FT%
    'drw': ('log',   g_rate('fta', 'fga'),            200),  # FT attempts per FGA
    'tpr': ('logit', g_rate('x3pa', 'fga'),           120),  # 3PA share of FGA (tendency)
    'usg': ('log',   g_adv('usg_percent'),            300),  # usage (tendency)
    'tov': ('logit', g_adv('tov_percent'),            500),  # turnover% (lower is better)
    'ast': ('logit', g_adv('ast_percent'),            350),
    'orb': ('logit', g_adv('orb_percent'),            350),
    'drb': ('logit', g_adv('drb_percent'),            350),
    'stl': ('logit', g_adv('stl_percent'),            500),
    'blk': ('logit', g_adv('blk_percent'),            500),
    'pf':  ('log',   g_rate('pf', 'mp'),              400),  # fouls per minute
    'def': ('lin',   g_adv('dbpm', 1.0),              700),  # defensive box +/-
}
KEYS = list(STATS)

def tf(kind, v):
    if kind == 'logit': return logit(v)
    if kind == 'log': return math.log(max(v, 1e-4))
    return v

# ------------------------------------------------ pass 1: priors by season x position
raw = {}  # (season, pid) -> {key: (value, weight)}
info = {}
for k, t in comb.items():
    season, pid = k
    a = adv.get((season, pid, t['team'])) or {}
    mp = num(t.get('mp'), 0)
    if mp <= 0: continue
    raw[k] = {s: STATS[s][1](t, a) for s in KEYS}
    info[k] = dict(t=t, a=a, mp=mp, grp=posgrp(t.get('pos')))

# Priors by season x position group x role tier (minutes per game). Minutes
# carry information about quality, so a 4-mpg player is shrunk toward other
# deep-bench players, not toward the league average.
def tier(k):
    g = num(info[k]['t'].get('g'), 1) or 1
    mpg = info[k]['mp'] / g
    return 0 if mpg < 12 else 1 if mpg < 24 else 2
prior = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
for k, st in raw.items():
    season, grp, tr = k[0], info[k]['grp'], tier(k)
    for s in KEYS:
        v, w = st[s]
        if w > 0:
            for key in ((season, grp, tr), (season, grp), (season, '*')):
                acc = prior[key][s]; acc[0] += v * w; acc[1] += w

def prior_of(season, grp, s, tr=None):
    for key in ((season, grp, tr), (season, grp), (season, '*')):
        acc = prior[key][s]
        if acc[1] > 0: return acc[0] / acc[1]
    return 0.0

# ------------------------------------------------ pass 2: shrink, transform, era stats
shr = {}
for k, st in raw.items():
    season, grp, tr = k[0], info[k]['grp'], tier(k)
    out = {}
    for s in KEYS:
        kind, _, kk = STATS[s]
        v, w = st[s]
        p = prior_of(season, grp, s, tr)
        out[s] = tf(kind, (v * w + p * kk) / (w + kk))
    shr[k] = out

era = {}
for season in range(FIRST, LAST + 1):
    ks = [k for k in shr if int(k[0]) == season]
    if not ks: continue
    e = {}
    for s in KEYS:
        W = sum(info[k]['mp'] for k in ks)
        mu = sum(shr[k][s] * info[k]['mp'] for k in ks) / W
        var = sum(info[k]['mp'] * (shr[k][s] - mu) ** 2 for k in ks) / W
        e[s] = [round(mu, 4), round(max(math.sqrt(var), 1e-3), 4)]
    era[season] = e

z = {}
for k, v in shr.items():
    e = era[int(k[0])]
    z[k] = {s: (v[s] - e[s][0]) / e[s][1] for s in KEYS}

# ------------------------------------------------ defense: team-defense model instead of raw DBPM
from defense import build_def
import numpy as np
def _age(pid, season):
    bd = career.get(pid, {}).get('birth_date') or ''
    try:
        y, m, d = map(int, bd[:10].split('-'))
        return season - y - (1 if m > 2 else 0)
    except ValueError:
        a = num(comb.get((str(season), pid), {}).get('age'))
        return int(a) if a else 27
dval = build_def(tot, teams_raw, z, career, _age, lam_u=float(os.environ.get('LAMU', '3')), lam_v=float(os.environ.get('LAMV', '40')))
# box part: DBPM with its defensive-rebounding and steal shares taken out (the engine rates both on their own)
_ks = list(z)
_X = np.array([[z[k]['drb'], z[k]['stl']] for k in _ks]); _y = np.array([z[k]['def'] for k in _ks]); _w = np.array([info[k]['mp'] for k in _ks])
b_box = np.linalg.solve((_X * _w[:, None]).T @ _X, (_X * _w[:, None]).T @ _y)
b_drb = [round(float(b), 3) for b in b_box]
_box = {k: z[k]['def'] - float(b_box @ x) for k, x in zip(_ks, _X)}
DEF_TEAM = float(os.environ.get('DEFW', '0.6'))   # weight of the team-defense model
def _norm(vals):
    out = {}
    for season in era:
        ks = [k for k in z if int(k[0]) == season]
        W = sum(info[k]['mp'] for k in ks)
        mu = sum(vals[k] * info[k]['mp'] for k in ks) / W
        sd = math.sqrt(sum(info[k]['mp'] * (vals[k] - mu) ** 2 for k in ks) / W)
        for k in ks: out[k] = (vals[k] - mu) / max(sd, 1e-3)
    return out
zt = _norm(dval)
zb = _norm(_box)
zd = _norm({k: DEF_TEAM * zt[k] + (1 - DEF_TEAM) * zb[k] for k in z})
# mostly relative to the position: a slow centre is a poor defender even if bigs block more shots
POSC = float(os.environ.get('POSC', '0.75'))
gm = defaultdict(lambda: [0.0, 0.0])
for k in z: a = gm[(k[0], info[k]['grp'])]; a[0] += zd[k] * info[k]['mp']; a[1] += info[k]['mp']
zd = _norm({k: zd[k] - POSC * gm[(k[0], info[k]['grp'])][0] / gm[(k[0], info[k]['grp'])][1] for k in z})
for k in z: z[k]['def'] = zd[k]
print('def: drb/stl share removed from DBPM', b_drb, 'team weight', DEF_TEAM, file=sys.stderr)
if os.environ.get('DEFDBG'):
    names = {r['player_id']: r['player'] for r in tot}
    car = defaultdict(lambda: [0.0, 0.0])
    for k in z:
        c = car[k[1]]; c[0] += z[k]['def'] * info[k]['mp']; c[1] += info[k]['mp']
    rank = sorted([(s / w, names[pid]) for pid, (s, w) in car.items() if w > 15000], reverse=True)
    for i, (v, n) in enumerate(rank):
        if i < 25 or i >= len(rank) - 8 or n in os.environ['DEFDBG'].split(','): print(f"C {i+1:4d} {n:26s} {v:5.2f}", file=sys.stderr)
    cur = sorted([(z[k]['def'], names[k[1]], info[k]['grp']) for k in z if k[0] == '2026' and info[k]['mp'] > 1200], reverse=True)
    for i, (v, n, g) in enumerate(cur):
        if i < 25 or i >= len(cur) - 6 or n in os.environ['DEFDBG'].split(','): print(f"N {i+1:4d} {n:26s} {g} {v:5.2f}", file=sys.stderr)
    for g in 'GFC': 
        vs = [v for v, n, gg in cur if gg == g]; print('2026 mean', g, round(sum(vs) / len(vs), 2), file=sys.stderr)

# ------------------------------------------------ overall rating: regress BPM on z
import itertools
X, Y, Wt = [], [], []
for k in z:
    a, mp = info[k]['a'], info[k]['mp']
    bpm = num(a.get('bpm'))
    if bpm is None or mp < 300: continue
    bpm_s = (bpm * mp + (-2.0) * 600) / (mp + 600)   # shrink toward replacement-ish
    X.append([1.0] + [z[k][s] for s in KEYS]); Y.append(bpm_s); Wt.append(mp)
n = len(KEYS) + 1
A = [[0.0] * n for _ in range(n)]; B = [0.0] * n
for x, y, w in zip(X, Y, Wt):
    for i in range(n):
        B[i] += w * x[i] * y
        for j in range(n): A[i][j] += w * x[i] * x[j]
for i in range(1, n): A[i][i] += 50.0   # light ridge
# gaussian elimination
M = [row[:] + [b] for row, b in zip(A, B)]
for c in range(n):
    p = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[p] = M[p], M[c]
    for r in range(n):
        if r != c:
            f = M[r][c] / M[c][c]
            M[r] = [a - f * b for a, b in zip(M[r], M[c])]
beta = [M[i][n] / M[i][i] for i in range(n)]
pred = [sum(b * xi for b, xi in zip(beta, x)) for x in X]
my = sum(w * y for y, w in zip(Y, Wt)) / sum(Wt)
ss_t = sum(w * (y - my) ** 2 for y, w in zip(Y, Wt))
ss_r = sum(w * (y - p) ** 2 for y, p, w in zip(Y, pred, Wt))
print('BPM regression R2 =', round(1 - ss_r / ss_t, 3), file=sys.stderr)
ovr_w = {'_': round(beta[0], 4), **{s: round(b, 4) for s, b in zip(KEYS, beta[1:])}}

# ------------------------------------------------ aging curves (minutes-weighted dz by age)
def age_of(pid, season):
    c = career.get(pid, {})
    bd = c.get('birth_date') or ''
    try:
        y, m, d = map(int, bd[:10].split('-'))
        return season - y - (1 if m > 2 else 0)
    except ValueError:
        a = num(comb.get((str(season), pid), {}).get('age'))
        return int(a) if a else 27

aging = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
for k in z:
    season, pid = int(k[0]), k[1]
    k2 = (str(season + 1), pid)
    if k2 not in z: continue
    w = 1.0 / (1.0 / info[k]['mp'] + 1.0 / info[k2]['mp'])
    if w < 200: continue
    age = age_of(pid, season)
    for s in KEYS:
        d = z[k2][s] - z[k][s]
        acc = aging[age][s]; acc[0] += d * w; acc[1] += d * d * w; acc[2] += w
AGES = list(range(18, 42))
age_tab = {}
for s in KEYS:
    mean, sd = [], []
    for a in AGES:
        # pool neighbours for stability
        S = [0.0, 0.0, 0.0]
        for aa, wf in ((a - 1, .5), (a, 1.0), (a + 1, .5)):
            acc = aging[aa][s]; S[0] += acc[0] * wf; S[1] += acc[1] * wf; S[2] += acc[2] * wf
        if S[2] < 3000:
            mean.append(None); sd.append(None); continue
        m = S[0] / S[2]
        mean.append(round(m, 3)); sd.append(round(math.sqrt(max(S[1] / S[2] - m * m, 0.01)), 3))
    # fill gaps at the ends
    for arr in (mean, sd):
        first = next(i for i, v in enumerate(arr) if v is not None)
        last = max(i for i, v in enumerate(arr) if v is not None)
        for i in range(len(arr)):
            if arr[i] is None:
                arr[i] = arr[first] if i < first else arr[last]
    age_tab[s] = {'mean': mean, 'sd': sd}

# ------------------------------------------------ league averages per season (for calibration)
league = {}
by_season = defaultdict(list)
for r in team_tot:
    if r['team'] != 'League Average': by_season[int(r['season'])].append(r)
for r in teams_raw:
    if r['team'] == 'League Average':
        s = int(r['season']); T = by_season[s]
        sm = lambda f: sum(num(x[f], 0) for x in T)
        games = sm('g')
        league[s] = dict(
            pace=num(r['pace']), ortg=num(r['o_rtg']), efg=num(r['e_fg_percent']),
            tov=num(r['tov_percent']), orb=num(r['orb_percent']), ftfga=num(r['ft_fga']),
            tpar=num(r['x3p_ar']), ftr=num(r['f_tr']),
            p2=sm('x2p') / sm('x2pa'), p3=(sm('x3p') / sm('x3pa')) if sm('x3pa') else 0.0,
            pft=sm('ft') / sm('fta'), ast_fg=sm('ast') / sm('fg'),
            ppg=sm('pts') / games, stl_g=sm('stl') / games, blk_g=sm('blk') / games,
            pf_g=sm('pf') / games, games=round(games / len(T)))

# ------------------------------------------------ team list per season
seasons = {}
for r in teams_raw:
    if r['team'] == 'League Average': continue
    s = int(r['season']); f = fr(r['abbreviation'])
    conf = [c for y, c in CONF[f] if y <= s][-1]
    seasons.setdefault(s, {'teams': {}, 'cap': CAP[s]})
    seasons[s]['teams'][f] = dict(abbr=r['abbreviation'], name=r['team'].replace('*', ''), conf=conf,
                                  w=int(r['w']), l=int(r['l']), pace=num(r['pace']))
for s in seasons:
    seasons[s]['league'] = league[s]
    seasons[s]['games'] = league[s]['games']

# ------------------------------------------------ players
drafted = {}
for r in drafts:
    pid = r['player_id']
    if not pid or pid == 'NA': continue
    drafted.setdefault(pid, r)  # first draft listing

players = {}
def pinfo(pid, name):
    c = career.get(pid, {})
    if pid not in players:
        bd = (c.get('birth_date') or '')[:10]
        players[pid] = dict(
            n=name, b=bd, h=int(num(c.get('ht_in_in'), 78)), w=int(num(c.get('wt'), 210)),
            p=c.get('pos') or 'F', hof=c.get('hof') == 'TRUE', f=int(num(c.get('from'), 0) or 0), s=[])
    return players[pid]

for k in sorted(z, key=lambda k: (k[1], int(k[0]))):
    season, pid = int(k[0]), k[1]
    t = info[k]['t']
    p = pinfo(pid, t['player'])
    g = num(t['g'], 0)
    tms = teams_of[k] or [t['team']]
    p['s'].append([season, fr(tms[-1]), int(g), int(info[k]['mp']),
                   round(num(t['pts'], 0) / g, 1) if g else 0, round(num(t['trb'], 0) / g, 1) if g else 0,
                   round(num(t['ast'], 0) / g, 1) if g else 0,
                   [round(z[k][s], 2) for s in KEYS]])

# draft classes (rounds <= 2, or anyone who played in the NBA)
classes = defaultdict(list)
for r in drafts:
    pid = r['player_id']; s = int(r['season'])
    if not pid or pid == 'NA' or s > 2025: continue
    rnd = int(num(r['round'], 9)); pick = int(num(r['overall_pick'], 999))
    played = pid in players
    if s < FIRST:
        if played and 'd' not in players[pid]:
            players[pid]['d'] = [s, pick, rnd, fr(r['tm'])]
        continue
    if rnd > 2 and not played: continue
    if not played:
        pinfo(pid, r['player'])
    players[pid]['d'] = [s, pick, rnd, fr(r['tm'])]
    players[pid]['c'] = r['college'] if r['college'] != 'NA' else ''
    classes[s].append(pid)

# undrafted / pre-1980 arrivals: first season in data without a 1980+ draft and not on a 1980 roster
arrivals = defaultdict(list)
for pid, p in players.items():
    if not p['s']: continue
    first = p['s'][0][0]
    if first == 1980: continue
    if 'd' in p and p['d'][0] >= 1980 and p['d'][0] < first + 1:
        continue
    arrivals[first].append(pid)

# draft-slot priors: mean z at the player's first season, by pick bucket, and chance of ever playing
def bucket(pick):
    for i, hi in enumerate((3, 10, 20, 30, 45, 60)):
        if pick <= hi: return i
    return 6
bz = defaultdict(lambda: [[0.0] * len(KEYS), 0, 0])
for pid, p in players.items():
    if 'd' not in p: continue
    b = bucket(p['d'][1]); acc = bz[b]; acc[2] += 1
    if p['s']:
        acc[1] += 1
        for i, v in enumerate(p['s'][0][7]): acc[0][i] += v
draft_prior = []
for b in range(7):
    acc = bz[b]
    draft_prior.append(dict(z=[round(v / acc[1], 2) for v in acc[0]] if acc[1] else [-1.0] * len(KEYS),
                            play=round(acc[1] / acc[2], 3) if acc[2] else 0.2))

# 1980 rosters: last team in the season
roster1980 = defaultdict(list)
for pid, p in players.items():
    if p['s'] and p['s'][0][0] == 1980:
        roster1980[p['s'][0][1]].append(pid)
for tm in roster1980:
    roster1980[tm].sort(key=lambda pid: -players[pid]['s'][0][3])

CHAMPS = 'LAL BOS LAL PHI BOS LAL BOS LAL LAL DET DET CHI CHI CHI HOU HOU CHI CHI CHI SAS LAL LAL LAL SAS DET SAS MIA SAS BOS LAL LAL DAL MIA MIA SAS GSW CLE GSW GSW TOR LAL MIL GSW DEN BOS OKC NYK'.split()
champions = {str(1980 + i): c for i, c in enumerate(CHAMPS)}
awards = defaultdict(dict)
for r in rows('Player Award Shares'):
    if r['winner'] == 'TRUE' and r['award'] in ('nba mvp', 'nba roy') and int(r['season']) >= FIRST:
        awards[r['season']]['mvp' if r['award'] == 'nba mvp' else 'roy'] = r['player_id']

out = dict(
    champions=champions, awards=awards,
    keys=KEYS, transforms={s: STATS[s][0] for s in KEYS}, era=era, ovr=ovr_w, ages=AGES, aging=age_tab,
    seasons=seasons, players=players, classes=classes, arrivals=arrivals, draftPrior=draft_prior,
    roster1980=roster1980,
)
with open(OUT, 'w') as f:
    json.dump(out, f, separators=(',', ':'))
print('players', len(players), 'classes', sum(len(v) for v in classes.values()),
      'arrivals', sum(len(v) for v in arrivals.values()), file=sys.stderr)
print('ovr weights', ovr_w, file=sys.stderr)
print('1980 rosters', {k: len(v) for k, v in roster1980.items()}, file=sys.stderr)
