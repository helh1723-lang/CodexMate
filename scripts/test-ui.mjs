import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const home=resolve('.local',`browser-${Date.now()}`);
mkdirSync(home,{recursive:true});
const server=spawn(process.execPath,['dist/cli/index.js','--home',home,'demo','--port','4318'],{stdio:'pipe',windowsHide:true});
server.stdout.on('data',b=>process.stdout.write(b));server.stderr.on('data',b=>process.stderr.write(b));
let ready=false;
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error('UI server exited');try{const r=await fetch('http://127.0.0.1:4318/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw new Error('UI server not ready');
  const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test'],{stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));
}finally{server.kill();server.stdout.destroy();server.stderr.destroy();server.unref();}
