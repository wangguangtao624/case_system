#!/bin/bash
# Build/test only on 38. Never run inside the production working directory.
set -Eeuo pipefail
hostname -I | tr ' ' '\n' | grep -qx '10.26.10.38' || { echo 'Build is allowed only on 10.26.10.38'; exit 1; }
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo 'Commit the candidate before validation'; exit 1; }
[[ -f data/platform.db ]] || { echo 'Explicit isolated test database is required'; exit 1; }
export PATH="$HOME/case-system/runtime/node20/bin:$PATH"
export APP_WORKSPACE_PATH="$ROOT" APP_RUNTIME_ENV=PROD NODE_ENV=production
export JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
REPORT="$HOME/case-system/validation/$(git rev-parse HEAD)"
mkdir -p "$REPORT"
exec 9>"$HOME/case-system/build.lock"
flock -n 9 || { echo 'Another build is running'; exit 1; }
date --iso-8601=seconds > "$REPORT/started.txt"
git rev-parse HEAD > "$REPORT/commit.txt"
node --version > "$REPORT/node-version.txt"
pnpm --version > "$REPORT/pnpm-version.txt"
pnpm install --frozen-lockfile > "$REPORT/install.log" 2>&1
pnpm exec tsc --noEmit --incremental false > "$REPORT/types.log" 2>&1
pnpm lint > "$REPORT/lint.log" 2>&1
python3 -m unittest discover -s ops -p 'test_*.py' > "$REPORT/ops-tests.log" 2>&1
pnpm exec next build > "$REPORT/build.log" 2>&1
pnpm exec tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify > "$REPORT/server-build.log" 2>&1
git diff --exit-code -- pnpm-lock.yaml package.json > "$REPORT/lock-check.log"
date --iso-8601=seconds > "$REPORT/checks-passed.txt"
echo "Checks passed: $REPORT. Browser/business acceptance and migration rehearsal remain mandatory."
