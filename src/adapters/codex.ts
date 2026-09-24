import { Codex, type ThreadEvent } from '@openai/codex-sdk';
import { z } from 'zod';
import { AppError, assert } from '../core/model.js';
import { redact, untrustedPrompt } from '../core/security.js';
import { checked } from './process.js';
import { codexExecutable } from './codex-runtime.js';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export interface RunnerInput { cwd:string; prompt:string; context:unknown; threadId?:string; signal:AbortSignal; onEvent:(e:ThreadEvent)=>void; }
export interface Runner { run(input:RunnerInput):Promise<{summary:string;changes:{path:string;content:string;originalHash:string|null}[];threadId?:string}>; text(input:RunnerInput):Promise<string>; }
const resultSchema=z.object({summary:z.string(),changes:z.array(z.object({path:z.string(),content:z.string(),originalHash:z.string().nullable()}))});
const outputSchema={type:'object',properties:{summary:{type:'string'},changes:{type:'array',items:{type:'object',properties:{path:{type:'string'},content:{type:'string'},originalHash:{type:['string','null']}},required:['path','content','originalHash'],additionalProperties:false}}},required:['summary','changes'],additionalProperties:false};
export class CodexRunner implements Runner {
  private async client(cwd:string) {
    const env:Record<string,string>={};
    for(const key of ['PATH','Path','HOME','USERPROFILE','SystemRoot','SYSTEMROOT','TEMP','TMP','APPDATA','LOCALAPPDATA','CODEX_HOME','CODEX_API_KEY','OPENAI_API_KEY'])if(process.env[key])env[key]=process.env[key]!;
    // Inspect names in memory, then explicitly disable every configured MCP transport.
    const configured=JSON.parse(await checked(codexExecutable(),['mcp','list','--json'],{cwd,env}));
    assert(Array.isArray(configured),'CODEX_CONFIG','无法核验 Codex MCP 配置。');
    const servers:Record<string,{enabled:boolean}>={};
    for(const item of configured){assert(typeof item.name==='string'&&/^[\w-]+$/.test(item.name),'CODEX_CONFIG','MCP 名称无法安全覆盖，停止执行。');servers[item.name]={enabled:false};}
    return new Codex({env,config:{features:{shell_tool:false,unified_exec:false,apps:false,computer_use:false,browser_use:false,browser_use_external:false,remote_plugin:false,code_mode:false,code_mode_host:false,workspace_dependencies:false,multi_agent:false},web_search:'disabled',mcp_servers:servers,shell_environment_policy:{inherit:'none'}}});
  }
  private async execute(input:RunnerInput,structured:boolean) {
    // Avoid repository-local config and AGENTS.md. Context is supplied by the host after scanning.
    const neutral=await mkdtemp(join(tmpdir(),'codexmate-context-'));
    const codex=await this.client(neutral);
    // Codex proposes edits; the host validates and applies them. The model never gets a writable sandbox.
    const options={workingDirectory:neutral,skipGitRepoCheck:true,sandboxMode:'read-only' as const,approvalPolicy:'never' as const,networkAccessEnabled:false,webSearchMode:'disabled' as const};
    const thread=input.threadId?codex.resumeThread(input.threadId,options):codex.startThread(options);
    const turn=await thread.runStreamed(untrustedPrompt(input.prompt,input.context),{signal:input.signal,...(structured?{outputSchema}:{})});
    let response='',completed=false;
    for await(const event of turn.events){input.onEvent(JSON.parse(redact(JSON.stringify(event))));if(event.type==='turn.failed')throw new AppError('CODEX_FAILED',redact(event.error.message));if(event.type==='error')throw new AppError('CODEX_FAILED',redact(event.message));if(event.type==='item.completed'&&event.item.type==='agent_message')response=event.item.text;if(event.type==='turn.completed')completed=true;}
    assert(completed,'CODEX_INCOMPLETE','Codex 未返回完成事件；保留本机记录。');
    return {response,threadId:thread.id??undefined};
  }
  async run(input:RunnerInput){const {response,threadId}=await this.execute({...input,prompt:input.prompt+'\n根据提供文件上下文返回完整新文件内容 changes；每个原文件用上下文 sha256 填 originalHash，新文件为 null。不要删除文件。无法安全实现时 changes 为空并说明阻碍。'},true);return {...resultSchema.parse(JSON.parse(response)),threadId};}
  async text(input:RunnerInput){return (await this.execute(input,false)).response;}
}
