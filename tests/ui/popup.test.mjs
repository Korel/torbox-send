// Renders the toolbar popup in Playwright's Firefox (Gecko, what the add-on ships on).
// Screenshots land in test-results/ui/ for a human look; nothing is compared against baselines.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { firefox } from "playwright";

const POPUP_URL = `${pathToFileURL(fileURLToPath(new URL("../../options.html", import.meta.url)))}?popup`;
const STUB = fileURLToPath(new URL("./browser-stub.js", import.meta.url));
const SCREENSHOTS = fileURLToPath(new URL("../../test-results/ui/", import.meta.url));
const POPUP_WIDTH = 400; // options.html: body { width: 25rem }
const BUTTON_LABELS = { "check-cache": ["Check cache", "Checking…", "⚡ 100 cached", "None cached", "Check failed"] };
const CHECK_LABELS = { "check-send": ["Send", "Sending…", "Added ✓", "Failed"] };
const CHECK_PAGE_URL = POPUP_URL.replace("?popup", "?check");

const LONG_NAME = "A.Very.Long.Release.Name.That.Goes.On.And.On.2026.2160p.UHD.BluRay.REMUX.HDR.DV.TrueHD.Atmos-EXAMPLE";
const INFO = Buffer.from(`d4:name${LONG_NAME.length}:${LONG_NAME}12:piece lengthi16384e6:pieces0:e`, "latin1");
const TORRENT = Buffer.concat([Buffer.from("d8:announce14:http://t.org/a4:info"), INFO, Buffer.from("e")]);
const TORRENT_HASH = createHash("sha1").update(INFO).digest("hex");

// Drops TORRENT on the popup the way a file dragged in from the desktop arrives.
function dropTorrent(page, selector = "body") {
  return page.evaluate(([bytes, selector]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "Some.Release.torrent", { type: "application/x-bittorrent" }));
    const target = document.querySelector(selector);
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }, [[...TORRENT], selector]);
}

async function openCheckPage(colorScheme) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, colorScheme });
  await page.addInitScript({ path: STUB });
  await page.goto(CHECK_PAGE_URL);
  await page.waitForSelector("#check-view:not([hidden])");
  return page;
}

const sentOf = (page, type) => page.evaluate((type) => window.sentMessages.filter((m) => m.type === type), type);

let browser;
before(async () => {
  browser = await firefox.launch();
});
after(() => browser?.close());

const POPUP_MAX_HEIGHT = 600; // Firefox caps popups at 800x600

async function openPopup(colorScheme, { extraReleases = 0, storedSettings = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT }, colorScheme });
  await page.addInitScript(([count, stored]) => Object.assign(window, { extraReleases: count, storedSettings: stored }), [
    extraReleases,
    storedSettings,
  ]);
  await page.addInitScript({ path: STUB });
  await page.goto(POPUP_URL);
  await page.waitForSelector("#links li");
  return page;
}

// Problems a user would see: horizontal scroll, clipped or wrapped text, buttons moving with their label.
function layoutProblems(page, labels = {}) {
  return page.evaluate((labels) => {
    const problems = [];
    const root = document.documentElement;
    const visible = (selector) => [...document.querySelectorAll(selector)].filter((el) => el.getClientRects().length);
    const check = (state) => {
      if (root.scrollWidth > root.clientWidth) problems.push(`${state}: page is ${root.scrollWidth}px wide`);
      for (const el of visible(".btn, .legend, .tabs button, .kinds button, #theme-toggle")) {
        const name = el.id || el.className;
        if (el.scrollWidth > el.clientWidth) problems.push(`${state}: "${el.textContent.trim()}" clipped in ${name}`);
        if (el.getBoundingClientRect().right > root.clientWidth) problems.push(`${state}: ${name} sticks out`);
      }
      // Only text node boxes: icons sit at a different top than the text beside them.
      for (const el of visible(".legend, .btn")) {
        const lineTops = new Set();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) lineTops.add(Math.round(rect.top));
        }
        if (lineTops.size > 1) problems.push(`${state}: "${el.textContent.trim()}" wraps`);
      }
    };
    const buttonBoxes = () =>
      visible(".links-footer .btn, #check-send").map((b) => JSON.stringify(b.getBoundingClientRect())).join();

    check("initial");
    const initialBoxes = buttonBoxes();
    for (const [id, texts] of Object.entries(labels)) {
      const button = document.getElementById(id);
      if (!button || button.hidden) continue;
      const original = button.textContent;
      for (const text of texts) {
        button.textContent = text;
        check(`${id}="${text}"`);
        if (buttonBoxes() !== initialBoxes) problems.push(`${id}="${text}": buttons move`);
      }
      button.textContent = original;
    }
    return problems;
  }, labels);
}

