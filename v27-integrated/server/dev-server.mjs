import http from 'node:http';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Local dotenv parser: secrets remain on the Node side, never imported into Vite.
try {
 for(const line of readFileSync(resolve(process.cwd(),'.env'),'utf8').split(/\r?\n/)) {
  const match=line.match(/^\s*(OPERATOR_PIN|DEV_API_PORT|DEV_ALLOWED_ORIGIN)\s*=\s*(.*)\s*$/);
  if(match && process.env[match[1]] === undefined){
   let value=match[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
   process.env[match[1]]=value;
  }
 }
}catch{}

const pinCandidate=process.env.OPERATOR_PIN||'';
// Refuse to unlock with the example placeholder or a trivial short PIN.
const configuredPin=pinCandidate.length>=8 && pinCandidate!=='replace-with-a-private-long-pin'?pinCandidate:'';
const expectedHash=createHash('sha256').update(configuredPin).digest();
const sessions=new Map();
const attempts=new Map();
const MAX_FAILS=6, WINDOW_MS=15*60_000, TOKEN_TTL=2*60*60_000;
const permitted=new Set(['bot:add','timer:start','timer:pause','race:now','map:set']);
const themes=new Set(['candy','midnight','moon','rainbow','castle']);
const send=(res,status,data)=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(data));
};
function lockedOut(ip){const now=Date.now(), record=attempts.get(ip);return record&&now-record.start<WINDOW_MS&&record.errors>=MAX_FAILS}
function auth(req){
 const h=req.headers.authorization||'';
 if(!h.startsWith('Bearer '))return null;
 const token=h.slice(7);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const stored=sessions.get(token);
 if(!stored || stored.until<Date.now()){sessions.delete(token);return null}
 return token;
}
function validAction(data){
 if(!data || !permitted.has(data.type))return false;
 if(data.type==='bot:add')return Number.isInteger(data.count)&&[1,10].includes(data.count);
 if(data.type==='map:set')return themes.has(data.theme);
 return true;
}
function originAllowed(req){
 if(!req.headers.origin)return true; // node-based tests and non-browser clients still need authorization
 const origin=req.headers.origin;
 const custom=(process.env.DEV_ALLOWED_ORIGIN||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(custom.includes(origin))return true;
 try{const u=new URL(origin);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)}catch{return false}
}
const server=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||!req.url?.startsWith('/api/dev/')){send(res,404,{ok:false,error:'Not found'});return}
 if(!originAllowed(req)){send(res,403,{ok:false,error:'Origin not allowed'});return}
 const ip=req.socket.remoteAddress||'unknown';
 let raw='';
 try{
  for await(const part of req){raw+=part;if(raw.length>4096)throw new Error('Request too large')}
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('JSON required');
  const data=JSON.parse(raw||'{}');
  if(req.url==='/api/dev/unlock'){
   if(!configuredPin){send(res,503,{ok:false,error:'Operator PIN is not configured on the server.'});return}
   if(lockedOut(ip)){send(res,429,{ok:false,error:'Too many PIN attempts. Try again later.'});return}
   const candidate=typeof data.pin==='string'?data.pin:'';
   // Hash both values to perform a constant-time comparison without exposing the PIN.
   const digest=createHash('sha256').update(candidate).digest();
   if(!candidate||!timingSafeEqual(digest,expectedHash)){
    const now=Date.now();const current=attempts.get(ip);
    const entry=!current||now-current.start>WINDOW_MS?{start:now,errors:0}:current;
    entry.errors++;attempts.set(ip,entry);
    send(res,entry.errors>=MAX_FAILS?429:401,{ok:false,error:entry.errors>=MAX_FAILS?'Too many attempts. Try again later.':'Incorrect PIN.'});return;
   }
   attempts.delete(ip);
   const token=randomBytes(32).toString('hex');sessions.set(token,{until:Date.now()+TOKEN_TTL});
   send(res,200,{ok:true,token});return;
  }
  const token=auth(req);
  if(!token){send(res,401,{ok:false,error:'Developer authorization required.'});return}
  if(req.url==='/api/dev/logout'){sessions.delete(token);send(res,200,{ok:true});return}
  if(req.url==='/api/dev/action'){
   if(!validAction(data)){send(res,422,{ok:false,error:'Invalid developer command.'});return}
   // This is a server-authorized LOCAL PREVIEW command. The standalone game
   // intentionally owns its own lobby state; do not treat this as a shared race update.
   send(res,200,{ok:true,accepted:data.type});return;
  }
  send(res,404,{ok:false,error:'Not found'});
 }catch{send(res,400,{ok:false,error:'Malformed request.'})}
});
const port=Number(process.env.DEV_API_PORT||3001);
server.listen(port,'127.0.0.1',()=>{
 console.log('Monad Marbles developer API listening on http://127.0.0.1:'+server.address().port);
 if(!configuredPin)console.warn('Developer Mode disabled until OPERATOR_PIN is configured in .env');
});
