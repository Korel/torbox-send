let autoCapture = true;
browser.storage.local.get({ autoCapture: true }).then((settings) => (autoCapture = settings.autoCapture));
browser.storage.onChanged.addListener((changes) => {
  if (changes.autoCapture) autoCapture = changes.autoCapture.newValue;
});

function isCapturable(href) {
  if (href.startsWith("magnet:")) return true;
  try {
    return /\.(torrent|nzb(\.gz)?)$/i.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

const TOAST_COLORS = { pending: "#2b3440", ok: "#0f7a55", error: "#b3261e" };
let toastHost = null;
let toastBox = null;
let hideTimer = null;

// Inline styles inside a shadow root, so page CSS can't restyle it and page CSP can't block it.
function showToast({ state, title, detail }) {
  if (!toastHost) {
    toastHost = document.createElement("div");
    Object.assign(toastHost.style, { all: "initial", position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647" });
    toastBox = document.createElement("div");
    Object.assign(toastBox.style, {
      maxWidth: "340px", padding: "10px 14px", borderRadius: "8px", color: "#fff", cursor: "pointer",
      font: "13px/1.4 system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,.35)", overflowWrap: "anywhere",
    });
    toastBox.addEventListener("click", () => toastHost.remove());
    toastHost.attachShadow({ mode: "closed" }).append(toastBox);
  }
  const heading = document.createElement("div");
  heading.style.fontWeight = "600";
  heading.textContent = title;
  const body = document.createElement("div");
  body.textContent = detail;
  toastBox.replaceChildren(heading, body);
  toastBox.style.background = TOAST_COLORS[state] || TOAST_COLORS.pending;
  document.documentElement.append(toastHost);

  clearTimeout(hideTimer);
  if (state !== "pending") hideTimer = setTimeout(() => toastHost.remove(), state === "error" ? 8000 : 4000);
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "toast") showToast(message);
});

document.addEventListener(
  "click",
  (event) => {
    // Modifier-clicks pass through so the link can still be opened or downloaded normally.
    if (!autoCapture || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.composedPath().find((el) => el.localName === "a" && typeof el.href === "string" && el.href);
    if (!link || !isCapturable(link.href)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    browser.runtime.sendMessage({ type: "send", url: link.href });
  },
  true,
);
