import { now, policySchema, taskSchema, type Project, type Review, type Handoff } from './model.js';
import type { Service } from './service.js';
export function seedDemo(s:Service){
  const id='demo-studio';if(s.store.get('project',id))return;
  const p:Project={id,slug:'studio/atlas',root:process.cwd(),user:'you',role:'owner',defaultBranch:'main',mode:'github-only',activeDevice:s.store.device,members:[{login:'you',role:'owner',paths:['src','docs']},{login:'lin',role:'developer',paths:['api','tests']},{login:'chen',role:'reviewer',paths:['src']}],policy:policySchema.parse({}),compatible:true,demo:true,lastSync:now()};
  s.store.put('project',id,p);
  const entries=[
    {issue:24,title:'为工作台添加全局搜索',owner:'you',state:'ready',paths:['src/search'],needs:[],priority:'high',acceptance:['按标题与编号搜索任务','支持键盘聚焦与空结果提示']},
    {issue:23,title:'统一任务事件与状态流转',owner:'lin',state:'running',paths:['api/events'],needs:[],priority:'high',acceptance:['事件幂等落库','非法状态转换被阻止']},
    {issue:22,title:'完善工作区设置页面',owner:'you',state:'review',paths:['src/settings'],needs:[],priority:'medium',acceptance:['审批策略独立配置','设置刷新后保持']},
    {issue:21,title:'实现通知去重与免打扰',owner:'lin',state:'handoff_pending',paths:['api/notifications'],needs:[],priority:'medium',acceptance:['同一事件仅一条通知','免打扰期间不产生提醒']},
    {issue:20,title:'为事件同步补充回归测试',owner:'',state:'blocked',paths:['tests/events'],needs:[23],priority:'medium',acceptance:['覆盖断网与重复事件']},
    {issue:19,title:'建立项目配置与校验规则',owner:'you',state:'done',paths:['src/config'],needs:[],priority:'low',acceptance:['不兼容配置只读降级']},
  ];
  for(const e of entries)s.saveTask({...taskSchema.parse({schema:'codexmate.task/v1',revision:1,...e}),repoId:id,body:'这是一条演练任务，用来了解 CodexMate 协作流程。没有关联真实 GitHub 仓库。',title:e.title,url:'#demo-task',updatedAt:now(),remoteClosed:e.state==='done'});
  const review:Review={id:'demo-review',repoId:id,pr:38,head:'f29a341'+ '0'.repeat(33),title:'完善工作区设置页面',url:'#demo-pr',body:'AI-assisted review · 演练内容\n\n[medium] src/settings.ts:42\n保存失败时应保留用户编辑内容，并提供重试操作。\n\n验证状态：演练示例，未读取代码、未运行测试。',status:'draft',createdAt:now()};s.store.put('review',review.id,review);
  const h:Handoff={schema:'codexmate.handoff/v1',id:'demo-handoff',repoId:id,issue:21,revision:1,from:'lin',to:'you',sha:'7a8c91e'+'0'.repeat(33),branch:'cm/21/lin',goal:'实现通知去重与免打扰',acceptance:['同一事件仅一条通知','免打扰期间不产生提醒'],remaining:['补充跨午夜免打扰测试','核验重启后的通知去重'],risks:['检查点仅用于演练'],checks:[],needs:[],status:'pending',createdAt:now()};s.store.put('handoff',h.id,h);
  s.store.audit(id,'demo.created','独立演练环境已就绪。所有示例任务、审查、检查点均为演示数据。');
}
