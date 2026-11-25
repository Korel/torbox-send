const keyInput = document.getElementById("api-key");
const autoCaptureInput = document.getElementById("auto-capture");
const hoverHintInput = document.getElementById("hover-hint");
const includeStreamSitesInput = document.getElementById("include-stream-sites");
const autoCheckSitesInput = document.getElementById("auto-check-sites");
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

// --- Website access ---
// Firefox lets users switch host permissions off; without them TorBox's CORS rules block the API calls.

const ALL_SITES = { origins: ["<all_urls>"] };
const accessBanner = document.getElementById("access-banner");

async function updateAccessBanner() {
  accessBanner.hidden = await browser.permissions.contains(ALL_SITES);
}

document.getElementById("grant-access").addEventListener("click", () => {
  // Called directly in the click handler: Firefox only prompts in response to a user action.
  browser.permissions.request(ALL_SITES).then(updateAccessBanner);
});
browser.permissions.onAdded.addListener(updateAccessBanner);
browser.permissions.onRemoved.addListener(updateAccessBanner);
updateAccessBanner();

// --- Theme ---
// theme.js applies a stored choice before first paint; without one the browser's preference wins.

const themeToggle = document.getElementById("theme-toggle");
const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const SUN_RAYS = "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";
const THEME_ICONS = {
  light: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ["path", { d: SUN_RAYS }],
  ],
  dark: [["path", { d: "M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" }]],
};
const ICON_STYLE = { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", "stroke-width": 2 };

function themeIcon(theme) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ ...ICON_STYLE, "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(name, value);
  }
  for (const [tag, attributes] of THEME_ICONS[theme]) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

const currentTheme = () => document.documentElement.dataset.theme || (prefersDark.matches ? "dark" : "light");

// The icon shows where a click goes: a sun in dark mode, a moon in light mode.
function showThemeToggle() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  themeToggle.replaceChildren(themeIcon(next));
  themeToggle.setAttribute("aria-label", `Switch to ${next} theme`);
  themeToggle.title = `Switch to ${next} theme`;
}

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
  showThemeToggle();
});
prefersDark.addEventListener("change", showThemeToggle);
showThemeToggle();

// --- Settings ---

autoCaptureInput.addEventListener("change", () => browser.storage.local.set({ autoCapture: autoCaptureInput.checked }));
hoverHintInput.addEventListener("change", () => browser.storage.local.set({ hoverHint: hoverHintInput.checked }));
includeStreamSitesInput.addEventListener("change", () =>
  browser.storage.local.set({ includeStreamSites: includeStreamSitesInput.checked }),
);

let autoCheckSites = [];

function setAutoCheckSites(sites) {
  autoCheckSites = sites;
  autoCheckSitesInput.value = sites.join("\n");
  updateAutoCheckRow();
}

autoCheckSitesInput.addEventListener("change", () => {
  const sites = parseSiteList(autoCheckSitesInput.value);
  setAutoCheckSites(sites);
  browser.storage.local.set({ autoCheckSites: sites });
});

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

function boltIcon(size) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  const bolt = document.createElementNS(SVG_NS, "polygon");
  bolt.setAttribute("points", "18,2 6,18 15,18 13,30 26,13 17,13");
  bolt.setAttribute("fill", "#f5b301");
  bolt.setAttribute("stroke", "#9a6b00");
  bolt.setAttribute("stroke-width", "1.5");
  svg.append(bolt);
  return svg;
}

document.getElementById("legend").replaceChildren(
  cubeIcon(12, GREEN_CUBE), "click sends", cubeIcon(12, BLUE_CUBE), "hoster", boltIcon(12), "cached",
);

const LINK_KINDS = [
  ["magnet", "Magnets"],
  ["torrent", ".torrent"],
  ["other", "Other"],
];
const kindsBar = document.getElementById("kinds");
const rows = []; // { link, kind, hash, item, title, subtitle }
let activeKind = null;

