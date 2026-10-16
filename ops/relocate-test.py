#!/usr/bin/env python3
"""Rewrite ONLY a restored test clone; never connect to the production database."""
import argparse
import json
import os
from pathlib import Path
import sqlite3

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('root')
a=p.parse_args()
root=Path(a.root).resolve()
allowed=Path.home()/'case-system'
if not root.is_relative_to(allowed) or not (root/'RESTORE-TEST.json').is_file():
    raise SystemExit('Only a marked restore beneath ~/case-system is allowed')
with sqlite3.connect(root/'data/platform.db') as db:
    for table in ('files','project_space_files','bug_attachments','issue_ticket_attachments'):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
            continue
        for row_id,stored in db.execute('SELECT id,storage_path FROM '+table).fetchall():
            old=Path(stored)
            parts=old.parts
            if 'uploads' not in parts:
                raise SystemExit('Unrecognized test attachment path; do not guess')
            target=root.joinpath(*parts[parts.index('uploads'):])
            if not target.is_file():
                raise SystemExit('Missing restored attachment: '+str(target))
            db.execute('UPDATE '+table+' SET storage_path=? WHERE id=?',(str(target),row_id))
    db.execute("UPDATE settings SET value=? WHERE key='storage_path'",(str(root/'uploads'),))
    db.execute('DELETE FROM active_sessions')
(root/'data/.jwt_secret').write_text(os.urandom(32).hex())
(root/'data/.jwt_secret').chmod(0o600)
print(json.dumps({'test_root':str(root),'sessions_cleared':True,'production_secret_copied':False}))
