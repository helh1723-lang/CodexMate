import { spawn } from 'node:child_process';
import { AppError } from '../core/model.js';
import { redact } from '../core/security.js';
import { dirname, join } from 'node:path';
export interface ExecResult { stdout: string; stderr: string; code: number; }
export function exec(command: string,args: string[],opts: {cwd?: string; input?: string; timeout?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv} = {}): Promise<ExecResult> {
  if(process.platform==='win32'&&(command==='npm'||command==='npm.cmd')){args=[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...args];command=process.execPath;}
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:opts.cwd,env:opts.env??process.env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],signal:opts.signal});
    let stdout='',stderr='',exceeded=false;
    const timer=setTimeout(()=>child.kill(),opts.timeout??60000);
    child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>16_000_000){exceeded=true;child.kill();}});
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-30000);});
    child.on('error',e=>{clearTimeout(timer);reject(new AppError('PROCESS_ERROR',redact(e.message)));});
    child.on('close',code=>{clearTimeout(timer);if(exceeded) reject(new AppError('OUTPUT_LIMIT','进程输出超出安全大小限制。'));else resolve({stdout,stderr,code:code??-1});});
    child.stdin.on('error',()=>{});child.stdin.end(opts.input??'');
  });
}
export async function checked(command:string,args:string[],opts:Parameters<typeof exec>[2]={}) {const r=await exec(command,args,opts);if(r.code!==0)throw new AppError('COMMAND_FAILED',redact(`${command}: ${r.stderr||r.stdout||'进程终止'} (exit ${r.code})`));return r.stdout.trim();}
