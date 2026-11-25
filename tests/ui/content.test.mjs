// Runs the real content script on a fixture page in Playwright's Firefox.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { firefox } from "playwright";

const file = (path) => fileURLToPath(new URL(path, import.meta.url));
// Served from a real host name, since the add-on's site list matches on it.
const PAGE_URL = "http://tracker.test/search";
const LISTED = { autoCheckSites: ["tracker.test"] };

let browser;
before(async () => {
  browser = await firefox.launch();
});
after(() => browser?.close());

async function openPage({ knownCached = null, storedSettings = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route("http://tracker.test/**", (route) => route.fulfill({ path: file("./fixtures/tracker-page.html") }));
  await page.addInitScript((stored) => (window.storedSettings = stored), storedSettings);
  // Our UI uses closed shadow roots; open them so the test can read the badge text.
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
  await page.addInitScript((source) => (window.knownCached = source && new RegExp(source, "i")), knownCached);
  await page.addInitScript({ path: file("./browser-stub.js") });
  await page.goto(PAGE_URL);
  await page.addScriptTag({ path: file("../../lib.js") });
  await page.addScriptTag({ path: file("../../content.js") });
  await page.waitForTimeout(100); // settings load from storage
  return page;
}

const badgeText = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find(
      (el) => el.style.position === "fixed" && el.style.pointerEvents === "none",
    );
    return host ? host.shadowRoot.textContent : null;
  });

const realChecks = (page) =>
  page.evaluate(() => window.sentMessages.filter((m) => m.type === "check-cached" && !m.knownOnly));

test("loading a listed site sends nothing to TorBox", async () => {
  const page = await openPage({ storedSettings: LISTED });
  await page.waitForTimeout(700);
  assert.deepEqual(await realChecks(page), []);
  await page.close();
});

test("on a listed site, resting on a link checks just that link", async () => {
  const page = await openPage({ storedSettings: LISTED });
  await page.hover("#cached-magnet");
  await page.waitForTimeout(600);
  const checks = await realChecks(page);
  assert.deepEqual(checks.map((m) => m.urls.length), [1]);
  assert.match(checks[0].urls[0], /a{40}/);
  assert.match((await badgeText(page)) ?? "", /cached/);
  await page.close();
});

test("passing over links quickly checks nothing", async () => {
  const page = await openPage({ storedSettings: LISTED });
  await page.hover("#cached-magnet");
  await page.waitForTimeout(150);
  await page.hover("#plain-magnet");
  await page.waitForTimeout(150);
  await page.mouse.move(700, 500);
  await page.waitForTimeout(600);
  assert.deepEqual(await realChecks(page), []);
  await page.close();
});

test("on other sites, resting on a link sends nothing to TorBox", async () => {
  const page = await openPage();
  await page.hover("#cached-magnet");
  await page.waitForTimeout(600);
  assert.deepEqual(await realChecks(page), []);
  await page.close();
});

test("hover badge stays while another part of the page scrolls by itself", async () => {
  const page = await openPage();
  await page.hover("#plain-magnet");
  await page.waitForTimeout(300); // the carousel scrolls every 20ms
  assert.match((await badgeText(page)) ?? "", /send to TorBox/);

  await page.evaluate(() => window.scrollBy(0, 40));
  await page.waitForTimeout(50);
  assert.equal(await badgeText(page), null, "scrolling the page moves the link, so the badge goes");
  await page.close();
});

test("hover badge says cached when an earlier check found it, without asking TorBox", async () => {
  const page = await openPage({ knownCached: "a{40}" });
  await page.hover("#cached-magnet");
  await page.waitForTimeout(100);
  assert.match((await badgeText(page)) ?? "", /cached/);
  await page.screenshot({ path: file("../../test-results/ui/hover-cached.png"), clip: { x: 0, y: 0, width: 500, height: 160 } });

  await page.hover("#plain-magnet");
  await page.waitForTimeout(100);
  assert.doesNotMatch((await badgeText(page)) ?? "", /cached/);

  const asked = await page.evaluate(() => window.sentMessages.filter((m) => m.type === "check-cached" && !m.knownOnly));
  assert.deepEqual(asked, []);
  await page.close();
});
