import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
import { NextResponse } from 'next/server';
import ts from 'typescript';
import { validateClassification } from '../src/lib/project-classification';

const code = ts.transpileModule(readFileSync('src/app/api/projects/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function setup(username: string | null = 'admin') {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, sort_order INTEGER, is_public INTEGER, publish_status TEXT, test_type TEXT, chip_model TEXT, firmware_version TEXT);
    INSERT INTO projects VALUES (1, 1, 'Original', 1, 1, 'published', 'firmware', 'MAT130V300', 'V4.2.5');`);
  const routes = {} as Record<string, (request: Request) => Promise<Response>>;
  runInNewContext(code, { exports: routes, console, require(name: string) {
    if (name === 'next/server') return { NextResponse };
    if (name === '@/lib/db') return { getDb: () => db };
    if (name === '@/lib/project-classification') return { validateClassification };
    if (name === '@/lib/auth') return { getCurrentUser: async () => username ? { id: 1, username } : null, isManagerUser: (name: string) => name === 'admin' };
    throw new Error(name);
  } });
  return { db, request: (method: string, body: object) => routes[method](new Request('http://localhost/api/projects', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })), row: () => db.prepare('SELECT * FROM projects WHERE id = 1').get() as Record<string, unknown> };
}

test('new projects persist explicit test types, normalized chip and draft lifecycle', async t => {
  const s = setup(); t.after(() => s.db.close());
  for (const body of [
    { name: 'MAT821', test_type: 'chip', chip_model: ' mat821 ', firmware_version: '' },
    { name: 'MAT130 firmware', test_type: 'firmware', chip_model: 'MAT130 V300', firmware_version: ' V4.2.7 ' },
    { name: 'ISP tool', test_type: 'tool' },
  ]) {
    const response = await s.request('POST', body); assert.equal(response.status, 200);
    const result = await response.json();
    const row = s.db.prepare('SELECT * FROM projects WHERE id = ?').get(result.id) as Record<string, unknown>;
    assert.equal(row.test_type, body.test_type); assert.equal(row.publish_status, 'draft');
    assert.equal(row.chip_model, body.test_type === 'chip' ? 'MAT821' : body.test_type === 'tool' ? '' : 'MAT130V300');
  }
});

test('classification errors reject the complete edit before renaming or changing stored metadata', async t => {
  const s = setup(); t.after(() => s.db.close());
  const before = s.row();
  const response = await s.request('PUT', { id: 1, name: 'Should not change', test_type: 'chip', firmware_version: 'V4.2.5' });
  assert.equal(response.status, 400); assert.deepEqual(s.row(), before);
  assert.equal((await s.request('POST', { name: 'Invalid', test_type: 'unknown' })).status, 400);
});

test('classification changes preserve project identity and existing lifecycle', async t => {
  const s = setup(); t.after(() => s.db.close());
  assert.equal((await s.request('PUT', { id: 1, test_type: 'chip', firmware_version: '', name: 'MAT130V300' })).status, 200);
  assert.equal(s.row().id, 1); assert.equal(s.row().publish_status, 'published');
  assert.equal(s.row().chip_model, 'MAT130V300'); assert.equal(s.row().firmware_version, '');
});

test('ordinary users and signed-out users cannot create or reclassify projects', async t => {
  for (const username of ['tester', null]) {
    const s = setup(username); t.after(() => s.db.close());
    const expected = username ? 403 : 401;
    assert.equal((await s.request('POST', { name: 'Unauthorized', test_type: 'tool' })).status, expected);
    assert.equal((await s.request('PUT', { id: 1, test_type: 'tool' })).status, expected);
    assert.equal(s.row().test_type, 'firmware');
  }
});
