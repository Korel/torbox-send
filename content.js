const settings = { autoCapture: true, confirmCapture: false, hoverHint: true, includeStreamSites: false, autoCheckSites: [] };
let hosterEntries = [];
let hosterRules = null; // compiled on first use

function setHosters(hosters) {
  hosterEntries = hosters?.entries || [];
  hosterRules = null;
}

browser.storage.local.get(settings).then((stored) => Object.assign(settings, stored));
browser.storage.local.get("hosters").then(({ hosters }) => setHosters(hosters));
browser.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in settings) settings[key] = newValue;
  }
  if (changes.hosters) setHosters(changes.hosters.newValue);
});

function isHosterLink(href) {
  hosterRules ??= hosterEntries.flatMap(({ pattern, stream }) => {
    try {
      return [{ regex: new RegExp(pattern, "i"), stream }];
    } catch {
      return [];
    }
  });
  return hosterRules.some((rule) => (settings.includeStreamSites || !rule.stream) && rule.regex.test(href));
}

function capturableLink(event) {
  const link = event.composedPath().find((el) => el.localName === "a" && typeof el.href === "string" && el.href);
  return link && isCapturable(link.href) ? link : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const GREEN_CUBE = ["#8cdc78", "#3cac6c", "#1c8062"];

function cubeIcon(size, colors = GREEN_CUBE) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  const faces = [
    ["16,2 29,9.5 16,17 3,9.5", colors[0]],
    ["3,9.5 16,17 16,30 3,22.5", colors[1]],
    ["16,17 29,9.5 29,22.5 16,30", colors[2]],
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

// clientWidth/Height leave out scrollbars, which innerWidth/Height include.
function visibleSize() {
  return {
    width: Math.min(innerWidth, document.documentElement.clientWidth),
    height: Math.min(innerHeight, document.documentElement.clientHeight),
  };
}

const TOAST_COLORS = { pending: "#2b3440", ok: "#0f7a55", error: "#b3261e" };
const toastBox = document.createElement("div");
Object.assign(toastBox.style, {
  maxWidth: "340px", padding: "10px 14px", borderRadius: "8px", color: "#fff", cursor: "pointer",
  font: "13px/1.4 system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,.35)", overflowWrap: "anywhere",
});
const toastHost = shadowHost("div", { position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647" }, toastBox);
// A toast goes away on any click; a prompt only through its buttons, Escape or its timeout.
toastBox.addEventListener("click", () => promptedHref === null && toastHost.remove());
let toastTimer = null;
let promptedHref = null;

function showToast({ state, title, detail }) {
  const heading = document.createElement("div");
  heading.style.fontWeight = "600";
  heading.textContent = title;
  const body = document.createElement("div");
  body.textContent = detail;
  toastBox.replaceChildren(heading, body);
  toastBox.style.background = TOAST_COLORS[state] || TOAST_COLORS.pending;
  toastBox.style.cursor = "pointer";
  promptedHref = null;
  Object.assign(toastHost.style, { left: "auto", top: "auto", right: "16px", bottom: "16px" });
  document.documentElement.append(toastHost);

  clearTimeout(toastTimer);
  if (state !== "pending") toastTimer = setTimeout(() => toastHost.remove(), state === "error" ? 8000 : 4000);
}

const PROMPT_ARM_MS = 500;
const PROMPT_TIMEOUT_MS = 15000;

function promptButton(label, background, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    flex: "none", padding: "4px 14px", border: "1px solid rgba(255,255,255,.35)", borderRadius: "6px",
    background, color: "#fff", font: "inherit", fontWeight: "600", whiteSpace: "nowrap", cursor: "pointer",
  });
  button.addEventListener("click", onClick);
  return button;
}

function closePrompt() {
  promptedHref = null;
  clearTimeout(toastTimer);
  toastHost.remove();
}

// "Ask before sending": the clicked link waits here until the user picks Send.
function showPrompt(link, pointer) {
  const href = link.href;
  const shownAt = performance.now();
  const heading = document.createElement("div");
  heading.style.fontWeight = "600";
  heading.textContent = "Send to TorBox?";
  const name = document.createElement("div");
  Object.assign(name.style, { display: "-webkit-box", overflow: "hidden" });
  name.style.setProperty("-webkit-box-orient", "vertical");
  name.style.setProperty("-webkit-line-clamp", "3");
  const label = { href, text: link.textContent.trim().replace(/\s+/g, " ").slice(0, 120), title: link.title.trim().slice(0, 120) };
  name.textContent = linkTitle(label, new Map()) || href;

  const send = promptButton("Send", "#17946a", (event) => {
    // Not armed at once, so the second half of a double-click on the link can't confirm it;
    // untrusted clicks come from the page's script.
    if (!event.isTrusted || performance.now() - shownAt < PROMPT_ARM_MS) return;
    closePrompt();
    browser.runtime.sendMessage({ type: "send", url: href });
  });
  const buttons = document.createElement("div");
  Object.assign(buttons.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" });
  buttons.append(promptButton("Cancel", "transparent", closePrompt), send);

  toastBox.replaceChildren(heading, name, buttons);
  toastBox.style.background = TOAST_COLORS.pending;
  toastBox.style.cursor = "default";
  promptedHref = href;
  document.documentElement.append(toastHost);
  // Below the pointer, or above it at the bottom of the window, so the buttons never open under the pointer.
  const { width, height } = toastBox.getBoundingClientRect();
  const visible = visibleSize();
  const below = pointer.y + 16;
  const top = below + height + 4 <= visible.height ? below : pointer.y - height - 12;
  Object.assign(toastHost.style, {
    right: "auto", bottom: "auto",
    left: `${Math.max(4, Math.min(pointer.x, visible.width - width - 4))}px`,
    top: `${Math.max(4, top)}px`,
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(closePrompt, PROMPT_TIMEOUT_MS);
}

document.addEventListener("keydown", (event) => {
  if (event.isTrusted && event.key === "Escape" && promptedHref !== null) closePrompt();
}, true);

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
let hintPointer = { x: 0, y: 0 };

// Measured, not assumed: the label grows when the link turns out to be cached.
function placeHint() {
  const { width, height } = hintBox.getBoundingClientRect();
  const visible = visibleSize();
  hintHost.style.left = `${Math.max(0, Math.min(hintPointer.x + 12, visible.width - width - 4))}px`;
  hintHost.style.top = `${Math.max(0, Math.min(hintPointer.y + 16, visible.height - height - 4))}px`;
}

const HINT = "Click: send to TorBox";
const CACHED_HINT = "Click: send to TorBox · ⚡ cached";
const HOVER_CHECK_DELAY_MS = 400; // only links the pointer rests on, so a sweep down a list asks nothing
let hoverCheckTimer = null;

// knownOnly asks the background for earlier answers (e.g. the popup's Check cache), sending nothing to TorBox.
async function askCached(link, knownOnly) {
  const answers = await browser.runtime
    .sendMessage({ type: "check-cached", urls: [link.href], knownOnly })
    .catch(() => null);
  const cached = answers?.[0] ?? null;
  if (cached && hintedLink === link) {
    hintLabel.textContent = CACHED_HINT;
    placeHint();
  }
  return cached;
}

async function showHintCacheState(link) {
  hintLabel.textContent = HINT;
  if (!linkHash(link.href)) return;
  const known = await askCached(link, true);
  if (known !== null || hintedLink !== link || !hostMatches(location.hostname, settings.autoCheckSites || [])) return;
  hoverCheckTimer = setTimeout(() => hintedLink === link && askCached(link, false), HOVER_CHECK_DELAY_MS);
}

function hideHint() {
  clearTimeout(hoverCheckTimer);
  hintedLink = null;
  hintHost.remove();
}

document.addEventListener(
  "mouseover",
  (event) => {
    // Untrusted events come from the page's own script, which must not be able to make us ask TorBox.
    if (!event.isTrusted || !settings.autoCapture || !settings.hoverHint) return;
    const link = capturableLink(event);
    if (!link) return hideHint();
    if (link === hintedLink) return;
    clearTimeout(hoverCheckTimer);
    hintedLink = link;
    showHintCacheState(link);
    hintPointer = { x: event.clientX, y: event.clientY };
    document.documentElement.append(hintHost);
    placeHint();
  },
  true,
);
// Only scrolls that move the hovered link: self-scrolling carousels fire scroll events non-stop.
document.addEventListener(
  "scroll",
  (event) => {
    if (hintedLink && (event.target === document || event.target.contains?.(hintedLink))) hideHint();
  },
  true,
);
document.documentElement.addEventListener("mouseleave", hideHint);

// TorBox's hoster patterns cover whole domains (github.com, youtube.com), so on those sites
// every internal link would match; only links leaving the current site count as hoster links.
function isOtherSiteHosterLink(link) {
  return link.hostname.replace(/^www\./, "") !== location.hostname.replace(/^www\./, "") && isHosterLink(link.href);
}

function sendableLinks() {
  return [...document.querySelectorAll("a[href]")].flatMap((link) => {
    if (isCapturable(link.href)) return [{ link, clickable: true }];
    if (isOtherSiteHosterLink(link)) return [{ link, clickable: false }];
    return [];
  });
}

let listedLinks = [];

// Every frame reports its own links straight to the popup, since tabs.sendMessage returns only one frame's reply.
function reportLinks(requestId) {
  const found = sendableLinks();
  listedLinks = found.map(({ link }) => link);
  if (found.length === 0 && window !== window.top) return;
  const links = found.map(({ link, clickable }, index) => ({
    index,
    clickable,
    href: link.href,
    text: link.textContent.trim().replace(/\s+/g, " ").slice(0, 120),
    title: link.title.trim().slice(0, 120),
    hidden: link.getClientRects().length === 0,
  }));
  browser.runtime.sendMessage({ type: "links", requestId, links }).catch(() => {});
}

function revealLink(link) {
  if (!link?.isConnected) return;
  link.scrollIntoView({ behavior: "smooth", block: "center" });
  const { outline, outlineOffset } = link.style;
  Object.assign(link.style, { outline: "3px solid #f5a623", outlineOffset: "2px" });
  setTimeout(() => Object.assign(link.style, { outline, outlineOffset }), 2500);
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "toast") showToast(message);
  if (message?.type === "list") reportLinks(message.requestId);
  if (message?.type === "reveal") revealLink(listedLinks[message.index]);
});

document.addEventListener(
  "click",
  (event) => {
    hideHint();
    // Only the user's own clicks: a page's script could otherwise send links by calling link.click().
    if (!event.isTrusted) return;
    // Modifier-clicks pass through so the link can still be opened or downloaded normally.
    if (!settings.autoCapture || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = capturableLink(event);
    if (!link) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    // Keyboard clicks (detail 0) carry no pointer position, so the prompt hangs off the link itself.
    const rect = link.getBoundingClientRect();
    const pointer = event.detail === 0 ? { x: rect.left, y: rect.bottom - 12 } : { x: event.clientX, y: event.clientY };
    if (settings.confirmCapture) showPrompt(link, pointer);
    else browser.runtime.sendMessage({ type: "send", url: link.href });
  },
  true,
);
