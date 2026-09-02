# Presentail Scanner Agent

A lightweight Windows tray application that watches the HP Scan destination configured during setup, detects completed scan files (PDF, JPG, JPEG, PNG), and uploads them to Presentail OS via the scanner upload API. Existing installations default to `C:\PresentailScanner\Inbox`.

## Architecture

```
artifacts/scanner-agent/
├── src/
│   ├── main.ts              — Main process: app lifecycle, IPC, auto-update, orchestration
│   ├── preload.ts           — Electron contextBridge: exposes scanner.pair() to renderer
│   └── lib/
│       ├── logger.ts        — Winston + daily-rotate logger (%APPDATA%\PresentailScannerAgent\logs\)
│       ├── credential.ts    — Windows Credential Manager via keytar (save/load/clear)
│       ├── queue.ts         — SQLite persistent upload queue (better-sqlite3)
│       ├── stability.ts     — File stability guard (polls size+mtime, 3 stable readings)
│       ├── fileOps.ts       — Move/copy files, ensure scanner directories
│       ├── uploader.ts      — SHA-256, multipart POST to /api/scanner/upload
│       ├── retryScheduler.ts— Retry loop with exponential back-off (5s → 5min)
│       ├── watcher.ts       — chokidar watcher on Inbox → stability guard → upload
│       ├── heartbeat.ts     — 2-minute PATCH to /api/scanner/heartbeat
│       ├── notifications.ts — Electron Notification toasts (success/queued/error)
│       ├── tray.ts          — System tray: 4-state icon, tooltip, context menu
│       └── autostart.ts     — HKCU Run registry entry via winreg
├── installer/
│   └── custom-nsis.nsh     — NSIS hooks: scanner dir creation, upgrade preservation,
│                              uninstall warnings
├── renderer/
│   └── setup/
│       ├── index.html       — Pairing setup window (server URL + pairing code)
│       └── setup.js         — Renderer script (communicates via window.scanner.pair)
├── scripts/
│   └── generate-icons.js   — Generates placeholder 16×16 PNG tray icons
├── docs/
│   ├── SETUP_GUIDE.md              — Step-by-step commissioning guide for IT technicians
│   ├── OPERATOR_GUIDE.md           — Single-page quick reference for scanner operators
│   └── ACCEPTANCE_TEST_CHECKLIST.md— Full acceptance test checklist (physical + automated)
├── assets/                  — Tray icons (replace with branded icons before distribution)
├── package.json
└── tsconfig.json
```

## Directory Layout (Windows runtime)

The configured inbox and its `Uploaded` and `Failed` siblings can live anywhere
on a local Windows drive. The backward-compatible default is:
```
C:\PresentailScanner\
├── Inbox\       ← Drop scanned files here; watched by the agent
├── Uploaded\    ← Files moved here after successful upload
└── Failed\      ← Files moved here on permanent failure (+ .error.json sidecar)

%APPDATA%\PresentailScannerAgent\
├── queue.db     ← SQLite persistent upload queue
├── settings.json← Non-secret scan inbox setting, preserved across upgrades
└── logs\
    └── scanner-agent-YYYY-MM-DD.log   ← JSON structured logs (14-day rotation)

%LOCALAPPDATA%\PresentailScannerAgent\   ← Application install directory
```

## Tray Icon States

| State      | Color  | Meaning                                        |
|------------|--------|------------------------------------------------|
| Connected  | Green  | Paired, online, no queued files                |
| Uploading  | Blue   | Actively uploading a file                      |
| Offline    | Amber  | Network unavailable or files queued for retry  |
| Error      | Red    | Credential revoked — re-pair required          |

---

## Development Setup

### Prerequisites

- **Node.js 20+**
- **Windows** (for keytar / winreg native modules; the packaged installer requires Windows)
- pnpm (for the monorepo) or npm (for this package in isolation)

### Install dependencies

```bash
pnpm install --filter @workspace/scanner-agent --frozen-lockfile
```

### Regenerate Windows and tray icons

```bash
node scripts/generate-icons.js
```

### Build TypeScript

```bash
pnpm --filter @workspace/scanner-agent run build
```

### Run in development

```bash
pnpm --filter @workspace/scanner-agent run dev
```

---

## Building the Windows Installer

> **Requires a Windows host or a CI runner with `windows-latest`.** Electron Builder
> cross-compiles the NSIS installer but native modules (keytar, better-sqlite3) must
> be rebuilt for Windows.

```bash
pnpm --filter @workspace/scanner-agent run dist:win
pnpm --filter @workspace/scanner-agent run verify-release
```

The installer is written to **`release/`**:

```
release/
├── Presentail-Scanner-Agent-1.0.3-x64.exe
├── latest.yml
├── SHA256SUMS.txt
└── RELEASE-METADATA.json
```

### What the installer does

