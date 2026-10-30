const keyInput = document.getElementById("api-key");
const autoCaptureInput = document.getElementById("auto-capture");
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

browser.storage.local.get({ apiKey: "", autoCapture: true }).then(({ apiKey, autoCapture }) => {
  keyInput.value = apiKey;
  autoCaptureInput.checked = autoCapture;
});

document.getElementById("get-key").addEventListener("click", () => {
  browser.tabs.create({ url: "https://torbox.app/settings" });
});

document.getElementById("save").addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  await browser.storage.local.set({ autoCapture: autoCaptureInput.checked });
  if (!apiKey) {
    await browser.storage.local.remove("apiKey");
    showStatus("Saved. No API key set.", true);
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
