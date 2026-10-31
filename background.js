const API = "https://api.torbox.app/v1/api";
const MENU_ID = "send-to-torbox";
const MARK_MENU_ID = "mark-sendable-links";
const SEND_PAGE_MENU_ID = "send-page-to-torbox";

const TORRENT_TYPE = /application\/(x-)?bittorrent/i;
const NZB_TYPE = /application\/(x-)?nzb/i;
const TORRENT_NAME = /\.torrent$/i;
const NZB_NAME = /\.nzb(\.gz)?$/i;

const HOSTERS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let hosterRules = null; // [{ regex, stream }]; null until a list was ever fetched

function compileRules(entries) {
  return entries.flatMap(({ pattern, stream }) => {
    try {
      return [{ regex: new RegExp(pattern, "i"), stream }];
    } catch {
      return [];
    }
  });
}

// TorBox's public list of supported hosters; fetched without credentials and matched locally.
// "stream" entries are video/social sites (YouTube, Twitter, …), skipped unless the user opts in.
async function refreshHosters() {
  try {
    const res = await fetch(`${API}/webdl/hosters`);
    const body = await res.json();
    const entries = (body.data || [])
      .filter((hoster) => typeof hoster.regex === "string")
      .map((hoster) => ({ pattern: hoster.regex, stream: hoster.type === "stream" }));
    if (!res.ok || entries.length === 0) return;
    await browser.storage.local.set({ hosters: { fetchedAt: Date.now(), entries } });
    hosterRules = compileRules(entries);
  } catch {}
}

async function loadHosters() {
  const { hosters } = await browser.storage.local.get("hosters");
  if (hosters?.entries) hosterRules = compileRules(hosters.entries);
  if (!hosters?.entries || Date.now() - hosters.fetchedAt > HOSTERS_MAX_AGE_MS) await refreshHosters();
}

const hostersReady = loadHosters();

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function urlFileName(url) {
  try {
    return safeDecode(new URL(url).pathname.split("/").pop());
  } catch {
    return "";
  }
}

function responseFileName(res, url) {
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename\*=(?:UTF-8'')?([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  if (match) return safeDecode((match[1] || match[2]).trim());
  return urlFileName(url) || "download";
}

function fileKind(res, name) {
  const type = res.headers.get("content-type") || "";
  if (TORRENT_TYPE.test(type) || TORRENT_NAME.test(name)) return "torrent";
  if (NZB_TYPE.test(type) || NZB_NAME.test(name)) return "nzb";
  return null;
}

// Downloads the link only if it turns out to be a .torrent/.nzb; anything else is aborted after the headers.
async function fetchTorrentOrNzb(url) {
  const controller = new AbortController();
  try {
    const res = await fetch(url, { credentials: "include", signal: controller.signal });
    const name = responseFileName(res, url);
    const kind = res.ok ? fileKind(res, name) : null;
    if (kind) return { kind, name, blob: await res.blob() };
    controller.abort();
  } catch {}
  return null;
}

async function post(path, fields) {
  const { apiKey } = await browser.storage.local.get("apiKey");
  if (!apiKey) throw new Error("No API key set. Add one in the add-on's options.");

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) form.append(key, ...value);
    else form.append(key, value);
  }
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(body.detail || body.error || `TorBox answered HTTP ${res.status}`);
  }
  return body;
}

async function send(url) {
  if (!(await browser.permissions.contains({ origins: ["<all_urls>"] }))) {
    throw new Error("Website access is off. Open the TorBox Send popup and click Grant access.");
  }
  if (url.startsWith("magnet:"))return post("/torrents/createtorrent", { magnet: url });

  const file = await fetchTorrentOrNzb(url);
  if (file?.kind === "torrent") return post("/torrents/createtorrent", { file: [file.blob, file.name] });
  if (file?.kind === "nzb") return post("/usenet/createusenetdownload", { file: [file.blob, file.name] });

  const name = urlFileName(url);
  if (TORRENT_NAME.test(name)) throw new Error("Couldn't download the .torrent file from that site.");
  // TorBox fetches the NZB itself; this only helps for public links.
  if (NZB_NAME.test(name)) return post("/usenet/createusenetdownload", { link: url });
  return post("/webdl/createwebdownload", { link: url });
}

