#!/usr/bin/env python3
"""Incremental 2-year, all-hours Upbit 15-minute candle backfill. Standard library only."""
import json, os, time, urllib.parse, urllib.request, datetime, math, random
from pathlib import Path
BASE="https://api.upbit.com/v1"
ROOT=Path("data")
ROOT.mkdir(exist_ok=True)
STATE=ROOT/"backfill-state.json"
STATE_DATA=json.loads(STATE.read_text()) if STATE.exists() else {"completed":[],"failed":{},"updated":None}
HEADERS={"User-Agent":"UPBIT-SIGNAL-LAB-Research/1.0","Accept":"application/json"}
def api(path,params=None):
    url=BASE+path+("?"+urllib.parse.urlencode(params) if params else "")
    for attempt in range(8):
        try:
            req=urllib.request.Request(url,headers=HEADERS)
            with urllib.request.urlopen(req,timeout=25) as res:return json.load(res)
        except Exception as ex:
            if attempt==7:raise
            time.sleep(min(35,2**attempt+random.random()))
def epoch(s):return int(datetime.datetime.fromisoformat(s.replace("Z","+00:00")).replace(tzinfo=datetime.timezone.utc).timestamp()) if "+" not in s else int(datetime.datetime.fromisoformat(s).timestamp())
def vector(a):
    if len(a)!=97:return None
    ts=[epoch(x["candle_date_time_utc"]) for x in a]
    if any(ts[i]!=ts[0]+i*900 for i in range(97)):return None
    price=lambda i:float(a[i]["trade_price"])
    vol=lambda b:sum(float(x.get("candle_acc_trade_price",0)) for x in b)/len(b)
    base=max(vol(a[:80]),1)
    tail=a[-24:]
    high=max(float(x["high_price"]) for x in tail)
    low=max(float(x["low_price"]) for x in tail)
    total=sum(float(x.get("candle_acc_trade_price",0)) for x in a[-12:])
    up=sum(float(x.get("candle_acc_trade_price",0)) for x in a[-12:] if x["trade_price"]>x["opening_price"])
    f=[100*(price(-1)/price(-5)-1),100*(price(-1)/price(-13)-1),100*(price(-1)/price(-25)-1),100*(price(-1)/price(0)-1),math.log1p(vol(a[-4:])/base),math.log1p(vol(a[-12:])/base),100*(high/max(low,1e-10)-1),100*(price(-1)/high-1),up/total if total else .5]
    return [round(x,5) for x in f] if all(math.isfinite(x) for x in f) else None
def collect(market):
    cutoff=int(time.time())-731*86400
    cursor=None
    seen={}
    for page in range(380):
        params={"market":market,"count":200}
        if cursor:params["to"]=cursor
        rows=api("/candles/minutes/15",params)
        if not rows:break
        for c in rows:seen[c["candle_date_time_utc"]]=c
        last=rows[-1]["candle_date_time_utc"]
        cursor=last+"Z"
        if epoch(last)<cutoff or len(rows)<200:break
        time.sleep(.14)
    candles=sorted((c for c in seen.values() if epoch(c["candle_date_time_utc"])>=cutoff),key=lambda c:c["candle_date_time_utc"])
    out=[]
    for i in range(97,len(candles)-8,4): # hourly observations throughout all 24 hours
        a=candles[i-97:i]
        f=vector(a)
        if f is None:continue
        future=candles[i:i+8]
        t=epoch(candles[i]["candle_date_time_utc"])
        if any(epoch(c["candle_date_time_utc"])!=t+j*900 for j,c in enumerate(future)):continue
        entry=float(a[-1]["trade_price"])
        peak=max(float(c["high_price"]) for c in future)
        gain=100*(peak/entry-1)
        y=int(gain>=10)
        # Keep every positive; uniformly retain one negative every 12 hours to cap storage.
        if not y and (t//3600)%12!=0:continue
        best=max(future,key=lambda c:c["high_price"])
        onset=next((c for c in future if float(c["high_price"])>=entry*1.03),None)
        dt=datetime.datetime.fromtimestamp(t+9*3600,datetime.timezone.utc)
        out.append({"market":market,"date":dt.strftime("%Y-%m-%d"),"hour":dt.hour,"f":f,"y":y,"gain":round(gain,3),"peakTime":datetime.datetime.fromtimestamp(epoch(best["candle_date_time_utc"])+9*3600,datetime.timezone.utc).strftime("%H:%M"),"onsetTime":datetime.datetime.fromtimestamp(epoch(onset["candle_date_time_utc"])+9*3600,datetime.timezone.utc).strftime("%H:%M") if onset else None})
    return out,len(candles)
def main():
    markets=[x["market"] for x in api("/market/all",{"isDetails":"false"}) if x["market"].startswith("KRW-")]
    # All currently listed KRW markets, deterministic order; includes illiquid coins.
    pending=[m for m in sorted(markets) if m not in STATE_DATA["completed"]]
    shard=int(os.environ.get("SHARD_INDEX","0"))
    shard_count=int(os.environ.get("SHARD_COUNT","1"))
    for market in [m for i,m in enumerate(sorted(markets)) if i%shard_count==shard and m not in STATE_DATA["completed"]]:
        try:
            samples,n=collect(market)
            (ROOT/(market.replace("-","_")+".json")).write_text(json.dumps({"market":market,"candles":n,"samples":samples},ensure_ascii=False,separators=(",",":")))
            STATE_DATA["completed"].append(market)
            STATE_DATA["failed"].pop(market,None)
            print(market,"candles",n,"samples",len(samples),"positive",sum(s["y"] for s in samples),flush=True)
        except Exception as ex:
            STATE_DATA["failed"][market]=str(ex)
            print("FAILED",market,str(ex),flush=True)
        STATE_DATA["updated"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
        STATE.write_text(json.dumps(STATE_DATA,ensure_ascii=False,indent=2))
    STATE_DATA["allMarketsComplete"]=all(m in STATE_DATA["completed"] for m in markets) if shard_count==1 else False
    STATE.write_text(json.dumps(STATE_DATA,ensure_ascii=False,indent=2))
    print("Completed",len(STATE_DATA["completed"]),"of",len(markets),"finished",STATE_DATA["allMarketsComplete"])
if __name__=="__main__":main()
