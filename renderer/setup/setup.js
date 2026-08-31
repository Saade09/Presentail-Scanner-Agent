/* global scanner */
// Renderer script — runs in isolated context.
// Communicates with the main process via contextBridge (window.scanner).

(function () {
  "use strict";

  const btnPair     = document.getElementById("btn-pair");
  const inputUrl    = document.getElementById("server-url");
  const inputCode   = document.getElementById("pairing-code");
  const errorBanner = document.getElementById("error-banner");
  const successBanner = document.getElementById("success-banner");

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
    } catch {
      showError("Please enter a valid URL (e.g. https://your-company.presentail.com)");
      inputUrl.focus();
      return null;
    }

    if (!code || code.length < 6) {
      showError("Please enter the 8-character pairing code.");
      inputCode.focus();
      return null;
    }

    return { serverUrl: url, pairingCode: code };
  }

  async function handlePair() {
    clearError();

    const payload = validateInputs();
    if (!payload) return;

    setLoading(true);

    try {
      const result = await window.scanner.pair(payload);

      if (result.success) {
        successBanner.style.display = "block";
        btnPair.style.display = "none";
        inputUrl.disabled = true;
        inputCode.disabled = true;
        // Window will be closed by main process after short delay
      } else {
        showError(result.error || "Pairing failed. Please check the code and try again.");
      }
    } catch (err) {
      showError("Unexpected error: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  btnPair.addEventListener("click", handlePair);

  // Submit on Enter in either field
  [inputUrl, inputCode].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handlePair();
    });
  });

  // Focus server URL on load
  inputUrl.focus();
})();