const realCacheChecks = (page) =>
  page.evaluate(() => window.sentMessages.filter((m) => m.type === "check-cached" && !m.knownOnly));

const visibleTitles = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#links li:not([hidden]) .link-title")].map((el) => el.textContent));

test("opening the popup asks TorBox nothing until Check cache is clicked", async () => {
  const page = await openPopup("light");
  await page.waitForTimeout(100);
  assert.deepEqual(await realCacheChecks(page), []);

  await page.click("#check-cache");
  await page.waitForSelector(".tag.cached");
  assert.equal((await realCacheChecks(page)).length, 1);
  await page.close();
});

test("opening the popup on a listed site checks the whole page in one request", async () => {
  const page = await openPopup("light", { storedSettings: { autoCheckSites: ["example-tracker.org"] } });
  await page.waitForSelector(".tag.cached");
  const checks = await realCacheChecks(page);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].urls.length, 3, "two magnets and the hash-named .torrent");
  assert.equal(await page.textContent("#check-cache"), "⚡ 1 cached");
  assert.match(await page.textContent("#auto-check"), /when the popup opens/);
  await page.close();
});

test("theme button switches light/dark and the choice survives reopening", async () => {
  const page = await openPopup("dark");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const darkBackground = await background();
  assert.equal(await page.getAttribute("#theme-toggle", "aria-label"), "Switch to light theme");

  await page.click("#theme-toggle");
  assert.notEqual(await background(), darkBackground);
  assert.equal(await page.getAttribute("#theme-toggle", "aria-label"), "Switch to dark theme");

  await page.reload();
  await page.waitForSelector("#links li");
  assert.notEqual(await background(), darkBackground, "still light after reopening");
  await page.screenshot({ path: `${SCREENSHOTS}popup-light-chosen.png` });

  await page.click("#theme-toggle");
  assert.equal(await background(), darkBackground);
  await page.close();
});

test("tabs split magnets, .torrent files and other links", async () => {
  const page = await openPopup("light");
  const tabs = await page.locator(".kinds button").allTextContents();
  assert.deepEqual(tabs, ["Magnets 2", ".torrent 2", "Other 1"]);
  assert.deepEqual(await visibleTitles(page), [
    "You.Can.See.Everything.2026.1080p.WEB-DL.DDP5.1.H.264-EXAMPLE",
    "Another.Really.Long.Release.Name.2026.2160p.UHD.BluRay",
  ]);

  await page.click(".kinds button[data-kind=torrent]");
  // The itorrents link takes its magnet's name; the other falls back to its file name.
  assert.deepEqual(await visibleTitles(page), [
    "You.Can.See.Everything.2026.1080p.WEB-DL.DDP5.1.H.264-EXAMPLE",
    "Some.Show.S01E01.1080p.WEB",
  ]);

  await page.click(".kinds button[data-kind=other]");
  assert.deepEqual(await visibleTitles(page), ["Mega mirror"]);
  await page.close();
});

