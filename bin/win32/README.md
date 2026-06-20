Place the Windows sqlite3 runtime here before building the Win7 package.

The release workflow copies `sqlite3.exe` into this directory before running
electron-builder. Local builds can use the same layout:

```powershell
mkdir bin\win32
copy C:\path\to\sqlite3.exe bin\win32\sqlite3.exe
pnpm run dist:win
```
