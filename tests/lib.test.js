const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
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
  parseCheckInput,
  torrentFileInfo,
} = require("../lib.js");
const { createHash } = require("node:crypto");

const HEX = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";

test("magnetHash reads a hex btih and lowercases it", () => {
  assert.equal(magnetHash(`magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=x`), HEX);
});

test("magnetHash converts a base32 btih to hex", () => {
  assert.equal(magnetHash("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK"), HEX);
});

test("magnetHash skips non-btih xt params and rejects junk", () => {
  assert.equal(magnetHash(`magnet:?xt=urn:btmh:1220abcd&xt=urn:btih:${HEX}`), HEX);
  assert.equal(magnetHash("magnet:?xt=urn:btih:nothex"), null);
  assert.equal(magnetHash("https://example.org/a.torrent"), null);
});

test("chunk splits into groups of n", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});

test("cachedHashes accepts list and object response shapes", () => {
  assert.deepEqual(cachedHashes({ data: [{ hash: HEX.toUpperCase() }] }), new Set([HEX]));
  assert.deepEqual(cachedHashes({ data: { [HEX]: { name: "x" } } }), new Set([HEX]));
  assert.deepEqual(cachedHashes({ data: null }), new Set());
});

test("parseSiteList normalizes hosts and pasted URLs", () => {
  assert.deepEqual(parseSiteList(" Example.org\nhttps://www.tracker.net/search?q=1\n\nnot a host!\n"), [
    "example.org",
    "tracker.net",
  ]);
});

test("hostMatches covers subdomains and ignores www", () => {
  const sites = ["example.org"];
  assert.equal(hostMatches("www.example.org", sites), true);
  assert.equal(hostMatches("mirror.example.org", sites), true);
  assert.equal(hostMatches("badexample.org", sites), false);
  assert.equal(hostMatches("example.org.evil.com", sites), false);
});

test("knownAnswers reads fresh entries and leaves unknown or expired ones null", () => {
  const ttl = 600_000;
  const cacheChecks = {
    [HEX]: { cached: true, at: 1_000 },
    ["a".repeat(40)]: { cached: false, at: 1_000 },
    ["b".repeat(40)]: { cached: true, at: 0 },
  };
  const urls = [`magnet:?xt=urn:btih:${HEX}`, `magnet:?xt=urn:btih:${"a".repeat(40)}`, `magnet:?xt=urn:btih:${"b".repeat(40)}`, `magnet:?xt=urn:btih:${"c".repeat(40)}`, "https://x.org/a.torrent"];
  assert.deepEqual(knownAnswers(urls, cacheChecks, 600_500, ttl), [true, false, null, null, null]);
});

test("linkHash reads magnets and .torrent URLs named after their info-hash", () => {
  assert.equal(linkHash(`magnet:?xt=urn:btih:${HEX}`), HEX);
  assert.equal(linkHash(`https://itorrents.org/torrent/${HEX.toUpperCase()}.torrent`), HEX);
  assert.equal(linkHash(`https://itorrents.org/torrent/${HEX}.torrent?title=Some.Name`), HEX);
  assert.equal(linkHash("https://tracker.example/dl/12345/Some.Show.S01E01.torrent"), null);
  assert.equal(linkHash(`https://mega.nz/file/${HEX}`), null);
  assert.equal(linkHash("not a url"), null);
});

test("knownAnswers matches a .torrent URL to the answer for its hash", () => {
  const cacheChecks = { [HEX]: { cached: true, at: 0 } };
  assert.deepEqual(knownAnswers([`https://itorrents.org/torrent/${HEX}.torrent`], cacheChecks, 0, 1), [true]);
});

test("isGenericLinkText spots download labels and bare host names", () => {
  const host = "https://itorrents.org/torrent/x.torrent";
  for (const text of ["", "download .torrent", "Download", "Torrent Download", "ITORRENTS MIRROR", "magnet link", "⬇"]) {
    assert.equal(isGenericLinkText(text, host), true, text);
  }
  for (const text of ["Blue Emanuelle (2026) [1080p]", "Some.Show.S01E01"]) {
    assert.equal(isGenericLinkText(text, host), false, text);
  }
});

test("linkTitle names a .torrent after the magnet with the same hash", () => {
  const magnetNames = new Map([[HEX, "You Can See Everything 2026"]]);
  const torrent = { href: `https://itorrents.org/torrent/${HEX.toUpperCase()}.torrent`, text: "download .torrent", title: "" };
  assert.equal(linkTitle(torrent, magnetNames), "You Can See Everything 2026");
});

test("linkTitle falls back to the title attribute, real link text, then the file name", () => {
  const none = new Map();
  const href = "https://tracker.example/dl/12345/Some.Show.S01E01.1080p.torrent";
  assert.equal(linkTitle({ href, text: "download", title: "Some Show S01E01" }, none), "Some Show S01E01");
  assert.equal(linkTitle({ href, text: "Some Show (2026)", title: "" }, none), "Some Show (2026)");
  assert.equal(linkTitle({ href, text: "download .torrent", title: "" }, none), "Some.Show.S01E01.1080p");
  assert.equal(linkTitle({ href: `https://itorrents.org/torrent/${HEX}.torrent`, text: "download", title: "" }, none), null);
});

test("linkTitle uses a magnet's dn, else its text", () => {
  const none = new Map();
  assert.equal(linkTitle({ href: `magnet:?xt=urn:btih:${HEX}&dn=Some+Name`, text: "magnet", title: "" }, none), "Some Name");
  assert.equal(linkTitle({ href: `magnet:?xt=urn:btih:${HEX}`, text: "Some Name", title: "" }, none), "Some Name");
});

