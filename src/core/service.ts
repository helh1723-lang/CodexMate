import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, appendFile, readdir, stat, unlink } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { Store } from '../store/index.js';
import { GitHub, encodeTask, type GitHubLike } from '../adapters/github.js';
import { GitWorktree, git } from '../adapters/git.js';
import { exec, checked } from '../adapters/process.js';
import { CodexRunner, type Runner } from '../adapters/codex.js';
import { codexExecutable } from '../adapters/codex-runtime.js';
import { actionSchema, policySchema, planSchema, taskSchema, assert, now, AppError, type Project, type Task, type Run, type Review, type Handoff, type Approval, type ActionRequest, type Plan } from './model.js';
import { digest, redact, publicText, classifyError } from './security.js';
import { blockers, validateGraph, conflicts, quality, suggestions, validatePlan } from './planning.js';

export class Service {
  controllers=new Map<string,AbortController>();
  private githubs=new Map<string,GitHubLike>();
  // GitHub 适配器可注入：生产固定走真实 gh，测试可离线驱动同步对账与幂等分支。
  constructor(public store:Store,public runner:Runner=new CodexRunner(),private github:(slug:string)=>GitHubLike=slug=>new GitHub(slug)){}
  project(id:string){const p=this.store.get<Project>('project',id);assert(p,'PROJECT_NOT_FOUND','仓库尚未连接。');return p;}
  task(repo:string,n:number){const t=this.store.get<Task>('task',`${repo}:${n}`);assert(t,'TASK_NOT_FOUND','任务不存在，请先同步。');return t;}
  gh(p:Project){let gh=this.githubs.get(p.id);if(!gh){gh=this.github(p.slug);this.githubs.set(p.id,gh);}return gh;}
  git(p:Project){return new GitWorktree(p.root,join(this.store.home,'worktrees',p.id));}
  saveTask(t:Task){return this.store.put('task',`${t.repoId}:${t.issue}`,t);}
  saveRun(r:Run){return this.store.put('run',r.id,r);}
  latest(repo:string,issue:number){return this.store.list<Run>('run').filter(r=>r.repoId===repo&&r.issue===issue).at(-1);}
  snapshot(){const projects=this.store.list<Project>('project'),tasks=this.store.list<Task>('task'),runs=this.store.list<Run>('run');return {version:'1.1.0-rc.1',device:this.store.device,projects,tasks,runs:runs.map(({threadId,...r})=>r),reviews:this.store.list<Review>('review'),handoffs:this.store.list<Handoff>('handoff'),approvals:this.store.list<Approval>('approval'),plans:this.store.list<Plan>('plan'),audit:this.store.audits(),notifications:this.store.list('notification'),conflicts:conflicts(tasks),quality:quality(runs),suggestions:projects.flatMap(p=>suggestions(p,tasks)),quota:'未知'};}
  async connect(root:string){
    root=resolve(root);const top=await git(root,['rev-parse','--show-toplevel']);assert(resolve(top)===root,'REPO_ROOT','请选择 Git 仓库根目录。');
    const remote=await git(root,['remote','get-url','origin']);const match=remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    assert(match,'REMOTE','只支持明确的 GitHub.com origin，请先配置可信仓库。');const gh=new GitHub(match[1]),user=await gh.identity(),repo=await gh.permission(user);
    const id=digest(match[1]).slice(0,16),old=this.store.get<Project>('project',id);
    await git(root,['fetch','origin',repo.default_branch]);
    let config:any;try{config=parse(await git(root,['show',`FETCH_HEAD:.codexmate/config.yml`]),{maxAliasCount:0});}catch(e){if(!repo.permissions?.admin)throw new AppError('CONFIG_MISSING','默认分支缺少配置。请让维护者初始化并提交配置。');}
    const permissionRole=repo.permissions?.admin?'owner':repo.permissions?.push?'developer':repo.permissions?.pull?'viewer':null;assert(permissionRole,'PERMISSION','没有仓库读取权限。');
    const member=config?.members?.find((m:any)=>m.login===user);
    const configuredRole=member?.role as Project['role']|undefined;
    const role=permissionRole==='viewer'?'viewer':configuredRole??permissionRole;
    assert(['owner','developer','reviewer','viewer'].includes(role),'CONFIG_ROLE','仓库角色配置无效。');
    const p:Project={id,slug:match[1],root,user,role,defaultBranch:repo.default_branch,mode:'github-only',activeDevice:config?.workers?.[user]??'',members:config?.members??[{login:user,role,paths:[]}],policy:old?.policy??policySchema.parse({}),compatible:!config||config.schema==='codexmate.config/v1'};
    this.store.put('project',id,p);this.store.audit(id,'project.connected',{slug:p.slug,user,root});return p;
  }
  async init(p:Project){
    assert(p.role==='owner','FORBIDDEN','只有仓库维护者可以初始化。');
    const config={schema:'codexmate.config/v1',members:p.members,workers:{[p.user]:this.store.device},repo:{default_branch:p.defaultBranch},execution:{default_mode:'approve-first'}};
    await mkdir(join(p.root,'.codexmate'),{recursive:true});
    await writeFile(join(p.root,'.codexmate','config.yml'),stringify(config),{flag:'wx'});
    await mkdir(join(p.root,'.github','ISSUE_TEMPLATE'),{recursive:true});
    await writeFile(join(p.root,'.github','ISSUE_TEMPLATE','codexmate_task.yml'),'name: CodexMate 任务\ndescription: 填写目标与验收后通过规划中心创建结构化任务\nbody:\n  - type: textarea\n    id: goal\n    attributes:\n      label: 目标与验收条件\n    validations:\n      required: true\n',{flag:'wx'});
    await appendFile(join(p.root,'.gitignore'),'\n.codexmate/local/\n');
    for(const state of ['ready','running','review','blocked','handoff','needs_approval','done','cancelled']) {try{await this.gh(p).request('/labels','POST',{name:`cm:${state}`,color:'5f856a',description:`CodexMate ${state}`});}catch(e){if(!String(e).includes('422'))throw e;}}
    return '配置与 Issue 模板已生成。请审查并提交到默认分支，随后同步；Worker 身份在配置生效前保持禁用。';
  }
  async sync(id:string,dryRun=false){
    const p=this.project(id);if(p.demo)return {tasks:this.store.list<Task>('task').filter(t=>t.repoId===id),demo:true};
    try{
      const gh=this.gh(p);await gh.permission(p.user);const tasks=await gh.tasks(id);validateGraph(tasks);
      if(dryRun)return {tasks};
      const cfg=await gh.request<any>(`/contents/.codexmate/config.yml?ref=${encodeURIComponent(p.defaultBranch)}`);
      const config=parse(Buffer.from(cfg.content,'base64').toString(),{maxAliasCount:0});
      p.compatible=config.schema==='codexmate.config/v1';p.activeDevice=config.workers?.[p.user]??'';p.members=config.members??p.members;
      for(const t of tasks){this.saveTask(t);if(t.owner===p.user&&t.state==='ready')this.notify(p,`ready:${t.issue}:${t.revision}`,'任务待处理',t.url);}
      for(const r of this.store.list<Review>('review').filter(r=>r.repoId===id&&r.status!=='stale')){const pr=await gh.request<any>(`/pulls/${r.pr}`);if(pr.head.sha!==r.head)this.store.put('review',r.id,{...r,status:'stale'});}
      // Handoffs are small, deduplicated GitHub events; author and exact schema are checked before use.
      for(const t of tasks.filter(t=>t.state==='handoff_pending')){
        for(const c of await gh.pages(`/issues/${t.issue}/comments`)){
          const json=c.body?.match(/<!-- codexmate-handoff-json:([A-Za-z0-9+/=]+) -->/)?.[1];if(!json)continue;
          try{const h=JSON.parse(Buffer.from(json,'base64').toString()) as Handoff;if(h.schema==='codexmate.handoff/v1'&&h.repoId===id&&h.issue===t.issue&&h.revision===t.revision&&h.from===t.owner&&c.user.login===h.from&&/^[a-f0-9]{40}$/.test(h.sha)&&!this.store.get('handoff',h.id))this.store.put('handoff',h.id,h);}catch{/* malformed public data is never executable */}
        }
      }
      p.lastSync=now();delete p.error;this.store.put('project',id,p);this.store.audit(id,'sync.completed',{tasks:tasks.length});return {tasks};
    }catch(e){p.error=redact(String(e));this.store.put('project',id,p);this.notify(p,'sync-error','同步失败',p.error);throw e;}
  }
  notify(p:Project,key:string,title:string,detail:string){if(!p.policy.notifications)return;const quiet=p.policy.quietHours,hour=new Date().getHours();if(quiet&&(quiet.start<=quiet.end?hour>=quiet.start&&hour<quiet.end:hour>=quiet.start||hour<quiet.end))return;this.store.put('notification',`${p.id}:${key}`,{id:`${p.id}:${key}`,repoId:p.id,title,detail:redact(detail),at:now()});}
  binding(req:ActionRequest){const p=this.project(req.repoId);return {req,user:p.user,role:p.role,policy:p.policy,task:this.store.get('task',`${p.id}:${req.target}`),run:this.latest(p.id,Number(req.target)),review:this.store.get('review',req.target),handoff:this.store.get('handoff',req.target),plan:this.store.get('plan',req.target)};}
  request(raw:unknown){const req=actionSchema.parse(raw);const p=this.project(req.repoId);assert(p.compatible,'CONFIG_NEWER','配置版本较新，当前客户端只读。');assert(p.role!=='viewer','FORBIDDEN','观察者只能查看。');
    const approval:Approval={...req,id:randomUUID(),digest:digest(this.binding(req)),status:'pending',createdAt:now(),expiresAt:new Date(Date.now()+15*60_000).toISOString()};this.store.put('approval',approval.id,approval);this.store.audit(p.id,'approval.requested',{id:approval.id,action:req.action,target:req.target});return approval;
  }
  async approve(id:string,approved:boolean){
    const a=this.store.get<Approval>('approval',id);assert(a,'APPROVAL_NOT_FOUND','审批不存在。');
    this.store.transaction(()=>{const current=this.store.get<Approval>('approval',id)!;assert(current.status==='pending','APPROVAL_USED','该审批已处理。');assert(a.expiresAt>now(),'APPROVAL_EXPIRED','审批已过期，请重新请求。');if(approved)assert(a.digest===digest(this.binding(actionSchema.parse(a))),'APPROVAL_CHANGED','任务、策略或内容已变化，请重新预览并申请审批。');a.status=approved?'executing':'rejected';this.store.put('approval',id,a);});
    this.store.audit(a.repoId,approved?'approval.granted':'approval.rejected',{id,action:a.action});
    if(!approved)return a;
    try{a.result=redact(String(await this.execute(a)));a.status='completed';}catch(e){a.result=redact(String(e));a.status='failed';throw e;}finally{this.store.put('approval',id,a);this.store.audit(a.repoId,`action.${a.status}`,{action:a.action,target:a.target,result:a.result});}return a;
  }
  private async permission(p:Project,action:ActionRequest['action']){
    assert(p.compatible&&p.role!=='viewer','FORBIDDEN','当前策略不允许写操作。');
    if(['plan','publish_plan','revert_plan','assign','init'].includes(action))assert(p.role==='owner','FORBIDDEN','此操作仅限维护者。');
    if(['run','resume','publish','repair','handoff','accept_handoff'].includes(action))assert(['owner','developer'].includes(p.role),'FORBIDDEN','当前角色不能启动开发任务。');
    if(!p.demo){const repo=await this.gh(p).permission(p.user);assert(repo.permissions?.push||(['review','plan'].includes(action)&&repo.permissions?.pull),'GITHUB_PERMISSION','GitHub 权限不足。');await this.git(p).verifyRemote(p.slug);
      if(action!=='init'){
        const raw=await this.gh(p).request<any>(`/contents/.codexmate/config.yml?ref=${encodeURIComponent(p.defaultBranch)}`);
        const cfg=parse(Buffer.from(raw.content,'base64').toString(),{maxAliasCount:0});
        assert(cfg.schema==='codexmate.config/v1','CONFIG_NEWER','远端配置不兼容，停止写入。');
        const member=cfg.members?.find((m:any)=>m.login===p.user);
        assert(member&&member.role===p.role,'ROLE_CHANGED','远端角色已变化，请重新连接仓库。');
        assert(action==='review'||action==='publish_review'||cfg.workers?.[p.user]===this.store.device,'INACTIVE_DEVICE','本机不是默认分支指定的活跃 Worker。');
      }
    }
  }
  private async fresh(p:Project,n:number){const old=this.task(p.id,n);if(p.demo)return old;const fresh=await this.gh(p).task(p.id,n);assert(fresh.revision===old.revision&&fresh.owner===old.owner&&fresh.updatedAt===old.updatedAt&&!fresh.warning,'REMOTE_CHANGED','任务已发生变化，请同步并重新审批。');return fresh;}
  private async execute(a:Approval):Promise<unknown>{
    const p=this.project(a.repoId);await this.permission(p,a.action);if(p.demo)return this.demoAction(p,a);
    switch(a.action){
      case 'init':return this.init(p);
      case 'run':return this.run(p,await this.fresh(p,Number(a.target)));
      case 'resume':return this.run(p,await this.fresh(p,Number(a.target)),true);
      case 'pause':return this.pause(p,Number(a.target));
      case 'publish':return this.publish(p,await this.fresh(p,Number(a.target)));
      case 'review':return this.review(p,Number(a.target));
      case 'publish_review':return this.publishReview(p,a.target);
      case 'handoff':return this.handoff(p,await this.fresh(p,Number(a.target)),String(a.input.to??''));
      case 'accept_handoff':return this.acceptHandoff(p,a.target);
      case 'reject_handoff':{const h=this.handoffRecord(p,a.target);assert(h.to===p.user,'FORBIDDEN','只有接手者可以拒绝。');h.status='rejected';this.store.put('handoff',h.id,h);return this.gh(p).comment(h.issue,'接手者已拒绝交接；负责人不变，请原负责人确认后处理。',`reject:${h.id}`);}
      case 'repair':{const t=await this.fresh(p,Number(a.target)),r=this.latest(p.id,t.issue);assert(r&&r.repairRound<p.policy.maxRepairAttempts,'REPAIR_LIMIT','修复已达到上限，请人工处理。');const review=this.store.get<Review>('review',String(a.input.reviewId));assert(review&&review.repoId===p.id&&r.pr?.number===review.pr&&review.status==='published','REVIEW_REQUIRED','请选择当前任务已发布的审查。');const pr=await this.gh(p).request<any>(`/pulls/${review.pr}`);assert(pr.head.sha===review.head,'STALE_REVIEW','审查已过期。');r.repairRound++;this.saveRun(r);return this.run(p,t,true,review.body);}
      case 'plan':return this.createPlan(p,String(a.input.goal??a.target),String(a.input.acceptance??''));
      case 'publish_plan':return this.publishPlan(p,a.target);
      case 'revert_plan':return this.revertPlan(p,a.target);
      case 'assign':{const t=await this.fresh(p,Number(a.target));assert(!t.owner&&t.state==='ready','ASSIGNED','任务已经有负责人。');const owner=String(a.input.owner);assert(p.members.some(m=>m.login===owner&&['owner','developer'].includes(m.role)),'MEMBER','目标人不是开发成员。');return this.saveTask(await this.gh(p).update({...t,owner,revision:t.revision+1},t));}
    }
  }
  private async run(p:Project,t:Task,resume=false,feedback?:string,checkpoint?:string){
    assert(p.mode==='github-only','COORDINATOR_REQUIRED','协调模式尚未通过跨设备验收，客户端禁止启用自动执行。');
    assert(p.activeDevice===this.store.device,'INACTIVE_DEVICE','请维护者在默认分支配置 workers 中指定本机 device ID，然后同步。');
    assert(t.owner===p.user&&!t.warning&&!t.remoteClosed,'TASK_OWNER','任务未指派给本人、状态不一致或已关闭。');
    assert((resume?['blocked','running','review','ready']:['ready','needs_approval']).includes(t.state),'TASK_STATE','当前任务状态不允许启动。');
    for(const dep of t.needs){const remote=await this.gh(p).request<any>(`/issues/${dep}`);assert(remote.state==='closed','DEPENDENCY_BLOCKED',`前置任务 #${dep} 尚未关闭。`);}
    const id=randomUUID();this.store.lock(`writer:${p.id}`,id);let run:Run|undefined;
    const controller=new AbortController();this.controllers.set(`${p.id}:${t.issue}`,controller);const timer=setTimeout(()=>controller.abort(),p.policy.timeoutMinutes*60000);
    this.store.remove('cancel',`${p.id}:${t.issue}`);
    const cancellation=setInterval(()=>{if(this.store.get('cancel',`${p.id}:${t.issue}`))controller.abort();},500);
    try{
      const old=this.latest(p.id,t.issue);
      if(resume){assert(old&&old.status!=='frozen'&&old.device===this.store.device&&old.revision===t.revision,'CANNOT_RESUME','没有可恢复的本机运行，或该运行已冻结。');await this.git(p).health(old.worktree,old.branch);run={...old,status:'running',pid:process.pid};}
      else{assert(!old||old.revision!==t.revision,'DUPLICATE_RUN','该版本已经运行过，请使用恢复。');const branch=`cm/${t.issue}/${p.user}-r${t.revision}`;const wt=await this.git(p).create(branch,checkpoint??t.base_branch,id);run={id,repoId:p.id,issue:t.issue,revision:t.revision,owner:p.user,device:this.store.device,status:'running',worktree:wt.path,branch,baseSha:wt.sha,startedAt:now(),checks:[],repairRound:0,pid:process.pid};}
      this.saveRun(run);t=this.saveTask(await this.gh(p).update({...t,state:'running'},t));
      const context=await this.git(p).context(run.worktree);
      const result=await this.runner.run({cwd:run.worktree,prompt:'实现任务目标，满足验收条件；返回结构化修改建议与真实限制。',context:{task:t,files:context,feedback},threadId:resume?run.threadId:undefined,signal:controller.signal,onEvent:e=>{if(e.type==='thread.started'){run!.threadId=e.thread_id;this.saveRun(run!);}this.log(run!.id,e);}});
      assert(!controller.signal.aborted,'PAUSED','任务已暂停。');
      const current=await this.gh(p).task(p.id,t.issue);assert(current.owner===p.user&&current.revision===t.revision&&current.state==='running','OWNER_CHANGED','任务执行资格已变化，阻止应用修改。');
      await this.git(p).apply(run.worktree,result.changes,t.paths);run.summary=result.summary;run.threadId=result.threadId;run.checks=await this.checks(p,run,controller.signal);run.status=run.checks.some(c=>c.exitCode!==0)?'blocked':'completed';run.endedAt=now();this.saveRun(run);
      if(run.status==='blocked')this.saveTask(await this.gh(p).update({...current,state:'blocked'},current));
      this.notify(p,`run:${run.id}`,run.status==='completed'?'修改已就绪，等待发布':'检查失败',`任务 #${t.issue}`);return run.summary;
    }catch(e){if(run){run.status=controller.signal.aborted?'paused':'blocked';run.error=`${classifyError(e)}: ${redact(String(e))}`;run.endedAt=now();this.saveRun(run);}throw e;}
    finally{clearTimeout(timer);clearInterval(cancellation);this.controllers.delete(`${p.id}:${t.issue}`);this.store.unlock(`writer:${p.id}`,id);}
  }
  private async checks(p:Project,r:Run,signal:AbortSignal){const out:Run['checks']=[];for(const check of p.policy.checks){assert(check.trustedSha===r.baseSha,'CHECK_UNTRUSTED','检查命令绑定的基准 SHA 不匹配，请重新信任检查。');assert(!/[;&|`\r\n]/.test(check.command),'CHECK_COMMAND','检查必须是可执行文件与独立参数。');const start=Date.now();const result=await exec(check.command,check.args,{cwd:r.worktree,timeout:300000,signal});out.push({name:check.name,exitCode:result.code,output:redact((result.stdout+'\n'+result.stderr).slice(-20000)),at:now(),durationMs:Date.now()-start});}return out;}
  async pause(p:Project,n:number){const run=this.latest(p.id,n);assert(run&&run.status==='running'&&run.device===this.store.device,'RUN_NOT_LOCAL','没有当前设备正在执行的任务。');this.store.put('cancel',`${p.id}:${n}`,{at:now(),run:run.id});this.controllers.get(`${p.id}:${n}`)?.abort();return '已请求本机 Worker 暂停；进程退出前不会释放写锁。';}
  private async publish(p:Project,t:Task){
    const r=this.latest(p.id,t.issue);assert(r&&r.status==='completed'&&t.owner===p.user&&r.revision===t.revision,'RUN_NOT_READY','没有可发布的已完成运行。');
    this.store.lock(`writer:${p.id}`,r.id);try{await this.git(p).health(r.worktree,r.branch);const summary=publicText(`${r.summary??''}\n\n验证：${r.checks.length?r.checks.map(c=>`${c.name}: ${c.exitCode===0?'通过':'失败'}`).join('\n'):'未运行（未配置可信检查）'}`);const sha=await this.git(p).checkpoint(r.worktree,r.baseSha,`CodexMate #${t.issue} revision ${t.revision}`);await this.git(p).push(r.worktree,r.branch,r.baseSha);const pr=await this.gh(p).draft(t,r.branch,summary);r.pr={number:pr.number,url:pr.html_url,head:sha};this.saveRun(r);this.saveTask(await this.gh(p).update({...t,state:'review'},t));await this.gh(p).comment(t.issue,`草稿 PR：${pr.html_url}\n${summary}`,`publish:${t.issue}:${t.revision}:${sha}`);if(t.reviewers.length)await this.gh(p).request(`/pulls/${pr.number}/requested_reviewers`,'POST',{reviewers:t.reviewers.filter(x=>x!==p.user)});return pr.html_url;}finally{this.store.unlock(`writer:${p.id}`,r.id);}
  }
  private async review(p:Project,n:number){assert(Number.isSafeInteger(n)&&n>0,'PR_NUMBER','PR 编号无效。');const gh=this.gh(p),pr=await gh.request<any>(`/pulls/${n}`),files=await gh.pages(`/pulls/${n}/files`);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),p.policy.timeoutMinutes*60000);try{const body=await this.runner.text({cwd:p.root,prompt:'只读审查提供的 PR。给出严重性、文件与行号、证据、复现方法和验证建议。未复现的结论标为待验证，禁止声称测试已执行。不要执行仓库脚本。',context:{title:pr.title,body:pr.body,head:pr.head.sha,files:files.map(f=>({filename:f.filename,patch:f.patch??'无可用文本 diff'}))},signal:controller.signal,onEvent:()=>{}});const latest=await gh.request<any>(`/pulls/${n}`);const r:Review={id:randomUUID(),repoId:p.id,pr:n,head:pr.head.sha,title:pr.title,url:pr.html_url,body:redact(body),status:latest.head.sha===pr.head.sha?'draft':'stale',createdAt:now()};this.store.put('review',r.id,r);return r.id;}finally{clearTimeout(timer);}}
  private async publishReview(p:Project,id:string){const r=this.store.get<Review>('review',id);assert(r&&r.repoId===p.id&&r.status==='draft','REVIEW_STATE','审查不存在、已发布或已过期。');const gh=this.gh(p),pr=await gh.request<any>(`/pulls/${r.pr}`);assert(pr.head.sha===r.head,'STALE_REVIEW','PR 已有新提交，请重新审查。');const marker=`<!-- codexmate:review:${r.id} -->`;const reviews=await gh.pages(`/pulls/${r.pr}/reviews`);if(!reviews.some(x=>x.body?.includes(marker)))await gh.request(`/pulls/${r.pr}/reviews`,'POST',{commit_id:r.head,event:'COMMENT',body:publicText(`AI-assisted review\n\n${r.body}`)+'\n'+marker});r.status='published';this.store.put('review',r.id,r);return r.url;}
  private handoffRecord(p:Project,id:string){const h=this.store.get<Handoff>('handoff',id);assert(h&&h.repoId===p.id&&h.status==='pending','HANDOFF_STATE','没有待处理交接。');return h;}
  private async handoff(p:Project,t:Task,to:string){
    assert(t.owner===p.user&&to!==p.user&&p.members.some(m=>m.login===to&&['owner','developer'].includes(m.role)),'HANDOFF_TARGET','接手者必须是另一个开发成员。');
    const r=this.latest(p.id,t.issue);assert(r&&r.status!=='running'&&r.status!=='frozen','RUN_ACTIVE','请先暂停运行并等待退出。');
    this.store.lock(`writer:${p.id}`,r.id);try{const sha=await this.git(p).checkpoint(r.worktree,r.baseSha,`CodexMate handoff #${t.issue}`);await this.git(p).push(r.worktree,r.branch,r.baseSha);const h:Handoff={schema:'codexmate.handoff/v1',id:randomUUID(),repoId:p.id,issue:t.issue,revision:t.revision,from:p.user,to,sha,branch:r.branch,goal:t.title,acceptance:t.acceptance,remaining:[r.summary??'请核验当前代码并继续完成验收项'],risks:['验收完成情况需接手者核验'],checks:r.checks.map(c=>({...c,output:c.output.slice(-500)})),needs:t.needs,status:'pending',createdAt:now()};publicText(JSON.stringify(h));r.status='frozen';this.saveRun(r);this.store.put('handoff',h.id,h);this.saveTask(await this.gh(p).update({...t,state:'handoff_pending'},t));await this.gh(p).comment(t.issue,`交接给 @${to}，检查点 ${sha}。\n<!-- codexmate-handoff-json:${Buffer.from(JSON.stringify(h)).toString('base64')} -->`,`handoff:${h.id}`);return h.id;}finally{this.store.unlock(`writer:${p.id}`,r.id);}
  }
  private async acceptHandoff(p:Project,id:string){const h=this.handoffRecord(p,id);assert(h.to===p.user,'HANDOFF_OWNER','仅指定接手者可以接受。');const t=await this.gh(p).task(p.id,h.issue);assert(t.state==='handoff_pending'&&t.owner===h.from&&t.revision===h.revision,'HANDOFF_CHANGED','任务已变化，禁止接受旧交接。');await git(p.root,['fetch','origin',h.branch]);assert(await git(p.root,['rev-parse','FETCH_HEAD'])===h.sha,'CHECKPOINT_CHANGED','远端检查点分支已变化。');const next=await this.gh(p).update({...t,owner:p.user,revision:t.revision+1,state:'ready'},t);this.saveTask(next);h.status='accepted';this.store.put('handoff',id,h);return this.run(p,next,false,undefined,h.sha);}
  private async createPlan(p:Project,goal:string,acceptance:string){assert(goal.trim()&&acceptance.trim(),'PLAN_INPUT','请同时提供目标与验收条件。');const context=await this.git(p).context(p.root);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),p.policy.timeoutMinutes*60000);try{const result=await this.runner.text({cwd:p.root,prompt:'返回严格 JSON：{goal:string,tasks:[{title,acceptance:string[],paths:string[],needs:number[],owner:string,evidence:string}]}。needs 使用数组从零开始的索引。仅提出可撤销的任务拆分，每项须有来自提供文件的证据。不要创建 Issue。',context:{goal,acceptance,files:context},signal:controller.signal,onEvent:()=>{}});const parsed=planSchema.parse(JSON.parse(result.replace(/^```json\s*|\s*```$/g,'')));validatePlan(parsed);const plan:Plan={...parsed,id:randomUUID(),repoId:p.id,status:'draft',createdAt:now(),issues:[]};this.store.put('plan',plan.id,plan);return plan.id;}finally{clearTimeout(timer);}}
  private async publishPlan(p:Project,id:string){const plan=this.store.get<Plan>('plan',id);assert(plan&&plan.repoId===p.id&&plan.status==='draft','PLAN_STATE','只能发布当前仓库的规划草稿。');validatePlan(plan);const gh=this.gh(p);const existing=await gh.pages('/issues?state=all');for(let i=0;i<plan.tasks.length;i++){if(plan.issues[i])continue;const item=plan.tasks[i],marker=`<!-- codexmate:plan:${id}:${i} -->`;let issue=existing.find(x=>x.body?.includes(marker));if(!issue)issue=await gh.request('/issues','POST',{title:item.title,body:publicText(`${plan.goal}\n\n${item.evidence}\n${marker}`)});plan.issues[i]=issue.number;this.store.put('plan',id,plan);}
    for(let i=0;i<plan.tasks.length;i++){const item=plan.tasks[i],number=plan.issues[i],t:Task={...taskSchema.parse({schema:'codexmate.task/v1',issue:number,revision:1,state:'ready',owner:item.owner,acceptance:item.acceptance,paths:item.paths,needs:item.needs.map(n=>plan.issues[n]),base_branch:p.defaultBranch}),repoId:p.id,title:item.title,body:`${plan.goal}\n${item.evidence}\n<!-- codexmate:plan:${id}:${i} -->`,url:`https://github.com/${p.slug}/issues/${number}`,updatedAt:now()};await gh.request(`/issues/${number}`,'PATCH',{body:encodeTask(t),labels:['cm:ready'],assignees:t.owner?[t.owner]:[]});this.saveTask(t);}plan.status='published';this.store.put('plan',id,plan);return `已创建 ${plan.issues.length} 个 Issue`;}
  private async revertPlan(p:Project,id:string){const plan=this.store.get<Plan>('plan',id);assert(plan&&plan.repoId===p.id&&plan.status==='published','PLAN_STATE','规划未发布。');for(const n of plan.issues){const t=await this.gh(p).task(p.id,n);assert(t.state==='ready','PLAN_IN_USE',`任务 #${n} 已经开始，不能撤销整个规划。`);}for(const n of plan.issues){await this.gh(p).request(`/issues/${n}`,'PATCH',{state:'closed',state_reason:'not_planned'});const t=this.task(p.id,n);this.saveTask({...t,state:'cancelled',remoteClosed:true});}plan.status='reverted';this.store.put('plan',id,plan);return '规划创建的未启动 Issue 已关闭，历史保留。';}
  log(run:string,event:unknown){const dir=join(this.store.home,'logs');try{mkdirSync(dir,{recursive:true});appendFileSync(join(dir,`${run}.jsonl`),redact(JSON.stringify({at:now(),event}))+'\n');}catch(e){this.store.audit('','log.error',String(e));}}
  async logs(id:string){assert(this.store.get('run',id),'RUN_NOT_FOUND','运行不存在。');try{return redact((await readFile(join(this.store.home,'logs',`${id}.jsonl`),'utf8')).slice(-100000));}catch(e:any){if(e.code==='ENOENT')return '尚无本机日志。';throw e;}}
  async recover(){const recovered=[];for(const lock of this.store.locks()){let alive=true;try{process.kill(lock.pid,0);}catch(e:any){alive=e.code!=='ESRCH'?true:false;}if(alive)continue;for(const r of this.store.list<Run>('run').filter(r=>r.status==='running'&&`writer:${r.repoId}`===lock.key)){r.status='paused';r.error='原 Worker 进程已退出，需核对远端与工作树后手动恢复。';this.saveRun(r);recovered.push(r.id);}this.store.unlock(lock.key,lock.holder);}return recovered;}
  settings(id:string,input:unknown){const p=this.project(id);p.policy=policySchema.parse(input);this.store.put('project',id,p);this.store.audit(id,'policy.updated',p.policy);return p;}
  async prune(){let deleted=0;for(const p of this.store.list<Project>('project'))for(const r of this.store.list<Run>('run').filter(r=>r.repoId===p.id&&r.status!=='running'&&Date.parse(r.endedAt??r.startedAt)<Date.now()-p.policy.retentionDays*86400000)){try{await unlink(join(this.store.home,'logs',`${r.id}.jsonl`));deleted++;}catch(e:any){if(e.code!=='ENOENT')throw e;}}return {deleted};}
  async tick(){for(const p of this.store.list<Project>('project').filter(p=>!p.demo)){try{await this.sync(p.id);if(!p.policy.autoStart)continue;for(const t of this.store.list<Task>('task').filter(t=>t.repoId===p.id&&t.owner===p.user&&t.state==='ready'&&t.risk==='normal'&&!t.warning)){if(this.latest(p.id,t.issue)?.revision===t.revision)continue;const a=this.request({repoId:p.id,action:'run',target:String(t.issue),input:{}});await this.approve(a.id,true);if(p.policy.autoPush&&this.latest(p.id,t.issue)?.status==='completed'){const push=this.request({repoId:p.id,action:'publish',target:String(t.issue),input:{}});await this.approve(push.id,true);}break;}}catch(e){this.store.audit(p.id,'worker.error',String(e));}}}
  async doctor(){const checks=[];for(const [name,command,args] of [['Node',process.execPath,['--version']],['Git','git',['--version']],['GitHub CLI','gh',['--version']],['Codex CLI',codexExecutable(),['--version']],['GitHub 身份','gh',['api','/user','--jq','.login']],['Codex 登录',codexExecutable(),['login','status']]] as [string,string,string[]][]){try{const r=await exec(command,args,{timeout:15000});checks.push({name,ok:r.code===0,detail:redact((r.stdout||r.stderr).trim())});}catch(e){checks.push({name,ok:false,detail:redact(String(e))});}}return {checks,authMode:process.env.CODEX_API_KEY||process.env.OPENAI_API_KEY?'API Key 环境变量（独立计费；实际来源以 Codex 登录状态为准）':'未发现 API Key 环境变量；以 Codex 登录状态为准',quota:'未知',device:this.store.device};}
  async demoAction(p:Project,a:Approval):Promise<string>{
    const n=Number(a.target),t=this.store.get<Task>('task',`${p.id}:${n}`);
    if(['run','resume','repair'].includes(a.action)){assert(t&&t.owner===p.user,'TASK_OWNER','只能演练本人任务。');assert(!blockers(t,this.store.list<Task>('task')).length,'DEPENDENCY_BLOCKED','前置任务尚未完成。');const old=this.latest(p.id,n);assert(a.action!=='repair'||!old||old.repairRound<p.policy.maxRepairAttempts,'REPAIR_LIMIT','已达到修复上限。');const run:Run={id:randomUUID(),repoId:p.id,issue:n,revision:t.revision,owner:p.user,device:this.store.device,status:'completed',worktree:'演练环境，不创建工作树',branch:`cm/${n}/${p.user}`,baseSha:'a'.repeat(40),startedAt:now(),endedAt:now(),checks:[],repairRound:a.action==='repair'?(old?.repairRound??0)+1:0,pid:process.pid,summary:'演练运行已完成。未调用 Codex、未修改代码、未运行真实测试。'};this.saveRun(run);this.saveTask({...t,state:'running'});this.log(run.id,{message:run.summary});return run.summary!;}
    if(a.action==='publish'){assert(t,'TASK_NOT_FOUND','任务不存在。');const r=this.latest(p.id,n);assert(r&&r.status==='completed','RUN_NOT_READY','请先完成演练运行。');r.pr={number:n+100,url:'#demo-pr',head:'b'.repeat(40)};this.saveRun(r);this.saveTask({...t,state:'review'});return '演练草稿 PR 已生成；未写入 GitHub。';}
    if(a.action==='review'){const r:Review={id:randomUUID(),repoId:p.id,pr:n,head:'b'.repeat(40),title:`演练 PR #${n}`,url:'#demo-pr',body:'AI-assisted review · 演练草稿\n\n[medium] 请补充失败分支的回归用例。\n验证状态：未运行测试；此内容是流程演示，不是实际代码审查。',status:'draft',createdAt:now()};this.store.put('review',r.id,r);return r.id;}
    if(a.action==='publish_review'){const r=this.store.get<Review>('review',a.target);assert(r&&r.repoId===p.id&&r.status==='draft','REVIEW_STATE','无法发布该审查。');this.store.put('review',r.id,{...r,status:'published'});return '演练审查已发布。';}
    if(a.action==='handoff'){assert(t,'TASK_NOT_FOUND','任务不存在。');const r=this.latest(p.id,n);assert(r&&r.status!=='running','RUN_ACTIVE','请先完成或暂停运行。');assert(a.input.to&&a.input.to!==p.user,'HANDOFF_TARGET','请选择队友。');const h:Handoff={schema:'codexmate.handoff/v1',id:randomUUID(),repoId:p.id,issue:n,revision:t.revision,from:p.user,to:String(a.input.to),sha:'c'.repeat(40),branch:r.branch,goal:t.title,acceptance:t.acceptance,remaining:['接手者核对验收项'],risks:['仅为演练检查点'],checks:[],needs:t.needs,status:'pending',createdAt:now()};this.store.put('handoff',h.id,h);r.status='frozen';this.saveRun(r);this.saveTask({...t,state:'handoff_pending'});return h.id;}
    if(['accept_handoff','reject_handoff'].includes(a.action)){const h=this.handoffRecord(p,a.target);assert(h.to===p.user,'HANDOFF_OWNER','仅接手者可处理。');h.status=a.action==='accept_handoff'?'accepted':'rejected';this.store.put('handoff',h.id,h);if(h.status==='accepted'){const task=this.task(p.id,h.issue);this.saveTask({...task,owner:p.user,state:'ready',revision:task.revision+1});}return '演练交接状态已更新。';}
    if(a.action==='plan'){const goal=String(a.input.goal??a.target);const plan:Plan={id:randomUUID(),repoId:p.id,goal,status:'draft',createdAt:now(),issues:[],tasks:[{title:`${goal}：定义契约`,acceptance:['形成可审查的接口与验收文档'],paths:['docs'],needs:[],owner:p.user,evidence:'演练模板；未读取仓库代码。'},{title:`${goal}：实现与回归`,acceptance:[String(a.input.acceptance||'满足目标验收条件')],paths:['src','tests'],needs:[0],owner:'',evidence:'依赖契约任务；演练模板，需人工核验。'}]};this.store.put('plan',plan.id,plan);return plan.id;}
    if(a.action==='publish_plan'){const plan=this.store.get<Plan>('plan',a.target);assert(plan&&plan.repoId===p.id&&plan.status==='draft','PLAN_STATE','规划不存在或已发布。');let next=Math.max(0,...this.store.list<Task>('task').filter(t=>t.repoId===p.id).map(t=>t.issue))+1;plan.issues=plan.tasks.map(()=>next++);for(let i=0;i<plan.tasks.length;i++){const item=plan.tasks[i];this.saveTask({...taskSchema.parse({schema:'codexmate.task/v1',issue:plan.issues[i],revision:1,state:'ready',owner:item.owner,acceptance:item.acceptance,paths:item.paths,needs:item.needs.map(n=>plan.issues[n])}),repoId:p.id,title:item.title,body:item.evidence,url:'#demo-task',updatedAt:now()});}plan.status='published';this.store.put('plan',plan.id,plan);return '演练任务已创建。';}
    if(a.action==='revert_plan'){const plan=this.store.get<Plan>('plan',a.target);assert(plan&&plan.status==='published','PLAN_STATE','规划未发布。');for(const n of plan.issues)assert(this.task(p.id,n).state==='ready','PLAN_IN_USE','任务已开始，禁止撤销。');for(const n of plan.issues)this.saveTask({...this.task(p.id,n),state:'cancelled'});plan.status='reverted';this.store.put('plan',plan.id,plan);return '演练规划已撤销。';}
    if(a.action==='assign'){assert(t&&!t.owner,'ASSIGNED','任务已经有负责人。');this.saveTask({...t,owner:String(a.input.owner),revision:t.revision+1});return '演练分配已更新。';}
    throw new AppError('DEMO_UNAVAILABLE','此操作需要真实仓库；演练模式不会执行外部动作。');
  }
}
