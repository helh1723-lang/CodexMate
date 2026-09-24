import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store/index.js';
import { coordinatorApp } from '../src/scheduler/server.js';

const TOKEN = 'coordinator-test-token';
const RUN = '11111111-1111-4111-8111-111111111111';
const REPO = 'org/repo';

test('协调器租约：鉴权、越权与并发争抢返回可区分的状态码', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'cm-coord-')));
  const app = coordinatorApp(store, { leaseSeconds: 60, principals: [{ tokenSha256: createHash('sha256').update(TOKEN).digest('hex'), worker: 'device-a', repositories: [REPO] }] });
  const port = 19438, server = app.listen(port, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const call = async (action: string, body: unknown, bearer = TOKEN) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  const req = { repo: REPO, issue: 42, revision: 1, runId: RUN };
  try {
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/health`)).json() as any).mode, 'experimental-coordinator');
    assert.equal((await call('acquire', req, 'wrong-token')).status, 401, '身份无效应为 401');
    assert.equal((await call('acquire', { ...req, repo: 'other/repo' })).status, 403, '超出仓库范围应为 403');
    assert.equal((await call('renew', req)).status, 403, '缺少 fence 应为 403');
    const first = await call('acquire', req);
    assert.equal(first.status, 200);
    assert.equal(first.body.fence, 1);
    assert.equal((await call('acquire', { ...req, runId: '22222222-2222-4222-8222-222222222222' })).status, 409, '旧 Worker 未确认停止时不得接管');
    assert.equal((await call('validate', { ...req, fence: 99 })).status, 409, '失效 fence 必须被拒绝');
    assert.equal((await call('renew', { ...req, fence: 1 })).status, 200);
    assert.equal((await call('stop', { ...req, fence: 1 })).status, 200);
    const second = await call('acquire', { ...req, runId: '33333333-3333-4333-8333-333333333333' });
    assert.equal(second.status, 200);
    assert.equal(second.body.fence, 2, '接管后 fence 必须单调递增');
    assert.equal((await call('stop', { ...req, fence: 1 })).status, 409, '旧 fence 不得停止新租约');
    const audits = store.audits(REPO).map((a) => a.action);
    assert.ok(audits.includes('lease.acquire') && audits.includes('lease.stop'), '租约事件必须留审计');
  } finally {
    await new Promise<void>((r, e) => server.close((x) => (x ? e(x) : r())));
    store.close();
  }
});