test("isCapturable takes magnets and http(s) .torrent/.nzb links", () => {
  assert.equal(isCapturable(`magnet:?xt=urn:btih:${HEX}`), true);
  assert.equal(isCapturable("https://example.org/dl/a.torrent?key=1"), true);
  assert.equal(isCapturable("http://example.org/a.NZB"), true);
  assert.equal(isCapturable("https://example.org/a.nzb.gz"), true);
  assert.equal(isCapturable("https://example.org/a.zip"), false);
});

test("isCapturable refuses .torrent links that are not http(s)", () => {
  assert.equal(isCapturable("data:text/plain,x.torrent"), false);
  assert.equal(isCapturable("file:///home/me/a.torrent"), false);
  assert.equal(isCapturable("ftp://example.org/a.torrent"), false);
  assert.equal(isCapturable("not a url.torrent"), false);
});

test("isWebUrl is true only for http and https", () => {
  assert.equal(isWebUrl("https://mega.nz/file/abc"), true);
  assert.equal(isWebUrl("http://example.org/"), true);
  assert.equal(isWebUrl("data:text/html,hi"), false);
  assert.equal(isWebUrl("file:///etc/passwd"), false);
  assert.equal(isWebUrl("nonsense"), false);
});

const streamOf = (chunks, onCancel = () => {}) =>
  new ReadableStream({
    pull(controller) {
      if (chunks.length) controller.enqueue(chunks.shift());
      else controller.close();
    },
    cancel: onCancel,
  });

test("readCapped returns the body with its content type when it fits", async () => {
  const res = new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), {
    headers: { "content-type": "application/x-bittorrent" },
  });
  const blob = await readCapped(res, 3);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  assert.equal(blob.type, "application/x-bittorrent");
});

test("readCapped refuses on Content-Length alone, without reading", async () => {
  let pulled = false;
  const body = new ReadableStream({ pull: () => (pulled = true) }, { highWaterMark: 0 });
  const res = new Response(body, { headers: { "content-length": String(50 * 1024 * 1024 + 1) } });
  await assert.rejects(readCapped(res, 50 * 1024 * 1024), { tooLarge: true, message: "File is larger than 50 MB." });
  assert.equal(pulled, false);
});

test("readCapped stops reading a body that outgrows the cap", async () => {
  let cancelled = false;
  const endless = new ReadableStream({
    pull: (controller) => controller.enqueue(new Uint8Array(4)),
    cancel: () => (cancelled = true),
  });
  await assert.rejects(readCapped(new Response(endless), 10), { tooLarge: true });
  assert.equal(cancelled, true);
});

test("parseCheckInput accepts magnets and bare hex or base32 hashes", () => {
  const magnet = `magnet:?xt=urn:btih:${HEX}&dn=Some.Release`;
  assert.deepEqual(parseCheckInput(`  ${magnet}\n`), { hash: HEX, name: "Some.Release", magnet });
  assert.deepEqual(parseCheckInput(HEX.toUpperCase()), { hash: HEX, name: null, magnet: `magnet:?xt=urn:btih:${HEX}` });
  assert.equal(parseCheckInput("YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK").hash, HEX);
});

test("parseCheckInput rejects anything without a v1 info-hash", () => {
  for (const text of ["", "hello", "magnet:?xt=urn:btmh:1220abcd", HEX.slice(1), `https://x.org/${HEX}.torrent`]) {
    assert.equal(parseCheckInput(text), null, text);
  }
});

const bytes = (...parts) => Buffer.concat(parts.map((part) => Buffer.from(part, typeof part === "string" ? "latin1" : undefined)));
const sha1 = (buffer) => createHash("sha1").update(buffer).digest("hex");

test("torrentFileInfo hashes the exact info dict bytes and reads its name", async () => {
  const pieces = Buffer.from([0x00, 0x65, 0x64, 0xff, 0x3a, 0x69]); // contains "e", "d", ":" and "i" bytes
  const info = bytes("d5:filesld6:lengthi-3e4:pathl1:aeee4:name12:Some.Release12:piece lengthi16384e6:pieces6:", pieces, "e");
  const file = bytes("d8:announce14:http://t.org/a4:info", info, "8:url-listl0:ee");
  assert.deepEqual(await torrentFileInfo(new Uint8Array(file)), { hash: sha1(info), name: "Some.Release" });
});

test("torrentFileInfo decodes UTF-8 names and accepts hybrid v1+v2 torrents", async () => {
  const name = Buffer.from("Ünïcode ✓", "utf8");
  const info = bytes(`d12:meta versioni2e4:name${name.length}:`, name, "6:pieces0:e");
  const result = await torrentFileInfo(new Uint8Array(bytes("d4:info", info, "e")));
  assert.deepEqual(result, { hash: sha1(info), name: "Ünïcode ✓" });
});

test("torrentFileInfo flags v2-only torrents and rejects junk", async () => {
  const v2 = bytes("d4:infod9:file treede12:meta versioni2e4:name1:xee");
  assert.deepEqual(await torrentFileInfo(new Uint8Array(v2)), { error: "v2-only" });
  for (const junk of ["", "not bencode", "d4:infoi1ee", "d4:name1:xe", "d4:infod4:name1:x", "l4:infoe"]) {
    assert.equal(await torrentFileInfo(new Uint8Array(bytes(junk))), null, junk);
  }
});
