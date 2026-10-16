#!/usr/bin/env python3
"""Case System operations. Standard library only; never imports application code."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

STATE = Path(os.environ.get('CASE_OPS_STATE', str(Path.home() / '.local/state/case-system-ops')))
TABLES = ('files', 'project_space_files', 'bug_attachments', 'issue_ticket_attachments')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.chmod(0o600)
    os.replace(temp, path)


def run(args, timeout=1800, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, timeout=timeout,
                          text=True, capture_output=True, **kwargs).stdout.strip()


@contextlib.contextmanager
def lock(name):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / (name + '.lock')).open('a') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(name + ' already running')
        yield


def config():
    return read_json(STATE / 'config.json') or {}


def connection(db):
    return sqlite3.connect(Path(db).resolve().as_uri() + '?mode=ro', uri=True, timeout=10)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def ssh_args(remote):
    return ['ssh', '-i', remote['identity'], '-p', str(remote.get('port', 22)),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8',
            remote['user'] + '@' + remote['host']]


def remote_run(remote, args, timeout=60):
    return run(ssh_args(remote) + [shlex.join([str(a) for a in args])], timeout=timeout)


def verify(snapshot):
    snapshot = Path(snapshot).resolve()
    manifest = read_json(snapshot / 'manifest.json')
    if not manifest or manifest.get('format') != 'case-system-backup-v1':
        raise RuntimeError('Not a recognized backup')
    for item in manifest['files']:
        path = (snapshot / item['path']).resolve()
        if not path.is_relative_to(snapshot) or not path.is_file():
            raise RuntimeError('Missing or unsafe file: ' + item['path'])
        if path.stat().st_size != item['size'] or sha(path) != item['sha256']:
            raise RuntimeError('Checksum mismatch: ' + item['path'])
    with connection(snapshot / 'data/platform.db') as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('SQLite integrity check failed')
        for table, expected in manifest['rows'].items():
            if db.execute('SELECT count(*) FROM "' + table + '"').fetchone()[0] != expected:
                raise RuntimeError('Row count mismatch: ' + table)
        referenced = 0
        for table in TABLES:
            if table not in manifest['rows']:
                continue
            for (stored,) in db.execute('SELECT storage_path FROM ' + table):
                path = Path(stored)
                if not path.is_absolute():
                    path = Path(manifest['source_root']) / path
                rel = path.relative_to(Path(manifest['source_root']))
                if not (snapshot / rel).is_file():
                    raise RuntimeError('Referenced attachment missing: ' + str(rel))
                referenced += 1
    return {'verified_at': now(), 'files': len(manifest['files']),
            'attachments': referenced, 'rows': manifest['rows'], 'snapshot': snapshot.name}


def snapshot_local(cfg):
    root = Path(cfg['production_root']).resolve()
    if not (root / 'data/platform.db').is_file():
        raise RuntimeError('Production database absent; refusing to create empty database')
    base = STATE / 'snapshots'
    base.mkdir(exist_ok=True, mode=0o700)
    tag = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:6]
    stage = base / ('.partial-' + tag)
    stage.mkdir(mode=0o700)
    (stage / 'data').mkdir(mode=0o700)
    if shutil.disk_usage(base).free < 6 * 1024**3:
        raise RuntimeError('Less than 6 GiB free for backup')
    deadline = time.monotonic() + 120
    def progress(*_):
        if time.monotonic() > deadline:
            raise RuntimeError('SQLite online backup timed out')
    with connection(root / 'data/platform.db') as src, sqlite3.connect(stage / 'data/platform.db') as dst:
        src.backup(dst, pages=256, progress=progress, sleep=0.05)
    # Snapshot DB first; later deletes/races fail reference checks instead of reporting success.
    previous = (base / 'latest').resolve() if (base / 'latest').exists() else None
    for directory in ('uploads', 'data/bug-feedback'):
        source = root / directory
        if source.exists():
            dest = stage / directory
            dest.mkdir(parents=True, exist_ok=True, mode=0o700)
            args = ['rsync', '-a', '--safe-links']
            if previous and (previous / directory).is_dir():
                args += ['--link-dest=' + str(previous / directory)]
            run(args + [str(source) + '/', str(dest) + '/'])
    for name in ('data/.jwt_secret', '.env', '.env.local', '.env.production', '.env.production.local'):
        source = root / name
        if source.is_file():
            shutil.copy2(source, stage / name)
            (stage / name).chmod(0o600)
    rows = {}
    with connection(stage / 'data/platform.db') as db:
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            rows[table] = db.execute('SELECT count(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
    files = []
    for path in sorted(stage.rglob('*')):
        if path.is_symlink():
            raise RuntimeError('Symlinks in backup are not supported')
        if path.is_file():
            files.append({'path': str(path.relative_to(stage)), 'size': path.stat().st_size, 'sha256': sha(path)})
    manifest = {'format': 'case-system-backup-v1', 'created_at': now(),
                'source_host': socket.gethostname(), 'source_root': str(root), 'rows': rows, 'files': files,
                'consistency': 'online DB snapshot; attachments copied afterwards, all referenced files checked; not a write-frozen filesystem snapshot',
                'code_commit': run(['git', '-C', root, 'rev-parse', 'HEAD'])}
    write_json(stage / 'manifest.json', manifest)
    result = verify(stage)
    final = base / tag
    stage.rename(final)
    temp = base / ('.latest-' + uuid.uuid4().hex)
    temp.symlink_to(tag)
    os.replace(temp, base / 'latest')
    result['snapshot'] = tag
    return final, result


def backup():
    with lock('backup'):
        cfg = config()
        status = read_json(STATE / 'backup.json', {})
        status.update({'last_attempt': now(), 'running': True, 'error': None})
        write_json(STATE / 'backup.json', status)
        try:
            snapshot, local = snapshot_local(cfg)
            status.update({'local': local, 'local_path': str(snapshot)})
            write_json(STATE / 'backup.json', status)
            remote = cfg.get('backup_remote')
            if not remote:
                raise RuntimeError('Remote backup is not configured')
            remote_base = remote['base']
            if not remote_base.startswith('/') or any(c not in '/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in remote_base):
                raise RuntimeError('Unsafe remote base')
            tag = snapshot.name
            stage = remote_base + '/.partial-' + tag
            remote_run(remote, ['mkdir', '-p', stage])
            # --link-dest is resolved relative to destination; no --inplace and no deletion of previous snapshots.
            prev = remote_run(remote, ['sh', '-c', 'if [ -L "$1/latest" ]; then readlink -f "$1/latest"; fi', 'sh', remote_base])
            args = ['rsync', '-a', '--safe-links', '-e', shlex.join(ssh_args(remote)[:-1])]
            if prev.startswith(remote_base + '/') and '/.partial-' not in prev:
                args += ['--link-dest=' + prev]
            run(args + [str(snapshot) + '/', remote['user'] + '@' + remote['host'] + ':' + stage + '/'])
            result = json.loads(remote_run(remote, ['python3', remote['tool'], 'verify', stage, '--record'], timeout=1800))
            remote_run(remote, ['mv', stage, remote_base + '/' + tag])
            remote_run(remote, ['ln', '-sfn', tag, remote_base + '/latest'])
            result['snapshot'] = tag
            result['host'] = remote['host']
            status.update({'remote': result, 'error': None})
            remote_run(remote, ['python3', remote['tool'], 'prune', remote_base], timeout=120)
            # Prune only complete, owned snapshots; remote cleanup is explicit, never a mirror --delete.
            completed = sorted(p for p in (STATE / 'snapshots').iterdir()
                               if p.is_dir() and not p.is_symlink() and not p.name.startswith('.')
                               and (p / 'manifest.json').is_file())
            for old in completed[:-cfg.get('local_keep', 6)]:
                shutil.rmtree(old)
        except Exception as exc:
            status['error'] = type(exc).__name__ + ': ' + str(exc)[:300]
            raise
        finally:
            status.update({'running': False, 'finished_at': now()})
            write_json(STATE / 'backup.json', status)


def host_metrics():
    mem = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        mem[key] = int(value.strip().split()[0]) * 1024
    disk = shutil.disk_usage(Path.home())
    backup_state = read_json(STATE / 'backup.json', {})
    return {'hostname': socket.gethostname(), 'memory_total': mem['MemTotal'],
            'memory_available': mem['MemAvailable'], 'swap_used': mem['SwapTotal'] - mem['SwapFree'],
            'disk_total': disk.total, 'disk_used': disk.used, 'disk_free': disk.free,
            'load': list(os.getloadavg()), 'cpus': os.cpu_count(),
            'backup_attempt': {'failed': bool(backup_state.get('error')), 'running': backup_state.get('running', False),
                               'last_attempt': backup_state.get('last_attempt')},
            'memory_pressure': Path('/proc/pressure/memory').read_text() if Path('/proc/pressure/memory').exists() else None}


def prune(base):
    """Keep 48 hourly snapshots and one per day for 30 days; only our complete snapshots."""
    base = Path(base).resolve()
    latest = (base / 'latest').resolve()
    snapshots = sorted((p for p in base.iterdir() if not p.is_symlink() and p.is_dir()
                        and not p.name.startswith('.') and (p / 'verification.json').is_file()), reverse=True)
    keep = {p.name for p in snapshots[:48]} | {latest.name}
    days = set()
    cutoff = time.time() - 30 * 86400
    for p in snapshots:
        manifest = read_json(p / 'manifest.json', {})
        if manifest.get('format') != 'case-system-backup-v1':
            continue
        stamp = dt.datetime.fromisoformat(manifest['created_at'])
        day = stamp.date().isoformat()
        if stamp.timestamp() >= cutoff and day not in days:
            keep.add(p.name)
            days.add(day)
    removed = 0
    for p in snapshots:
        if p.name not in keep and read_json(p / 'manifest.json', {}).get('format') == 'case-system-backup-v1':
            shutil.rmtree(p)
            removed += 1
    print(json.dumps({'retained': len(snapshots) - removed, 'removed': removed}))


def probe(url):
    begin = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return {'ok': response.status == 200, 'status': response.status, 'ms': round((time.monotonic() - begin) * 1000)}
    except Exception as exc:
        return {'ok': False, 'error': type(exc).__name__, 'ms': round((time.monotonic() - begin) * 1000)}


def age(stamp):
    return time.time() - dt.datetime.fromisoformat(stamp).timestamp() if stamp else None


def monitor():
    with lock('monitor'):
        cfg = config()
        metrics = host_metrics()
        observer = cfg.get('role') == 'backup-observer'
        http = {name: probe(url) for name, url in cfg['health_urls'].items()}
        backup_state = read_json(STATE / 'backup.json', {})
        if observer:
            verified = read_json(Path(cfg['backup_base']) / 'latest/verification.json', {})
            backup_state = {'remote': verified, 'running': False}
        old = read_json(STATE / 'status.json', {})
        failures = old.get('failures', 0) + 1 if not all(p['ok'] for p in http.values()) else 0
        lowmem = old.get('low_memory_samples', 0) + 1 if metrics['memory_available'] / metrics['memory_total'] < .2 else 0
        alerts = []
        if failures >= 3:
            alerts.append('生产 HTTP 连续至少 3 次失败')
        if lowmem >= 10 and not observer:
            alerts.append('可用内存低于 20% 持续至少 10 次采样')
        if metrics['disk_used'] / metrics['disk_total'] > .8:
            alerts.append(('38' if observer else '生产') + '磁盘使用超过 80%')
        remote_age = age(backup_state.get('remote', {}).get('verified_at'))
        if remote_age is None or remote_age > 7200:
            alerts.append('38 上的备份尚未验证或已超过 2 小时')
        if backup_state.get('error'):
            alerts.append('最近一次备份失败')
        remote = None
        if cfg.get('monitor_remote'):
            try:
                r = cfg['monitor_remote']
                remote = json.loads(remote_run(r, ['python3', r['tool'], 'metrics'], timeout=15))
                if remote['disk_used'] / remote['disk_total'] > .8:
                    alerts.append(('生产' if observer else '38') + '磁盘使用超过 80%')
            except Exception as exc:
                remote = {'error': type(exc).__name__}
                alerts.append('无法采集 ' + ('12' if observer else '38') + ' 状态')
        if observer and remote and not remote.get('error'):
            lowmem = old.get('low_memory_samples', 0) + 1 if remote['memory_available'] / remote['memory_total'] < .2 else 0
            if lowmem >= 10:
                alerts.append('生产可用内存低于 20% 持续至少 10 次采样')
            if remote.get('backup_attempt', {}).get('failed'):
                alerts.append('12 报告最近一次备份失败')
        drill_state = read_json(STATE / 'restore-drill.json', {})
        if observer and drill_state.get('ok') is False:
            alerts.append('最近一次恢复演练失败')
        if observer and drill_state.get('finished_at') and age(drill_state['finished_at']) > 35 * 86400:
            alerts.append('恢复演练超过 35 天未完成')
        result = {'sampled_at': now(), 'production': remote if observer else metrics,
                  'http': http, 'development': metrics if observer else remote,
                  'backup': backup_state, 'alerts': alerts, 'failures': failures, 'low_memory_samples': lowmem,
                  'restore_drill': drill_state,
                  'notification': 'dashboard-and-local-events; no external push configured'}
        if old.get('alerts') != alerts:
            events = read_json(STATE / 'events.json', [])
            events.append({'at': now(), 'alerts': alerts, 'previous': old.get('alerts', [])})
            write_json(STATE / 'events.json', events[-500:])
        write_json(STATE / 'status.json', result)
        history = read_json(STATE / 'history.json', [])
        history.append({'at': result['sampled_at'], 'available': metrics['memory_available'],
                        'disk_free': metrics['disk_free'], 'http_ok': all(p['ok'] for p in http.values())})
        write_json(STATE / 'history.json', history[-1440:])
        print(json.dumps(result, ensure_ascii=False))


def restore_test(snapshot, destination):
    snapshot, dest = Path(snapshot).resolve(), Path(destination).resolve()
    cfg = config()
    prod = Path(cfg['production_root']).resolve()
    backup_root = (STATE / 'snapshots').resolve()
    if dest == prod or dest.is_relative_to(prod) or prod.is_relative_to(dest) or dest.is_relative_to(backup_root):
        raise RuntimeError('Refusing unsafe restore destination')
    if dest.exists():
        raise RuntimeError('Restore destination must not exist')
    result = verify(snapshot)
    dest.mkdir(parents=True, mode=0o700)
    shutil.copytree(snapshot / 'uploads', dest / 'uploads')
    (dest / 'data').mkdir(mode=0o700)
    shutil.copy2(snapshot / 'data/platform.db', dest / 'data/platform.db')
    if (snapshot / 'data/bug-feedback').is_dir():
        shutil.copytree(snapshot / 'data/bug-feedback', dest / 'data/bug-feedback')
    manifest = read_json(snapshot / 'manifest.json')
    with sqlite3.connect(dest / 'data/platform.db') as db:
        for table in TABLES:
            if table in manifest['rows']:
                for row_id, stored in db.execute('SELECT id, storage_path FROM ' + table).fetchall():
                    old = Path(stored)
                    if not old.is_absolute():
                        old = Path(manifest['source_root']) / old
                    new = dest / old.relative_to(manifest['source_root'])
                    db.execute('UPDATE ' + table + ' SET storage_path=? WHERE id=?', (str(new), row_id))
        db.execute("UPDATE settings SET value=? WHERE key='storage_path'", (str(dest / 'uploads'),))
        if 'active_sessions' in manifest['rows']:
            db.execute('DELETE FROM active_sessions')
    (dest / 'data/.jwt_secret').write_text(os.urandom(32).hex())
    (dest / 'data/.jwt_secret').chmod(0o600)
    # Do not restore production environment secrets into test.
    write_json(dest / 'RESTORE-TEST.json', {**result, 'restored_at': now(), 'production_secrets_copied': False,
                                          'warning': 'Contains production business data; restrict access; not anonymized'})
    print(json.dumps({'destination': str(dest), 'verified': result}, ensure_ascii=False))


def drill():
    """Monthly database/file restore exercise on 38; application acceptance is separate."""
    with lock('restore-drill'):
        cfg = config()
        if cfg.get('role') != 'backup-observer':
            raise RuntimeError('Restore drill is allowed only on the backup observer')
        base = STATE / 'restore-drills'
        base.mkdir(exist_ok=True, mode=0o700)
        dest = base / dt.datetime.now(dt.timezone.utc).strftime('restore-%Y%m%dT%H%M%SZ')
        try:
            restore_test(Path(cfg['backup_base']) / 'latest', dest)
            with connection(dest / 'data/platform.db') as db:
                if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise RuntimeError('Restored SQLite is corrupt')
                count = db.execute('SELECT count(*) FROM active_sessions').fetchone()[0]
                if count:
                    raise RuntimeError('Restored sessions were not invalidated')
            write_json(STATE / 'restore-drill.json', {'finished_at': now(), 'ok': True,
                'destination': str(dest), 'scope': 'database integrity, hashes, attachment references, path rewrite and session invalidation; not full application acceptance'})
            old = sorted(p for p in base.iterdir() if p.is_dir() and not p.is_symlink()
                         and p.name.startswith('restore-') and (p / 'RESTORE-TEST.json').is_file())
            for path in old[:-2]:
                shutil.rmtree(path)
        except Exception as exc:
            write_json(STATE / 'restore-drill.json', {'finished_at': now(), 'ok': False, 'error': type(exc).__name__})
            raise


def serve():
    with lock('dashboard'):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                route = self.path.split('?', 1)[0]
                if route == '/':
                    body = Path(__file__).with_name('dashboard.html').read_bytes()
                    content = 'text/html; charset=utf-8'
                elif route in ('/status.json', '/events.json', '/history.json'):
                    path = STATE / route[1:]
                    body = path.read_bytes() if path.exists() else b'{}'
                    content = 'application/json'
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', content)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_):
                pass
        http.server.ThreadingHTTPServer(('127.0.0.1', config().get('dashboard_port', 8765)), Handler).serve_forever()


def ensure_dashboard():
    # OS lock, rather than a successful connection to an unrelated process, identifies our daemon.
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / 'dashboard.lock').open('a') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
    with (STATE / 'dashboard.log').open('a') as log:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'serve'],
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    for name in ('backup', 'monitor', 'metrics', 'serve', 'ensure-dashboard', 'drill'):
        subs.add_parser(name)
    check = subs.add_parser('verify')
    check.add_argument('snapshot')
    check.add_argument('--record', action='store_true')
    restore = subs.add_parser('restore-test')
    restore.add_argument('snapshot')
    restore.add_argument('destination')
    retention = subs.add_parser('prune')
    retention.add_argument('base')
    args = parser.parse_args()
    if args.command == 'verify':
        result = verify(args.snapshot)
        if args.record:
            result['snapshot'] = Path(args.snapshot).resolve().name.removeprefix('.partial-')
            write_json(Path(args.snapshot) / 'verification.json', result)
        print(json.dumps(result, ensure_ascii=False))
    elif args.command == 'restore-test':
        restore_test(args.snapshot, args.destination)
    elif args.command == 'prune':
        prune(args.base)
    elif args.command == 'metrics':
        print(json.dumps(host_metrics()))
    else:
        {'backup': backup, 'monitor': monitor, 'serve': serve, 'ensure-dashboard': ensure_dashboard, 'drill': drill}[args.command]()


if __name__ == '__main__':
    main()
