import type { Task, Project, Run, Plan } from './model.js';
import { assert } from './model.js';
export function validateGraph(tasks:{issue:number;needs:number[]}[]){
  const map=new Map(tasks.map(t=>[t.issue,t.needs]));const active=new Set<number>(),done=new Set<number>();
  function visit(id:number){assert(!active.has(id),'DEPENDENCY_CYCLE','依赖形成循环，请先调整任务。');if(done.has(id))return;active.add(id);for(const dep of map.get(id)??[])visit(dep);active.delete(id);done.add(id);}
  for(const id of map.keys())visit(id);
}
export function blockers(task:Task,tasks:Task[]){return task.needs.filter(n=>!tasks.some(t=>t.issue===n&&t.repoId===task.repoId&&t.remoteClosed));}
export function conflicts(tasks:Task[]){const pairs:{a:number;b:number;paths:string[]}[]=[];for(let i=0;i<tasks.length;i++)for(let j=i+1;j<tasks.length;j++){const a=tasks[i],b=tasks[j];if(a.repoId!==b.repoId||['done','cancelled'].includes(a.state)||['done','cancelled'].includes(b.state))continue;const paths=a.paths.filter(p=>b.paths.some(q=>p===q||p.startsWith(q+'/')||q.startsWith(p+'/')));if(paths.length)pairs.push({a:a.issue,b:b.issue,paths});}return pairs;}
export function suggestions(project:Project,tasks:Task[]){return tasks.filter(t=>t.repoId===project.id&&!t.owner&&t.state==='ready').map(t=>({issue:t.issue,candidates:project.members.filter(m=>['owner','developer'].includes(m.role)).map(m=>({login:m.login,score:t.paths.filter(p=>m.paths.some(q=>p.startsWith(q))).length,reason:`目录匹配 ${t.paths.filter(p=>m.paths.some(q=>p.startsWith(q))).length} 项；未完成依赖 ${blockers(t,tasks).length} 项`})).sort((a,b)=>b.score-a.score)}));}
export function quality(runs:Run[]){const checks=runs.flatMap(r=>r.checks);return {runs:runs.length,completed:runs.filter(r=>r.status==='completed').length,checks:checks.length,passed:checks.filter(c=>c.exitCode===0).length,failed:checks.filter(c=>c.exitCode!==0).length,notRun:runs.filter(r=>!r.checks.length).length,failures:checks.filter(c=>c.exitCode!==0).map(c=>({name:c.name,at:c.at,evidence:c.output.slice(-1000)})),note:'仅统计本机已记录的运行与实际检查，不代表团队整体质量或效率提升。'};}
export function validatePlan(plan:Pick<Plan,'tasks'>){validateGraph(plan.tasks.map((t,i)=>({issue:i,needs:t.needs})));for(const t of plan.tasks)for(const n of t.needs)assert(n<plan.tasks.length,'INVALID_DEPENDENCY','规划依赖索引超出任务列表。');}
