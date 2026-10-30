const keyInput = document.getElementById("api-key");
const autoCaptureInput = document.getElementById("auto-capture");
const hoverHintInput = document.getElementById("hover-hint");
const status = document.getElementById("status");

function showStatus(text, isError = false) {
  status.textContent = text;
  status.className = isError ? "error" : "";
}

async function accountEmail(apiKey) {
  const res = await fetch("https://api.torbox.app/v1/api/user/me", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.detail || `TorBox answered HTTP ${res.status}`);
  return body.data?.email;
}

browser.storage.local.get({ apiKey: "", autoCapture: true, hoverHint: true }).then((stored) => {
  keyInput.value = stored.apiKey;
  autoCaptureInput.checked = stored.autoCapture;
  hoverHintInput.checked = stored.hoverHint;
});

autoCaptureInput.addEventListener("change", () => browser.storage.local.set({ autoCapture: autoCaptureInput.checked }));
hoverHintInput.addEventListener("change", () => browser.storage.local.set({ hoverHint: hoverHintInput.checked }));

// The toolbar popup opens this page as options.html?popup; the about:addons copy has no page to scan.
if (new URLSearchParams(location.search).has("popup")) {
  document.getElementById("page-tools").hidden = false;
}

document.getElementById("mark-links").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    const count = await browser.tabs.sendMessage(tab.id, { type: "mark" });
    showStatus(count ? `Marked ${count} link${count === 1 ? "" : "s"}.` : "No magnet, .torrent or .nzb links on this page.");
  } catch {
    showStatus("Can't scan this page. Reload it and try again.", true);
  }
});

document.getElementById("get-key").addEventListener("click", () => {
  browser.tabs.create({ url: "https://torbox.app/settings" });
});

document.getElementById("save").addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    await browser.storage.local.remove("apiKey");
    showStatus("API key removed.", true);
    return;
  }
  showStatus("Checking key…");
  try {
    const email = await accountEmail(apiKey);
    await browser.storage.local.set({ apiKey });
    showStatus(`Saved. Connected${email ? ` as ${email}` : ""}.`);
  } catch (error) {
    showStatus(`Key not saved: ${error.message}`, true);
  }
});
