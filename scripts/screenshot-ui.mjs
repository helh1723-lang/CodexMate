import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serveChat } from '../dist/chat/http.js';
import { ChatStore } from '../dist/chat/store.js';

/**
 * 界面人工审查素材生成器。
 * 直接向本机数据库写入一份示例会话（含上下文同步记录），再把界面截出来。
 * 注意：这是为了看界面的种子数据，不是真实协作过程。
 */
const home = mkdtempSync(join(tmpdir(), 'cm-ui-review-'));
const db = new ChatStore(home);
const room = randomUUID(), member = randomUUID(), peer = randomUUID(), task = randomUUID();

db.put('settings', 'account', { loggedIn: true, type: 'chatgpt' });
db.put('settings', 'room', { url: 'https://relay.example.com', id: room, member, token: 'dummy', peer, online: true });
db.put('settings', 'project', {
  path: join(home,'example-project'), remote: 'https://github.com/example/shared-project.git', name: 'CodexMate',
  checks: [['npm', 'run', 'typecheck'], ['npm', 'test']],
  grant: { room, peer },
});
db.save({
  id: task, title: '排行榜分页接口：两端协作', goal: '排行榜分页接口：两端协作',
  initiator: member, base: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  path: join(home, 'worktrees', task), branch: `cm/${task}/${member.slice(0, 8)}-work`,
  phase: 'working', wakes: 4, budget: 20, repairs: 0, results: {}, created: Date.now() - 600000,
});

const messages = [
  ['user', '给排行榜加分页接口。我这边写服务层分页逻辑，同伴那边写调用。', undefined],
  ['collaboration', '分工：我写 service 层分页，接口定为 GET /rank?page&size；请你确认后写前端调用。', '本机 → 同伴'],
  ['collaboration', '已确认 GET /rank?page&size，我按这个完成调用。你也请完成你的部分。', '同伴 → 本机'],
  ['terminal', '$ npm run typecheck\n> tsc --noEmit\n无错误输出', undefined],
  ['context', '同伴进展已更新 · 12 条进展 · 文件 3 · 命令 4', '同伴 → 本机'],
  ['assistant', '两边都已确认同一套接口参数，各自完成自己那部分后提交，由发起方整合并交叉审查。', undefined],
  ['context', '已把本机新进展同步给同伴 · 9 条进展 · 文件 2 · 命令 3', '本机 → 同伴'],
];
for (const [role, text, direction] of messages) db.message(task, role, text, direction);
db.close();

const app = await serveChat(home, 0);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });

async function shoot(name, { theme, viewport, clip, openSidebar }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript(`try{localStorage.setItem('theme','${theme}')}catch{}`);
  const page = await context.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.goto(app.url);
  // 窄屏下侧栏默认不渲染，需要先展开再选会话。
  if (openSidebar) await page.getByRole('button', { name: '切换侧栏' }).click();
  await page.locator('.history-item').first().waitFor();
  await page.locator('.history-item').first().click();
  if (openSidebar) await page.getByRole('button', { name: '切换侧栏' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '同步上下文' }).waitFor();
  await page.waitForTimeout(400);
  // 整页图滚到顶部，方便一次看全所有消息类型；元素图不受影响。
  if (!clip) await page.evaluate(() => { const c = document.querySelector('.conversation'); if (c) c.scrollTop = 0; });
  await page.waitForTimeout(250);
  const target = clip ? page.locator(clip) : page;
  await target.screenshot({ path: resolve('artifacts', name) });
  await context.close();
  console.log(name);
}

try {
  await shoot('ui-review-dark.png', { theme: 'dark', viewport: { width: 1160, height: 820 } });
  await shoot('ui-review-light.png', { theme: 'light', viewport: { width: 1160, height: 820 } });
  await shoot('ui-review-composer.png', { theme: 'dark', viewport: { width: 1160, height: 820 }, clip: '.composer-area' });
  await shoot('ui-review-mobile.png', { theme: 'dark', viewport: { width: 390, height: 844 }, openSidebar: true });
  console.log('url=' + app.url);
} finally {
  await browser.close();
  await app.close();
}
