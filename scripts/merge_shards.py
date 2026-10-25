#!/usr/bin/env python3
import json,pathlib,datetime,urllib.request
root=pathlib.Path("data")
base=json.loads((root/"backfill-state.json").read_text()) if (root/"backfill-state.json").exists() else {"completed":[],"failed":{}}
done=set(base.get("completed",[]));failed=dict(base.get("failed",{}))
for folder in sorted(pathlib.Path("shard-results").glob("shard-*")):
    f=folder/"backfill-state.json"
    if not f.exists():continue
    state=json.loads(f.read_text());done.update(state.get("completed",[]));failed.update(state.get("failed",{}))
    for p in folder.glob("KRW_*.json"):(root/p.name).write_bytes(p.read_bytes())
req=urllib.request.Request("https://api.upbit.com/v1/market/all?isDetails=false",headers={"User-Agent":"UPBIT-SIGNAL-LAB-Research/1.0"})
with urllib.request.urlopen(req,timeout=30) as res:markets={x["market"] for x in json.load(res) if x["market"].startswith("KRW-")}
missing=sorted(markets-done)
state={"completed":sorted(done),"failed":failed,"missing":missing,"allMarketsComplete":not missing,"updated":datetime.datetime.now(datetime.timezone.utc).isoformat()}
(root/"backfill-state.json").write_text(json.dumps(state,ensure_ascii=False,indent=2))
print("Collected",len(done),"of",len(markets),"missing",len(missing),flush=True)
