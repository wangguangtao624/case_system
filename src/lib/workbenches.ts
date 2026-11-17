import crypto from 'crypto';
import type Database from 'better-sqlite3';

export function initWorkbenches(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS automation_workbenches (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1, last_seen INTEGER, inventory TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
}
export function hashWorkbenchToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
export function authenticateWorkbench(db: Database.Database, authorization: string | null) {
  const match = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(authorization || '');
  if (!match) return null;
  initWorkbenches(db);
  return db.prepare('SELECT id,name FROM automation_workbenches WHERE token_hash=? AND enabled=1').get(hashWorkbenchToken(match[1])) as {id:string;name:string}|undefined || null;
}