test("a .torrent with its magnet's hash shares the cache result", async () => {
  const page = await openPopup("light");
  await page.click("#check-cache");
  await page.waitForSelector(".tag.cached");
  assert.equal(await page.textContent("#check-cache"), "⚡ 1 cached");
  await page.click(".kinds button[data-kind=torrent]");
  assert.equal(await page.locator("#links li:not([hidden]) .tag.cached").count(), 1);
  await page.close();
});

test("a long list scrolls inside the popup, which itself never scrolls", async () => {
  const page = await openPopup("dark", { extraReleases: 170 });
  const fit = await page.evaluate(() => {
    const root = document.documentElement;
    const footer = document.getElementById("check-cache").getBoundingClientRect();
    return { width: root.scrollWidth, height: root.scrollHeight, footerBottom: Math.ceil(footer.bottom) };
  });
  await page.screenshot({ path: `${SCREENSHOTS}popup-long-list.png` });
  assert.ok(fit.width <= POPUP_WIDTH, `popup is ${fit.width}px wide`);
  assert.ok(fit.height <= POPUP_MAX_HEIGHT, `popup is ${fit.height}px tall`);
  assert.ok(fit.footerBottom <= POPUP_MAX_HEIGHT, `Check cache ends at ${fit.footerBottom}px`);
  await page.close();
});

test("Ask before sending is off by default, stores its choice, and needs Send on click", async () => {
  const page = await openPopup("light");
  await page.click("#tab-settings");
  assert.equal(await page.isChecked("#confirm-capture"), false);

  await page.click("label:has(#confirm-capture)");
  assert.deepEqual(await page.evaluate(() => window.storageWrites), [{ confirmCapture: true }]);

  await page.click("label:has(#auto-capture)");
  assert.equal(await page.isDisabled("#confirm-capture"), true, "nothing to confirm when clicks don't send");
  await page.close();

  const stored = await openPopup("light", { storedSettings: { confirmCapture: true } });
  assert.equal(await stored.isChecked("#confirm-capture"), true);
  await stored.close();
});

test("Check tab checks a pasted magnet and sends it", async () => {
  const page = await openPopup("light");
  await page.click("#tab-check");
  const magnet = `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=Pasted.Release`;
  await page.fill("#check-input", magnet);
  await page.waitForSelector("#check-sub .tag.cached");
  assert.equal(await page.textContent("#check-name"), "Pasted.Release");
  assert.deepEqual((await realCacheChecks(page)).map((m) => m.urls), [[`magnet:?xt=urn:btih:${"a".repeat(40)}`]]);

  await page.click("#check-send");
  await page.waitForSelector("#check-send.done");
  assert.deepEqual(await sentOf(page, "send"), [{ type: "send", url: magnet, tabId: 1, quiet: false }]);

  await page.fill("#check-input", "not a hash");
  assert.equal(await page.isHidden("#check-result"), true);
  assert.match(await page.textContent("#check-status"), /magnet|hash/i);
  assert.equal((await realCacheChecks(page)).length, 1, "junk asks TorBox nothing");
  await page.close();
});

test("dropping a .torrent anywhere on the popup checks its hash and sends the file", async () => {
  const page = await openPopup("light");
  await dropTorrent(page, "#links");
  await page.waitForSelector("#check-view:not([hidden]) #check-sub:has-text('Not cached')");
  assert.equal(await page.getAttribute("#tab-check", "aria-selected"), "true");
  assert.equal(await page.textContent("#check-name"), LONG_NAME);
  assert.deepEqual((await realCacheChecks(page)).map((m) => m.urls), [[`magnet:?xt=urn:btih:${TORRENT_HASH}`]]);

  await page.click("#check-send");
  await page.waitForSelector("#check-send.done");
  const [sent] = await sentOf(page, "send-file");
  assert.equal(sent.name, "Some.Release.torrent");
  assert.deepEqual(Buffer.from(Object.values(sent.bytes)), TORRENT);
  await page.close();
});

