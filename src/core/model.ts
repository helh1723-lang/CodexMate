import { z } from 'zod';
export const stateSchema = z.enum(['ready','needs_approval','running','review','blocked','handoff_pending','done','cancelled']);
export type TaskState = z.infer<typeof stateSchema>;
export const taskSchema = z.object({
  schema: z.literal('codexmate.task/v1'), issue: z.number().int().positive(), revision: z.number().int().positive(),
  state: stateSchema, owner: z.string().max(100), reviewers: z.array(z.string()).default([]),
  priority: z.enum(['high','medium','low']).default('medium'), acceptance: z.array(z.string().min(1).max(3000)).min(1),
  needs: z.array(z.number().int().positive()).default([]), base_branch: z.string().min(1).default('main'),
  paths: z.array(z.string()).default([]), risk: z.enum(['normal','high']).default('normal'),
});
export type Task = z.infer<typeof taskSchema> & { repoId: string; title: string; body: string; url: string; updatedAt: string; remoteClosed?: boolean; warning?: string };
export const policySchema = z.object({
  autoStart: z.boolean().default(false), autoPush: z.boolean().default(false),
  checks: z.array(z.object({ name: z.string().min(1), command: z.string().min(1), args: z.array(z.string()), trustedSha: z.string().regex(/^[a-f0-9]{40}$/) })).default([]),
  maxRepairAttempts: z.number().int().min(0).max(2).default(2),
  timeoutMinutes: z.number().int().min(1).max(180).default(30),
  pollingSeconds: z.number().int().min(30).max(3600).default(60),
  retentionDays: z.number().int().min(1).max(365).default(30), notifications: z.boolean().default(true),
  quietHours: z.object({ start: z.number().min(0).max(23), end: z.number().min(0).max(23) }).nullable().default(null),
});
export type Policy = z.infer<typeof policySchema>;
export interface Project {
  id: string; slug: string; root: string; user: string; role: 'owner'|'developer'|'reviewer'|'viewer';
  defaultBranch: string; mode: 'github-only'|'coordinated'; activeDevice: string;
  members: { login: string; role: string; paths: string[] }[];
  policy: Policy; compatible: boolean; lastSync?: string; error?: string; demo?: boolean;
}
export interface CheckResult { name: string; exitCode: number | null; output: string; at: string; durationMs: number; }
export interface Run {
  id: string; repoId: string; issue: number; revision: number; owner: string; device: string;
  status: 'running'|'paused'|'blocked'|'completed'|'frozen'; worktree: string; branch: string; baseSha: string;
  threadId?: string; startedAt: string; endedAt?: string; summary?: string; error?: string; checks: CheckResult[];
  repairRound: number; pr?: {number: number; url: string; head: string}; pid: number;
}
export interface Review { id: string; repoId: string; pr: number; head: string; title: string; url: string; body: string; status: 'draft'|'published'|'stale'; createdAt: string; }
export interface Handoff {
  schema: 'codexmate.handoff/v1'; id: string; repoId: string; issue: number; revision: number;
  from: string; to: string; sha: string; branch: string; goal: string; acceptance: string[]; remaining: string[];
  risks: string[]; checks: CheckResult[]; needs: number[]; status: 'pending'|'accepted'|'rejected'; createdAt: string;
}
export const planItemSchema = z.object({ title: z.string().min(1).max(200), acceptance: z.array(z.string().min(1)).min(1), paths: z.array(z.string()), needs: z.array(z.number().int().nonnegative()), owner: z.string().default(''), evidence: z.string() });
export const planSchema = z.object({ goal: z.string().min(1), tasks: z.array(planItemSchema).min(1).max(20) });
export type Plan = z.infer<typeof planSchema> & {id: string; repoId: string; status: 'draft'|'published'|'reverted'; createdAt: string; issues: number[]};
export type Action = 'run'|'resume'|'pause'|'publish'|'review'|'publish_review'|'handoff'|'accept_handoff'|'reject_handoff'|'repair'|'plan'|'publish_plan'|'revert_plan'|'assign'|'init';
export const actionSchema = z.object({ repoId: z.string().min(1), action: z.enum(['run','resume','pause','publish','review','publish_review','handoff','accept_handoff','reject_handoff','repair','plan','publish_plan','revert_plan','assign','init']), target: z.string().min(1), input: z.record(z.unknown()).default({}) });
export type ActionRequest = z.infer<typeof actionSchema>;
export interface Approval extends ActionRequest {id: string; digest: string; status: 'pending'|'approved'|'rejected'|'executing'|'completed'|'failed'; createdAt: string; expiresAt: string; result?: string;}
export interface Audit { id: number; at: string; repoId: string; action: string; detail: string; }
export class AppError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export function assert(ok: unknown, code: string, message: string): asserts ok { if (!ok) throw new AppError(code, message); }
export const now = () => new Date().toISOString();