function linkKind(link) {
  if (link.isPage) return "page";
  if (link.href.startsWith("magnet:")) return "magnet";
  return /\.torrent$/i.test(linkSubtitle(link.href)) ? "torrent" : "other";
}

// A .torrent named "download" gets the name of the magnet with the same hash, possibly from another frame.
function nameRows() {
  const magnetNames = new Map();
  for (const row of rows) {
    const name = row.kind === "magnet" && row.hash && magnetDisplayName(row.link.href);
    if (name) magnetNames.set(row.hash, name);
  }
  for (const row of rows) {
    const name = row.kind === "magnet" || row.kind === "torrent" ? linkTitle(row.link, magnetNames) : row.link.text;
    row.title.textContent = name || linkSubtitle(row.link.href);
  }
}

function showKinds() {
  const counts = new Map(LINK_KINDS.map(([kind]) => [kind, 0]));
  for (const row of rows) if (counts.has(row.kind)) counts.set(row.kind, counts.get(row.kind) + 1);
  const present = LINK_KINDS.filter(([kind]) => counts.get(kind));
  if (!counts.get(activeKind)) activeKind = present[0]?.[0] ?? null;

  kindsBar.hidden = present.length < 2;
  kindsBar.replaceChildren(
    ...present.map(([kind, label]) => {
      const count = Object.assign(document.createElement("span"), { className: "count", textContent: counts.get(kind) });
      const tab = button("", "", () => {
        activeKind = kind;
        showKinds();
      });
      tab.dataset.kind = kind;
      tab.setAttribute("aria-selected", String(kind === activeKind));
      tab.append(`${label} `, count);
      return tab;
    }),
  );
  for (const row of rows) row.item.hidden = row.kind !== "page" && row.kind !== activeKind;
}

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
  rows.push({ link, kind: linkKind(link), hash: linkHash(link.href), item: row, title, subtitle });
}

// Rows whose hash is known without downloading: magnets and hash-named .torrent links.
const hashedRows = () => rows.filter((row) => row.hash);

// knownOnly: show answers the background already has, without asking TorBox.
async function tagCachedRows(checkedRows, { knownOnly = false } = {}) {
  const urls = checkedRows.map((row) => row.link.href);
  const answers = await browser.runtime.sendMessage({ type: "check-cached", urls, knownOnly });
  if (!Array.isArray(answers)) return [];
  checkedRows.forEach(({ subtitle }, i) => {
    if (answers[i] !== true || subtitle.querySelector(".tag.cached")) return;
    const tag = document.createElement("span");
    tag.className = "tag cached";
    tag.textContent = "⚡ cached";
    tag.title = "Already cached on TorBox: adds instantly";
    subtitle.prepend(tag);
  });
  return answers;
}

// Counts releases, not links: a magnet and its .torrent share one hash.
function showCacheResult(checkedRows, answers) {
  const cached = new Set(checkedRows.filter((_, i) => answers[i] === true).map((row) => row.hash)).size;
  const allKnown = answers.length > 0 && answers.every((answer) => answer !== null);
  checkCacheButton.textContent = allKnown ? (cached ? `⚡ ${cached} cached` : "None cached") : "Check cache";
  checkCacheButton.disabled = allKnown;
}

const checkCacheButton = document.getElementById("check-cache");

// Hashes already answered come from the background's store, so re-running only asks TorBox about new ones.
async function checkCache() {
  checkCacheButton.disabled = true;
  checkCacheButton.textContent = "Checking…";
  const checkedRows = hashedRows();
  const answers = await tagCachedRows(checkedRows);
  if (answers.some((answer) => answer !== null)) return showCacheResult(checkedRows, answers);
  checkCacheButton.textContent = "Check failed";
  checkCacheButton.disabled = false;
}

checkCacheButton.addEventListener("click", checkCache);

// --- Automatic cache checks for the current site (toolbar popup only) ---

const autoCheckRow = document.getElementById("auto-check");
const autoCheckText = document.getElementById("auto-check-text");
const autoCheckToggle = document.getElementById("auto-check-toggle");
let pageHost = null;