// failOpen: with no hoster list yet, say yes rather than hide a link TorBox could take.
async function isSendable(url, { failOpen = true } = {}) {
  const name = urlFileName(url);
  if (url.startsWith("magnet:") || TORRENT_NAME.test(name) || NZB_NAME.test(name)) return true;
  await hostersReady;
  if (hosterRules === null) return failOpen;
  const { includeStreamSites } = await browser.storage.local.get({ includeStreamSites: false });
  return hosterRules.some((rule) => (includeStreamSites || !rule.stream) && rule.regex.test(url));
}

function displayName(url) {
  if (url.startsWith("magnet:")) {
    try {
      return new URL(url).searchParams.get("dn") || "Magnet link";
    } catch {
      return "Magnet link";
    }
  }
  return urlFileName(url) || url;
}

// Shown in the page; falls back to an OS notification where content scripts can't run (about: pages, PDF viewer).
async function report(tabId, state, title, detail) {
  if (tabId >= 0) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "toast", state, title, detail }, { frameId: 0 });
      return;
    } catch {}
  }
  if (state !== "pending") {
    browser.notifications.create({ type: "basic", iconUrl: "icon.png", title, message: detail });
  }
}

async function sendAndReport(url, tabId) {
  const name = displayName(url);
  await report(tabId, "pending", "Sending to TorBox…", name);
  try {
    const body = await send(url);
    const addedName = body.data?.name || name;
    await report(tabId, "ok", "Added to TorBox", addedName);
    return { ok: true, name: addedName };
  } catch (error) {
    await report(tabId, "error", "Not added to TorBox", error.message);
    return { ok: false, error: error.message };
  }
}

async function markAndReport(tabId) {
  let counts;
  try {
    counts = await browser.tabs.sendMessage(tabId, { type: "mark" });
  } catch {
    return report(tabId, "error", "Can't scan this page", "Reload it and try again.");
  }
  if (!counts?.total) return report(tabId, "ok", "Nothing to mark", "No magnet, .torrent, .nzb or hoster links on this page.");
  const title = `Marked ${counts.total} sendable link${counts.total === 1 ? "" : "s"}`;
  const detail = counts.hosters ? "Green: click to send. Blue: right-click → Send to TorBox." : "Click a marked link to send it.";
  await report(tabId, "ok", title, detail);
}

function createMenu() {
  browser.menus.removeAll().then(() => {
    browser.menus.create({ id: MENU_ID, title: "Send to TorBox", contexts: ["link"] });
    // Not on links, so a link's menu keeps a single "Send to TorBox" entry instead of a submenu.
    browser.menus.create({ id: MARK_MENU_ID, title: "Mark sendable links on this page", contexts: ["page", "frame", "selection"] });
    browser.menus.create({ id: SEND_PAGE_MENU_ID, title: "Send this page to TorBox", contexts: ["page", "frame", "selection"], visible: false });
  });
}

browser.runtime.onInstalled.addListener(createMenu);
browser.runtime.onStartup.addListener(createMenu);

browser.menus.onShown.addListener(async (info) => {
  const updates = [];
  if (info.contexts.includes("link") && info.linkUrl) {
    updates.push(browser.menus.update(MENU_ID, { visible: await isSendable(info.linkUrl) }));
  }
  if (info.pageUrl) {
    updates.push(browser.menus.update(SEND_PAGE_MENU_ID, { visible: await isSendable(info.pageUrl, { failOpen: false }) }));
  }
  await Promise.all(updates);
  browser.menus.refresh();
});

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) sendAndReport(info.linkUrl, tab?.id);
  if (info.menuItemId === SEND_PAGE_MENU_ID && info.pageUrl) sendAndReport(info.pageUrl, tab?.id);
  if (info.menuItemId === MARK_MENU_ID && tab?.id >= 0) markAndReport(tab.id);
});

// Content scripts send from their own tab; the popup has no tab and passes the page's tab along.
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || typeof message?.url !== "string") return;
  if (message.type === "send") return sendAndReport(message.url, sender.tab?.id ?? message.tabId);
  if (message.type === "is-sendable-page") return isSendable(message.url, { failOpen: false });
});
