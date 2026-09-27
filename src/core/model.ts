// v1.1 遗留的基础设施。v2（chat）只复用下面四个定义，其余随旧版一起删除。
export interface Audit { id: number; at: string; repoId: string; action: string; detail: string; }
export class AppError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export function assert(ok: unknown, code: string, message: string): asserts ok { if (!ok) throw new AppError(code, message); }
export const now = () => new Date().toISOString();
