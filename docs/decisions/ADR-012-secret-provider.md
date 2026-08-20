# ADR-012: Unified runtime credential provider

## Status

Accepted

## Context

OLT Manager currently has separate credential paths: OSS/NGB uses a migration-master-password encrypted SQLite record, while desktop-only flows can use Electron `safeStorage`. Future scheduled and automated read-only jobs need one boundary that works in Electron 22 on macOS/Windows 7 and in pure Node/Web processes without storing plaintext credentials.

This decision is intentionally limited to a provider seam. It does not migrate the existing SQLite schema or change API, Electron, Feishu, or device adapters.

## Decision

Add `src/secret-provider.mjs` with an injected backend interface:

- `safeStorage`: machine-bound Electron OS encryption, selected explicitly with `mode: "os"` or automatically when available and no master password is supplied. The provider does not import Electron, so Node tests and Web/server code remain independent.
- `masterPassword`: portable scrypt + AES-256-GCM encryption, selected with `mode: "portable"` or automatically when a master password is supplied. The master password is never returned in the envelope.

Both backends return a versioned envelope containing only a backend identifier, purpose, optional opaque reference, and ciphertext/cryptographic parameters. SQLite and backups may persist this envelope or an opaque reference, but never plaintext secrets, master passwords, OS sessions, Cookies, tokens, or device responses. Decryption is an explicit runtime operation and returns the secret only to the adapter that needs it.

`safeStorage` is not a cross-machine backup format. Portable envelopes are required for migration to another machine or for headless/Node automation. Automatic mode chooses the OS backend only when no portable master password was provided; callers that need portability must request `portable` explicitly.

## Integration contract

1. Add one provider instance at application composition time and inject it into repositories/adapters.
2. Replace direct password fields in persistence with a provider envelope or secret reference in a later database migration.
3. API responses expose `metadata()` only (`backend`, `purpose`, `reference`), never `open()` results.
4. Read-only scheduled jobs request the secret for the shortest possible operation and must not log it or put it in job records.
5. Existing `oss-credential-crypto.mjs` functions remain backward compatible; new generic helpers use a distinct purpose-bound AAD format.

## Consequences

- Desktop auto-login can be convenient without making a machine-bound secret portable.
- Web/Node and cross-platform restore have a deterministic encrypted envelope and do not require Electron.
- Losing the portable master password makes the portable envelope unrecoverable; the UI must offer replacement credentials rather than attempting recovery.
- This slice does not itself remove legacy plaintext database columns. That requires a separate schema migration and integration change outside this subtask.
