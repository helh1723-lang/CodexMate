import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { now, AppError, type Audit } from '../core/model.js';
import { redact } from '../core/security.js';
export class Store {
  db: DatabaseSync;
  constructor(public home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const file = join(home, 'codexmate.db');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as any).user_version);
    if (version > 1) throw new AppError('SCHEMA_NEWER','本地数据库来自更新版本，请升级客户端。');
    if (version < 1) {
      if (existsSync(file) && version) copyFileSync(file, file + '.backup');
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, repoId TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS locks(key TEXT PRIMARY KEY, holder TEXT NOT NULL, pid INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS leases(key TEXT PRIMARY KEY, holder TEXT NOT NULL, fence INTEGER NOT NULL, expires INTEGER NOT NULL, stopped INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, at TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
    }
    if (!this.get('meta','device')) this.put('meta','device', randomUUID());
  }
  get device(): string { return this.get<string>('meta','device')!; }
  get<T>(kind: string, id: string): T | undefined { const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id) as {data: string}|undefined; return row ? JSON.parse(row.data) as T : undefined; }
  list<T>(kind: string): T[] { return (this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind) as {data: string}[]).map(r=>JSON.parse(r.data) as T); }
  put<T>(kind: string, id: string, data: T): T { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(data)); return data; }
  remove(kind: string,id: string) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  transaction<T>(fn: ()=>T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  once(id: string) { return Number(this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(id,now()).changes)>0; }
  audit(repoId: string, action: string, detail: unknown) { this.db.prepare('INSERT INTO audit(at,repoId,action,detail) VALUES(?,?,?,?)').run(now(),repoId,action,redact(typeof detail==='string'?detail:JSON.stringify(detail))); }
  audits(repoId?: string): Audit[] { return (repoId ? this.db.prepare('SELECT * FROM audit WHERE repoId=? ORDER BY id DESC LIMIT 500').all(repoId) : this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all()) as unknown as Audit[]; }
  lock(key: string, holder: string) { try { this.db.prepare('INSERT INTO locks VALUES(?,?,?)').run(key,holder,process.pid); } catch { throw new AppError('WORKER_BUSY','此仓库已有本机 Worker。请先暂停或对账恢复。',409); } }
  unlock(key: string,holder: string) { this.db.prepare('DELETE FROM locks WHERE key=? AND holder=?').run(key,holder); }
  locks(): {key:string;holder:string;pid:number}[] { return this.db.prepare('SELECT * FROM locks').all() as any; }
  close() { this.db.close(); }
}
