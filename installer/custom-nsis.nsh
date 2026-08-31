; =============================================================================
; Presentail Scanner Agent — Custom NSIS hooks
; Included by electron-builder via nsis.include
;
; Macros used by electron-builder:
;   customInstallMode  — called first; override default install directory
;   customInstall      — called after files are extracted; create scanner dirs
;   customUnInstall    — called at uninstall start; warn if files remain
; =============================================================================

; ── Install directory ─────────────────────────────────────────────────────────
; Per-user install into %LOCALAPPDATA%\PresentailScannerAgent — no UAC elevation
!macro customInstallMode
  StrCpy $INSTDIR "$LOCALAPPDATA\PresentailScannerAgent"
!macroend

; ── Post-install actions ──────────────────────────────────────────────────────
; Runs after all files have been extracted into $INSTDIR.
; Creates the three scanner directories if they don't already exist.
; These directories live outside $INSTDIR so they are never overwritten on upgrade
; and are never removed by the uninstaller.
!macro customInstall
  ; Create scanner working directories (idempotent — no-op if they already exist)
  CreateDirectory "C:\PresentailScanner\Inbox"
  CreateDirectory "C:\PresentailScanner\Uploaded"
  CreateDirectory "C:\PresentailScanner\Failed"

  ; Write a README into the scanner root so operators know what the folders are for
  ; (Only on first install — skip if the file already exists)
  IfFileExists "C:\PresentailScanner\README.txt" done_readme 0
    FileOpen $0 "C:\PresentailScanner\README.txt" w
    FileWrite $0 "Presentail Scanner Directories$\r$\n"
    FileWrite $0 "==============================$\r$\n$\r$\n"
    FileWrite $0 "Inbox\     — Drop scanned PDFs here (watched by the agent)$\r$\n"
    FileWrite $0 "Uploaded\  — Files moved here after successful upload$\r$\n"
    FileWrite $0 "Failed\    — Files moved here on permanent failure (see .error.json sidecar)$\r$\n$\r$\n"
    FileWrite $0 "Do NOT move or rename these folders.$\r$\n"
    FileClose $0
  done_readme:

  ; Note: the following items are stored OUTSIDE $INSTDIR and are naturally
  ; preserved across upgrades without any special handling:
  ;   - %APPDATA%\PresentailScannerAgent\queue.db  (SQLite upload queue)
  ;   - Windows Credential Manager entry "PresentailScannerAgent" (bearer token)
  ;   - HKCU\Software\Microsoft\Windows\CurrentVersion\Run\PresentailScannerAgent (auto-start)
!macroend

; ── Pre-uninstall warning ─────────────────────────────────────────────────────
; Runs before any files are removed.
; Warns (but does not block) if Inbox or Failed still contain files.
; Does NOT delete C:\PresentailScanner\ or its contents.
!macro customUnInstall
  ; Check Inbox for unprocessed files
  FindFirst $0 $1 "C:\PresentailScanner\Inbox\*.*"
  StrCmp $1 "" inbox_empty 0
  StrCmp $1 "." 0 inbox_has_files
  FindNext $0 $1
  StrCmp $1 ".." 0 inbox_has_files
  FindNext $0 $1
  StrCmp $1 "" inbox_empty inbox_has_files
  inbox_has_files:
    FindClose $0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "C:\PresentailScanner\Inbox contains files that have NOT been uploaded.$\r$\n$\r$\nUninstalling now means these files will NOT be sent to Presentail OS.$\r$\n$\r$\nClick Cancel to abort and process the remaining files, or OK to continue." IDOK inbox_continue
    Abort
  inbox_continue:
    Goto inbox_done
  inbox_empty:
    FindClose $0
  inbox_done:

  ; Check Failed for files that need operator attention
  FindFirst $0 $1 "C:\PresentailScanner\Failed\*.*"
  StrCmp $1 "" failed_empty 0
  StrCmp $1 "." 0 failed_has_files
  FindNext $0 $1
  StrCmp $1 ".." 0 failed_has_files
  FindNext $0 $1
  StrCmp $1 "" failed_empty failed_has_files
  failed_has_files:
    FindClose $0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "C:\PresentailScanner\Failed contains files that failed to upload.$\r$\n$\r$\nThese files need manual review before you uninstall.$\r$\n$\r$\nClick Cancel to abort, or OK to continue uninstalling." IDOK failed_continue
    Abort
  failed_continue:
    Goto failed_done
  failed_empty:
    FindClose $0
  failed_done:

  ; The C:\PresentailScanner\ tree is intentionally left on disk after uninstall.
  ; Operators must manually remove it after verifying no files remain.
!macroend
