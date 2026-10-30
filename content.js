const settings = { autoCapture: true, hoverHint: true };
browser.storage.local.get(settings).then((stored) => Object.assign(settings, stored));
browser.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in settings) settings[key] = newValue;
  }
});

function isCapturable(href) {
  if (href.startsWith("magnet:")) return true;
  try {
    return /\.(torrent|nzb(\.gz)?)$/i.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

function capturableLink(event) {
  const link = event.composedPath().find((el) => el.localName === "a" && typeof el.href === "string" && el.href);
  return link && isCapturable(link.href) ? link : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function cubeIcon(size) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  const faces = [
    ["16,2 29,9.5 16,17 3,9.5", "#8cdc78"],
    ["3,9.5 16,17 16,30 3,22.5", "#3cac6c"],
    ["16,17 29,9.5 29,22.5 16,30", "#1c8062"],
  ];
  for (const [points, fill] of faces) {
    const face = document.createElementNS(SVG_NS, "polygon");
    face.setAttribute("points", points);
    face.setAttribute("fill", fill);
    svg.append(face);
  }
  return svg;
}

// Our UI lives in closed shadow roots styled via CSSOM, so page CSS can't restyle it and page CSP can't block it.
function shadowHost(tag, hostStyle, ...children) {
  const host = document.createElement(tag);
  Object.assign(host.style, { all: "initial", ...hostStyle });
  host.attachShadow({ mode: "closed" }).append(...children);
  return host;
}

const TOAST_COLORS = { pending: "#2b3440", ok: "#0f7a55", error: "#b3261e" };
const toastBox = document.createElement("div");
Object.assign(toastBox.style, {
  maxWidth: "340px", padding: "10px 14px", borderRadius: "8px", color: "#fff", cursor: "pointer",
  font: "13px/1.4 system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,.35)", overflowWrap: "anywhere",
});
const toastHost = shadowHost("div", { position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647" }, toastBox);
toastBox.addEventListener("click", () => toastHost.remove());
let toastTimer = null;

function showToast({ state, title, detail }) {
  const heading = document.createElement("div");
  heading.style.fontWeight = "600";
  heading.textContent = title;
  const body = document.createElement("div");
  body.textContent = detail;
  toastBox.replaceChildren(heading, body);
  toastBox.style.background = TOAST_COLORS[state] || TOAST_COLORS.pending;
  document.documentElement.append(toastHost);

  clearTimeout(toastTimer);
  if (state !== "pending") toastTimer = setTimeout(() => toastHost.remove(), state === "error" ? 8000 : 4000);
}

const hintLabel = document.createElement("span");
hintLabel.textContent = "Click: send to TorBox";
const hintBox = document.createElement("div");
Object.assign(hintBox.style, {
  display: "flex", alignItems: "center", gap: "5px", padding: "3px 8px 3px 5px", borderRadius: "6px",
  background: "#1c2128", color: "#e6edf3", font: "12px/1.3 system-ui, sans-serif", whiteSpace: "nowrap",
  boxShadow: "0 2px 8px rgba(0,0,0,.35)",
});
hintBox.append(cubeIcon(14), hintLabel);
const hintHost = shadowHost("div", { position: "fixed", zIndex: "2147483647", pointerEvents: "none" }, hintBox);
let hintedLink = null;

function hideHint() {
  hintedLink = null;
  hintHost.remove();
}

document.addEventListener(
  "mouseover",
  (event) => {
    if (!settings.autoCapture || !settings.hoverHint) return;
    const link = capturableLink(event);
    if (!link) return hideHint();
    if (link === hintedLink) return;
    hintedLink = link;
    hintHost.style.left = `${Math.min(event.clientX + 12, innerWidth - 170)}px`;
    hintHost.style.top = `${Math.min(event.clientY + 16, innerHeight - 30)}px`;
    document.documentElement.append(hintHost);
  },
  true,
);
document.addEventListener("scroll", hideHint, true);
document.documentElement.addEventListener("mouseleave", hideHint);

const markedLinks = new WeakSet();

function markLinks() {
  let count = 0;
  for (const link of document.querySelectorAll("a[href]")) {
    if (!isCapturable(link.href)) continue;
    count++;
    if (markedLinks.has(link)) continue;
    markedLinks.add(link);
    const marker = shadowHost("span", { display: "inline-block", verticalAlign: "middle", marginLeft: "4px" }, cubeIcon(14));
    marker.title = "TorBox Send can send this link";
    link.after(marker);
  }
  return count;
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "toast") showToast(message);
  if (message?.type === "mark") {
    const count = markLinks();
    // Only the top frame always answers, so the popup gets a reply even when no frame has matches.
    if (count || window === window.top) return Promise.resolve(count);
  }
});

document.addEventListener(
  "click",
  (event) => {
    hideHint();
    // Modifier-clicks pass through so the link can still be opened or downloaded normally.
    if (!settings.autoCapture || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = capturableLink(event);
    if (!link) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    browser.runtime.sendMessage({ type: "send", url: link.href });
  },
  true,
);
