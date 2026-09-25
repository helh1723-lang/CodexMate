import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { git, GitWorktree, hostGitEnvironment } from '../adapters/git.js';
import { exec } from '../adapters/process.js';
import { redact } from '../core/security.js';
import type { Check, Project, Result, Task } from './model.js';
export const shaPattern=/^[0-9a-f]{40,64}$/;
export function repositoryIdentity(remote:string){return remote.replace(/^git@([^:]+):/,'https://$1/').replace(/^ssh:\/\/git@/,'https://').replace(/\.git$/,'').replace(/\/$/,'');}
export class Repository {
  constructor(public project:Project,private home:string){}
  async verify(){const root=await git(this.project.path,['rev-parse','--show-toplevel']);if(resolve(root)!==resolve(this.project.path))throw new Error('请选择仓库根目录');const remote=await git(this.project.path,['remote','get-url','origin']);if(remote!==this.project.remote)throw new Error('仓库 origin 已改变，需要重新授权');}
  async base(){await this.verify();await git(this.project.path,['fetch','origin']);const head=await git(this.project.path,['rev-parse','HEAD']);const refs=await git(this.project.path,['branch','-r','--contains',head]);if(!refs.trim())throw new Error('当前 HEAD 尚未同步到 origin，请先推送项目基准提交');return head;}
  async worktree(task:string,member:string,base:string,kind='work'){
    await this.verify();if(!shaPattern.test(base))throw new Error('基准提交格式错误');
    await git(this.project.path,['fetch','origin']);await git(this.project.path,['cat-file','-e',`${base}^{commit}`]);
    const refs=await git(this.project.path,['branch','-r','--contains',base]);if(!refs.trim())throw new Error('同伴基准不属于共享远端，请核对仓库');
    const branch=`cm/${task}/${member.slice(0,8)}-${kind}`,path=join(this.home,'worktrees',task,member.slice(0,8)+'-'+kind);
    await mkdir(join(this.home,'worktrees',task),{recursive:true});
    try{await git(path,['rev-parse','--git-dir']);if(await git(path,['branch','--show-current'])!==branch)throw new Error('已有工作树分支不符');return {path,branch};}catch(e){if(String(e).includes('分支不符'))throw e;}
    await git(this.project.path,['worktree','add','-b',branch,path,base]);return {path,branch};
  }
  async checks(path:string,signal?:AbortSignal):Promise<Check[]>{const results:Check[]=[],env=await hostGitEnvironment(path);for(const command of this.project.checks){if(!command.length)continue;const r=await exec(command[0],command.slice(1),{cwd:path,signal,timeout:600000,env});results.push({command,code:r.code,output:redact(r.stdout+'\n'+r.stderr).slice(-20000)});if(r.code!==0)break;}return results;}
  async verifyReview(path:string,sha:string){
    if(await git(path,['rev-parse','HEAD'])!==sha||await git(path,['status','--porcelain']))throw new Error('审查工作树已偏离指定提交。请还原额外修改后继续，不能把修改后的检查归到原 SHA。');
  }
  async commit(task:Task,summary:string,signal?:AbortSignal):Promise<Result>{
    await this.verify();const tree=new GitWorktree(this.project.path,join(this.home,'worktrees'));await tree.health(task.path,task.branch);
    const checks=await this.checks(task.path,signal);if(checks.some(c=>c.code!==0))throw new Error('约定检查失败：\n'+checks.map(c=>c.command.join(' ')+'\n'+c.output).join('\n'));
    if(signal?.aborted)throw new Error('任务已停止');const sha=await tree.checkpoint(task.path,task.base,'CodexMate: '+task.title.slice(0,100));
    if(signal?.aborted)throw new Error('任务已停止');await tree.push(task.path,task.branch,task.base);return {sha,branch:task.branch,checks,summary};
  }
  async reconcileCommitted(task:Task,summary:string):Promise<Result|undefined>{
    await this.verify();const tree=new GitWorktree(this.project.path,join(this.home,'worktrees'));await tree.health(task.path,task.branch);
    const remoteRef=`refs/heads/${task.branch}`;
    const remoteSha=(value:string)=>/^([0-9a-f]{40,64})\s/m.exec(value)?.[1];
    const local=await git(task.path,['rev-parse','HEAD']),remote=remoteSha(await git(task.path,['ls-remote','--heads','origin',remoteRef]));
    if(!remote||remote!==local||local===task.base)return undefined;
    await git(task.path,['merge-base','--is-ancestor',task.base,local]);
    if(await git(task.path,['status','--porcelain']))return undefined;
    await tree.scan(task.path,task.base);const checks=await this.checks(task.path);
    if(checks.some(c=>c.code!==0))return undefined;
    const current=await git(task.path,['rev-parse','HEAD']),remoteNow=remoteSha(await git(task.path,['ls-remote','--heads','origin',remoteRef]));
    if(current!==local||remoteNow!==local||await git(task.path,['status','--porcelain']))return undefined;
    await tree.scan(task.path,task.base);
    return {sha:local,branch:task.branch,checks,summary};
  }
  async fetchResult(task:Task,result:Result){
    if(!shaPattern.test(result.sha)||!result.branch.startsWith(`cm/${task.id}/`)||!/^cm\/[a-zA-Z0-9/_-]+$/.test(result.branch))throw new Error('同伴结果不是合法协作分支');
    await this.verify();await git(this.project.path,['fetch','origin',`refs/heads/${result.branch}`]);const sha=await git(this.project.path,['rev-parse','FETCH_HEAD']);if(sha!==result.sha)throw new Error('远端分支已变化，与同伴报告 SHA 不符');
    await git(this.project.path,['merge-base','--is-ancestor',task.base,result.sha]);
  }
  async integrate(task:Task,member:string){
    const work=await this.worktree(task.id,member,task.base,'integration');
    for(const result of Object.values(task.results)){await this.fetchResult(task,result);await git(work.path,['-c','commit.gpgsign=false','merge','--no-edit',result.sha]);}
    return work;
  }
  async diff(task:Task){return (await git(task.path,['diff','--no-ext-diff','--no-textconv',task.base,'--'])).slice(0,200000);}
}
