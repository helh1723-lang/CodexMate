import { checked, exec } from './process.js';
import { chmod, mkdir, lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { assert, AppError } from '../core/model.js';
import { scanText, digest } from '../core/security.js';
const hostHooksDirectory=()=>join(resolve(process.env.CODEXMATE_HOME??join(homedir(),'.codexmate')),'disabled-git-hooks');
const contained=(root:string,path:string)=>{const rel=relative(resolve(root),resolve(path));return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));};
async function protectedHooksPath(cwd:string){
  // Bootstrap only uses read-only rev-parse commands with the intended hook path.
  // It lets us prove the host-owned directory is outside the actual worktree/gitdir
  // before creating or using it, including when the user opened Git at a subfolder.
  const directory=hostHooksDirectory(),config=['-c','core.hooksPath='+directory];
  const probe=await exec('git',[...config,'rev-parse','--is-bare-repository'],{cwd});
  const bare=probe.code===0?probe.stdout.trim():undefined;
  const repositoryRoot=bare===undefined?await realpath(cwd):await checked('git',[...config,'rev-parse',bare==='true'?'--absolute-git-dir':'--show-toplevel'],{cwd});
  let actual:string;
  try{actual=await realpath(directory);}catch(e:any){if(e.code!=='ENOENT')throw e;actual=resolve(directory);}
  assert(!contained(repositoryRoot,actual),'HOOKS_PATH','Git hook guard must remain outside the repository.');
  await mkdir(directory,{recursive:true,mode:0o700});
  let stat=await lstat(directory);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'HOOKS_PATH','Git hook guard must be a host-owned directory.');await chmod(directory,0o700);stat=await lstat(directory);if(process.platform!=='win32')assert((stat.mode&0o077)===0,'HOOKS_PATH','Git hook guard permissions are not private.');
  actual=await realpath(directory);
  assert(!contained(repositoryRoot,actual),'HOOKS_PATH','Git hook guard must remain outside the repository.');
  assert((await readdir(actual)).length===0,'HOOKS_PATH','Git hook guard directory is not empty; refusing host Git operation.');
  return actual;
}
export const git = async (cwd:string,args:string[]) => {
  const hooks=await protectedHooksPath(cwd);
  return checked('git',['-c','core.hooksPath='+hooks,'-c','core.fsmonitor=false','-c','diff.external=','--no-pager',...args],{cwd});
};
export async function hostGitEnvironment(cwd:string):Promise<NodeJS.ProcessEnv>{
  const hooks=await protectedHooksPath(cwd);
  return {...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:hooks};
}
export const sensitivePath = (p:string) => /(^|\/)(\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|id_rsa|id_ed25519|\.npmrc|\.git|\.codex|\.codexmate|node_modules)(\/|$)|\.(?:pem|key|p12|pfx)$/i.test(p.replaceAll('\\','/'));
export async function safePath(root:string,path:string) {
  assert(path&&!path.includes('\0')&&!isAbsolute(path)&&!path.includes(':'),'UNSAFE_PATH','不允许绝对路径或特殊路径。');
  const realRoot=await realpath(root), full=resolve(realRoot,path), rel=relative(realRoot,full);
  assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'PATH_ESCAPE','文件必须位于任务工作树内。');
  let cursor=realRoot;
  for(const part of rel.split(/[\\/]/)){cursor=join(cursor,part);try{assert(!(await lstat(cursor)).isSymbolicLink(),'SYMLINK','任务文件不允许通过符号链接访问。');}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  return full;
}
export class GitWorktree {
  constructor(public root:string,public worktreeRoot:string){}
  async verifyRemote(slug:string){const remote=await git(this.root,['remote','get-url','origin']);assert(remote===`https://github.com/${slug}.git`||remote===`https://github.com/${slug}`||remote===`git@github.com:${slug}.git`||remote===`ssh://git@github.com/${slug}.git`,'REMOTE_MISMATCH','origin 与已绑定 GitHub 仓库不一致。');}
  async create(branch:string,base:string,id:string){
    assert(/^[a-zA-Z0-9/_-]+$/.test(branch)&&branch.startsWith('cm/'),'BRANCH','只能创建 CodexMate 任务分支。');
    assert(/^[a-zA-Z0-9._/-]+$/.test(base)&&!base.startsWith('-')&&!base.includes('..'),'BASE','基准引用无效。');
    await mkdir(this.worktreeRoot,{recursive:true});
    await git(this.root,['fetch','origin',base]);
    const sha=await git(this.root,['rev-parse','FETCH_HEAD^{commit}']);
    const path=join(this.worktreeRoot,id);
    await git(this.root,['worktree','add','-b',branch,path,sha]);
    return {path,sha};
  }
  async health(path:string,branch:string){const actual=await git(path,['branch','--show-current']);assert(actual===branch,'BRANCH_CHANGED','工作树当前分支已改变，禁止自动续写。');}
  async changed(path:string,base:string){const tracked=await git(path,['diff','--name-only','-z',base,'--']);const untracked=await git(path,['ls-files','--others','--exclude-standard','-z']);return [...new Set((tracked+'\0'+untracked).split('\0').filter(Boolean))];}
  async scan(path:string,base:string){
    const files=await this.changed(path,base);
    const diff=await git(path,['diff','--no-ext-diff','--no-textconv',base,'--']);
    assert(!scanText(diff),'SECRET_DETECTED','Git diff 含疑似凭据，禁止提交或推送。');
    const history=await git(path,['log','-p','--no-ext-diff','--no-textconv',`${base}..HEAD`,'--']);
    assert(!scanText(history),'SECRET_HISTORY','分支历史含疑似凭据，禁止推送。');
    for(const p of files){
      assert(!sensitivePath(p),'SENSITIVE_FILE',`敏感路径需要人工处理：${p}`);
      const f=await safePath(path,p);
      try{const stat=await lstat(f);assert(stat.isFile()&&stat.size<2_000_000,'FILE_LIMIT',`无法自动扫描文件：${p}`);const b=await readFile(f);assert(!b.includes(0),'BINARY_FILE',`二进制文件需人工审查：${p}`);assert(!scanText(b.toString('utf8')),'SECRET_DETECTED',`文件含疑似凭据：${p}`);}catch(e:any){if(e.code!=='ENOENT')throw e;}
    }
    return files;
  }
  async checkpoint(path:string,base:string,message:string){await this.scan(path,base);await git(path,['add','--all','--','.']);const diff=await exec('git',['diff','--cached','--quiet'],{cwd:path});if(diff.code===1)await git(path,['-c','commit.gpgsign=false','commit','-m',message]);else assert(diff.code===0,'GIT_DIFF','无法检查暂存区。');return git(path,['rev-parse','HEAD']);}
  async push(path:string,branch:string,base:string){await this.health(path,branch);await this.scan(path,base);await git(path,['push','--set-upstream','origin',`${branch}:refs/heads/${branch}`]);}
  async context(path:string){
    const files=(await git(path,['ls-files','-z'])).split('\0').filter(p=>p&&!sensitivePath(p)).slice(0,150);
    const data:{path:string;content:string;sha256:string}[]=[];let bytes=0;
    for(const p of files){try{const f=await safePath(path,p);const stat=await lstat(f);if(!stat.isFile()||stat.size>50000)continue;const b=await readFile(f);if(b.includes(0)||scanText(b.toString()))continue;bytes+=b.length;if(bytes>300000)break;data.push({path:p,content:b.toString(),sha256:digest(b.toString())});}catch(e){if(e instanceof AppError)continue;throw e;}}
    return data;
  }
  async apply(path:string,changes:{path:string;content:string;originalHash:string|null}[],allowed:string[]){
    assert(changes.length<=50,'CHANGE_LIMIT','单次修改超过 50 个文件，请拆分任务。');
    const staged:{file:string;content:string}[]=[];
    for(const c of changes){assert(!sensitivePath(c.path),'SENSITIVE_FILE','禁止模型修改敏感路径。');assert(!allowed.length||allowed.some(p=>c.path===p||c.path.startsWith(p.replace(/\/$/,'')+'/')),'OUT_OF_SCOPE',`超出任务范围：${c.path}`);assert(!scanText(c.content)&&c.content.length<200000,'CONTENT_BLOCKED','生成内容含疑似凭据或过大。');const file=await safePath(path,c.path);let original:null|string=null;try{original=await readFile(file,'utf8');}catch(e:any){if(e.code!=='ENOENT')throw e;}assert((original===null?null:digest(original))===c.originalHash,'FILE_CHANGED',`文件已变更，拒绝覆盖：${c.path}`);staged.push({file,content:c.content});}
    for(const c of staged){await mkdir(dirname(c.file),{recursive:true});await writeFile(c.file,c.content,'utf8');}
  }
}