test("a dropped file that isn't a usable torrent says so and asks TorBox nothing", async () => {
  const page = await openPopup("light");
  await page.click("#tab-check");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["hello"], "notes.txt"));
    document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForSelector("#check-status.error");
  assert.equal(await page.isHidden("#check-result"), true);
  assert.deepEqual(await realCacheChecks(page), []);
  await page.close();
});

test("Choose file in the popup opens the Check tab as a full page, where the picker works", async () => {
  const popup = await openPopup("light");
  await popup.click("#tab-check");
  await popup.click("#choose-file");
  const [created] = await popup.evaluate(() => window.createdTabs);
  assert.match(created.url, /options\.html\?check$/);
  await popup.close();

  const page = await openCheckPage("light");
  assert.equal(await page.isHidden("#tab-links"), true);
  assert.equal(await page.isVisible("#tab-settings"), true);
  await page.setInputFiles("#torrent-file", { name: "Some.Release.torrent", mimeType: "application/x-bittorrent", buffer: TORRENT });
  await page.waitForSelector("#check-sub:has-text('Not cached')");
  await page.click("#check-send");
  await page.waitForSelector("#check-send.done");
  const [sent] = await sentOf(page, "send-file");
  assert.equal(sent.quiet, true, "the page shows the outcome; no toast or notification");
  await page.close();
});

for (const scheme of ["light", "dark"]) {
  test(`Check tab layout holds (${scheme})`, async () => {
    const popup = await openPopup(scheme);
    await popup.click("#tab-check");
    const emptyProblems = await layoutProblems(popup);
    await popup.screenshot({ path: `${SCREENSHOTS}check-empty-${scheme}.png`, fullPage: true });
    assert.deepEqual(emptyProblems, []);

    await dropTorrent(popup);
    await popup.waitForSelector("#check-sub:has-text('Not cached')");
    const problems = await layoutProblems(popup, CHECK_LABELS);
    await popup.screenshot({ path: `${SCREENSHOTS}check-${scheme}.png`, fullPage: true });
    assert.deepEqual(problems, []);

    await popup.fill("#check-input", "nope");
    await popup.screenshot({ path: `${SCREENSHOTS}check-error-${scheme}.png`, fullPage: true });
    assert.deepEqual(await layoutProblems(popup), []);
    await popup.close();

    const page = await openCheckPage(scheme);
    const pageProblems = await layoutProblems(page);
    await page.screenshot({ path: `${SCREENSHOTS}check-page-${scheme}.png` });
    assert.deepEqual(pageProblems, []);
    await page.close();
  });
}

for (const scheme of ["light", "dark"]) {
  test(`popup layout holds at ${POPUP_WIDTH}px (${scheme})`, async () => {
    const page = await openPopup(scheme);
    await page.click("#check-cache");
    await page.waitForSelector(".tag.cached");
    const problems = await layoutProblems(page, BUTTON_LABELS);
    await page.screenshot({ path: `${SCREENSHOTS}popup-${scheme}.png`, fullPage: true });
    assert.deepEqual(problems, []);

    for (const kind of ["torrent", "other"]) {
      await page.click(`.kinds button[data-kind=${kind}]`);
      const kindProblems = await layoutProblems(page);
      await page.screenshot({ path: `${SCREENSHOTS}popup-${kind}-${scheme}.png`, fullPage: true });
      assert.deepEqual(kindProblems, [], kind);
    }

    await page.click("#tab-settings");
    const settingsProblems = await layoutProblems(page);
    await page.screenshot({ path: `${SCREENSHOTS}settings-${scheme}.png`, fullPage: true });
    assert.deepEqual(settingsProblems, []);
    const settingsCutOff = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main.scrollHeight - main.clientHeight;
    });
    assert.ok(settingsCutOff <= 0, `settings need scrolling: ${settingsCutOff}px don't fit the popup`);
    await page.close();
  });
}
