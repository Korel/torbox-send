const keyInput = document.getElementById("api-key");
const autoCaptureInput = document.getElementById("auto-capture");
const hoverHintInput = document.getElementById("hover-hint");
const includeStreamSitesInput = document.getElementById("include-stream-sites");
const status = document.getElementById("status");
const linksStatus = document.getElementById("links-status");
const linksList = document.getElementById("links");

function showStatus(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

async function accountEmail(apiKey) {
  const res = await fetch("https://api.torbox.app/v1/api/user/me", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.detail || `TorBox answered HTTP ${res.status}`);
  return body.data?.email;
}

// --- Settings ---

autoCaptureInput.addEventListener("change", () => browser.storage.local.set({ autoCapture: autoCaptureInput.checked }));
hoverHintInput.addEventListener("change", () => browser.storage.local.set({ hoverHint: hoverHintInput.checked }));
includeStreamSitesInput.addEventListener("change", () =>
  browser.storage.local.set({ includeStreamSites: includeStreamSitesInput.checked }),
);

document.getElementById("get-key").addEventListener("click", () => {
  browser.tabs.create({ url: "https://torbox.app/settings" });
});

document.getElementById("save").addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    await browser.storage.local.remove("apiKey");
    showStatus(status, "API key removed.", true);
    return;
  }
  showStatus(status, "Checking key…");
  try {
    const email = await accountEmail(apiKey);
    await browser.storage.local.set({ apiKey });
    showStatus(status, `Saved. Connected${email ? ` as ${email}` : ""}.`);
  } catch (error) {
    showStatus(status, `Key not saved: ${error.message}`, true);
  }
});

// --- Links on the current page (toolbar popup only) ---

let pageTabId = null;
let linkCount = 0;

function linkSubtitle(href) {
  if (href.startsWith("magnet:")) return "magnet link";
  try {
    const url = new URL(href);
    return url.hostname.replace(/^www\./, "") + url.pathname;
  } catch {
    return href;
  }
}

function magnetName(href) {
  try {
    return new URL(href).searchParams.get("dn");
  } catch {
    return null;
  }
}

function button(text, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const GREEN_CUBE = ["#8cdc78", "#3cac6c", "#1c8062"];
const BLUE_CUBE = ["#8cc8f0", "#3c8cd0", "#1c5c9c"];

function cubeIcon(size, colors) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  const faces = ["16,2 29,9.5 16,17 3,9.5", "3,9.5 16,17 16,30 3,22.5", "16,17 29,9.5 29,22.5 16,30"];
  faces.forEach((points, i) => {
    const face = document.createElementNS(SVG_NS, "polygon");
    face.setAttribute("points", points);
    face.setAttribute("fill", colors[i]);
    svg.append(face);
  });
  return svg;
}

document.getElementById("legend").replaceChildren(cubeIcon(12, GREEN_CUBE), "click sends", cubeIcon(12, BLUE_CUBE), "hoster");

function addLinkRow(link, frameId) {
  const row = document.createElement("li");

  const cube = cubeIcon(18, link.clickable ? GREEN_CUBE : BLUE_CUBE);
  cube.append(Object.assign(document.createElementNS(SVG_NS, "title"), {
    textContent: link.clickable ? "Click on the page sends it" : "Hoster link: right-click to send",
  }));

  const text = document.createElement("div");
  text.className = "link-text";
  const title = document.createElement("div");
  title.className = "link-title";
  title.textContent = (link.href.startsWith("magnet:") && magnetName(link.href)) || link.text || linkSubtitle(link.href);
  title.title = link.href;
  const subtitle = document.createElement("div");
  subtitle.className = "link-sub";
  subtitle.textContent = linkSubtitle(link.href);
  if (link.isPage || link.hidden) {
    const tag = document.createElement("span");
    tag.className = link.isPage ? "tag page" : "tag";
    tag.textContent = link.isPage ? "this page" : "hidden";
    subtitle.prepend(tag);
  }
  text.append(title, subtitle);

  const send = button("Send", "btn sm primary", async () => {
    send.disabled = true;
    send.textContent = "Sending…";
    const result = await browser.runtime.sendMessage({ type: "send", url: link.href, tabId: pageTabId });
    send.textContent = result?.ok ? "Added ✓" : "Failed";
    send.className = `btn sm ${result?.ok ? "done" : "failed"}`;
    send.title = result?.ok ? "" : result?.error || "";
    send.disabled = !!result?.ok;
  });
  row.append(cube, text, send);
  if (!link.isPage) {
    const show = button("Show", "btn sm", () => browser.tabs.sendMessage(pageTabId, { type: "reveal", index: link.index }, { frameId }));
    show.disabled = link.hidden;
    if (link.hidden) show.title = "Not visible on the page, e.g. inside a collapsed menu";
    row.append(show);
  }
  linksList.append(row);
}

async function loadLinks() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  pageTabId = tab.id;
  const requestId = crypto.randomUUID();
  let topFrameAnswered = false;

  const pageIsSendable = tab.url && (await browser.runtime.sendMessage({ type: "is-sendable-page", url: tab.url }));
  if (pageIsSendable) addLinkRow({ href: tab.url, text: tab.title, clickable: false, hidden: false, isPage: true });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "links" || message.requestId !== requestId || sender.tab?.id !== pageTabId) return;
    if (sender.frameId === 0) topFrameAnswered = true;
    for (const link of message.links) addLinkRow(link, sender.frameId);
    linkCount += message.links.length;
    const other = pageIsSendable ? " other" : "";
    showStatus(
      linksStatus,
      linkCount
        ? `${linkCount}${other} sendable link${linkCount === 1 ? "" : "s"} on this page.`
        : `No${other} magnet, .torrent, .nzb or hoster links on this page.`,
    );
  });

  browser.tabs.sendMessage(pageTabId, { type: "list", requestId }).catch(() => {});
  setTimeout(() => {
    if (!topFrameAnswered) showStatus(linksStatus, "Can't read this page. Reload it and try again.", true);
  }, 1500);
}

const markButton = document.getElementById("mark-links");
markButton.addEventListener("click", async () => {
  try {
    await browser.tabs.sendMessage(pageTabId, { type: "mark" });
    markButton.textContent = "Marked";
  } catch {
    markButton.textContent = "Can't mark this page";
  }
  markButton.disabled = true;
});

function selectTab(name) {
  for (const view of ["links", "settings"]) {
    document.getElementById(`tab-${view}`).setAttribute("aria-selected", String(view === name));
    document.getElementById(`${view}-view`).hidden = view !== name;
  }
}

document.getElementById("tab-links").addEventListener("click", () => selectTab("links"));
document.getElementById("tab-settings").addEventListener("click", () => selectTab("settings"));

browser.storage.local.get({ apiKey: "", autoCapture: true, hoverHint: true, includeStreamSites: false }).then((stored) => {
  keyInput.value = stored.apiKey;
  autoCaptureInput.checked = stored.autoCapture;
  hoverHintInput.checked = stored.hoverHint;
  includeStreamSitesInput.checked = stored.includeStreamSites;

  // The toolbar popup opens this page as options.html?popup; the about:addons copy has no page to list.
  if (new URLSearchParams(location.search).has("popup")) {
    document.getElementById("tabs").hidden = false;
    selectTab(stored.apiKey ? "links" : "settings");
    loadLinks();
  }
});
