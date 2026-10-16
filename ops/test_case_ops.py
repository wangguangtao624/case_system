"""Recovery-boundary tests; fixtures never use real production data."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('case_ops', Path(__file__).with_name('case_ops.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / 'production'
        self.snapshot = self.base / 'snapshot'
        self.original_state = ops.STATE
        ops.STATE = self.base / 'state'
        (self.snapshot / 'data').mkdir(parents=True)
        (self.snapshot / 'uploads').mkdir()
        (self.snapshot / 'uploads/a.txt').write_text('attachment')
        with sqlite3.connect(self.snapshot / 'data/platform.db') as db:
            db.executescript('CREATE TABLE files(id INTEGER PRIMARY KEY,storage_path TEXT);'
                             'CREATE TABLE settings(key TEXT,value TEXT);'
                             'CREATE TABLE active_sessions(id INTEGER);')
            db.execute('INSERT INTO files VALUES(1,?)', (str(self.source / 'uploads/a.txt'),))
            db.execute('INSERT INTO settings VALUES(?,?)', ('storage_path', str(self.source / 'uploads')))
            db.execute('INSERT INTO active_sessions VALUES(1)')
        files = [{'path': str(p.relative_to(self.snapshot)), 'size': p.stat().st_size, 'sha256': ops.sha(p)}
                 for p in self.snapshot.rglob('*') if p.is_file()]
        ops.write_json(self.snapshot / 'manifest.json', {'format':'case-system-backup-v1',
            'source_root':str(self.source), 'files':files, 'rows':{'files':1,'settings':1,'active_sessions':1}})
        ops.write_json(ops.STATE / 'config.json', {'production_root':str(self.source)})

    def tearDown(self):
        ops.STATE = self.original_state
        self.temp.cleanup()

    def test_valid_snapshot(self):
        self.assertEqual(ops.verify(self.snapshot)['attachments'], 1)

    def test_modified_attachment_is_rejected(self):
        (self.snapshot / 'uploads/a.txt').write_text('tampered!!')
        with self.assertRaisesRegex(RuntimeError, 'Checksum'):
            ops.verify(self.snapshot)

    def test_missing_attachment_is_rejected(self):
        (self.snapshot / 'uploads/a.txt').unlink()
        with self.assertRaisesRegex(RuntimeError, 'Missing'):
            ops.verify(self.snapshot)

    def test_manifest_cannot_escape_snapshot(self):
        m=ops.read_json(self.snapshot / 'manifest.json')
        m['files'][0]['path']='../outside'
        ops.write_json(self.snapshot / 'manifest.json',m)
        with self.assertRaises(RuntimeError):
            ops.verify(self.snapshot)

    def test_restore_never_overwrites_production(self):
        with self.assertRaisesRegex(RuntimeError, 'unsafe'):
            ops.restore_test(self.snapshot,self.source)

    def test_restore_never_overwrites_existing_directory(self):
        with self.assertRaisesRegex(RuntimeError,'must not exist'):
            ops.restore_test(self.snapshot,self.snapshot)

    def test_restore_rewrites_paths_and_invalidates_sessions(self):
        dest=self.base/'restored'
        ops.restore_test(self.snapshot,dest)
        with sqlite3.connect(dest/'data/platform.db') as db:
            self.assertEqual(db.execute('SELECT storage_path FROM files').fetchone()[0],str(dest/'uploads/a.txt'))
            self.assertEqual(db.execute('SELECT count(*) FROM active_sessions').fetchone()[0],0)
        self.assertEqual((dest/'data/.jwt_secret').stat().st_mode & 0o777,0o600)
        self.assertFalse((dest/'.env.production').exists())

    def test_online_backup_includes_uncheckpointed_wal(self):
        src=sqlite3.connect(self.base/'live.db')
        try:
            src.execute('PRAGMA journal_mode=WAL')
            src.execute('PRAGMA wal_autocheckpoint=0')
            src.execute('CREATE TABLE test(value TEXT)')
            src.execute("INSERT INTO test VALUES('latest committed data')")
            src.commit()
            self.assertTrue((self.base/'live.db-wal').exists())
            with ops.connection(self.base/'live.db') as reader, sqlite3.connect(self.base/'copy.db') as dst:
                reader.backup(dst,pages=1)
            with sqlite3.connect(self.base/'copy.db') as dst:
                self.assertEqual(dst.execute('SELECT value FROM test').fetchone()[0],'latest committed data')
        finally:
            src.close()


if __name__ == '__main__':
    unittest.main()
