#!/usr/bin/env python3
"""Read-only release gate. Passing is not a deployment and does not waive acceptance."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--candidate',required=True,help='Exact accepted full commit SHA')
p.add_argument('--report',required=True,help='Validation report directory copied from 38')
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
report=Path(a.report).resolve()
def git(*args):
    return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
errors=[]
if '10.26.10.12' not in subprocess.check_output(['hostname','-I'],text=True).split():
    errors.append('Release preflight must run on 12')
if git('status','--porcelain','--untracked-files=normal'):
    errors.append('Production working tree is dirty; preserve and reconcile current changes first')
if len(a.candidate)!=40 or any(c not in '0123456789abcdef' for c in a.candidate):
    errors.append('Candidate must be a full commit SHA')
for name in ('checks-passed.txt','commit.txt','browser-accepted.json','artifact-sha256.txt'):
    if not (report/name).is_file():
        errors.append('Missing release evidence: '+name)
if (report/'commit.txt').is_file() and (report/'commit.txt').read_text().strip()!=a.candidate:
    errors.append('Validation commit differs from candidate')
if (report/'browser-accepted.json').is_file():
    acceptance=json.loads((report/'browser-accepted.json').read_text())
    if acceptance.get('commit')!=a.candidate or not acceptance.get('accepted_by_user'):
        errors.append('User acceptance does not match candidate')
state=Path.home()/'.local/state/case-system-ops'
backup=json.loads((state/'backup.json').read_text()) if (state/'backup.json').exists() else {}
stamp=backup.get('remote',{}).get('verified_at')
if not stamp or (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(stamp)).total_seconds()>900:
    errors.append('A verified remote backup from the last 15 minutes is required')
if backup.get('running') or backup.get('error'):
    errors.append('Backup is running or the last attempt failed')
print(json.dumps({'eligible':not errors,'errors':errors,'candidate':a.candidate,
                  'production_commit':git('rev-parse','HEAD'),'deploy_performed':False},ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
