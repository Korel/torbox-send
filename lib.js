// Pure helpers shared by background.js, content.js and options.js; also loaded by node --test.

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(text) {
  let bits = "";
  for (const char of text.toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) return null;
    bits += value.toString(2).padStart(5, "0");
  }
  return bits.match(/.{4}/g).map((nibble) => parseInt(nibble, 2).toString(16)).join("");
}

// The v1 info-hash as 40 lowercase hex chars, or null.
function magnetHash(url) {
  if (!url.startsWith("magnet:")) return null;
  const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  for (const xt of params.getAll("xt")) {
    const match = /^urn:btih:(.+)$/i.exec(xt);
    if (!match) continue;
    const value = match[1];
    if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
    if (/^[a-z2-7]{32}$/i.test(value)) return base32ToHex(value);
  }
  return null;
}

// Magnets, plus .torrent URLs named after their hash (itorrents.org/torrent/<HASH>.torrent).
function linkHash(url) {
  if (url.startsWith("magnet:")) return magnetHash(url);
  try {
    const match = /\/([0-9a-f]{40})\.torrent$/i.exec(new URL(url).pathname);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function isWebUrl(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Links a plain click sends: magnets, and http(s) links to .torrent/.nzb files.
function isCapturable(href) {
  if (href.startsWith("magnet:")) return true;
  return isWebUrl(href) && /\.(torrent|nzb(\.gz)?)$/i.test(new URL(href).pathname);
}

const GENERIC_WORDS = new Set(["download", "dl", "get", "torrent", "magnet", "link", "file", "mirror", "here", "click"]);

// True for labels like "download .torrent" or a bare site name, which say nothing about the release.
function isGenericLinkText(text, href) {
  let host = "";
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {}
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.every((word) => GENERIC_WORDS.has(word) || host.split(".").includes(word));
}

function magnetDisplayName(href) {
  try {
    return new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("dn");
  } catch {
    return null;
  }
}

// Best human name for a listed link, or null to let the caller show its URL.
function linkTitle({ href, text = "", title = "" }, magnetNames) {
  if (href.startsWith("magnet:")) return magnetDisplayName(href) || text || null;
  const hash = linkHash(href);
  if (hash && magnetNames.has(hash)) return magnetNames.get(hash);
  for (const label of [title, text]) {
    if (label && !isGenericLinkText(label, href)) return label;
  }
  let fileName = "";
  try {
    fileName = decodeURIComponent(new URL(href).pathname.split("/").pop());
  } catch {}
  const stem = fileName.replace(/\.(torrent|nzb(\.gz)?)$/i, "");
  return stem && !/^[0-9a-f]{40}$/i.test(stem) ? stem : null;
}

function chunk(items, size) {
  const groups = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

// checkcached answers a list or an object keyed by hash, depending on `format`.
function cachedHashes(body) {
  const data = body?.data;
  const entries = Array.isArray(data) ? data.map((item) => item?.hash) : Object.keys(data || {});
  return new Set(entries.filter((hash) => typeof hash === "string").map((hash) => hash.toLowerCase()));
}

// One answer per url from earlier checks: true/false, or null when unknown or older than ttlMs.
function knownAnswers(urls, cacheChecks, now, ttlMs) {
  return urls.map((url) => {
    const entry = cacheChecks[linkHash(url)];
    return entry && now - entry.at <= ttlMs ? entry.cached : null;
  });
}

function bareHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function parseSiteList(text) {
  return text.split(/\s+/).flatMap((line) => {
    if (!line) return [];
    try {
      const host = bareHost(new URL(line.includes("://") ? line : `https://${line}`).hostname);
      return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host) ? [host] : [];
    } catch {
      return [];
    }
  });
}

function hostMatches(hostname, sites) {
  const host = bareHost(hostname);
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

// The response body as a Blob; rejects with { tooLarge: true } past maxBytes, without buffering the rest.
async function readCapped(res, maxBytes) {
  const tooLarge = () =>
    Object.assign(new Error(`File is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`), { tooLarge: true });
  if (Number(res.headers.get("content-length")) > maxBytes) throw tooLarge();

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type: res.headers.get("content-type") || "" });
}

if (typeof module === "object") {
  module.exports = {
    magnetHash,
    linkHash,
    isGenericLinkText,
    linkTitle,
    chunk,
    cachedHashes,
    parseSiteList,
    hostMatches,
    knownAnswers,
    isWebUrl,
    isCapturable,
    readCapped,
  };
}
