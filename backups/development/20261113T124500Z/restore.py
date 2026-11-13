#!/usr/bin/env python3
"""Restore this encrypted development backup into an empty directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def restore():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key', required=True, type=Path, help='Local recovery key file; never upload it to GitHub')
    parser.add_argument('--target', required=True, type=Path, help='New, empty restore directory')
    args = parser.parse_args()
    os.umask(0o077)
    base = Path(__file__).resolve().parent
    public = json.loads((base / 'backup.json').read_text())
    target = args.target.resolve()
    if target.exists() and any(target.iterdir()):
        raise RuntimeError('Target must be empty; refusing to overwrite data')
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = args.key.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='case-restore-') as temp:
        temp = Path(temp)
        archive = temp / 'snapshot.gpg'
        full_hash = hashlib.sha256()
        with archive.open('wb') as output:
            for item in public['parts']:
                part = base / item['name']
                if part.stat().st_size != item['size'] or digest(part) != item['sha256']:
                    raise RuntimeError('Part verification failed: ' + item['name'])
                with part.open('rb') as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        output.write(chunk)
                        full_hash.update(chunk)
        if full_hash.hexdigest() != public['encrypted_sha256']:
            raise RuntimeError('Archive verification failed')
        gnupg = temp / 'gnupg'
        gnupg.mkdir(mode=0o700)
        process = subprocess.Popen([
            'gpg', '--homedir', str(gnupg), '--batch', '--pinentry-mode', 'loopback',
            '--passphrase-file', str(key), '--no-symkey-cache', '--decrypt', str(archive),
        ], stdout=subprocess.PIPE)
        try:
            with tarfile.open(fileobj=process.stdout, mode='r|gz') as tar:
                for member in tar:
                    path = Path(member.name)
                    if not member.isfile() or path.is_absolute() or '..' in path.parts:
                        raise RuntimeError('Unsafe archive entry')
                    destination = target / path
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with tar.extractfile(member) as source, destination.open('wb') as output:
                        shutil.copyfileobj(source, output)
            if process.wait() != 0:
                raise RuntimeError('Decryption failed; restore is incomplete')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    manifest = json.loads((target / 'manifest.json').read_text())
    for item in manifest['files']:
        path = target / item['path']
        if path.stat().st_size != item['size'] or digest(path) != item['sha256']:
            raise RuntimeError('Restored file verification failed: ' + item['path'])
    with sqlite3.connect(target / 'data/platform.db') as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('Restored database integrity check failed')
        for table, expected in manifest['rows'].items():
            table_sql = '"' + table.replace('"', '""') + '"'
            if db.execute('SELECT COUNT(*) FROM ' + table_sql).fetchone()[0] != expected:
                raise RuntimeError('Restored row count mismatch: ' + table)
        old_root = Path(manifest['source_root'])
        tables = set(manifest['rows'])
        references = 0
        for table in ['files', 'project_space_files', 'bug_attachments', 'issue_ticket_attachments']:
            if table not in tables:
                continue
            columns = [row[1] for row in db.execute('PRAGMA table_info("' + table + '")')]
            if 'storage_path' not in columns:
                continue
            for row_id, stored in db.execute('SELECT id, storage_path FROM "' + table + '"').fetchall():
                path = Path(stored)
                relative = path.relative_to(old_root) if path.is_absolute() else path
                if relative.is_absolute() or '..' in relative.parts:
                    raise RuntimeError('Unsafe attachment path')
                new_path = target / relative
                if not new_path.is_file():
                    raise RuntimeError('Restored attachment missing')
                db.execute('UPDATE "' + table + '" SET storage_path = ? WHERE id = ?', (str(new_path), row_id))
                references += 1
        if references != manifest['attachment_references']:
            raise RuntimeError('Restored attachment reference count mismatch')
        db.execute("UPDATE settings SET value = ? WHERE key = 'storage_path'", (str(target / 'uploads'),))
    # An independent signing secret invalidates old sessions in the restored environment.
    secret = target / 'data/.jwt_secret'
    secret.write_text(secrets.token_hex(32))
    secret.chmod(0o600)
    (target / 'RESTORE_COMPLETE.json').write_text(json.dumps({
        'backup_id': public['id'], 'code_commit': manifest['code_commit'],
        'attachment_references': references, 'integrity': 'ok',
        'note': 'Storage paths rewritten and fresh session signing secret generated.',
    }, indent=2) + '\n')
    print('Restore verified:', target)
    print('Attachment references:', references)
    print('Use the matching code commit and APP_WORKSPACE_PATH=' + str(target))


if __name__ == '__main__':
    restore()
