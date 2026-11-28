// Fake WebExtension API so options.html?popup renders outside Firefox's add-on runtime.
// Injected before the page's scripts; records every runtime message in window.sentMessages.
(() => {
  const magnet = (hex, name) => `magnet:?xt=urn:btih:${hex.repeat(40)}&dn=${name}`;
  // Like a torrentgalaxy results page: each release has a magnet and an itorrents.org .torrent.
  const links = [
    { clickable: true, href: magnet("a", "You.Can.See.Everything.2026.1080p.WEB-DL.DDP5.1.H.264-EXAMPLE"), text: "", hidden: false },
    { clickable: true, href: `https://itorrents.org/torrent/${"A".repeat(40)}.torrent`, text: "download .torrent", hidden: false },
    { clickable: true, href: magnet("b", "Another.Really.Long.Release.Name.2026.2160p.UHD.BluRay"), text: "", hidden: true },
    { clickable: true, href: "https://example-tracker.org/dl/12345/Some.Show.S01E01.1080p.WEB.torrent", text: "download", hidden: false },
    { clickable: false, href: "https://mega.nz/file/abcdef#key", text: "Mega mirror", hidden: false },
    // window.extraReleases (set by a test before this script) adds magnet + .torrent pairs.
    ...Array.from({ length: window.extraReleases || 0 }, (_, i) => {
      const hash = i.toString(16).padStart(40, "c");
      return [
        { clickable: true, href: `magnet:?xt=urn:btih:${hash}&dn=Extra.Release.${i}.2026.1080p.WEB`, text: "", hidden: false },
        { clickable: true, href: `https://itorrents.org/torrent/${hash}.torrent`, text: "download .torrent", hidden: false },
      ];
    }).flat(),
  ].map((link, index) => ({ index, title: "", ...link }));

  const listeners = [];
  const ignoredEvent = { addListener() {} };
  window.sentMessages = [];
  // Lets a test play the background script, e.g. deliver a toast to the content script.
  window.deliverMessage = (message) => listeners.forEach((listener) => listener(message, {}));

  window.browser = {
    runtime: {
      onMessage: { addListener: (listener) => listeners.push(listener) },
      getURL: (path) => new URL(path, location.href).href,
      async sendMessage(message) {
        window.sentMessages.push(message);
        if (message.type === "is-sendable-page") return false;
        // Nothing known from earlier checks; a real check says only hash "aaa…" is cached.
        // window.knownCached (a RegExp set by a test) stands for answers from an earlier check.
        if (message.type === "check-cached" && message.knownOnly) {
          return message.urls.map((url) => (window.knownCached?.test(url) ? true : null));
        }
        if (message.type === "check-cached") return message.urls.map((url) => /a{40}/i.test(url));
        return { ok: true };
      },
    },
    tabs: {
      async query() {
        return [{ id: 1, url: "https://www.example-tracker.org/search/example/1/", title: "Search" }];
      },
      async sendMessage(tabId, message) {
        if (message.type !== "list") return;
        const reply = { type: "links", requestId: message.requestId, links };
        setTimeout(() => listeners.forEach((listener) => listener(reply, { tab: { id: tabId }, frameId: 0 })));
      },
      create(properties) {
        (window.createdTabs ??= []).push(properties);
      },
    },
    storage: {
      local: {
        // window.storedSettings (set by a test) overrides what the add-on finds in storage.
        async get(defaults) {
          return { ...defaults, apiKey: "test-key", ...window.storedSettings };
        },
        async set(values) {
          (window.storageWrites ??= []).push(values);
        },
        async remove() {},
      },
      onChanged: ignoredEvent,
    },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      },
      onAdded: ignoredEvent,
      onRemoved: ignoredEvent,
    },
  };
})();
