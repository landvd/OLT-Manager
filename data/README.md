# Seed Data

This directory keeps only sanitized example seed files in git.

- `olts.example.json`: local OLT examples with documentation IPs and empty Telnet credentials.
- `pon-ports.example.json`: local PON ledger examples for UI and parser debugging.

Runtime files are ignored by git:

- `olts.json`
- `pon-ports.json`
- `*.sqlite`
- `*.sqlite-*`

Use `pnpm run reset:data` to reset local development data from the example seed.
