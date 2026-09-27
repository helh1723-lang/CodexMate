import { spawn } from 'node:child_process';
import { AppError } from '../core/model.js';
import { redact } from '../core/security.js';
import { dirname, join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
export function terminateTree(child:import('node:child_process').ChildProcess){
  if(!child.pid)return;
  if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}
  else{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}
}
export interface ExecResult { stdout: string; stderr: string; code: number; }
export function exec(command: string,args: string[],opts: {cwd?: string; input?: string; timeout?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv} = {}): Promise<ExecResult> {
  if(process.platform==='win32'&&(command==='npm'||command==='npm.cmd')){
    const paths=(process.env.PATH??process.env.Path??'').split(delimiter);
    const node=process.versions.electron?paths.map(p=>join(p,'node.exe')).find(existsSync):process.execPath;
    const npm=paths.map(p=>join(p,'node_modules/npm/bin/npm-cli.js')).find(existsSync)??(node?join(dirname(node),'node_modules/npm/bin/npm-cli.js'):undefined);
    if(!node||!npm) return Promise.reject(new AppError('NODE_REQUIRED','项目检查需要安装 Node.js 并加入 PATH。'));
    args=[npm,...args];command=node;
  }
  return new Promise((resolve,reject)=>{
    if(opts.signal?.aborted){reject(new AppError('ABORTED','任务已停止'));return;}
    const child=spawn(command,args,{cwd:opts.cwd,env:opts.env??process.env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    const abort=()=>terminateTree(child);opts.signal?.addEventListener('abort',abort,{once:true});
    let stdout='',stderr='',exceeded=false;
    const timer=setTimeout(()=>terminateTree(child),opts.timeout??60000);
    child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>16_000_000){exceeded=true;terminateTree(child);}});
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-30000);});
    child.on('error',e=>{clearTimeout(timer);reject(new AppError('PROCESS_ERROR',redact(e.message)));});
    child.on('close',code=>{clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);if(exceeded) reject(new AppError('OUTPUT_LIMIT','进程输出超出安全大小限制。'));else resolve({stdout,stderr,code:code??-1});});
    child.stdin.on('error',()=>{});child.stdin.end(opts.input??'');
  });
}
export async function checked(command:string,args:string[],opts:Parameters<typeof exec>[2]={}) {const r=await exec(command,args,opts);if(r.code!==0)throw new AppError('COMMAND_FAILED',redact(`${command}: ${r.stderr||r.stdout||'进程终止'} (exit ${r.code})`));return r.stdout.trim();}
