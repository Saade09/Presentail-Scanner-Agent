# Presentail Scanner Agent — Acceptance Test Checklist

**Station:** ___________________  
**PC Hostname:** ___________________  
**Date:** ___________________  
**Tester:** ___________________  
**Agent version:** `1.0.4`
**Installer filename:** `Presentail-Scanner-Agent-1.0.4-x64.exe`
**SHA-256 (from RELEASE-METADATA.json):** `PENDING WINDOWS RELEASE`
**Source bundle SHA-256 (from RELEASE-METADATA.json):** `PENDING WINDOWS RELEASE`

> **Installer artifact: READY** — Windows CI built, installed, smoke-tested,
> and published the versioned x64 NSIS installer, update manifest, release
> metadata, installer checksum, and source-bundle checksum from one immutable
> tag. **Physical commissioning:
> MISSING** until that exact downloaded installer passes the HQ 2 checks below.

---

## How to Use This Checklist

Each item is marked with its validation type:

- **Automated — passes in CI** · Covered by the test suite; no manual action needed before go-live
- **⚠ Requires physical validation** · Must be performed on the physical scanner PC with hardware present

Mark each item `[x]` when passed, or record the failure notes in the **Notes** column.

---

## Section 1 — Hardware Installation

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| H1 | HP ScanJet Pro 2600 f1 USB cable connected; scanner powers on | ⚠ Requires physical validation | `[ ]` | |
| H2 | HP full-feature driver installed; scanner appears in Device Manager without errors | ⚠ Requires physical validation | `[ ]` | |
| H3 | HP Scan application installed and launches successfully | ⚠ Requires physical validation | `[ ]` | |
| H4 | Scanner visible in HP Scan scanner dropdown | ⚠ Requires physical validation | `[ ]` | |

---

## Section 2 — HP Scan Preset Configuration

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| P1 | "Invoice to Presentail" preset exists in HP Scan shortcut list | ⚠ Requires physical validation | `[ ]` | |
| P2 | Source set to ADF | ⚠ Requires physical validation | `[ ]` | |
| P3 | Sides set to duplex (both sides) | ⚠ Requires physical validation | `[ ]` | |
| P4 | Resolution set to 300 DPI | ⚠ Requires physical validation | `[ ]` | |
| P5 | Output format is multi-page PDF | ⚠ Requires physical validation | `[ ]` | |
| P6 | HP Scan destination is `C:\Users\Presentail\Desktop\INBOX` and the same path is entered in agent setup | ⚠ Requires physical validation | `[ ]` | |
| P7 | No filename prompt; no preview; no open-after-save | ⚠ Requires physical validation | `[ ]` | |
| P8 | Blank-page removal enabled | ⚠ Requires physical validation | `[ ]` | |
| P9 | Auto orientation / deskew enabled | ⚠ Requires physical validation | `[ ]` | |
| P10 | Physical Scan button on scanner panel triggers the "Invoice to Presentail" preset (if button assignment is supported by driver version) | ⚠ Requires physical validation | `[ ]` | |

---

## Section 3 — Agent Installation and Pairing

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| A1 | Installer runs without UAC elevation (per-user install) | ⚠ Requires physical validation | `[ ]` | |
| A2 | Agent installed to `%LOCALAPPDATA%\PresentailScannerAgent\` | ⚠ Requires physical validation | `[ ]` | |
| A3 | Configured inbox plus sibling `Uploaded` and `Failed` directories are created; missing settings still default to `C:\PresentailScanner\Inbox` | Automated + physical validation | `[ ]` | |
| A4 | Start Menu shortcut created | ⚠ Requires physical validation | `[ ]` | |
| A5 | Agent setup window opens automatically after install | ⚠ Requires physical validation | `[ ]` | |
| A6 | Pairing code generated in Presentail OS → Settings → Devices → Invoice Scanners | ⚠ Requires physical validation | `[ ]` | |
| A7 | Pairing code accepted in agent setup window; agent pairs successfully | ⚠ Requires physical validation | `[ ]` | |
| A8 | Tray icon appears green after successful pairing | ⚠ Requires physical validation | `[ ]` | |
| A9 | Auto-start Registry key present (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\PresentailScannerAgent`) | Automated — passes in CI | `[ ]` | |

---

