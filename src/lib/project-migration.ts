import type Database from 'better-sqlite3';
import { suggestClassification } from './project-classification';

export function migrateProjectClassification(db: Database.Database) {
  db.transaction(() => {
    const columns = new Set((db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(c => c.name));
    // The column is the migration marker. Never reclassify edited projects on restart.
    if (columns.has('test_type')) return;
    db.exec(`ALTER TABLE projects ADD COLUMN test_type TEXT NOT NULL DEFAULT 'firmware' CHECK(test_type IN ('firmware', 'chip', 'tool'));
      ALTER TABLE projects ADD COLUMN chip_model TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN firmware_version TEXT NOT NULL DEFAULT '';`);
    const update = db.prepare('UPDATE projects SET chip_model = ?, firmware_version = ? WHERE id = ?');
    for (const project of db.prepare('SELECT id, name FROM projects').all() as { id: number; name: string }[]) {
      const suggestion = suggestClassification(project.name);
      // Existing projects are firmware tests; ambiguous names stay available for manual classification.
      update.run(suggestion.chip_model, suggestion.firmware_version, project.id);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_classification ON projects(test_type, chip_model)');
  })();
}
