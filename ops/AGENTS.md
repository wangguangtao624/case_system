# Operations boundaries

- 10.26.10.12 is live production. Do development, installs, and builds on 10.26.10.38.
- Preserve existing user changes. Never reset, clean, checkout, or pull over a dirty production tree.
- Backups live on 38 as `casebackup` in `/srv/case-system/backups`; development uses `wangguangtao` and cannot access that directory.
- Never copy the production SSH private key, GitHub private key, JWT secret, environment files, or active sessions into development.
- Restore only into a new isolated destination. Testing data never replaces production data.
- Test snapshots include real business information; they are not anonymized. Bind test services to loopback until access controls and test accounts are arranged.
- Do not import application modules to inspect or back up production: the database initializer performs writes.
- Only count a remote backup as successful after remote hash, SQLite integrity, and attachment-reference verification.
- Keep a single production writer. Source-code merges do not merge SQLite databases.
- Use the runbook for releases, record exact artifact/commit/check evidence, and require the user's acceptance for a future feature release unless already explicitly authorized in the session.
- Once an operation is authorized, complete its documented steps without repeatedly requesting confirmation.
- During production incidents, collect evidence and use the established recovery plan. Never automatically restore an old database or deploy AI-generated fixes.
- Report actual monitoring/notification coverage. Persistent sampling does not mean a Codex chat is continuously running.
