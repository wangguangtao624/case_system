import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
import { NextResponse } from 'next/server';
import ts from 'typescript';

// Run the actual route against an in-memory DB. Never import the production DB or auth modules.
const routeCode = ts.transpileModule(readFileSync('src/app/api/cases/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function setup(username: string | null = 'admin') {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER, username TEXT);
    CREATE TABLE projects (id INTEGER, is_archived INTEGER, publish_status TEXT);
    CREATE TABLE modules (id INTEGER, project_id INTEGER);
    CREATE TABLE assignments (level TEXT, target_id INTEGER, user_id INTEGER);
    CREATE TABLE cases (
      id INTEGER, module_id INTEGER, test_device TEXT, test_result TEXT,
      revision INTEGER DEFAULT 1, updated_at TEXT DEFAULT 'original'
    );
    INSERT INTO users VALUES (1, 'admin'), (2, 'tester'), (3, 'other');
    INSERT INTO projects VALUES (1, 0, 'published'), (2, 0, 'published');
    INSERT INTO modules VALUES (1, 1), (2, 1), (3, 2);
    INSERT INTO cases (id, module_id, test_device, test_result) VALUES
      (1, 1, 'old', ''), (2, 1, '', NULL), (3, 1, 'old', 'Pass'),
      (4, 1, 'old', 'Fail'), (5, 1, 'old', 'Block'), (6, 2, 'old', ''),
      (7, 3, 'other-project', ''), (8, 1, '', 'Pass'), (9, 1, 'old', '  ');
    INSERT INTO assignments VALUES ('project', 1, 2), ('module', 2, 3), ('case', 9, 3);
  `);
  const exports = {} as { PATCH: (request: Request) => Promise<Response> };
  runInNewContext(routeCode, {
    exports,
    console,
    require(name: string) {
      if (name === 'next/server') return { NextResponse };
      if (name === '@/lib/db') return { getDb: () => db };
      if (name === '@/lib/auth') return {
        getCurrentUser: async () => username ? { id: username === 'admin' ? 1 : 2, username } : null,
        isManagerUser: (name: string) => name === 'admin',
      };
      if (name === '@/lib/jira-links') return {};
      throw new Error(`Unexpected route dependency: ${name}`);
    },
  });
  return {
    db,
    apply: (data: Record<string, unknown> = {}) => exports.PATCH(new Request('http://localhost/api/cases', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, test_device: ' new ', scope: 'unexecuted', ...data }),
    })),
    row: (id: number) => db.prepare('SELECT test_device, revision, updated_at FROM cases WHERE id = ?').get(id) as {
      test_device: string; revision: number; updated_at: string;
    },
  };
}

test('unexecuted scope overwrites existing devices across modules, preserving every recorded result and other projects', async t => {
  const s = setup();
  t.after(() => s.db.close());
  const response = await s.apply();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.updatedCount, 4);
  assert.equal(result.revision, 2);
  for (const id of [1, 2, 6, 9]) {
    assert.equal(s.row(id).test_device, 'new');
    assert.equal(s.row(id).revision, 2);
  }
  for (const id of [3, 4, 5, 7, 8]) {
    assert.equal(s.row(id).revision, 1);
    assert.equal(s.row(id).updated_at, 'original');
  }
  assert.deepEqual(result.deviceOptions.sort(), ['new', 'old']);
});

test('ordinary testers only overwrite their assigned cases, honoring module and case overrides', async t => {
  const s = setup('tester');
  t.after(() => s.db.close());
  const result = await (await s.apply()).json();
  assert.equal(result.updatedCount, 2);
  assert.equal(s.row(1).test_device, 'new');
  assert.equal(s.row(2).test_device, 'new');
  for (const id of [3, 4, 5, 6, 7, 8, 9]) assert.equal(s.row(id).revision, 1);
});

for (const scope of [undefined, 'blank']) {
  test(`blank scope (${scope ?? 'legacy default'}) still only fills empty devices, including executed cases`, async t => {
    const s = setup();
    t.after(() => s.db.close());
    const result = await (await s.apply({ scope })).json();
    assert.equal(result.updatedCount, 2);
    assert.equal(result.revision, 1);
    for (const id of [2, 8]) assert.equal(s.row(id).test_device, 'new');
    for (const id of [1, 3, 4, 5, 6, 7, 9]) assert.equal(s.row(id).revision, 1);
  });
}

test('unexecuted scope with no matching results is a no-op', async t => {
  const s = setup();
  t.after(() => s.db.close());
  s.db.exec("UPDATE cases SET test_result = 'Pass'");
  const result = await (await s.apply()).json();
  assert.equal(result.updatedCount, 0);
  assert.equal(result.revision, 1);
});

test('rejects invalid scope and device values without changing any cases', async t => {
  const s = setup();
  t.after(() => s.db.close());
  for (const data of [{ scope: 'all' }, { test_device: '' }, { test_device: 'x'.repeat(501) }]) {
    assert.equal((await s.apply(data)).status, 400);
  }
  assert.equal(s.row(1).revision, 1);
});

test('requires login and edit permission on the source case', async t => {
  const anonymous = setup(null);
  const tester = setup('tester');
  t.after(() => { anonymous.db.close(); tester.db.close(); });
  assert.equal((await anonymous.apply()).status, 401);
  assert.equal((await tester.apply({ id: 6 })).status, 403);
  assert.equal((await tester.apply({ id: 999 })).status, 404);
  assert.equal(tester.row(1).revision, 1);
});

test('ordinary testers cannot batch-edit archived or unpublished projects', async t => {
  const s = setup('tester');
  t.after(() => s.db.close());
  s.db.exec('UPDATE projects SET is_archived = 1 WHERE id = 1');
  assert.equal((await s.apply()).status, 403);
  s.db.exec("UPDATE projects SET is_archived = 0, publish_status = 'draft' WHERE id = 1");
  assert.equal((await s.apply()).status, 403);
  assert.equal(s.row(1).revision, 1);
});
