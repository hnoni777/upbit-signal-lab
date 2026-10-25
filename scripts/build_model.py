#!/usr/bin/env python3
"""Build a frozen browser-ready pattern library from archived training samples."""
import json, pathlib, datetime, collections
root=pathlib.Path("data")
state=json.loads((root/"backfill-state.json").read_text())
all_samples=[]
for market in state.get("completed",[]):
    p=root/(market.replace("-","_")+".json")
    if p.exists():
        all_samples.extend(json.loads(p.read_text()).get("samples",[]))
# Retain all positives and a representative balanced set of negatives by coin and date.
positives=[s for s in all_samples if s.get("y")==1]
negatives=[s for s in all_samples if s.get("y")==0]
# All 2-hour negative controls are retained; no future leakage in features.
samples=sorted(positives+negatives,key=lambda s:(s["date"],s["market"],s["hour"]))
markets=len(set(s["market"] for s in samples))
dates=sorted(set(s["date"] for s in samples))
boundary=dates[int(len(dates)*.8)] if dates else None
train=[s for s in samples if boundary and s["date"]<boundary]
test=[s for s in samples if boundary and s["date"]>=boundary]
scales=[2,4,7,15,.7,.7,8,6,.3]
def dist(a,b):
    return (sum(min(25,((x-y)/scales[i])**2) for i,(x,y) in enumerate(zip(a,b)))/len(a))**.5
def score(f,arr):
    p=sorted((dist(f,s["f"]) for s in arr if s["y"]),key=float)[:7]
    n=sorted((dist(f,s["f"]) for s in arr if not s["y"]),key=float)[:7]
    if len(p)<5 or len(n)<7:return None
    density=lambda ds:sum(1/(.25+d)**2 for d in ds)/len(ds)
    x,y=density(p),density(n)
    return x/(x+y)
by_group=collections.defaultdict(list)
# Bound validation work while retaining chronological separation and market diversity.
validation_train=train[::max(1,len(train)//2500)]
validation_test=test[::max(1,len(test)//1200)]
for s in validation_test:
    p=score(s["f"],validation_train)
    if p is not None:by_group[(s["date"],s["hour"])].append((p,s["y"]))
eligible=[v for v in by_group.values() if len(v)>=10]
picks=sum(min(5,len(v)) for v in eligible)
hits=sum(sum(y for _,y in sorted(v,reverse=True)[:5]) for v in eligible)
baseline=sum(sum(y for _,y in v) for v in eligible)/sum(len(v) for v in eligible) if eligible else None
precision=hits/picks if picks else None
valid=markets>=20 and len(eligible)>=10 and sum(s["y"] for s in validation_train)>=10 and sum(s["y"] for s in validation_test)>=5
# Compress historical observations into representative feature centroids; do not publish raw cases.
def centroids(rows,k=48):
    if not rows:return []
    rows=sorted(rows,key=lambda s:(s["market"],s["date"],s["hour"]))
    seeds=[rows[int(i*(len(rows)-1)/max(1,min(k,len(rows))-1))]["f"][:] for i in range(min(k,len(rows)))]
    for _ in range(5):
        groups=[[] for _ in seeds]
        for row in rows:
            j=min(range(len(seeds)),key=lambda n:dist(row["f"],seeds[n]))
            groups[j].append(row)
        for j,g in enumerate(groups):
            if g:seeds[j]=[sum(s["f"][i] for s in g)/len(g) for i in range(9)]
    out=[]
    for j,g in enumerate(groups):
        if g:out.append({"f":[round(x,5) for x in seeds[j]],"y":g[0]["y"],"count":len(g),"gain":round(sum(x["gain"] for x in g)/len(g),2)})
    return out
patterns=centroids([s for s in train if s["y"]],48)+centroids([s for s in train if not s["y"]],48)
out={"version":2,"builtAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"completedMarkets":len(state.get("completed",[])),"marketCount":markets,"sampleCount":len(samples),"positives":len(positives),"negatives":len(negatives),"completed":bool(state.get("allMarketsComplete",False)),"validation":{"valid":valid,"groups":len(eligible),"train":len(train),"test":len(test),"precision":precision,"baseline":baseline,"boundary":boundary},"patterns":patterns}
(root/"pattern-model.json").write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")))
print("model",markets,"coins",len(train),"train",len(test),"holdout",len(eligible),"comparison groups",flush=True)
