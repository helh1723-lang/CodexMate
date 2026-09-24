import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store/index.js';
import { Service } from '../src/core/service.js';
import { GitHub, encodeTask } from '../src/adapters/github.js';
import { now, policySchema, taskSchema, type Handoff, type Project, type Review, type Task } from '../src/core/model.js';
import type { Runner } from '../src/adapters/codex.js';
import { ghStub, type Reply } from './helpers.js';

const MEMBERS = [{ login: 'you', role: 'owner', paths: [] as string[] }, { login: 'lin', role: 'developer', paths: [] as string[] }];
const CONFIG = { schema: 'codexmate.config/v1', members: MEMBERS, workers: { you: 'dev-1' }, repo: { default_branch: 'main' }, execution: { default_mode: 'approve-first' } };
const runner: Runner = { run: async () => { throw new Error('本用例不应调用 Runner'); }, text: async () => { throw new Error('本用例不应调用 Runner'); } };
const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

/** 用真实 GitHub 适配器 + 离线 gh 执行器搭出一次同步场景：只替换最外层的进程边界。 */
function setup(config: unknown, issues: Task[], extra: (path: string, method: string) => Reply | undefined = () => undefined) {
  const stub = ghStub((path, method) => {
    const hit = extra(path, method);
    if (hit) return hit;
    if (path === '/user') return { plain: 'you' };
    if (path === '') return { body: { permissions: { admin: true, push: true, pull: true }, default_branch: 'main' } };
    if (path.startsWith('/contents/.codexmate/config.yml')) return { body: { content: base64(config) } };
    if (path.startsWith('/issues?state=all')) return { body: issues.map(issueRow) };
    if (path.startsWith('/issues/') && path.includes('/comments')) return { body: [] };
    if (path.startsWith('/pulls/')) return { body: { number: Number(path.split('/')[2]), head: { sha: 'f'.repeat(40) } } };
    return undefined;
  });
  const store = new Store(mkdtempSync(join(tmpdir(), 'cm-sync-')));
  const service = new Service(store, runner, () => new GitHub('org/repo', stub.run));
  const project: Project = { id: 'r1', slug: 'org/repo', root: store.home, user: 'you', role: 'owner', defaultBranch: 'main', mode: 'github-only', activeDevice: 'dev-1', members: MEMBERS, policy: policySchema.parse({}), compatible: true };
  store.put('project', 'r1', project);
  return { store, service, stub };
}
function issueRow(t: Task) {
  return { number: t.issue, title: t.title, body: encodeTask(t), state: 'open', assignees: t.owner ? [{ login: t.owner }] : [], labels: [{ name: `cm:${t.state === 'handoff_pending' ? 'handoff' : t.state}` }], html_url: `https://github.com/org/repo/issues/${t.issue}`, updated_at: t.updatedAt };
}
function task(issue: number, state: Task['state'], owner: string, revision = 1): Task {
  return { ...taskSchema.parse({ schema: 'codexmate.task/v1', issue, revision, state, owner, acceptance: ['满足验收'], base_branch: 'main', paths: ['src'], risk: 'normal', priority: 'medium', needs: [], reviewers: [] }), repoId: 'r1', title: `任务 ${issue}`, body: '人类正文', url: `https://github.com/org/repo/issues/${issue}`, updatedAt: now() };
}
const review = (pr: number, head: string, status: Review['status'] = 'draft'): Review => ({ id: `rev-${pr}`, repoId: 'r1', pr, head, title: `PR ${pr}`, url: 'u', body: 'AI-assisted review', status, createdAt: now() });
const comment = (payload: unknown, login: string) => ({ body: `交接说明\n<!-- codexmate-handoff-json:${base64(payload)} -->`, user: { login } });
const handoff = (over: Partial<Handoff> = {}): Handoff => ({ schema: 'codexmate.handoff/v1', id: 'h1', repoId: 'r1', issue: 21, revision: 1, from: 'lin', to: 'you', sha: 'c'.repeat(40), branch: 'cm/21/lin', goal: '接力目标', acceptance: ['满足验收'], remaining: ['补齐回归'], risks: ['需核验'], checks: [], needs: [], status: 'pending', createdAt: now(), ...over });