| Action | Detail |
|--------|--------|
| **Install directory** | `%LOCALAPPDATA%\PresentailScannerAgent\` — per-user, no UAC elevation |
| **Scanner directories** | Creates `C:\PresentailScanner\{Inbox,Uploaded,Failed}` if absent (idempotent) |
| **Start Menu shortcut** | Always created |
| **Desktop shortcut** | User is asked during install (optional) |
| **Launch after install** | Agent launches automatically on first install |
| **Upgrade** | Preserves `queue.db`, `settings.json`, Credential Manager entry, and auto-start Registry key |
| **Uninstall** | Warns if `Inbox\` or `Failed\` contain files; does **not** delete `C:\PresentailScanner\` |

---

## Code Signing

Code signing is an **external prerequisite** — no certificate is bundled.

The build **succeeds unsigned** when the environment variables are absent (suitable for
development and internal testing). Unsigned builds show a Windows SmartScreen warning
at install time.

To sign the installer and executable, set these environment variables before running
`npm run dist`:

| Variable | Description |
|----------|-------------|
| `CSC_LINK` | Path or base64-encoded PFX certificate. Base64: `certutil -encode cert.pfx cert.b64` (Windows) or `base64 cert.pfx` (Linux/macOS CI) |
| `CSC_KEY_PASSWORD` | Password for the PFX certificate |

Electron Builder reads `CSC_LINK` / `CSC_KEY_PASSWORD` automatically when set. No
changes to `package.json` are needed — the env vars are the switch.

For EV certificates via Azure Key Vault or DigiCert KeyLocker, see:
<https://www.electron.build/code-signing>

---

## Auto-Update

The agent uses `electron-updater` to check for new versions:

- **On startup** (after a 10-second delay to let the app settle)
- **Every 4 hours** while running

When a newer version is detected, a Windows notification toast appears:

> **Presentail Scanner Agent** — Update available (v1.x.x) — click to download

Clicking downloads the update. The update installs the next time the agent quits
(or Windows restarts). Credentials and the upload queue are preserved across updates
because they live outside the install directory (`%APPDATA%` and Windows Credential
Manager).

### Configuring the update feed

The default feed URL is the scanner-only rolling channel
`https://github.com/Saade09/Presentail-Scanner-Agent/releases/download/scanner-agent-current`.
It is updated by the Windows release workflow and is independent of unrelated
repository releases. Override via:

```
UPDATE_FEED_URL=https://your-internal-server.com/releases
```

Set this as a system-wide environment variable on the scanner PC if you host releases
internally.

### Publishing a new release

1. Set the package version and push the matching tag `scanner-agent-v<version>`.
2. The **Scanner Agent Windows Release** workflow builds on `windows-latest`,
   verifies the native dependencies, records the SHA-256 checksum, retains the
   files as workflow artifacts, and publishes them as durable GitHub Release assets.
3. Configure Presentail OS with the published
   `SCANNER_AGENT_RELEASE_URL`, `SCANNER_AGENT_RELEASE_VERSION`,
   `SCANNER_AGENT_RELEASE_FILENAME`, and `SCANNER_AGENT_RELEASE_SHA256`.
4. Confirm **Settings → Devices → Invoice Scanners → Download Windows Agent**
   downloads the exact filename recorded in `RELEASE-METADATA.json`.

---

## Pairing Flow

1. Open **Presentail OS → Settings → Devices → Invoice Scanners**, create a station,
   and click **Generate Pairing Code** (valid 15 min).
2. Launch the Scanner Agent; the setup window opens automatically if not paired.
3. Enter the Presentail OS URL, pairing code, and the exact destination folder
   used by the HP Scan preset. For the commissioned workstation this is
   `C:\Users\Presentail\Desktop\INBOX`.
4. On success, the agent stores the bearer token in **Windows Credential Manager**,
   registers the auto-start Registry key
   (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), and begins monitoring
   the configured scan inbox. The active path is shown in the tray menu and tooltip.

## Re-pairing

Right-click the tray icon → **Re-pair station** to:

- Clear the stored credential from Windows Credential Manager
- Clear the retry queue
- Reopen the setup window

## Logging

Logs are written as structured JSON lines to `%APPDATA%\PresentailScannerAgent\logs\`.

Sensitive fields (`token`, `authorization`, `content`, `text`, `raw`) are automatically
redacted. Response bodies are never logged — only HTTP status codes.

## Upload Protocol

Each file upload sends a `multipart/form-data` POST to `/api/scanner/upload`:

| Field               | Value                                |
|---------------------|--------------------------------------|
| `file`              | Binary file content                  |
| `captured_at`       | File mtime as ISO 8601 string        |
| `original_filename` | Original filename                    |
| `sha256`            | SHA-256 hex digest (idempotency key) |
| `agent_version`     | Agent version string                 |

Responses:

- **202** — accepted, newly imported
- **200 + `duplicate: true`** — already imported (idempotent)
- **4xx (permanent)** — file moved to the configured inbox's sibling `Failed\` folder
- **Network / 5xx** — file stays in the configured inbox, retried with exponential back-off

## Further Documentation

| Document | Audience |
|----------|----------|
| [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) | IT technician commissioning the scanner PC |
| [`docs/OPERATOR_GUIDE.md`](docs/OPERATOR_GUIDE.md) | Day-to-day scanner operators |
| [`docs/ACCEPTANCE_TEST_CHECKLIST.md`](docs/ACCEPTANCE_TEST_CHECKLIST.md) | QA / commissioning sign-off |
