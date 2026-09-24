import type { GitHubExec } from '../src/adapters/github.js';
import type { ExecResult } from '../src/adapters/process.js';

export type Reply = { status?: number; headers?: Record<string, string>; body?: unknown; plain?: string; error?: string; raw?: string };
export type GhCall = { path: string; method: string; body: any; args: string[] };

/** 把 Reply 渲染成与 `gh api --include` 一致的原始输出（状态行 + 头 + 空行 + 正文）。 */
export function render(r: Reply): ExecResult {
  if (r.error !== undefined) return { stdout: '', stderr: r.error, code: 1 };
  if (r.plain !== undefined) return { stdout: r.plain, stderr: '', code: 0 };
  if (r.raw !== undefined) return { stdout: r.raw, stderr: '', code: 0 };
  const lines = [`HTTP/2.0 ${r.status ?? 200}`, ...Object.entries(r.headers ?? {}).map(([k, v]) => `${k}: ${v}`), '', '', JSON.stringify(r.body ?? null)];
  return { stdout: lines.join('\r\n'), stderr: '', code: 0 };
}

/**
 * 离线 gh 执行器：在进程边界替换 `gh`，因此被测代码仍是真实的适配器与业务层。
 * 路由按「去掉 /repos/owner/name 前缀后的 API 路径」匹配，返回 undefined 表示未覆盖（会显式失败而不是静默返回空）。
 */
export function ghStub(route: (path: string, method: string, body: any, args: string[]) => Reply | undefined) {
  const calls: GhCall[] = [];
  const run: GitHubExec = async (_command, args, opts = {}) => {
    const path = args[1].replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
    const body = opts.input ? JSON.parse(opts.input) : undefined;
    calls.push({ path, method, body, args });
    const reply = route(path, method, body, args);
    if (!reply) return { stdout: '', stderr: `未覆盖的 gh 路由：${method} ${path}`, code: 1 };
    return render(reply);
  };
  return { run, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}
