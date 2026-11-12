import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { suggestClassification, validateClassification, groupProjects } from '../src/lib/project-classification';
import { migrateProjectClassification } from '../src/lib/project-migration';

test('recognizes chip and firmware names including spaced silicon revisions', () => {
  assert.deepEqual(suggestClassification('MAT821'), { test_type: 'chip', chip_model: 'MAT821', firmware_version: '' });
  assert.deepEqual(suggestClassification('MAT130V300'), { test_type: 'chip', chip_model: 'MAT130V300', firmware_version: '' });
  assert.deepEqual(suggestClassification('MAT130 V300 V4.2.5_DVP'), { test_type: 'firmware', chip_model: 'MAT130V300', firmware_version: 'V4.2.5_DVP' });
  assert.equal(suggestClassification('MAT130YV200_FW_Test_Case_公版v4.1.9').chip_model, 'MAT130YV200');
  assert.equal(suggestClassification('MAT130 v300 4.2.4_DVP').chip_model, 'MAT130V300');
  assert.equal(suggestClassification('MAT130V300 v4.2.6 T19 shengtaike').chip_model, 'MAT130V300');
});

test('migration preserves existing firmware projects and case references and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE cases (id INTEGER, project_id INTEGER, test_result TEXT);
      INSERT INTO projects VALUES (1, 'MAT130 V300 V4.2.5_DVP'), (2, 'MT821'), (3, '示例');
      INSERT INTO cases VALUES (10, 1, 'Pass');`);
    migrateProjectClassification(db);
    assert.deepEqual(db.prepare('SELECT test_type, chip_model, firmware_version FROM projects WHERE id = 1').get(), { test_type: 'firmware', chip_model: 'MAT130V300', firmware_version: 'V4.2.5_DVP' });
    assert.equal((db.prepare('SELECT test_type FROM projects WHERE id = 2').get() as { test_type: string }).test_type, 'firmware');
    assert.deepEqual(db.prepare('SELECT * FROM cases').get(), { id: 10, project_id: 1, test_result: 'Pass' });
    db.exec("UPDATE projects SET test_type = 'tool', chip_model = '', firmware_version = '' WHERE id = 1");
    migrateProjectClassification(db);
    assert.equal((db.prepare('SELECT test_type FROM projects WHERE id = 1').get() as { test_type: string }).test_type, 'tool');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n, 3);
  } finally { db.close(); }
});

test('explicit classification validates required fields and distinguishes chip from firmware', () => {
  assert.deepEqual(validateClassification({ test_type: 'chip', chip_model: ' mat130 v300 ' }), { test_type: 'chip', chip_model: 'MAT130V300', firmware_version: '' });
  assert.throws(() => validateClassification({ test_type: 'firmware', chip_model: 'MAT821' }), /固件版本/);
  assert.throws(() => validateClassification({ test_type: 'chip', chip_model: 'MAT821', firmware_version: 'V1.0.0' }), /不需要固件版本/);
  assert.throws(() => validateClassification({ test_type: 'other' }), /测试类型/);
  assert.throws(() => validateClassification({ test_type: 'firmware', chip_model: 123 }), /文本/);
  assert.deepEqual(validateClassification({ test_type: 'tool' }), { test_type: 'tool', chip_model: '', firmware_version: '' });
});

test('firmware groups by normalized chip while chip and tool tests remain separate', () => {
  const groups = groupProjects([
    { testType: 'firmware' as const, chipModel: 'MAT130 V300' },
    { testType: 'firmware' as const, chipModel: 'mat130v300' },
    { testType: 'chip' as const, chipModel: 'MAT130V300' },
    { testType: 'firmware' as const, chipModel: 'MAT821' },
    { testType: 'tool' as const }, { testType: 'firmware' as const },
  ]);
  assert.equal(groups.length, 5);
  assert.equal(groups.find(g => g.key === 'firmware:MAT130V300')?.projects.length, 2);
  assert.equal(groups.find(g => g.key === 'chip:MAT130V300')?.projects.length, 1);
  assert.equal(groups.find(g => g.key === 'firmware:待分类芯片')?.projects.length, 1);
});
