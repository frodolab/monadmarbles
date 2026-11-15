import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PIN='a-private-test-pin';
function pollServer(child){return new Promise((resolve,reject)=>{
 let stdout='';const timer=setTimeout(()=>reject(new Error('Server did not launch')),5000);
 child.stdout.on('data',data=>{stdout+=data.toString();const match=stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1])}});
 child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server exited unexpectedly'))});
})}
async function post(base,path,body,token){const response=await fetch(base+'/api/dev/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,...await response.json()}}
test('Developer API requires a private PIN and authenticated command tokens',async()=>{
 const child=spawn(process.execPath,[resolve(ROOT,'server/dev-server.mjs')],{cwd:ROOT,env:{...process.env,OPERATOR_PIN:PIN,DEV_API_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await pollServer(child);
  assert.equal((await post(base,'action',{type:'race:now'})).status,401);
  assert.equal((await post(base,'unlock',{pin:'bad'})).status,401);
  const login=await post(base,'unlock',{pin:PIN});assert.equal(login.status,200);assert.match(login.token,/^[a-f0-9]{64}$/);
  assert.equal((await post(base,'action',{type:'bot:add',count:10},login.token)).status,200);
  assert.equal((await post(base,'action',{type:'bot:add',count:200},login.token)).status,422);
  assert.equal((await post(base,'action',{type:'map:set',theme:'rainbow'},login.token)).status,200);
  assert.equal((await post(base,'action',{type:'map:set',theme:'evil'},login.token)).status,422);
  assert.equal((await post(base,'logout',{},login.token)).status,200);
  assert.equal((await post(base,'action',{type:'race:now'},login.token)).status,401);
  for(let i=0;i<6;i++){const denied=await post(base,'unlock',{pin:'wrong'+i});assert.ok([401,429].includes(denied.status))}
  assert.equal((await post(base,'unlock',{pin:PIN})).status,429);
 } finally{child.kill('SIGTERM')}
});
