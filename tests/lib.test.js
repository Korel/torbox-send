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
} = require("../lib.js");

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