## Section 4 — Physical Scan Tests

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| S1 | **ADF single-page scan** — Scan one A4 invoice page via ADF; file appears in Presentail OS within 15 s | ⚠ Requires physical validation | `[ ]` | |
| S2 | **ADF multi-page scan** — Scan a 4-page invoice; all pages appear in one PDF in Presentail OS | ⚠ Requires physical validation | `[ ]` | |
| S3 | **Duplex scan** — Scan a double-sided invoice; both sides present in the uploaded PDF | ⚠ Requires physical validation | `[ ]` | |
| S4 | **Flatbed scan** — Scan a receipt using the flatbed glass; file appears in Presentail OS | ⚠ Requires physical validation | `[ ]` | |
| S5 | **Blank reverse-side removal** — Scan a single-sided invoice via duplex; blank reverse page removed from PDF | ⚠ Requires physical validation | `[ ]` | |
| S6 | **Faint/low-contrast invoice** — Scan a faint or thermal receipt; text legible in the uploaded PDF | ⚠ Requires physical validation | `[ ]` | |
| S7 | **Rotated invoice** — Scan an invoice placed sideways; auto-orientation corrects rotation in the PDF | ⚠ Requires physical validation | `[ ]` | |
| S8 | **Duplicate re-scan** — Scan the same invoice a second time; Presentail OS shows only one entry (duplicate detected) | Automated — passes in CI | `[ ]` | |

---

