import {test,expect} from '@playwright/test';
test('minimal chat onboarding, themes and keyboard navigation',async({page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'两位 Codex，一个目标。'})).toBeVisible();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'连接我的协作空间'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('heading',{name:/选择共享 Git 仓库/})).toBeVisible();
  await page.getByRole('button',{name:'深色',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.screenshot({path:'artifacts/chat-dark.png'});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.getByRole('button',{name:/设置/}).click();await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();await page.screenshot({path:'artifacts/chat-light.png'});
  await page.keyboard.press('Control+n');await expect(page.getByRole('textbox',{name:'任务消息'})).toBeFocused();
});
test('narrow layout keeps composer accessible',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('textbox',{name:'任务消息'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'artifacts/chat-mobile.png'});});
