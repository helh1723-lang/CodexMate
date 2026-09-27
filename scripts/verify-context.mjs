import { AppServer } from '../dist/chat/app-server.js';
import { threadRows, itemsToEntries, buildBundle, formatPeerContext } from '../dist/chat/context.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 用真实本机 Codex 验证「同伴上下文」这条通路：
 * 1) 线程 A 真的做一件事（写文件）；
 * 2) 按产品逻辑导出上下文；
 * 3) 把这个上下文放进一个全新线程的提示词，问它能不能复述关键内容。
 * 这里验证的是产品实际依赖的机制（上下文进提示词），不是 inject_items 的内部行为。
 * 需要本机 Codex 已登录且额度可用。
 */
const marker = 'CMCTX-' + randomUUID().slice(0, 8);
const cwd = await mkdtemp(join(tmpdir(), 'cm-verify-ctx-'));
const server = new AppServer();
server.on('diagnostic', () => {});
const report = { marker, cwd, source: {}, exported: 0, injectedRecall: false, reply: '', error: '' };

function runTurn(threadId, text) {
  return new Promise((resolve, reject) => {
    let answer = '',commands=0;
    const timer = setTimeout(() => { cleanup(); reject(new Error('本轮超时')); }, 180000);
    const onNotify = (m) => {
      if(m.params?.threadId!==threadId)return;
      if(m.method==='item/completed'&&m.params.item?.type==='commandExecution')commands++;
      if (m.method === 'item/agentMessage/delta') answer += m.params.delta;
      if (m.method === 'turn/completed') { cleanup(); resolve({ status: m.params.turn.status, answer,commands }); }
    };
    const cleanup = () => { clearTimeout(timer); server.off('notification', onNotify); };
    server.on('notification', onNotify);
    server.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] }).catch(e => { cleanup(); reject(e); });
  });
}

try {
  await server.start();
  const account = await server.request('account/read', { refreshToken: false });
  if (!account.account) throw new Error('本机 Codex 尚未登录，或额度不可用');

  const a = (await server.request('thread/start', { cwd, runtimeWorkspaceRoots: [cwd], sandbox: 'workspace-write', approvalPolicy: 'never' })).thread.id;
  const first = await runTurn(a, `在当前目录创建 file.txt，内容只有一行 ${marker}。写完后用一句话复述这个标记。`);
  report.source.status = first.status;
  report.source.answer = first.answer.slice(0, 200);
  report.file = (await readFile(join(cwd, 'file.txt'), 'utf8').catch(() => '')).trim();

  const rows = await threadRows(server, a);
  const bundle = buildBundle({
    task: randomUUID(), sender: randomUUID(), phase: 'working', branch: 'cm/verify',
    entries: itemsToEntries(rows), maxBytes: 48_000,
  });
  report.exported = bundle.entries.length;
  report.entries = bundle.entries.slice(-8);

  // 关键验证：把上下文放进一个全新线程的提示词，看它能否被读到
  const receiver=await mkdtemp(join(tmpdir(),'cm-receive-ctx-'));
  const b = (await server.request('thread/start', { cwd:receiver, runtimeWorkspaceRoots: [receiver], sandbox: 'read-only', approvalPolicy: 'never' })).thread.id;
  const prompt = `${formatPeerContext(bundle)}\n\n只根据上面的同步上下文回答，不使用工具或读取文件。其中包含一串 CMCTX- 开头的标记，请只回复那串标记本身。`;
  const second = await runTurn(b, prompt);
  report.reply = second.answer.trim().slice(0, 200);
  report.receiverCommands=second.commands;
  report.injectedRecall = first.status==='completed'&&report.file===marker&&report.exported>0&&second.status==='completed'&&second.commands===0&&report.reply===marker;
  if (!report.injectedRecall) process.exitCode = 1;
} catch (e) {
  report.error = String(e.message ?? e);
  process.exitCode = 1;
} finally {
  server.close();
  await writeFile('artifacts/context-verify.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
