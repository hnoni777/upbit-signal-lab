/* Public quotation only. No account access or orders. */
(function(root){
'use strict';
function parse(m,now=Date.now()){
 if(!m||!/^KRW-[A-Z0-9]+$/.test(m.code)||!Number.isFinite(m.timestamp)||m.timestamp>now+30000||m.timestamp<=0)return null;
 if(m.type==='ticker'&&Number.isFinite(m.trade_price)&&m.trade_price>0&&Number.isFinite(m.trade_timestamp)&&m.trade_timestamp<=now+30000&&m.trade_timestamp>0)return {kind:'ticker',market:m.code,time:m.timestamp,tradeTime:m.trade_timestamp,price:m.trade_price};
 if(m.type!=='orderbook'||!Array.isArray(m.orderbook_units)||!m.orderbook_units.length)return null;
 const levels=m.orderbook_units.slice(0,5);
 if(levels.some((u,i)=>!['ask_price','bid_price','ask_size','bid_size'].every(k=>Number.isFinite(u[k]))||u.ask_price<=0||u.bid_price<=0||u.ask_size<0||u.bid_size<0||u.ask_price<u.bid_price||(i>0&&(u.ask_price<levels[i-1].ask_price||u.bid_price>levels[i-1].bid_price))))return null;
 const first=levels[0],bid=first.bid_price,ask=first.ask_price;
 return {kind:'book',market:m.code,time:m.timestamp,bid,ask,spread:100*(ask-bid)/((ask+bid)/2),bidKrw:levels.reduce((s,u)=>s+u.bid_price*u.bid_size,0),askKrw:levels.reduce((s,u)=>s+u.ask_price*u.ask_size,0),levels};
}
function fresh(q,connected,now=Date.now()){return !!(connected&&q&&now-q.time<=15000&&now-q.time>=-30000&&(q.kind!=='ticker'||now-q.tradeTime<=15000));}
function create(onChange,env={}){
 const now=env.now||Date.now,later=env.setTimeout||setTimeout,cancel=env.clearTimeout||clearTimeout,WS=env.WebSocket||root.WebSocket;
 let codes=[],key='',socket=null,timer=null,lastAttempt=-Infinity,generation=0,backoff=10000,connected=false,stopped=false;
 const data={};
 function emit(){onChange({connected,data,codes:codes.slice(),available:!!WS});}
 function close(){generation++;connected=false;if(socket){socket.onclose=null;socket.close();socket=null;}if(timer)cancel(timer);timer=null;}
 function schedule(delay){if(timer)cancel(timer);timer=later(connect,Math.max(delay,11000-(now()-lastAttempt)));}
 function connect(){timer=null;if(stopped||!codes.length||!WS)return;lastAttempt=now();const id=++generation;let ws;
  try{ws=socket=new WS('wss://api.upbit.com/websocket/v1');ws.binaryType='arraybuffer';}catch(e){schedule(backoff);backoff=Math.min(60000,backoff*2);return;}
  ws.onopen=()=>{if(id!==generation)return;connected=true;ws.send(JSON.stringify([{ticket:'signal-quotes-'+now()},{type:'ticker',codes},{type:'orderbook',codes:codes.map(c=>c+'.5'),level:0},{format:'DEFAULT'}]));emit();};
  ws.onmessage=async e=>{try{const raw=typeof e.data==='string'?e.data:e.data instanceof ArrayBuffer?new TextDecoder().decode(e.data):await e.data.text();if(id!==generation)return;const q=parse(JSON.parse(raw),now());if(!q||!codes.includes(q.market))return;const row=data[q.market]||(data[q.market]={});if(row[q.kind]?.time>q.time)return;row[q.kind]=q;backoff=10000;emit();}catch(e){/* Invalid frames never replace valid quotations. */}};
  ws.onerror=()=>{if(id===generation)ws.close();};
  ws.onclose=()=>{if(id!==generation)return;connected=false;socket=null;emit();schedule(backoff);backoff=Math.min(60000,backoff*2);};
 }
 return {set(markets){const next=[...new Set(markets.filter(c=>/^KRW-[A-Z0-9]+$/.test(c)))].sort().slice(0,3),k=next.join(',');if(k===key)return;close();codes=next;key=k;for(const c of Object.keys(data))if(!codes.includes(c))delete data[c];emit();if(codes.length)schedule(0);},stop(){stopped=true;close();emit();},resume(){if(!stopped)return;stopped=false;if(codes.length)schedule(0);},get(){return {connected,data,codes:codes.slice(),available:!!WS};}};
}
const api={parse,fresh,create};if(typeof module==='object'&&module.exports)module.exports=api;else root.LiveQuotes=api;
})(typeof window==='object'?window:globalThis);
