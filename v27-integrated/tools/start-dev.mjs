import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=process.cwd();
const commands=[
 [process.execPath,[resolve(root,'server/dev-server.mjs')]],
 [process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','0.0.0.0']]
];
const children=commands.map(([bin,args])=>spawn(bin,args,{cwd:root,env:process.env,stdio:'inherit'}));
let stopped=false;
function shutdown(){if(stopped)return;stopped=true;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
for(const child of children)child.once('exit',(code)=>{if(!stopped){shutdown();process.exitCode=code??1}});
