const API = "https://api.torbox.app/v1/api";
const MENU_ID = "send-to-torbox";
const MARK_MENU_ID = "mark-sendable-links";

const TORRENT_TYPE = /application\/(x-)?bittorrent/i;
const NZB_TYPE = /application\/(x-)?nzb/i;
const TORRENT_NAME = /\.torrent$/i;
const NZB_NAME = /\.nzb(\.gz)?$/i;

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
  if (url.startsWith("magnet:")) return post("/torrents/createtorrent", { magnet: url });

  const file = await fetchTorrentOrNzb(url);
  if (file?.kind === "torrent") return post("/torrents/createtorrent", { file: [file.blob, file.name] });
  if (file?.kind === "nzb") return post("/usenet/createusenetdownload", { file: [file.blob, file.name] });

  const name = urlFileName(url);
  if (TORRENT_NAME.test(name)) throw new Error("Couldn't download the .torrent file from that site.");
  // TorBox fetches the NZB itself; this only helps for public links.
  if (NZB_NAME.test(name)) return post("/usenet/createusenetdownload", { link: url });
  return post("/webdl/createwebdownload", { link: url });
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
    await report(tabId, "ok", "Added to TorBox", body.data?.name || name);
  } catch (error) {
    await report(tabId, "error", "Not added to TorBox", error.message);
  }
}

async function markAndReport(tabId) {
  let count;
  try {
    count = await browser.tabs.sendMessage(tabId, { type: "mark" });
  } catch {
    return report(tabId, "error", "Can't scan this page", "Reload it and try again.");
  }
  if (count) await report(tabId, "ok", `Marked ${count} sendable link${count === 1 ? "" : "s"}`, "Look for the cube next to each link.");
  else await report(tabId, "ok", "Nothing to mark", "No magnet, .torrent or .nzb links on this page.");
}

function createMenu() {
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({ id: MENU_ID, title: "Send to TorBox", contexts: ["link"] });
    // Not on links, so a link's menu keeps a single "Send to TorBox" entry instead of a submenu.
    browser.contextMenus.create({ id: MARK_MENU_ID, title: "Mark sendable links on this page", contexts: ["page", "frame", "selection"] });
  });
}

browser.runtime.onInstalled.addListener(createMenu);
browser.runtime.onStartup.addListener(createMenu);

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) sendAndReport(info.linkUrl, tab?.id);
  if (info.menuItemId === MARK_MENU_ID && tab?.id >= 0) markAndReport(tab.id);
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === browser.runtime.id && message?.type === "send" && typeof message.url === "string") {
    sendAndReport(message.url, sender.tab?.id);
  }
});
