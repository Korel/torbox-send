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

const badgeBox = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((el) => el.style.pointerEvents === "none");
    const { left, right } = host.shadowRoot.firstElementChild.getBoundingClientRect();
    return { left, right, width: innerWidth };
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

test("hover badge stays inside the window next to the right edge, also once it says cached", async () => {
  const page = await openPage({ knownCached: "a{40}" });
  await page.hover("#edge-magnet");
  await page.waitForTimeout(100);
  assert.match((await badgeText(page)) ?? "", /cached/);
  const box = await badgeBox(page);
  await page.screenshot({ path: file("../../test-results/ui/hover-edge.png"), clip: { x: 400, y: 0, width: 400, height: 200 } });
  assert.ok(box.right <= box.width, `badge ends at ${box.right}px in a ${box.width}px window`);
  assert.ok(box.left >= 0);
  await page.close();
});

const sends = (page) => page.evaluate(() => window.sentMessages.filter((m) => m.type === "send"));
// Stands in for the browser's own handling, so an uncaptured magnet click goes nowhere.
const ignoreUncapturedClicks = (page) =>
  page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()));

test("a real click on a magnet sends it", async () => {
  const page = await openPage();
  await page.click("#plain-magnet");
  assert.deepEqual((await sends(page)).map((m) => m.url.slice(0, 60)), ["magnet:?xt=urn:btih:" + "b".repeat(40)]);
  await page.close();
});

test("a click made by the page's own script sends nothing", async () => {
  const page = await openPage();
  await ignoreUncapturedClicks(page);
  await page.evaluate(() => {
    document.getElementById("plain-magnet").click();
    document.getElementById("cached-magnet").dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  assert.deepEqual(await sends(page), []);
  await page.close();
});

test("on a listed site, a hover made by the page's own script checks nothing", async () => {
  const page = await openPage({ storedSettings: LISTED });
  await page.evaluate(() =>
    document.getElementById("cached-magnet").dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 50, clientY: 50 })),
  );
  await page.waitForTimeout(600);
  assert.deepEqual(await realChecks(page), []);
  assert.deepEqual(await page.evaluate(() => window.sentMessages), []);
  await page.close();
});

// --- "Ask before sending" prompt ---

const ASK = { confirmCapture: true };
const PROMPT_ARM_MS = 500; // content.js: Send ignores clicks for this long after the prompt appears

const promptState = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find(
      (el) => el.style.position === "fixed" && el.style.pointerEvents !== "none" && el.shadowRoot,
    );
    if (!host) return null;
    const box = host.shadowRoot.firstElementChild;
    return { text: box.textContent, buttons: [...box.querySelectorAll("button")].map((b) => b.textContent) };
  });

const sendButton = (page) => page.getByRole("button", { name: "Send", exact: true });
const cancelButton = (page) => page.getByRole("button", { name: "Cancel", exact: true });

test("with Ask before sending on, a click shows a prompt and sends nothing yet", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  const prompt = await promptState(page);
  assert.match(prompt.text, /Send to TorBox\?/);
  assert.match(prompt.text, /Other\.Release/);
  assert.deepEqual(prompt.buttons, ["Cancel", "Send"]);
  assert.deepEqual(await sends(page), []);
  await page.close();
});

test("the prompt's Send button sends the link and closes the prompt", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  await page.waitForTimeout(PROMPT_ARM_MS + 100);
  await sendButton(page).click();
  assert.deepEqual((await sends(page)).map((m) => m.url.slice(20, 60)), ["b".repeat(40)]);
  assert.equal(await promptState(page), null);
  await page.close();
});

test("the prompt's Cancel button and Escape send nothing and close the prompt", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  await cancelButton(page).click();
  assert.equal(await promptState(page), null);

  await page.click("#cached-magnet");
  assert.notEqual(await promptState(page), null);
  await page.keyboard.press("Escape");
  assert.equal(await promptState(page), null);
  assert.deepEqual(await sends(page), []);
  await page.close();
});

test("Send ignores a click that lands right as the prompt appears", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  await sendButton(page).click({ timeout: PROMPT_ARM_MS - 100 });
  assert.deepEqual(await sends(page), [], "a double-click must not confirm its own prompt");
  assert.notEqual(await promptState(page), null);
  await page.close();
});

test("the prompt's Send button ignores clicks made by the page's own script", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  await page.waitForTimeout(PROMPT_ARM_MS + 100);
  // Only possible here because the test opens our shadow roots; kept as a second line of defence.
  await page.evaluate(() => {
    const host = [...document.documentElement.children].find((el) => el.shadowRoot && el.style.pointerEvents !== "none");
    for (const button of host.shadowRoot.querySelectorAll("button")) if (button.textContent === "Send") button.click();
  });
  assert.deepEqual(await sends(page), []);
  await page.close();
});

