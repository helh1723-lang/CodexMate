#!/usr/bin/env node
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Store } from '../store/index.js';
import { Service } from '../core/service.js';
import { seedDemo } from '../core/demo.js';
import { createApp } from '../server/index.js';
import { serveMcp } from '../mcp/index.js';
import { actionSchema, assert, AppError } from '../core/model.js';
import { redact } from '../core/security.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Adapters } from '../operations/adapters.js';
import { signRelease, stageRelease, verifyRelease } from '../operations/release.js';
import { coordinatorApp } from '../scheduler/server.js';
const cli=new Command().name('codexmate').version('1.1.0-rc.1').description('GitHub 驱动的本机 Codex 协作工具').option('--home <path>','本机私有状态目录').option('--repo <id>','已连接仓库 ID');
let service:Service;
function use(demo=false){if(!service){const home=cli.opts().home??process.env.CODEXMATE_HOME??(demo?resolve('.local/demo'):join(homedir(),'.codexmate'));service=new Service(new Store(home));if(demo)seedDemo(service);}return service;}
const print=(v:unknown):void=>{stdout.write(typeof v==='string'?redact(v)+'\n':redact(JSON.stringify(v,null,2))+'\n');};
function repo(){const s=use(),id=cli.opts().repo??s.snapshot().projects[0]?.id;assert(id,'NO_REPOSITORY','请先运行 codexmate join <仓库路径>。');return id;}
async function confirm(message:string){assert(stdin.isTTY,'INTERACTIVE_REQUIRED','请在交互终端确认，或使用本机面板审批。');const rl=createInterface({input:stdin,output:stdout});try{return (await rl.question(message+' [y/N] ')).trim().toLowerCase()==='y';}finally{rl.close();}}
async function action(action:string,target:string,input:Record<string,unknown>={}){const s=use(),a=s.request(actionSchema.parse({repoId:repo(),action,target,input}));print(a);if(await confirm('确认以上具体操作？'))print(await s.approve(a.id,true));else print('审批已保留为待处理，可在面板中审查。');}
cli.command('doctor').action(async()=>print(await use().doctor()));
cli.command('join').argument('[root]','Git 仓库根目录','.').action(async root=>print(await use().connect(root)));
cli.command('init').argument('[root]','Git 仓库根目录','.').action(async root=>{const p=await use().connect(root);cli.setOptionValue('repo',p.id);await action('init','config');});
cli.command('status').option('--json').action(()=>print(use().snapshot()));
cli.command('sync').option('--dry-run').action(async opts=>print(await use().sync(repo(),Boolean(opts.dryRun))));
const tasks=cli.command('task');tasks.command('list').option('--mine').action(opts=>{const p=use().project(repo());print(use().snapshot().tasks.filter(t=>t.repoId===p.id&&(!opts.mine||t.owner===p.user)));});
for(const verb of ['run','resume','pause','publish'])tasks.command(verb).argument('<issue>').action(n=>action(verb,n));
tasks.command('repair').argument('<issue>').requiredOption('--review <id>').action((n,o)=>action('repair',n,{reviewId:o.review}));
cli.command('review').argument('<pr>').action(pr=>action('review',pr));
cli.command('publish-review').argument('<id>').action(id=>action('publish_review',id));
const handoff=cli.command('handoff').argument('[issue]').option('--to <login>').action((issue,o)=>action('handoff',issue,{to:o.to}));handoff.command('accept').argument('<id>').action(id=>action('accept_handoff',id));handoff.command('reject').argument('<id>').action(id=>action('reject_handoff',id));
const approvals=cli.command('approvals');approvals.command('list').action(()=>print(use().snapshot().approvals));approvals.command('approve').argument('<id>').action(async id=>{print(use().store.get('approval',id));if(await confirm('确认执行该审批内容？'))print(await use().approve(id,true));});approvals.command('revoke').argument('<id>').action(async id=>print(await use().approve(id,false)));
cli.command('logs').argument('<issue>').option('--redacted').action(async n=>{const r=use().latest(repo(),Number(n));assert(r,'RUN_NOT_FOUND','任务尚无运行。');print(await use().logs(r.id));});
cli.command('export').action(()=>print(use().snapshot()));
cli.command('recover').action(async()=>print(await use().recover()));
cli.command('prune').action(async()=>print(await use().prune()));
cli.command('mcp').action(async()=>{await serveMcp(use());});
cli.command('plan').requiredOption('--goal <text>').requiredOption('--acceptance <text>').action(o=>action('plan','new',{goal:o.goal,acceptance:o.acceptance}));
cli.command('publish-plan').argument('<id>').action(id=>action('publish_plan',id));
cli.command('revert-plan').argument('<id>').action(id=>action('revert_plan',id));
cli.command('assign').argument('<issue>').requiredOption('--to <login>').action((n,o)=>action('assign',n,{owner:o.to}));
cli.command('policy').option('--file <path>','从本机 JSON 文件加载策略').action(async o=>{const s=use();if(!o.file){print(s.project(repo()).policy);return;}const input=JSON.parse(await readFile(o.file,'utf8'));print(input);if(await confirm('保存以上本机策略，包括勾选的自动化权限？'))print(s.settings(repo(),input));});
const adapters=cli.command('adapter').description('声明式 CI / 通知适配器，无任意代码执行权限');
adapters.command('add').argument('<file>').action(async file=>print(new Adapters(use().store).register(JSON.parse(await readFile(file,'utf8')))));
adapters.command('list').action(()=>print(use().store.list('adapter')));
adapters.command('grant').argument('<id>').action(async id=>{print(use().store.get('adapter',id));if(await confirm('授权此适配器访问上方确切 HTTPS 端点？'))new Adapters(use().store).grant(id);});
adapters.command('revoke').argument('<id>').action(id=>new Adapters(use().store).revoke(id));
adapters.command('read').argument('<id>').action(async id=>print(await new Adapters(use().store).invoke(id)));
adapters.command('notify').argument('<id>').requiredOption('--url <url>').requiredOption('--state <text>').action(async(id,o)=>{print({adapter:id,url:o.url,state:o.state});if(await confirm('向已授权端点发送以上通知？'))print(await new Adapters(use().store).invoke(id,{url:o.url,state:o.state}));});
const release=cli.command('release').description('离线 Ed25519 签名、校验与更新暂存');
// 注意：子命令不能再声明 --version，否则会被本程序的全局 -V/--version 抢占并直接退出。
release.command('sign').description('为发布包生成签名清单').argument('<package>').requiredOption('--release-version <version>','发布版本号，例如 1.1.0').requiredOption('--private-key <file>','Ed25519 私钥文件').requiredOption('--out <file>','清单输出路径').action(async(file,o)=>{const m=await signRelease(file,o.releaseVersion,await readFile(o.privateKey,'utf8'));try{await writeFile(o.out,JSON.stringify(m,null,2),{flag:'wx'});}catch(e:any){if(e.code==='EEXIST')throw new AppError('MANIFEST_EXISTS','清单已存在，请先移除或改换输出路径。');throw e;}print({manifest:o.out,version:m.version});});
release.command('verify').description('校验签名、哈希与体积').argument('<package>').requiredOption('--manifest <file>').requiredOption('--public-key <file>').action(async(file,o)=>print(await verifyRelease(file,JSON.parse(await readFile(o.manifest,'utf8')),await readFile(o.publicKey,'utf8'))));
release.command('stage').description('校验通过后暂存更新包，等待人工安装').argument('<package>').requiredOption('--manifest <file>').requiredOption('--public-key <file>').action(async(file,o)=>print(await stageRelease(file,JSON.parse(await readFile(o.manifest,'utf8')),await readFile(o.publicKey,'utf8'),use().store.home)));
cli.command('coordinator').description('实验性组织协调服务；客户端自动抢占仍禁用').requiredOption('--config <file>').option('--port <port>','监听端口','4320').option('--host <host>','容器内部可显式设为 0.0.0.0','127.0.0.1').action(async o=>{const app=coordinatorApp(use().store,JSON.parse(await readFile(o.config,'utf8')));app.listen(Number(o.port),o.host,()=>print(`实验性协调器监听 ${o.host}:${o.port}；跨设备部署必须配置 TLS 反向代理。`));});
async function ui(port:number,demo=false){const s=use(demo);await s.recover();const app=await createApp(s,port,process.argv[1].endsWith('.ts'));const server=app.app.listen(port,'127.0.0.1',()=>print(`CodexMate ${demo?'演练工作台':'本地工作台'}: http://127.0.0.1:${port}`));const shutdown=()=>{server.close();void app.close().finally(()=>{s.store.close();process.exit(0);});};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);}
cli.command('ui').option('--port <port>','本机端口','4317').action(opts=>ui(Number(opts.port)));
cli.command('demo').option('--port <port>','本机端口','4317').action(opts=>ui(Number(opts.port),true));
cli.command('start').description('前台轮询；默认只同步与通知，自动执行需在本机设置中独立开启').option('--once').action(async opts=>{const s=use();await s.recover();let stopped=false;process.once('SIGINT',()=>{stopped=true;for(const c of s.controllers.values())c.abort();});do{await s.tick();if(opts.once||stopped)break;const seconds=Math.min(...s.snapshot().projects.map(p=>p.policy.pollingSeconds),60);await new Promise(r=>setTimeout(r,seconds*1000+Math.random()*3000));}while(!stopped);});
cli.parseAsync().catch(e=>{process.stderr.write(redact(String(e))+'\n');process.exitCode=1;});
