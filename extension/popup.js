"use strict";
(() => {
  // extension/src/config.ts
  var CONFIG_KEY = "config";
  async function loadConfig() {
    const data = await chrome.storage.local.get(CONFIG_KEY);
    const raw = data?.[CONFIG_KEY] ?? {};
    return { endpoint: String(raw.endpoint ?? ""), token: String(raw.token ?? "") };
  }
  async function saveConfig(config) {
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
  }

  // extension/src/popup.ts
  function el(id) {
    return document.getElementById(id);
  }
  function setStatus(text) {
    el("status").textContent = text;
  }
  async function init() {
    const config = await loadConfig();
    el("endpoint").value = config.endpoint;
    el("token").value = config.token;
  }
  el("config").addEventListener("submit", async (event) => {
    event.preventDefault();
    const endpoint = el("endpoint").value.trim();
    const token = el("token").value.trim();
    await saveConfig({ endpoint, token });
    setStatus("Saved locally.");
  });
  el("backup").addEventListener("click", async () => {
    setStatus("Running backup\u2026");
    try {
      const response = await chrome.runtime.sendMessage({ type: "KIBRAIN_BACKUP_NOW" });
      if (response?.ok) setStatus(`Done: ${JSON.stringify(response.result)}`);
      else setStatus(`Error: ${response?.error ?? "unknown"}`);
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    }
  });
  void init();
})();
