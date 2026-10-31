# Defensive impact per player-season, from how well his teams actually defended.
#
# DBPM rewards defensive rebounds and blocks so much that every rebounding centre comes out as a
# good defender (Jokić rated above Gobert). Here each team-season's defensive rating (relative to
# the league) is shared out over the players by minutes, and solved for every player at once with
# heavy ridge shrinkage toward a box-score prior (steals, blocks, fouls, height, age – defensive
# rebounding deliberately has little say). A career-long player effect plus a small per-season
# deviation keeps it stable; 45 seasons of team defense separate Gobert from Jokić.
import math
from collections import defaultdict

import numpy as np
from scipy.sparse import coo_matrix, vstack, identity, diags
from scipy.sparse.linalg import lsqr


def num(x, d=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def build_def(tot, teams_raw, z, career, age_of, lam_u=3.0, lam_v=12.0, lam_b=0.5, rec=None):
    """Returns {(season, pid): defensive points per 100 possessions (team units, + = better)}."""
    # league defensive rating per season, team ratings
    import os
    FIELD = os.environ.get('DEFFIELD', 'opp_e_fg_percent')  # shot defense only: rebounds, steals and fouls have their own ratings
    lg = {int(r['season']): num(r[FIELD]) for r in teams_raw if r['team'] == 'League Average'}
    tdr = {(int(r['season']), r['abbreviation']): num(r[FIELD]) for r in teams_raw if r['team'] != 'League Average'}
    abbr_of = {}
    for r in teams_raw:
        if r['team'] != 'League Average': abbr_of[(int(r['season']), r['abbreviation'])] = True

    keys = sorted(z)  # (season str, pid)
    kidx = {k: i for i, k in enumerate(keys)}
    pids = sorted({k[1] for k in keys})
    pidx = {p: i for i, p in enumerate(pids)}

    # box prior features
    hts = [num(career.get(p, {}).get('ht_in_in')) for p in pids]
    hv = [h for h in hts if h]
    hmu, hsd = sum(hv) / len(hv), (sum((h - sum(hv) / len(hv)) ** 2 for h in hv) / len(hv)) ** 0.5
    def feats(k):
        zz = z[k]; p = k[1]
        h = num(career.get(p, {}).get('ht_in_in'))
        hz = (h - hmu) / hsd if h else 0.0
        a = age_of(p, int(k[0])) - 27
        f = [1.0, zz['stl'], zz['blk'], zz['pf'], hz, a / 5.0, (a / 5.0) ** 2]
        if rec is not None: f.append(rec.get(k, 0.0))
        return f
    F = np.array([feats(k) for k in keys])
    nb, nu, nv = F.shape[1], len(pids), len(keys)

    # observations: one row per team-season
    rows, cols, vals, y = [], [], [], []
    by_team = defaultdict(list)
    for r in tot:
        t = r['team']
        if t.endswith('TM') or t == 'TOT': continue
        k = (r['season'], r['player_id'])
        if k not in kidx: continue
        by_team[(int(r['season']), t)].append((k, num(r['mp'], 0)))
    o = 0
    for (s, t), lst in sorted(by_team.items()):
        if (s, t) not in tdr or s not in lg or tdr[(s, t)] is None: continue
        M = sum(m for _, m in lst)
        if M <= 0: continue
        for k, m in lst:
            w = m / M
            i = kidx[k]
            # d_k = F_k·β + u_p + v_k
            for j in range(nb):
                rows.append(o); cols.append(j); vals.append(w * F[i, j])
            rows.append(o); cols.append(nb + pidx[k[1]]); vals.append(w)
            rows.append(o); cols.append(nb + nu + i); vals.append(w)
        y.append((100 if FIELD.endswith('percent') else 1) * (lg[s] - tdr[(s, t)]))
        o += 1
    n = nb + nu + nv
    A = coo_matrix((vals, (rows, cols)), shape=(o, n)).tocsr()
    reg = diags([math.sqrt(lam_b)] * nb + [math.sqrt(lam_u)] * nu + [math.sqrt(lam_v)] * nv)
    A2 = vstack([A, reg]).tocsr()
    y2 = np.concatenate([np.array(y), np.zeros(n)])
    sol = lsqr(A2, y2, atol=1e-10, btol=1e-10, iter_lim=20000)[0]
    beta, u, v = sol[:nb], sol[nb:nb + nu], sol[nb + nu:]
    pred = A @ sol
    yy = np.array(y)
    print('defense model: team-seasons', o, 'R2', round(1 - ((yy - pred) ** 2).sum() / ((yy - yy.mean()) ** 2).sum(), 3),
          'beta', [round(b, 2) for b in beta], file=__import__('sys').stderr)
    out = {}
    for k, i in kidx.items():
        out[k] = float(F[i] @ beta + u[pidx[k[1]]] + v[i])
    return out
