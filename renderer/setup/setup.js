/* global scanner */
// Renderer script — runs in isolated context.
// Communicates with the main process via contextBridge (window.scanner).

(function () {
  "use strict";

  const btnPair     = document.getElementById("btn-pair");
  const inputUrl    = document.getElementById("server-url");
  const inputCode   = document.getElementById("pairing-code");
  const inputInbox  = document.getElementById("inbox-dir");
  const errorBanner = document.getElementById("error-banner");
  const successBanner = document.getElementById("success-banner");
  const DEFAULT_OS_URL = "https://os.presentail.com";
  let pairingInProgress = false;

  if (!inputUrl.value.trim()) {
    inputUrl.value = DEFAULT_OS_URL;
  }

  window.scanner.getSettings()
    .then((settings) => {
      if (settings && typeof settings.inboxDir === "string") {
        inputInbox.value = settings.inboxDir;
      }
    })
    .catch(() => {
      // Keep the backward-compatible default already rendered in the field.
    });

  // Auto-uppercase the pairing code field
  inputCode.addEventListener("input", () => {
    const pos = inputCode.selectionStart;
    inputCode.value = inputCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    inputCode.setSelectionRange(pos, pos);
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = "block";
    successBanner.style.display = "none";
  }

  const categoryLabels = {
    missing_code: "Pairing code missing",
    invalid_code: "Pairing code rejected",
    expired_code: "Pairing code expired",
    used_code: "Pairing code already used",
    station_disabled: "Station disabled",
    inactive_entity: "Invalid station entity",
    inbox_error: "Scan folder unavailable",
    secure_storage_failure: "Secure storage failed",
    post_pair_authentication_failure: "Authentication failed after pairing",
    network_api_failure: "Network or API unavailable",
    api_error: "Pairing API error",
  };

  function clearError() {
    errorBanner.style.display = "none";
    errorBanner.textContent = "";
  }

  function setLoading(loading) {
    btnPair.disabled = loading;
    if (loading) {
      btnPair.innerHTML = '<span class="spinner"></span>Pairing…';
    } else {
      btnPair.textContent = "Pair this station";
    }
  }

  function validateInputs() {
    const url  = inputUrl.value.trim();
    const code = inputCode.value.trim();
    const inboxDir = inputInbox.value.trim();

    if (!url) {
      showError("Please enter the Presentail OS URL.");
      inputUrl.focus();
      return null;
    }

    // Basic URL validation
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        showError("URL must start with https:// or http://");
        inputUrl.focus();
        return null;
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        showError("Use only the Presentail OS origin, without credentials, query parameters, or fragments.");
        inputUrl.focus();
        return null;
      }
    } catch {
      showError("Please enter a valid URL (e.g. https://os.presentail.com)");
      inputUrl.focus();
      return null;
    }

    if (!code || code.length < 6) {
      showError("Please enter the 8-character pairing code.");
      inputCode.focus();
      return null;
    }

    if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(inboxDir)) {
      showError("Enter an absolute Windows scan folder, such as C:\\PresentailScanner\\Inbox.");
      inputInbox.focus();
      return null;
    }

    return { serverUrl: url, pairingCode: code, inboxDir };
  }

  async function handlePair() {
    if (pairingInProgress) return;
    clearError();

    const payload = validateInputs();
    if (!payload) return;

    pairingInProgress = true;
    setLoading(true);

    try {
      const result = await window.scanner.pair(payload);

      if (result.success) {
        successBanner.textContent = `Paired successfully. The Windows tray agent is monitoring ${result.inboxDir}.`;
        successBanner.style.display = "block";
        btnPair.style.display = "none";
        inputUrl.disabled = true;
        inputCode.disabled = true;
        inputInbox.disabled = true;
        // Window will be closed by main process after short delay
      } else {
        const label = categoryLabels[result.category] || "Pairing failed";
        const reference = result.correlationId
          ? ` Reference: ${result.correlationId}`
          : "";
        showError(`${label}: ${result.error || "Confirm the station is enabled, select an active default entity, and generate a fresh code."}${reference}`);
      }
    } catch (err) {
      showError("Pairing could not be completed. Check the network and Presentail OS URL, then try again.");
    } finally {
      pairingInProgress = false;
      setLoading(false);
    }
  }

  btnPair.addEventListener("click", handlePair);

  // Submit on Enter in either field
  [inputUrl, inputCode, inputInbox].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handlePair();
    });
  });

  // Focus server URL on load
  inputUrl.focus();
})();
