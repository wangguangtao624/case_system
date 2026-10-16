#!/usr/bin/env python3
"""Forced SSH command: Git protocol only, against one dedicated bare repository."""
import os
from pathlib import Path
import shlex
import sys

parts=shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND',''))
if len(parts)!=2 or parts[0] not in ('git-upload-pack','git-receive-pack') or parts[1]!='/case-system.git':
    sys.exit('Only the Case System Git relay is permitted')
repo=Path.home()/'.local/share/case-system-git-relay.git'
os.execv('/usr/bin/'+parts[0],[parts[0],str(repo)])
