# Hidden boosts: for every All-NBA / MVP-vote season, how far below the rank the honour implies our
# ratings put the player (in box +/- points); half the career-average gap, shrunk for few seasons, capped at 2.
import json, csv, numpy as np, sys
from collections import defaultdict
H=json.load(open('/home/claude/nba-sim/data/history.json')); KEYS=H['keys']; OW=H['ovr']
D='/root/bball-reference-datasets/Data/'
def bpm(z): return OW['_']+sum(OW[k]*z[i] for i,k in enumerate(KEYS))
an={}; mvp={}
for r in csv.DictReader(open(D+'End of Season Teams.csv')):
    if r['lg']=='NBA' and r['type']=='All-NBA' and r['season'].isdigit() and int(r['season'])>=1980: an[(int(r['season']),r['player_id'])]={'1st':1,'2nd':2,'3rd':3}[r['number_tm']]
for r in csv.DictReader(open(D+'Player Award Shares.csv')):
    if r['award']=='nba mvp' and int(r['season'])>=1980: mvp[(int(r['season']),r['player_id'])]=float(r['share'])
# 2025-26 (not in the data set yet)
for p,n in json.loads(sys.argv[1] if len(sys.argv)>1 else '[]'): an[(2026,p)]=n
by=defaultdict(list)
for pid,p in H['players'].items():
    for s in p['s']:
        if s[3]>=1200: by[s[0]].append((bpm(s[7]),pid,s[3]))
gaps=defaultdict(list)
for s,L in by.items():
    L.sort(reverse=True); vals=[b for b,_,_ in L]
    for i,(b,pid,mp) in enumerate(L):
        exp=None
        if (s,pid) in an: exp={1:3,2:8,3:13}[an[(s,pid)]]
        m=mvp.get((s,pid),0)
        if m>=0.5: exp=min(exp or 99,2)
        elif m>=0.15: exp=min(exp or 99,5)
        if exp is None: continue
        need=vals[min(exp-1,len(vals)-1)]
        gaps[pid].append((s,max(0.0,need-b),i+1,exp))
res={}
for pid,g in gaps.items():
    n=len(g); avg=sum(x[1] for x in g)/n
    boost=min(2.0,0.5*avg*n/(n+1.5))
    if boost>=0.1: res[pid]=round(boost,2)
names={p:H['players'][p]['n'] for p in res}
print(len(res),'players get a boost')
for p,v in sorted(res.items(),key=lambda x:-x[1])[:45]: print(f'  {names[p]:24s} +{v:.2f}  seasons {len(gaps[p])}  e.g. '+', '.join(f'{s}:#{r}→#{e}' for s,_,r,e in gaps[p][:4]))
json.dump(res,open(__file__.replace('test/hboost.py','src/hboost.json'),'w'))
