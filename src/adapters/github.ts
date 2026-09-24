import { exec, type ExecResult } from './process.js';
import { AppError, assert, type Task } from '../core/model.js';
import { parse, stringify } from 'yaml';
import { taskSchema } from '../core/model.js';
import { publicText, redact } from '../core/security.js';
import { transition } from '../core/state.js';
// 执行器可注入：生产环境固定使用 gh，测试可离线构造真实的 HTTP 头/正文以覆盖退避、条件请求与幂等分支。
export type GitHubExec = (command: string, args: string[], opts?: { cwd?: string; input?: string; timeout?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }) => Promise<ExecResult>;
const begin='<!-- codexmate:task -->', end='<!-- /codexmate:task -->';
export function encodeTask(task: Task) { const {repoId,title,body,url,updatedAt,warning,remoteClosed,...meta}=task;return `${body.split(begin)[0].trim()}\n\n${begin}\n\`\`\`yaml\n${stringify(meta)}\`\`\`\n${end}`; }
export function decodeTask(repoId:string,issue:any):Task|undefined {
  const body=issue.body??''; const block=body.split(begin)[1]?.split(end)[0]?.replace(/^\s*```ya?ml\s*\n|\n```\s*$/g,'').trim();
  if(!block) return;
  const meta=taskSchema.parse(parse(block,{maxAliasCount:0}));
  assert(meta.issue===issue.number,'ISSUE_MISMATCH','Issue 编号与结构化数据不一致。');
  const assignees=(issue.assignees??[]).map((a:any)=>a.login);
  const labelState=meta.state==='handoff_pending'?'handoff':meta.state;
  const labels=(issue.labels??[]).map((l:any)=>typeof l==='string'?l:l.name).filter((l:string)=>l.startsWith('cm:'));
  const mismatch=(meta.owner ? assignees.length!==1||assignees[0]!==meta.owner : assignees.length!==0)|| (labels.length>0 && (labels.length!==1||labels[0]!==`cm:${labelState}`));
  return {...meta,repoId,title:issue.title,body:body.split(begin)[0].trim(),url:issue.html_url,updatedAt:issue.updated_at,remoteClosed:issue.state==='closed',...(mismatch?{warning:'负责人或状态标签与结构化记录不一致，已禁止执行。'}:{})};
}
export class GitHub {
  private cache=new Map<string,{etag:string;data:any}>();
  private blockedUntil=0;
  constructor(public slug:string, private run:GitHubExec = exec) { assert(/^[\w.-]+\/[\w.-]+$/.test(slug),'INVALID_REPO','仓库格式应为 owner/repo。'); }
  async request<T=any>(path:string,method='GET',body?:unknown):Promise<T> {
    assert(Date.now()>=this.blockedUntil,'RATE_LIMIT','GitHub 请求正在退避，请稍后同步。');
    const key=path;const cached=this.cache.get(key);
    const args=['api',`/repos/${this.slug}${path}`,'--method',method,'--include','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'];
    if(method==='GET'&&cached?.etag)args.push('-H',`If-None-Match: ${cached.etag}`);
    if(body!==undefined)args.push('--input','-');
    let raw:string;
    try { const result=await this.run('gh',args,{input:body===undefined?undefined:JSON.stringify(body),timeout:45000});raw=result.stdout.trim();if(result.code!==0&&!/^HTTP\//.test(raw))throw new AppError('GITHUB_TRANSPORT',result.stderr||'GitHub 网络请求失败。'); }
    catch(e) {
      const text=String(e);if(/429|rate limit|secondary rate/i.test(text)) this.blockedUntil=Date.now()+60000;
      throw e;
    }
    const separator=raw.search(/\r?\n\r?\n/),headers=separator>=0?raw.slice(0,separator):'',payload=separator>=0?raw.slice(separator).trim():raw;
    const status=Number(headers.match(/HTTP\/\S+ (\d+)/)?.[1]??200);
    if(status===304&&cached)return cached.data;
    if(status>=400){if(status===429||status>=500||(status===403&&/rate limit/i.test(payload))){const retry=Number(headers.match(/retry-after:\s*(\d+)/i)?.[1]??60);this.blockedUntil=Date.now()+Math.min(retry,3600)*1000;}throw new AppError('GITHUB_ERROR',`GitHub HTTP ${status}${status===401||status===403?'：请检查登录、仓库权限或限流状态。':''}`);}
    const result=payload?JSON.parse(payload):null;
    if(method==='GET')this.cache.set(key,{etag:headers.match(/etag:\s*(.+)/i)?.[1].trim()??'',data:result});else this.cache.clear();
    return result;
  }
  async pages(path:string) {const all:any[]=[];for(let page=1;page<=100;page++){const rows=await this.request<any[]>(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);all.push(...rows);if(rows.length<100)break;}return all;}
  async tasks(repoId:string) { const rows=await this.pages('/issues?state=all');return rows.filter(r=>!r.pull_request).flatMap(r=>{try{const t=decodeTask(repoId,r);return t?[t]:[];}catch{return [];}}); }
  async task(repoId:string,n:number) {const t=decodeTask(repoId,await this.request(`/issues/${n}`));assert(t,'INVALID_TASK','该 Issue 缺少有效 CodexMate 数据。');return t;}
  private async gh(args:string[]) {const r=await this.run('gh',args,{timeout:45000});assert(r.code===0,'GITHUB_COMMAND',redact(r.stderr||r.stdout||'gh 命令失败。'));return r.stdout.trim();}
  async identity() {return this.gh(['api','/user','--jq','.login']);}
  async permission(user:string) {const actual=await this.identity();assert(actual===user,'IDENTITY_CHANGED','当前 gh 账号与绑定账号不一致，请重新连接。');return this.request('');}
  async update(task:Task,expected:Task) {
    transition(expected.state,task.state,Boolean(task.remoteClosed));
    const current=await this.task(task.repoId,task.issue);
    assert(current.updatedAt===expected.updatedAt&&current.revision===expected.revision&&current.owner===expected.owner,'REMOTE_CHANGED','远端任务已变化，请同步后重新确认。');
    const old=await this.request<any>(`/issues/${task.issue}`);
    const labels=(old.labels??[]).map((x:any)=>x.name).filter((x:string)=>!x.startsWith('cm:'));
    labels.push(`cm:${task.state==='handoff_pending'?'handoff':task.state}`);
    const updated=await this.request(`/issues/${task.issue}`,'PATCH',{body:encodeTask(task),assignees:task.owner?[task.owner]:[],labels});
    return decodeTask(task.repoId,updated)!;
  }
  async comment(issue:number,text:string,key:string) {
    const marker=`<!-- codexmate:${key} -->`;const comments=await this.pages(`/issues/${issue}/comments`);
    const found=comments.find(c=>c.body?.includes(marker));if(found)return found;
    return this.request(`/issues/${issue}/comments`,'POST',{body:publicText(text)+'\n'+marker});
  }
  async draft(task:Task,branch:string,summary:string) {
    const existing=await this.request<any[]>(`/pulls?state=open&head=${encodeURIComponent(this.slug.split('/')[0]+':'+branch)}&base=${encodeURIComponent(task.base_branch)}`);
    if(existing.length)return existing[0];
    return this.request('/pulls','POST',{title:`#${task.issue} ${task.title}`,head:branch,base:task.base_branch,draft:true,body:publicText(`${summary}\n\nCloses #${task.issue}\n\n<!-- codexmate:pr:${task.issue}:${task.revision} -->`)});
  }
}
// 供上层注入的最小能力面：Service 只依赖这些方法，测试可离线替换实现。
export type GitHubLike = Pick<GitHub,'request'|'pages'|'tasks'|'task'|'update'|'comment'|'draft'|'permission'|'identity'>;
