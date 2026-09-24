import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub, encodeTask, decodeTask } from '../src/adapters/github.js';
import { taskSchema, type Task } from '../src/core/model.js';
import { ghStub } from './helpers.js';

test('GitHub 429 按 Retry-After 进入退避，退避期间不再发出请求', async () => {
  const stub = ghStub(() => ({ status: 429, headers: { 'retry-after': '1' }, body: { message: 'rate limit' } }));
  const gh = new GitHub('org/repo', stub.run);
  await assert.rejects(() => gh.request('/issues'), /HTTP 429/);
  assert.equal(stub.calls.length, 1);
  await assert.rejects(() => gh.request('/issues'), /退避/);
  assert.equal(stub.calls.length, 1, '退避期间不得再打 GitHub');
});

test('传输层错误里的限流信号同样触发退避，普通错误不触发', async () => {
  const limited = ghStub(() => ({ error: 'HTTP 429: API rate limit exceeded' }));
  const gh = new GitHub('org/repo', limited.run);
  await assert.rejects(() => gh.request('/issues'), /429/);
  await assert.rejects(() => gh.request('/issues'), /退避/);
  assert.equal(limited.calls.length, 1);
  const plain = ghStub(() => ({ error: 'gh: command not found' }));
  const other = new GitHub('org/repo', plain.run);
  await assert.rejects(() => other.request('/issues'), /command not found/);
  await assert.rejects(() => other.request('/issues'), /command not found/, '非限流错误不应被当成退避');
  assert.equal(plain.calls.length, 2);
});

test('ETag 条件请求：304 复用缓存且携带 If-None-Match', async () => {
  let first = true;
  const stub = ghStub(() => {
    if (first) { first = false; return { status: 200, headers: { etag: 'W/"abc"' }, body: [{ number: 1 }] }; }
    return { status: 304 };
  });
  const gh = new GitHub('org/repo', stub.run);
  assert.deepEqual(await gh.request('/issues'), [{ number: 1 }]);
  assert.deepEqual(await gh.request('/issues'), [{ number: 1 }], '304 必须返回缓存内容而不是 null');
  assert.match(stub.calls[1].args.join(' '), /If-None-Match: W\/"abc"/);
});

test('401/403 提示权限与限流排查方向，不打印凭据', async () => {
  const gh = new GitHub('org/repo', ghStub(() => ({ status: 401, body: { message: 'Bad credentials' } })).run);
  await assert.rejects(() => gh.request(''), /请检查登录、仓库权限或限流状态/);
});

test('草稿 PR 幂等：已存在同分支 Open PR 时直接复用，不再创建（T04）', async () => {
  const existing = { number: 58, html_url: 'https://github.com/org/repo/pull/58' };
  const stub = ghStub((path, method) => (method === 'GET' && path.startsWith('/pulls?state=open') ? { status: 200, body: [existing] } : { status: 201, body: { number: 99, html_url: 'x' } }));
  const gh = new GitHub('org/repo', stub.run);
  assert.equal((await gh.draft(taskFixture(), 'cm/42/you-r1', '摘要')).number, 58);
  assert.equal(stub.posts().length, 0, '重启后不得重复创建 PR');
});

test('草稿 PR 首次创建：标记 draft、关联 Issue、只指向任务分支', async () => {
  const stub = ghStub(() => ({ status: 201, body: { number: 99, html_url: 'https://github.com/org/repo/pull/99' } }));
  await new GitHub('org/repo', stub.run).draft(taskFixture(), 'cm/42/you-r1', '摘要');
  assert.match(stub.calls[0].path, /^\/pulls\?state=open&head=org%3Acm%2F42%2Fyou-r1/);
  const post = stub.posts()[0];
  assert.equal(post.path, '/pulls');
  assert.equal(post.body.draft, true);
  assert.equal(post.body.base, 'main');
  assert.equal(post.body.head, 'cm/42/you-r1');
  assert.match(post.body.body, /Closes #42/);
});

test('评审评论按幂等键去重，且疑似凭据在发出前被拦下', async () => {
  const marker = '<!-- codexmate:publish:42:1:abc -->';
  const seen = ghStub(() => ({ status: 200, body: [{ body: '已有评论\n' + marker }] }));
  assert.match((await new GitHub('org/repo', seen.run).comment(42, '新内容', 'publish:42:1:abc')).body, /已有评论/);
  assert.equal(seen.posts().length, 0);
  const blocked = ghStub(() => ({ status: 200, body: [] }));
  await assert.rejects(() => new GitHub('org/repo', blocked.run).comment(42, 'ghp_' + 'a'.repeat(36), 'k'), /凭据/);
  assert.equal(blocked.posts().length, 0, '含凭据的内容不得写入 GitHub');
});

test('任务同步跳过 PR 行、无结构化数据的 Issue 与编号错配的载荷', async () => {
  const good = taskFixture();
  const rows = [
    issueRow(42, encodeTask(good)),
    { number: 2, title: '这是 PR', pull_request: {}, body: '' },
    issueRow(3, '没有结构化数据区块'),
    issueRow(4, encodeTask(good).replace('issue: 42', 'issue: 7')),
  ];
  const tasks = await new GitHub('org/repo', ghStub(() => ({ status: 200, body: rows })).run).tasks('demo');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].issue, 42);
  assert.equal(tasks[0].warning, undefined);
});

test('负责人与状态标签和结构化记录不一致时给出阻断警告', () => {
  const body = encodeTask(taskFixture());
  assert.equal(decodeTask('demo', issueRow(42, body))?.warning, undefined);
  assert.match(String(decodeTask('demo', { ...issueRow(42, body), assignees: [{ login: 'lin' }] })?.warning), /不一致/);
  assert.match(String(decodeTask('demo', { ...issueRow(42, body), labels: [{ name: 'cm:running' }] })?.warning), /不一致/);
});

test('本机 gh 账号与绑定账号不一致时阻断权限核验', async () => {
  const stub = ghStub((path) => (path === '/user' ? { plain: 'someone-else' } : { status: 200, body: { permissions: { push: true } } }));
  await assert.rejects(() => new GitHub('org/repo', stub.run).permission('you'), /不一致/);
});

function taskFixture(): Task {
  return { ...taskSchema.parse({ schema: 'codexmate.task/v1', issue: 42, revision: 1, state: 'ready', owner: 'you', acceptance: ['实现并通过回归'], base_branch: 'main', paths: ['src'], risk: 'normal', priority: 'medium', needs: [], reviewers: [] }), repoId: 'demo', title: '测试任务', body: '人类正文', url: 'https://github.com/org/repo/issues/42', updatedAt: '2026-09-24T00:00:00Z' };
}
function issueRow(number: number, body: string) {
  return { number, title: `任务 ${number}`, body, state: 'open', assignees: [{ login: 'you' }], labels: [{ name: 'cm:ready' }], html_url: `https://github.com/org/repo/issues/${number}`, updated_at: '2026-09-24T00:00:00Z' };
}
