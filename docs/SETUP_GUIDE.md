# Presentail Scanner Agent — Setup Guide

> **Audience:** IT technician or operations manager commissioning the dedicated scanner PC for the first time.  
> **Time required:** ~45 minutes (hardware + software).  
> **Support:** Contact the Presentail operations team if you get stuck.

---

## Prerequisites

| Item | Required version / notes |
|------|--------------------------|
| PC   | Windows 10 64-bit or later; 4 GB RAM minimum |
| USB port | One free USB-A or USB-C port (use USB 3 if available) |
| HP ScanJet Pro 2600 f1 | Supplied unit with power cable and USB cable |
| Internet connection | Required during pairing; can be reconnected after if testing offline |
| Presentail OS account | Admin or Scanner Manager role required to generate pairing codes |

---

## Part 1 — Install HP ScanJet Pro 2600 f1 Hardware and Drivers

### 1.1  Physical connection

1. Place the scanner on a flat, stable surface with at least 15 cm clearance on all sides for the ADF paper path.
2. Connect the power cable and press the power button. The control panel should light up.
3. Connect the USB cable from the scanner to the PC. **Do not connect USB before the driver is installed if Windows Update might grab a generic driver — proceed to step 1.2 first if this is a clean machine.**

### 1.2  Download and install HP drivers