test('任务经真实解码落库，负责人与编号以结构化记录为准', async () => {
  const { store, service } = setup(CONFIG, [task(42, 'ready', 'you')]);
  await service.sync('r1');
  const saved = store.get<Task>('task', 'r1:42')!;
  assert.equal(saved.owner, 'you');
  assert.deepEqual(saved.acceptance, ['满足验收']);
  assert.equal(saved.warning, undefined);
  assert.equal(saved.body, '人类正文');
});

test('PR 新提交后原审查标记过期，未变化时保持草稿（T07）', async () => {
  const { store, service } = setup(CONFIG, [], (path) => (path === '/pulls/38' ? { body: { number: 38, head: { sha: 'a'.repeat(40) } } } : undefined));
  store.put('review', 'rev-38', review(38, 'a'.repeat(40)));
  await service.sync('r1');
  assert.equal(store.get<Review>('review', 'rev-38')!.status, 'draft', 'head 未变化不应过期');
  const shifted = setup(CONFIG, []);
  shifted.store.put('review', 'rev-38', review(38, 'a'.repeat(40)));
  await shifted.service.sync('r1');
  assert.equal(shifted.store.get<Review>('review', 'rev-38')!.status, 'stale');
});

test('只接受作者一致、编号版本匹配且 schema 正确的交接载荷', async () => {
  const t = task(21, 'handoff_pending', 'lin');
  const payloads = [
    comment(handoff({ id: 'bad-schema', schema: 'codexmate.handoff/v2' as unknown as Handoff['schema'] }), 'lin'),
    comment(handoff({ id: 'bad-author' }), 'someone-else'),
    comment(handoff({ id: 'bad-sha', sha: 'not-a-sha' }), 'lin'),
    comment(handoff({ id: 'bad-repo', repoId: 'other' }), 'lin'),
    comment(handoff({ id: 'bad-revision', revision: 9 }), 'lin'),
    comment(handoff(), 'lin'),
  ];
  const { store, service } = setup(CONFIG, [t], (path) => (path.startsWith('/issues/21/comments') ? { body: payloads } : undefined));
  await service.sync('r1');
  assert.ok(store.get<Handoff>('handoff', 'h1'), '合法交接必须入账');
  assert.equal(store.list<Handoff>('handoff').length, 1, '非法载荷不得被当作可执行交接');
});

test('同一任务版本的待处理通知在重复同步后仍只有一条', async () => {
  const { store, service } = setup(CONFIG, [task(42, 'ready', 'you')]);
  await service.sync('r1');
  await service.sync('r1');
  await service.sync('r1');
  assert.equal(store.list('notification').length, 1);
  assert.equal(store.list<Task>('task').length, 1);
});

test('远端配置版本较新时只读降级，并拒绝一切写操作（F14）', async () => {
  const { store, service } = setup({ ...CONFIG, schema: 'codexmate.config/v2' }, [task(42, 'ready', 'you')]);
  await service.sync('r1');
  assert.equal(service.project('r1').compatible, false);
  assert.throws(() => service.request({ repoId: 'r1', action: 'run', target: '42' }), /只读/);
  assert.equal(store.list('approval').length, 0, '不兼容配置不得留下可执行审批');
});

test('同步失败保留缓存数据并记录错误，不伪造成功时间戳（T05）', async () => {
  const { store, service } = setup(CONFIG, [task(42, 'ready', 'you')], (path) => (path === '' ? { error: 'GitHub HTTP 429：请检查登录、仓库权限或限流状态。' } : undefined));
  await assert.rejects(() => service.sync('r1'), /429/);
  const p = service.project('r1');
  assert.match(String(p.error), /429/);
  assert.equal(p.lastSync, undefined, '失败不得写成功时间戳');
  assert.equal(store.list('notification').length, 1);
  assert.equal(store.list<Task>('task').length, 0, '失败不得写入半截任务数据');
});
