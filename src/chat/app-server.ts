import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { codexExecutable } from '../adapters/codex-runtime.js';
import { redact } from '../core/security.js';
import { checked, terminateTree } from '../adapters/process.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** JSON-RPC stdio protocol pinned to bundled Codex 0.156.1. No account data crosses the relay. */
export class AppServer extends EventEmitter {
  private child?:ChildProcessWithoutNullStreams;
  private seq=0;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private starting?:Promise<void>;
  constructor(private executable=codexExecutable(),private prefix:string[]=[]){super();}
  start(){return this.starting??=this.boot().catch(e=>{this.starting=undefined;throw e;});}
  private async boot(){
    const neutral=await mkdtemp(join(tmpdir(),'codexmate-server-'));
    const env:NodeJS.ProcessEnv={};for(const key of ['PATH','Path','HOME','USERPROFILE','SystemRoot','SYSTEMROOT','TEMP','TMP','APPDATA','LOCALAPPDATA','CODEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','SSL_CERT_FILE'])if(process.env[key])env[key]=process.env[key];
    const overrides:string[]=[];
    // Load credentials normally, but never activate unrelated global MCP connections.
    if(!this.prefix.length){const list=JSON.parse(await checked(this.executable,['mcp','list','--json'],{cwd:neutral,env}));if(!Array.isArray(list))throw new Error('无法核验本机 MCP 配置');for(const item of list){if(typeof item.name!=='string'||!/^[\w-]+$/.test(item.name))throw new Error('MCP 名称无法安全覆盖');overrides.push('-c',`mcp_servers.${item.name}={enabled=false,command="codexmate-disabled"}`);}}
    for(const key of ['apps','remote_plugin','computer_use','browser_use','browser_use_external','multi_agent'])overrides.push('-c',`features.${key}=false`);
    overrides.push('-c','web_search="disabled"');
    const child=this.child=spawn(this.executable,[...this.prefix,...overrides,'app-server','--listen','stdio://'],{cwd:neutral,env,stdio:'pipe',windowsHide:true,detached:process.platform!=='win32'});
    child.stderr.on('data',b=>this.emit('diagnostic',redact(String(b)).slice(-4000)));
    createInterface({input:child.stdout}).on('line',line=>{
      try{const m=JSON.parse(line);if(m.method){this.emit(m.id===undefined?'notification':'request',m);return;}
        const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
      }catch{this.emit('diagnostic','App Server 返回无法识别的消息');}
    });
    const fail=(error:Error)=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.child=undefined;this.starting=undefined;this.emit('disconnected',error.message);};
    child.on('error',fail);child.on('exit',(code)=>fail(new Error(`Codex 进程已退出 (${code})`)));
    await this.request('initialize',{clientInfo:{name:'codexmate',title:'CodexMate',version:'2.0.0'},capabilities:{experimentalApi:true}});
    this.send({method:'initialized'});
  }
  private send(value:unknown){if(!this.child?.stdin.writable)throw new Error('Codex 尚未连接');this.child.stdin.write(JSON.stringify(value)+'\n');}
  request(method:string,params:unknown={}):Promise<any>{
    const id=++this.seq;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 响应超时，请检查本机 Codex`));},60000);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
  }
  respond(id:string|number,result:unknown){this.send({id,result});}
  reject(id:string|number,message:string){this.send({id,error:{code:-32000,message}});}
  close(){if(this.child)terminateTree(this.child);}
}
