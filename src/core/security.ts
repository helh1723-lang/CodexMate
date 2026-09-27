// v1.1 遗留的脱敏与摘要。v2（chat）复用 redact / scanText / digest。
import { createHash } from 'node:crypto';
const patterns = [
  /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[=:]\s*["']?[^\s"',;]{12,}/gi,
  /Bearer\s+[a-zA-Z0-9._~-]{16,}/gi,
];
export function redact(value: string) { let out = value; for (const p of patterns) out = out.replace(p, '[REDACTED]'); return out; }
export function scanText(value: string) { return patterns.some(p => { p.lastIndex = 0; return p.test(value); }); }
export function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
