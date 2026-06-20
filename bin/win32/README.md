Place the Windows sqlite3 runtime here before building the Win7 package.

Use the project helper to download the pinned Win7-compatible SQLite CLI:

```bash
pnpm run prepare:win-sqlite
```

The helper uses SQLite `sqlite-tools-win32-x86-3410000.zip` and verifies its
SHA3-256 before copying `sqlite3.exe` into this directory. The 32-bit CLI runs
on Windows 7 x64 and avoids newer Windows entry-point dependencies.
