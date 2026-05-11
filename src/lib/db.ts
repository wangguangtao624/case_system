import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'platform.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeDatabase(db);
  }
  return db;
}

function initializeDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      case_name TEXT NOT NULL,
      priority TEXT DEFAULT 'Middle',
      test_env TEXT DEFAULT '',
      pre_operation TEXT DEFAULT '',
      step TEXT DEFAULT '',
      expect_result TEXT DEFAULT '',
      note TEXT DEFAULT '',
      test_result TEXT,
      jira_link TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      file_type TEXT DEFAULT '',
      storage_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migration: add test_log column if not exists
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN test_log TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add source column to files table
  try {
    db.exec(`ALTER TABLE files ADD COLUMN source TEXT DEFAULT 'upload'`);
  } catch { /* column already exists */ }

  // Migration: add is_public column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN is_public INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }

  // Migration: convert all projects to public (remove personal project space)
  try {
    db.exec(`UPDATE projects SET is_public = 1 WHERE is_public = 0`);
  } catch { /* ignore migration errors */ }

  // Migration: add fail_note column to cases table
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN fail_note TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add test_device column to cases table
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN test_device TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add executor column to cases table
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN executor TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add case_no column to cases table
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN case_no TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add test_category column to cases table
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN test_category TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE cases ADD COLUMN feature TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add trait column to cases table (特征)
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN trait TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add test_result_note column to cases table (测试备注)
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN test_result_note TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add light column to cases table (灯光)
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN light TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add temperature column to cases table (温度)
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN temperature TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: create assignments table (Case分配)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(level, target_id)
      )
    `);
  } catch { /* table already exists */ }

  // Migration: update priority values to English
  try {
    db.exec(`UPDATE cases SET priority = 'High' WHERE priority = '高'`);
    db.exec(`UPDATE cases SET priority = 'Middle' WHERE priority = '中'`);
    db.exec(`UPDATE cases SET priority = 'Low' WHERE priority = '低'`);
  } catch { /* ignore migration errors */ }

  // Migration: update test_result 'Blocked' to 'Block'
  try {
    db.exec(`UPDATE cases SET test_result = 'Block' WHERE test_result = 'Blocked'`);
  } catch { /* ignore migration errors */ }

  // Migration: add is_archived column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }

  // Migration: add archived_at column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN archived_at TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  // Migration: add archive_note column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN archive_note TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add archived_by column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN archived_by TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add start_date column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN start_date TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  // Migration: add end_date column to projects table
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN end_date TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  // Migration: add independent gantt dates for high-priority-only view
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN high_priority_start_date TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE projects ADD COLUMN high_priority_end_date TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  // Migration: create bugs table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bugs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        reporter_id INTEGER NOT NULL REFERENCES users(id),
        reporter_name TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        resolver_id INTEGER,
        resolver_name TEXT,
        resolve_note TEXT DEFAULT '',
        resolved_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
  } catch { /* table already exists */ }

  // Migration: align legacy bugs schema with current API fields
  try {
    db.exec(`ALTER TABLE bugs ADD COLUMN resolver_id INTEGER`);
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE bugs ADD COLUMN resolver_name TEXT`);
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE bugs ADD COLUMN resolve_note TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  try {
    const bugColumns = db.prepare(`PRAGMA table_info(bugs)`).all() as Array<{ name: string }>;
    const bugColumnNames = new Set(bugColumns.map(column => column.name));

    if (bugColumnNames.has('resolved_by') && bugColumnNames.has('resolver_name')) {
      db.exec(`
        UPDATE bugs
        SET resolver_name = COALESCE(NULLIF(resolver_name, ''), resolved_by)
        WHERE resolved_by IS NOT NULL AND resolved_by != ''
      `);
    }

    if (bugColumnNames.has('resolution_note') && bugColumnNames.has('resolve_note')) {
      db.exec(`
        UPDATE bugs
        SET resolve_note = COALESCE(NULLIF(resolve_note, ''), resolution_note)
        WHERE resolution_note IS NOT NULL AND resolution_note != ''
      `);
    }
  } catch { /* ignore migration errors */ }

  // Initialize default users if not exists
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const insertUser = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
    const defaultPassword = hashPassword('111111');
    const normalUsers = ['王光涛', '路进艳', '潘瑞麟', '邱雪', '王世海', '许文霞', '晏术贤', '张宇慧', '刘济聪'];
    insertUser.run('admin', defaultPassword, 'admin');
    for (const name of normalUsers) {
      insertUser.run(name, defaultPassword, 'user');
    }

    // Initialize default storage path
    const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('storage_path', path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'uploads'));
  }
}

import { createHash, randomBytes } from 'crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const verifyHash = createHash('sha256').update(salt + password).digest('hex');
  return hash === verifyHash;
}

export function getStoragePath(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'storage_path'").get() as { value: string } | undefined;
  const storagePath = row?.value || path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'uploads');
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }
  return storagePath;
}
