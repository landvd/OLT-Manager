# Seed Data

This directory keeps only sanitized example seed files in git.

- `olts.example.json`: local OLT examples with documentation IPs and empty Telnet credentials.
- `pon-ports.example.json`: local PON ledger examples for UI and parser debugging.
- `sample-seed/`: optional ignored output from `pnpm run seed:sample`.

Runtime files are ignored by git:

- `olts.json`
- `pon-ports.json`
- `*.sqlite`
- `*.sqlite-*`

Recommended safe debugging flow:

```bash
pnpm run seed:sample
node scripts/reset-data.mjs --yes --data-dir /tmp/olt-manager-debug-data --seed-dir data/sample-seed
OLT_MANAGER_DATA_DIR=/tmp/olt-manager-debug-data pnpm start
```

This keeps the real `data/` runtime database untouched.