## Section 5 — Offline and Recovery Tests

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| O1 | **Internet disabled during scan** — Disable network adapter; scan an invoice; file queued in Inbox; tray icon goes amber; re-enable network; file uploads automatically within 1 retry cycle; tray icon returns green | Automated — passes in CI | `[ ]` | |
| O2 | **Windows restart while upload queued** — Queue a file; restart Windows; after restart the agent starts automatically; file uploads without manual intervention | ⚠ Requires physical validation | `[ ]` | |
| O3 | **Agent restart while upload queued** — Queue a file (disconnect network); kill the agent from Task Manager; relaunch; file uploads after reconnection | Automated — passes in CI | `[ ]` | |
| O4 | **File stability guard** — Drop a file that is still being written (simulate by copying a large file); agent waits until the file is stable (3 stable size+mtime readings) before processing | Automated — passes in CI | `[ ]` | |
| O5 | **Permanent failure move** — Upload a file that the server rejects with a 4xx error; file moved to `Failed\` with a `.error.json` sidecar | Automated — passes in CI | `[ ]` | |

---

## Section 6 — Installer Upgrade and Uninstall

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| U1 | **Upgrade preserves queue.db** — Run a newer installer over an existing installation; `%APPDATA%\PresentailScannerAgent\queue.db` is not deleted | Automated — passes in CI | `[ ]` | |
| U2 | **Upgrade preserves Windows Credential Manager entry** — After upgrade, agent starts without re-pairing | ⚠ Requires physical validation | `[ ]` | |
| U3 | **Upgrade preserves auto-start Registry key** — After upgrade, agent still listed in startup programs | Automated — passes in CI | `[ ]` | |
| U4 | **Upgrade does not delete `C:\PresentailScanner\`** — Any files in Inbox/Uploaded/Failed survive the upgrade | ⚠ Requires physical validation | `[ ]` | |
| U5 | **Uninstall warns when Inbox contains files** — Drop a file in Inbox; run uninstall; a warning dialog appears; clicking Cancel aborts uninstall | ⚠ Requires physical validation | `[ ]` | |
| U6 | **Uninstall warns when Failed contains files** — Drop a file in Failed; run uninstall; a warning dialog appears | ⚠ Requires physical validation | `[ ]` | |
| U7 | **Uninstall does not delete `C:\PresentailScanner\`** — After a clean uninstall (no files in Inbox/Failed), the `C:\PresentailScanner\` tree remains on disk | ⚠ Requires physical validation | `[ ]` | |

---

## Section 7 — Auto-Update

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| AU1 | Agent checks for updates on startup (log entry: "Auto-update check") | Automated — passes in CI | `[ ]` | |
| AU2 | Agent checks for updates every 4 hours (verified in log file) | Automated — passes in CI | `[ ]` | |
| AU3 | When a newer version is available, a Windows notification toast appears: "Update available — click to download" | ⚠ Requires physical validation | `[ ]` | |
| AU4 | Clicking the notification triggers download; update installed on next restart | ⚠ Requires physical validation | `[ ]` | |
| AU5 | After auto-update, credentials and queue survive the update (agent resumes without re-pairing) | ⚠ Requires physical validation | `[ ]` | |

---

## Section 8 — Agent Behaviour and Monitoring

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| M1 | **Heartbeat update** — Agent sends heartbeat PATCH immediately and every 2 minutes; last-seen timestamp and queued count update in Presentail OS | Automated — passes in CI | `[ ]` | |
| M2 | **SHA-256 idempotency** — Upload the same file twice (same bytes); server returns duplicate response; queue clears without error | Automated — passes in CI | `[ ]` | |
| M3 | **Credential revoke** — Revoke the scanner token from Presentail OS; tray icon turns red; agent logs error; re-pair restores green | ⚠ Requires physical validation | `[ ]` | |
| M4 | **Tray menu** — Right-click tray icon shows station name, entity, Re-pair option, and Quit | ⚠ Requires physical validation | `[ ]` | |
| M5 | **Log files present** — `%APPDATA%\PresentailScannerAgent\logs\` contains structured JSON log entries | ⚠ Requires physical validation | `[ ]` | |
| M6 | **Single instance** — Launching the agent a second time focuses the setup window (if open) rather than starting a second process | Automated — passes in CI | `[ ]` | |

### Required HQ 2 re-pair evidence

Record only correlation IDs, statuses, station IDs, versions, and timestamps.
Never paste a pairing code, credential, token hash, or Authorization header.

| Result field | Required evidence | Result |
|---|---|---|
| ROOT CAUSE | Installed version plus correlation-linked client/server logs | `PENDING PHYSICAL TEST` |
| PAIR REQUEST RESULT | POST endpoint, timestamp, HTTP status, result category, correlation ID | `PENDING PHYSICAL TEST` |
| CREDENTIAL STORAGE RESULT | Save/readback/restart logs with HQ 2 station ID and `credentialExists: true` | `PENDING PHYSICAL TEST` |
| HEARTBEAT RESULT | First heartbeat 2xx plus OS last-seen/version/queue count | `PENDING PHYSICAL TEST` |
| RACE CONDITION FOUND | Old-generation late 401 regression and physical result | `YES IN CODE; PENDING PHYSICAL CONFIRMATION` |
| FIXED VERSION | Tray, startup log, heartbeat, and installer properties agree | `1.0.4` |
| ACTIVE INBOX | Tray and watcher-ready log show the configured destination | `PENDING — C:\Users\Presentail\Desktop\INBOX` |
| INSTALLER FILENAME | Versioned x64 NSIS filename | `Presentail-Scanner-Agent-1.0.4-x64.exe` |
| RELEASE PROVENANCE | Source commit, source-bundle checksum, and recovery capabilities in release metadata | `PENDING WINDOWS RELEASE` |
| DOWNLOAD READY | Production URL, filename, version, checksum, immutable release, and rolling feed agree | `PENDING WINDOWS RELEASE` |
| PACKAGED WINDOWS PAIRING TEST | Fresh code, first heartbeat, restart persistence, HQ 2 Connected | `FAIL — NOT YET RUN` |

### Required fresh-PDF ingestion evidence

Use one new PDF that has never been uploaded before. Record no invoice contents,
credentials, pairing codes, or authorization headers.

| Stage | Secret-safe evidence | Result |
|---|---|---|
| DETECTED | Watcher `file detected` and `file stable, enqueuing` timestamps plus filename | `PENDING PHYSICAL TEST` |
| QUEUED | Queue entry ID/count before upload; file still present in Inbox | `PENDING PHYSICAL TEST` |
| SERVER ACCEPTED | HTTP status/result, correlation ID, and returned import ID | `PENDING PHYSICAL TEST` |
| FILE MOVED | Inbox absent and sibling Uploaded contains timestamped filename after acceptance | `PENDING PHYSICAL TEST` |
| OS ROW | Import ID, station entity, status, and visible row timestamp at `/ai-invoice-import` | `PENDING PHYSICAL TEST` |

---

## Section 9 — AI Extraction Review

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| AI1 | Scan a clear, standard invoice; AI extraction populates vendor, date, total, line items without manual correction | ⚠ Requires physical validation | `[ ]` | |
| AI2 | Scan a handwritten or ambiguous invoice; Presentail OS flags it for human review; reviewer can correct and approve | ⚠ Requires physical validation | `[ ]` | |

---

## Section 10 — Final End-to-End Acceptance Test with Adnan

> This is the formal sign-off test. Adnan (operations lead) performs a real invoice scan from start to finish.

| # | Test | Validation type | Pass | Notes |
|---|------|-----------------|------|-------|
| E1 | Adnan places a real vendor invoice (multi-page, double-sided) in the ADF and presses the physical Scan button | ⚠ Requires physical validation | `[ ]` | |
| E2 | The invoice uploads and appears in Presentail OS → Recent Imports within 15 seconds | ⚠ Requires physical validation | `[ ]` | |
| E3 | Test PDF moves from `C:\Users\Presentail\Desktop\INBOX\` to sibling `Uploaded\` on the scanner PC | ⚠ Requires physical validation | `[ ]` | |
| E4 | AI extraction results are reviewed and approved in Presentail OS | ⚠ Requires physical validation | `[ ]` | |
| E5 | Adnan confirms the end-to-end flow meets operational requirements | ⚠ Requires physical validation | `[ ]` | |

---

## Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| IT Technician (commissioning) | | | |
| Operations Manager (Adnan) | | | |
| Presentail Engineering (optional) | | | |

---

_All physical tests must pass before the scanner PC is released to production use._
