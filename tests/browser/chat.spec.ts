import {test,expect} from '@playwright/test';
test('minimal chat onboarding, themes and keyboard navigation',async({page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'两位 Codex，一个目标。'})).toBeVisible();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'连接我的协作空间'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('heading',{name:/选择本地工作目录/})).toBeVisible();
  await page.getByRole('button',{name:'深色',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.screenshot({path:'artifacts/chat-dark.png'});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.getByRole('button',{name:/设置/}).click();await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();await page.screenshot({path:'artifacts/chat-light.png'});
  await page.keyboard.press('Control+n');await expect(page.getByRole('textbox',{name:'任务消息'})).toBeFocused();
});
test('narrow layout keeps composer accessible',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('textbox',{name:'任务消息'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'artifacts/chat-mobile.png'});});

test('composer model picker saves supported effort and paused chat sends to the same task',async({page})=>{
  const calls:any[]=[],model=(name:string,efforts:string[])=>({id:name,model:name,displayName:name,description:'',isDefault:name==='GPT Example A',defaultReasoningEffort:efforts[0],supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort,description:''}))});
  const state:any={tasks:[{id:'task-existing',title:'保留原会话',phase:'paused',created:Date.now(),wakes:1,budget:20,running:false}],messages:[],permissions:[],account:{loggedIn:true},room:{id:'room',peer:'peer',online:true,peerWorkspace:{ready:true,status:'已就绪'}},project:{name:'Project',grant:{room:'room',peer:'peer'}},models:[model('GPT Example A',['medium']),model('GPT Example B',['low','high'])]};
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.route('**/api/action',async route=>{const body=route.request().postDataJSON();calls.push(body);if(body.action==='model')state.modelSelection=body.input;await route.fulfill({json:{result:body.action==='models'?state.models:{}}});});
  await page.goto('/');await page.getByRole('button',{name:'选择模型与思考强度'}).click();await page.getByRole('button',{name:'GPT Example B',exact:true}).click();await page.getByRole('button',{name:'高',exact:true}).click();
  await expect(page.getByRole('button',{name:'高',exact:true})).toHaveAttribute('aria-pressed','true');await page.screenshot({path:'artifacts/chat-model-picker.png'});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'保留原会话'}).click();await page.getByRole('textbox',{name:'任务消息'}).fill('沿用工作树继续');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(()=>calls.some(c=>c.action==='supplement'&&c.input.id==='task-existing')).toBeTruthy();expect(calls.some(c=>c.action==='start')).toBeFalsy();expect(state.modelSelection).toEqual({model:'GPT Example B',effort:'high'});
});