function updateAutoCheckRow() {
  autoCheckRow.hidden = !pageHost;
  if (!pageHost) return;
  const on = hostMatches(pageHost, autoCheckSites);
  const site = pageHost.replace(/^www\./, "");
  autoCheckText.textContent = on ? `Cache check on ${site}: when the popup opens.` : `Cache check on ${site}: on demand.`;
  autoCheckToggle.textContent = on ? "Check only on demand" : "Check when the popup opens";
}

autoCheckToggle.addEventListener("click", () => {
  const host = parseSiteList(pageHost)[0];
  const sites = hostMatches(pageHost, autoCheckSites)
    ? autoCheckSites.filter((site) => !hostMatches(pageHost, [site]))
    : [...autoCheckSites, host];
  setAutoCheckSites(sites);
  browser.storage.local.set({ autoCheckSites: sites });
});

async function loadLinks() {
  if (!(await browser.permissions.contains(ALL_SITES))) {
    showStatus(linksStatus, "Grant website access above to list links.", true);
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  pageTabId = tab.id;
  if (/^https?:/.test(tab.url || "")) pageHost = new URL(tab.url).hostname;
  updateAutoCheckRow();
  const requestId = crypto.randomUUID();
  let topFrameAnswered = false;

  const pageIsSendable = tab.url && (await browser.runtime.sendMessage({ type: "is-sendable-page", url: tab.url }));
  if (pageIsSendable) {
    addLinkRow({ href: tab.url, text: tab.title, clickable: false, hidden: false, isPage: true });
    nameRows();
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "links" || message.requestId !== requestId || sender.tab?.id !== pageTabId) return;
    if (sender.frameId === 0) topFrameAnswered = true;
    for (const link of message.links) addLinkRow(link, sender.frameId);
    nameRows();
    showKinds();
    linkCount += message.links.length;
    const other = pageIsSendable ? " other" : "";
    showStatus(
      linksStatus,
      linkCount
        ? `${linkCount}${other} sendable link${linkCount === 1 ? "" : "s"} on this page.`
        : `No${other} magnet, .torrent, .nzb or hoster links on this page.`,
    );

    const checkedRows = hashedRows();
    checkCacheButton.hidden = checkedRows.length === 0;
    if (!checkedRows.length) return;
    if (pageHost && hostMatches(pageHost, autoCheckSites)) checkCache();
    // Elsewhere only restores earlier answers (e.g. from a previous popup), without a request to TorBox.
    else tagCachedRows(checkedRows, { knownOnly: true }).then((answers) => showCacheResult(checkedRows, answers));
  });

  browser.tabs.sendMessage(pageTabId, { type: "list", requestId }).catch(() => {});
  setTimeout(() => {
    if (!topFrameAnswered) showStatus(linksStatus, "Can't read this page. Reload it and try again.", true);
  }, 1500);
}

function selectTab(name) {
  for (const view of ["links", "settings"]) {
    document.getElementById(`tab-${view}`).setAttribute("aria-selected", String(view === name));
    document.getElementById(`${view}-view`).hidden = view !== name;
  }
}

document.getElementById("tab-links").addEventListener("click", () => selectTab("links"));
document.getElementById("tab-settings").addEventListener("click", () => selectTab("settings"));

const DEFAULTS = { apiKey: "", autoCapture: true, hoverHint: true, includeStreamSites: false, autoCheckSites: [] };
browser.storage.local.get(DEFAULTS).then((stored) => {
  keyInput.value = stored.apiKey;
  autoCaptureInput.checked = stored.autoCapture;
  hoverHintInput.checked = stored.hoverHint;
  includeStreamSitesInput.checked = stored.includeStreamSites;
  setAutoCheckSites(stored.autoCheckSites);

  // The toolbar popup opens this page as options.html?popup; the about:addons copy has no page to list.
  if (new URLSearchParams(location.search).has("popup")) {
    document.getElementById("tabs").hidden = false;
    selectTab(stored.apiKey ? "links" : "settings");
    loadLinks();
  }
});