1. Open a browser and go to **[support.hp.com](https://support.hp.com)**.
2. Search for **HP ScanJet Pro 2600 f1** → select your model → **Software and Drivers** → **Full Feature Software and Drivers**.
3. Download the installer for Windows 64-bit.
4. Run the installer as Administrator. Accept defaults; install all components (drivers, HP Scan application, HP Smart Device Services).
5. When prompted, plug in the USB cable. Windows should detect and enumerate the scanner.
6. Complete the installer. Reboot if requested.

### 1.3  Verify hardware

1. Open **HP Scan** (from the Start Menu or desktop shortcut).
2. Confirm that **HP ScanJet Pro 2600 f1** appears in the scanner dropdown at the top of the HP Scan window.
3. Place a blank sheet in the **ADF** (automatic document feeder — the tray at the top of the scanner). Click **Scan** with any profile. The sheet should feed through and produce a preview image.
4. Place a sheet on the **flatbed glass** (lift the lid). Scan. The flatbed scan should succeed.
5. Both scans succeed → hardware is working correctly.

> **Troubleshooting:** If the scanner is not detected, open **Device Manager** (Win+X → Device Manager), look for the HP ScanJet under **Imaging devices**. If it shows a yellow warning icon, update the driver manually from the HP download.

---

## Part 2 — Configure HP Scan Preset "Invoice to Presentail"

> **Why a preset?** The preset lets operators press a single physical Scan button without touching the PC. Every setting below is required for the agent to process invoices correctly.

### 2.1  Open HP Scan

1. Launch **HP Scan** from the Start Menu.
2. At the top right, click **Add Shortcut** (or **New Shortcut** / **Add Profile** depending on your HP Scan version).

### 2.2  Create the preset

Name the new shortcut / profile exactly: **`Invoice to Presentail`**

Configure each field as follows:

| Setting | Value |
|---------|-------|
| **Scanner** | HP ScanJet Pro 2600 f1 |
| **Source** | Automatic Document Feeder (ADF) |
| **Sides** | Both sides (duplex) |
| **Document type** | Document (not Photo) |
| **File type** | PDF (multi-page) |
| **Resolution** | 300 DPI |
| **Color mode** | Auto detect (auto color) |
| **Page size** | Auto detect (auto page size) |
| **Auto orientation** | On |
| **Auto straighten / deskew** | On |
| **Blank page removal** | On |
| **Destination folder** | `C:\Users\Presentail\Desktop\INBOX` |
| **File name** | Any fixed prefix such as `invoice_` — do **not** enable filename prompt |
| **Show preview** | Off (disabled) |
| **Open after save** | Off (disabled) |
| **Show scanner dialog before scanning** | Off |

> **Screenshot placeholder:** _A photo of the HP Scan "Shortcut settings" dialog with the above fields configured should be placed here. Take a screenshot on the commissioning PC and add it to this folder._

### 2.3  Save and verify

1. Click **Save** (or **Apply**).
2. The shortcut **Invoice to Presentail** should appear in the left panel of HP Scan.
3. Load a test document in the ADF.
4. Click the **Invoice to Presentail** shortcut.
5. The scanner feeds and saves a PDF to `C:\Users\Presentail\Desktop\INBOX\` (the agent is not yet running — that is fine, the file just sits there).
6. Open `C:\Users\Presentail\Desktop\INBOX\` in File Explorer and confirm the PDF is there.
7. Delete the test file before continuing.

### 2.4  Assign preset to the physical Scan button (if supported)

The HP ScanJet Pro 2600 f1 has a physical Scan button on the control panel.

1. Open **HP Scan** → **Settings** (gear icon) → **Button Settings** or **Scan Button**.
2. If the option is available, assign the **Invoice to Presentail** shortcut to **Button 1** or the **Scan** button.
3. If button assignment is not available in your driver version, operators will need to press the shortcut inside HP Scan — note this in the Operator Guide displayed at the workstation.

> **Note:** HP Scan button assignment UI varies between driver versions. Some versions require HP Smart app instead of HP Scan for button configuration. Refer to the HP ScanJet Pro 2600 f1 User Guide (available at support.hp.com) for your specific driver version.

---

## Part 3 — Install Presentail Scanner Agent

### 3.1  Obtain the installer

In Presentail OS, go to **Settings → Devices → Invoice Scanners** and click
**Download Windows Agent**. The configurable-inbox release filename is
`Presentail-Scanner-Agent-1.0.4-x64.exe`.

Before installing, confirm the checksum and download URL in the matching
`RELEASE-METADATA.json` published with the release:

- Immutable release: `scanner-agent-v1.0.4`
- Installer: `Presentail-Scanner-Agent-1.0.4-x64.exe`
- Release page: `https://github.com/Saade09/Presentail-Scanner-Agent/releases/tag/scanner-agent-v1.0.4`

> **Installer artifact status: PENDING — publish the 1.0.4 Windows workflow
> artifact and matching immutable/rolling-channel assets before commissioning.
> Physical commissioning status: PENDING.**
> If the button says **Windows Agent unavailable**, do not use the unrelated
> Print Agent Windows ZIP. The production release metadata or deployment must be
> repaired before installation. Commissioning remains MISSING until the
> clean-PC install, restart, pairing, heartbeat, and first-PDF checks pass.

### 3.2  Run the installer

1. Double-click the installer `.exe`.
2. If Windows shows a **SmartScreen** warning ("Windows protected your PC"), click **More info** → **Run anyway**. _(This warning appears because the executable is not yet code-signed. Signed releases will not show this warning.)_
3. The installer wizard opens. Click **Next**.
4. Accept the default installation directory (`C:\Users\<YourName>\AppData\Local\PresentailScannerAgent`) — **do not change this**.
5. On the **Choose Start Menu Folder** screen, keep the default.
6. Click **Install**. No Administrator password is required. A Start Menu
   shortcut is created; this release does not create a Desktop shortcut.
7. Leave **Launch Presentail Scanner Agent** ticked.
8. Click **Finish**.

The Presentail Scanner Agent setup window opens automatically.

---

## Part 4 — Pair the Agent

### 4.1  Generate a pairing code in Presentail OS

1. Log in to **Presentail OS** in a browser (on any computer).
2. Go to **Settings → Devices → Invoice Scanners**.
3. Click **Add Scanner Station**.
4. Enter a station name (e.g., `Head Office Scanner 1`) and select the required active default entity (the branch or company that will receive this scanner's imports).
5. Create the station, open its actions menu, and click **Generate pairing code**. The dialog shows the exact Presentail OS URL and an 8-character code. The code is single-use and expires in **15 minutes**.

### 4.2  Enter the pairing code in the agent

1. In the **Presentail Scanner Agent Setup** window on the scanner PC:
   - **Presentail OS URL:** copy the exact URL shown in the pairing dialog (for example, `https://os.presentail.com`)
   - **Pairing Code:** enter the 8-character code from step 4.1 (case-insensitive)
    - **HP Scan Destination Folder:** enter the exact folder configured in the
      HP Scan preset. On the commissioned PC use
      `C:\Users\Presentail\Desktop\INBOX`. Existing PCs that still scan to
      `C:\PresentailScanner\Inbox` can keep that default.
2. Click **Pair**. The window stays open while the complete credential record is
   saved, read back, and verified by an authenticated heartbeat.
3. Only after that heartbeat succeeds, the setup window closes and the
   **Presentail Scanner Agent** tray icon appears in the system tray
   (bottom-right corner of the taskbar) with a **green** icon. Click the
   **∧ hidden-icons arrow** if it is not immediately visible.
4. The agent is now active and watches the path shown as **Scan inbox** in the
   tray menu. The setup success message also repeats the monitored path.

> **If the setup window is hidden:** Launch **Presentail Scanner Agent** from the Start menu. If it is already running, find the tray icon. If the server rejected the credential, right-click → **Re-pair station…**, wait for the setup window, then use a freshly generated code.
>
> **If pairing fails:** Copy the OS URL exactly, confirm the station is enabled, confirm it has an active default entity, and generate a fresh code if the old one expired or was already used. The agent finishes removing the previous local pairing before it accepts the new credential; queued scans are preserved.

---

## Part 5 — Verify the End-to-End Flow

### 5.1  Run a test scan

1. Place a real invoice (or a test document labelled "TEST") in the ADF.
2. Press the physical Scan button (or open HP Scan and click **Invoice to Presentail**).
3. The scanner feeds the document and saves a PDF to `C:\Users\Presentail\Desktop\INBOX\`.

### 5.2  Confirm upload in Presentail OS

1. Within approximately **15 seconds**, open **Presentail OS → Recent Imports**.
2. The invoice should appear with status **Pending Review** or **Processed**.
3. Confirm:
   - File moved from `C:\Users\Presentail\Desktop\INBOX\` to
     `C:\Users\Presentail\Desktop\Uploaded\`.
   - Tray icon shows **green** (connected).
    - The station's **Last seen** time updates in **Settings → Devices → Invoice Scanners**.
4. Restart the agent from the Start menu and confirm the tray returns to green and **Last seen** updates again. This verifies the new credential was saved in Windows Credential Manager.

### 5.3  If the test scan does not appear

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| Tray says **Offline / queued — check network** | No internet / server unreachable | Check network; the file will upload automatically when connectivity is restored |
| Tray says **Credential rejected — re-pair required** | Presentail OS rejected or revoked the device credential | In Presentail OS, generate a fresh code; right-click tray → **Re-pair station** and use that code |
| Tray says **Station disabled** | The station is disabled in Presentail OS | Enable the station, generate a fresh code, and re-pair |
| Tray says **Setup required — select an active entity** | Default entity is missing or inactive | Edit the station, select an active default entity, generate a fresh code, and re-pair |
| Setup shows a pairing result category and reference ID | Pairing, storage, first-heartbeat, or network validation failed | Copy the category and reference ID into the acceptance record; never copy the pairing code or credential |
| File stays in the HP Scan destination | Agent not running or watching a different folder | Check the system tray's **Scan inbox** line; it must exactly match HP Scan. Launch from Start Menu or re-pair with the corrected path |
| Agent logs `file detected` but not `file stable, enqueuing` | HP Scan is still writing, the file disappeared, or stability checks cannot read it | Wait for HP Scan to finish. Confirm the PDF remains in Inbox and inspect the watcher warning/error in the logs |
| Agent logs `file stable, enqueuing`, and file remains in Inbox | The scan is safely queued but has not been accepted | Check the tray queued count and the next upload result. Network/server failures retry automatically |
| Server returns `duplicate` | The same PDF bytes were already imported | The file moves to `Uploaded`; no second AI Invoice row is created |
| Server returns `success` with an import ID | Presentail OS accepted and created the import | The file moves to `Uploaded`; find the matching import ID and entity row at `/ai-invoice-import` |
| File in `Failed\` | Permanent file/upload error | Check the matching `.error.json` sidecar for the status and actionable reason. Credential, disabled-station, entity-configuration, and recoverable network failures remain queued instead of moving the scan to `Failed\` |

The agent only watches files saved into the Inbox. It does not operate the HP
scanner, install drivers, or choose HP Scan settings.

---

## Part 6 — Configure Auto-Start (Verify)

The agent registers itself to start automatically with Windows during pairing. Verify:

1. Open **Task Manager** → **Startup** tab.
2. Confirm **Presentail Scanner Agent** is listed and **Enabled**.
3. Alternatively: `Win+R` → `shell:startup` — the agent uses a Registry key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) rather than the Startup folder, so it may not appear here. Check the Registry key: `Win+R` → `regedit` → navigate to `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run` → confirm `PresentailScannerAgent` entry exists.

---

## Part 7 — Automatic Updates

The agent checks for updates on startup and every 4 hours.

When a new version is available, a Windows notification toast appears:

> **Presentail Scanner Agent** — Update available (v1.x.x) — click to download

Clicking the notification downloads the update in the background. The update is installed automatically the next time the agent is restarted (or Windows is restarted).

> **For IT administrators:** Updates are distributed from the scanner-only rolling channel `https://github.com/Saade09/Presentail-Scanner-Agent/releases/download/scanner-agent-current/` by default. To point agents at an internal update server, set the environment variable `UPDATE_FEED_URL` to your server's base URL before launching the agent (or configure it in the machine-wide environment variables).

**Publishing a new release (Presentail engineering step):**

1. Push `scanner-agent-v<version>` to run the Windows release workflow.
2. Download and retain the workflow artifact containing the versioned `.exe`,
   `latest.yml`, `SHA256SUMS.txt`, and `RELEASE-METADATA.json`.
3. The tag workflow verifies the packaged `app.asar` exactly matches the
   current compiled source and contains the configurable-inbox markers, then
   publishes the same files to the durable GitHub Release and rolling channel.
4. Configure Presentail OS with the release URL, exact filename, version, and
   SHA-256 from `RELEASE-METADATA.json`.
5. Complete the clean-PC install, restart, pair, heartbeat, and test-PDF checks
   before changing physical commissioning from **MISSING** to **READY**.

---

## Commissioning Complete

The scanner PC is ready. Place the **Operator Quick Reference** card (see `OPERATOR_GUIDE.md`) beside the scanner. Return the scanner to normal operations.

Record the following in your asset register:

- Scanner model: HP ScanJet Pro 2600 f1
- Station name (in Presentail OS): ___________________
- PC hostname: ___________________
- Date commissioned: ___________________
- Commissioned by: ___________________
