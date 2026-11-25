// Renders the toolbar popup in Playwright's Firefox (Gecko, what the add-on ships on).
// Screenshots land in test-results/ui/ for a human look; nothing is compared against baselines.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { firefox } from "playwright";

const POPUP_URL = `${pathToFileURL(fileURLToPath(new URL("../../options.html", import.meta.url)))}?popup`;
const STUB = fileURLToPath(new URL("./browser-stub.js", import.meta.url));
const SCREENSHOTS = fileURLToPath(new URL("../../test-results/ui/", import.meta.url));
const POPUP_WIDTH = 400; // options.html: body { width: 25rem }
const BUTTON_LABELS = { "check-cache": ["Check cache", "Checking…", "⚡ 100 cached", "None cached", "Check failed"] };

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
      visible(".links-footer .btn").map((b) => JSON.stringify(b.getBoundingClientRect())).join();

    check("initial");
    const initialBoxes = buttonBoxes();
    for (const [id, texts] of Object.entries(labels)) {
      const button = document.getElementById(id);
      if (!button || button.hidden) continue;
      const original = button.textContent;
      for (const text of texts) {
        button.textContent = text;
        check(`${id}="${text}"`);
        if (buttonBoxes() !== initialBoxes) problems.push(`${id}="${text}": footer buttons move`);
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
    await page.close();
  });
}
