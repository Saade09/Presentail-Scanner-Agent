# Presentail Scanner — Operator Quick Reference

> Print this card and keep it beside the scanner.

---

## Before You Scan

- ✅ Remove all **staples**, **paper clips**, and **sticky notes**
- ✅ All pages of the **same invoice must stay together** — scan one invoice at a time
- ✅ Straighten pages (the scanner will auto-straighten, but severe curls may cause a misfeed)
- ✅ Remove **blank separator pages** between invoice pages — they will be removed automatically
- ✅ Check that the **tray icon (bottom-right corner of the taskbar) is green** before scanning

---

## Scanning an Invoice

The Presentail Scanner Agent does not control the scanner. It watches the folder
shown as **Scan inbox** when you right-click the tray icon. On the commissioned
PC this must be `C:\Users\Presentail\Desktop\INBOX`, matching HP Scan exactly.

1. **Place the invoice** in the ADF (the tray at the top of the scanner), face-down, top edge first
2. **Press the Scan button** on the scanner panel  
   _(or open HP Scan on the PC and click **Invoice to Presentail**)_
3. **Wait** — the scanner feeds all pages automatically
4. **Do not remove pages** mid-scan; let the feeder finish

---

## Confirming the Upload

Within about **15 seconds**, open **Presentail OS → Recent Imports**.

The invoice should appear with status **Pending Review** or **Processed**.

If it does not appear after 30 seconds, check the tray icon (see below).

---

## Tray Icon States

The Presentail Scanner Agent icon lives in the system tray — bottom-right corner of the taskbar (click the ∧ arrow to see hidden icons if needed).

| Icon colour | Meaning | What to do |
|-------------|---------|------------|
| 🟢 **Green** | Connected and ready | Nothing — scan away |
| 🔵 **Blue** | Uploading a file | Wait; do not restart the PC |
| 🟡 **Amber** | Presentail OS cannot be reached; scans are queued | Check the internet connection; files upload automatically when connectivity returns — **do not rescan** |
| 🔴 **Red — Credential rejected** | Presentail OS rejected this device credential; agent paused | Ask a manager to generate a fresh code, then right-click → **Re-pair station…** |
| 🔴 **Red — Station disabled** | The station is disabled in Presentail OS | Ask a manager to enable it, generate a fresh code, then re-pair |
| 🔴 **Red — Setup required** | The default entity is missing or inactive | Ask a manager to select an active default entity, generate a fresh code, then re-pair |
| 🔴 **Red — Inbox unavailable** | The configured scan folder cannot be created or watched | Check the **Scan inbox** path and Windows folder permissions, then reopen settings |
| No icon | Agent not running | Launch from Start Menu → Presentail Scanner Agent |

---

## If Something Goes Wrong

### Tray icon is amber (offline)

1. Check that the PC has internet access (open a browser, try any website)
2. If no internet, scanned files are safely queued and will upload when connectivity is restored
3. If internet is working but icon stays amber, right-click the tray icon → **Open Log Folder** and call Presentail support

### Tray icon is red

Read the full status line before acting:

1. **Credential rejected:** ask a manager to generate a fresh one-time code in Presentail OS.
2. **Station disabled:** ask a manager to enable the station first, then generate a fresh code.
3. **Setup required:** ask a manager to edit the station and select an active default entity first, then generate a fresh code.
4. Right-click the tray icon → **Re-pair station…**. Wait for the setup window before entering the fresh code. The agent preserves queued scans while replacing the old pairing.
5. After pairing, confirm the tray is green and the station's **Last seen** time updates in Presentail OS.

### Invoice did not appear in Presentail OS

1. Check the tray icon — if blue, wait for the current upload to finish
2. If the icon is green but the invoice is missing, check **Presentail OS → Recent Imports** and refresh
3. Right-click the tray icon and confirm **Scan inbox** exactly matches the HP Scan destination. A green icon cannot detect files saved to a different folder.
4. If the file is in the `Uploaded` folder beside the configured inbox, refresh **Recent Imports**
5. If the file is in the sibling `Failed` folder, open the matching `.error.json` file for the reason. Ask a manager to confirm the station has an active default entity, then re-pair if instructed. Do **not** delete the failed scan.

### Agent setup window is missing

1. Open **Start → Presentail Scanner Agent**
2. If no window opens, click the **∧ hidden-icons arrow** in the Windows taskbar; the agent may already be running in the tray
3. If the tray icon is red, read its status and fix any disabled-station or default-entity issue in Presentail OS
4. Generate a fresh code, right-click the tray icon, and choose **Re-pair station…**

### Scanner misfeed / paper jam

1. Open the ADF cover and gently remove jammed paper
2. If pages were partially scanned, **rescan the whole invoice from the beginning** — the system detects duplicates automatically

### You accidentally scanned a document twice

No action needed. The system detects duplicate scans automatically (using a SHA-256 fingerprint) and ignores the second copy.

---

## What NOT to Do

- ❌ Do not scan multiple invoices in one batch — scan one invoice at a time
- ❌ Do not restart or shut down the PC while the tray icon is blue (uploading)
- ❌ Do not manually move or delete files from the **Scan inbox** folder shown in the tray
- ❌ Do not unplug the scanner USB cable while scanning

---

## Need Help?

Contact: **Presentail Operations** — [your internal contact details here]