test("a second click replaces the prompt, and Send sends only the latest link", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  await page.click("#cached-magnet");
  assert.match((await promptState(page)).text, /Cached\.Release/);
  await page.waitForTimeout(PROMPT_ARM_MS + 100);
  await sendButton(page).click();
  assert.deepEqual((await sends(page)).map((m) => m.url.slice(20, 60)), ["a".repeat(40)]);
  await page.close();
});

test("prompt layout holds with a very long name", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#long-magnet");
  const problems = await page.evaluate(() => {
    const host = [...document.documentElement.children].find((el) => el.shadowRoot && el.style.pointerEvents !== "none");
    const box = host.shadowRoot.firstElementChild;
    const found = [];
    const rect = box.getBoundingClientRect();
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) found.push("prompt leaves the window");
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) found.push("page scrolls sideways");
    const buttons = [...box.querySelectorAll("button")];
    for (const button of buttons) {
      const b = button.getBoundingClientRect();
      if (button.scrollWidth > button.clientWidth) found.push(`"${button.textContent}" is clipped`);
      if (b.left < rect.left || b.right > rect.right || b.bottom > rect.bottom) found.push(`"${button.textContent}" sticks out`);
      const range = document.createRange();
      range.selectNodeContents(button);
      if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) found.push(`"${button.textContent}" wraps`);
    }
    const tops = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    if (tops.size !== 1) found.push("buttons are not on one row");
    return found;
  });
  await page.screenshot({ path: file("../../test-results/ui/prompt-long-name.png"), clip: { x: 0, y: 0, width: 500, height: 400 } });
  assert.deepEqual(problems, []);

  await page.click("#plain-magnet");
  await page.screenshot({ path: file("../../test-results/ui/prompt.png"), clip: { x: 0, y: 0, width: 500, height: 400 } });
  await page.close();
});

test("hover badge stays clear of an always-visible scrollbar", async () => {
  const page = await openPage({ knownCached: "a{40}" });
  // Headless Firefox draws overlay scrollbars, so stand in for one that takes 15px of the window.
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, "clientWidth", { get: () => innerWidth - 15 });
    Object.defineProperty(document.documentElement, "clientHeight", { get: () => innerHeight - 15 });
  });
  await page.hover("#edge-magnet");
  await page.waitForTimeout(100);
  const box = await badgeBox(page);
  assert.ok(box.right <= box.width - 15, `badge ends at ${box.right}px; the scrollbar starts at ${box.width - 15}px`);
  await page.close();
});

const promptBox = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((el) => el.shadowRoot && el.style.pointerEvents !== "none");
    const { left, top, right, bottom } = host.shadowRoot.firstElementChild.getBoundingClientRect();
    return { left, top, right, bottom };
  });

async function clickPoint(page, selector) {
  const { x, y, width, height } = await page.locator(selector).boundingBox();
  return { x: x + width / 2, y: y + height / 2 };
}

test("the prompt opens just below where the link was clicked", async () => {
  const page = await openPage({ storedSettings: ASK });
  const click = await clickPoint(page, "#plain-magnet");
  await page.click("#plain-magnet");
  const box = await promptBox(page);
  assert.ok(box.top > click.y && box.top - click.y <= 30, `prompt starts ${box.top - click.y}px below the click`);
  assert.ok(Math.abs(box.left - click.x) <= 30, `prompt starts ${box.left - click.x}px right of the click`);
  await page.close();
});

test("the prompt stays inside the window and clear of the scrollbar at the right edge", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, "clientWidth", { get: () => innerWidth - 15 });
  });
  await page.click("#edge-magnet");
  const box = await promptBox(page);
  await page.screenshot({ path: file("../../test-results/ui/prompt-edge.png"), clip: { x: 400, y: 0, width: 400, height: 300 } });
  assert.ok(box.right <= 800 - 15, `prompt ends at ${box.right}px; the scrollbar starts at 785px`);
  assert.ok(box.left >= 0);
  await page.close();
});

test("at the bottom of the window the prompt opens above the click, not over it", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.evaluate(() => Object.assign(document.getElementById("long-magnet").style, { position: "fixed", left: "20px", bottom: "6px" }));
  const click = await clickPoint(page, "#long-magnet");
  await page.mouse.click(click.x, click.y);
  const box = await promptBox(page);
  await page.screenshot({ path: file("../../test-results/ui/prompt-bottom.png"), clip: { x: 0, y: 300, width: 500, height: 300 } });
  assert.ok(box.bottom < click.y, `prompt ends at ${box.bottom}px, the click was at ${click.y}px`);
  assert.ok(box.top >= 0 && box.bottom <= 600);
  await page.close();
});

test("after a prompt, result toasts are back in the bottom right corner", async () => {
  const page = await openPage({ storedSettings: ASK });
  await page.click("#plain-magnet");
  await page.evaluate(() => window.deliverMessage({ type: "toast", state: "ok", title: "Added to TorBox", detail: "Other.Release" }));
  const box = await promptBox(page);
  assert.equal(Math.round(800 - box.right), 16);
  assert.equal(Math.round(600 - box.bottom), 16);
  await page.close();
});
