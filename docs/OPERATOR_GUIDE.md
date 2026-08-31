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
| 🟡 **Amber** | Offline or queued | Check internet connection; files will upload automatically when connectivity is restored — **do not rescan** |
| 🔴 **Red** | Credential error — agent paused | Contact your IT team or Presentail support |
| No icon | Agent not running | Launch from Start Menu → Presentail Scanner Agent |

---

## If Something Goes Wrong

### Tray icon is amber (offline)

1. Check that the PC has internet access (open a browser, try any website)
2. If no internet, scanned files are safely queued and will upload when connectivity is restored
3. If internet is working but icon stays amber, right-click the tray icon → **Open Log Folder** and call Presentail support

### Invoice did not appear in Presentail OS

1. Check the tray icon — if blue, wait for the current upload to finish
2. If the icon is green but the invoice is missing, check **Presentail OS → Recent Imports** and refresh
3. If the file is in `C:\PresentailScanner\Failed\`, there was a permanent error — contact Presentail support and do **not** delete the file

### Scanner misfeed / paper jam

1. Open the ADF cover and gently remove jammed paper
2. If pages were partially scanned, **rescan the whole invoice from the beginning** — the system detects duplicates automatically

### You accidentally scanned a document twice

No action needed. The system detects duplicate scans automatically (using a SHA-256 fingerprint) and ignores the second copy.

---

## What NOT to Do

- ❌ Do not scan multiple invoices in one batch — scan one invoice at a time
- ❌ Do not restart or shut down the PC while the tray icon is blue (uploading)
- ❌ Do not manually move or delete files from `C:\PresentailScanner\Inbox\`
- ❌ Do not unplug the scanner USB cable while scanning

---

## Need Help?

Contact: **Presentail Operations** — [your internal contact details here]
