import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { initWorkbenches, hashWorkbenchToken, authenticateWorkbench } from '../src/lib/workbenches';

test('only the enabled workbench with the correct bearer credential can authenticate', () => {
 const db=new Database(':memory:');
 try {
  initWorkbenches(db);initWorkbenches(db);
  const token='a'.repeat(43);db.prepare('INSERT INTO automation_workbenches(id,name,token_hash) VALUES(?,?,?)').run('w1','测试台',hashWorkbenchToken(token));
  assert.equal(authenticateWorkbench(db,'Bearer '+token)?.id,'w1');
  assert.equal(authenticateWorkbench(db,'Bearer '+'b'.repeat(43)),null);
  assert.equal(authenticateWorkbench(db,token),null);
  db.prepare('UPDATE automation_workbenches SET enabled=0').run();
  assert.equal(authenticateWorkbench(db,'Bearer '+token),null);
 } finally { db.close(); }
});
