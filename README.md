# TorBox Send

Minimal Firefox add-on that sends links to your [TorBox](https://torbox.app) account.

> Unofficial. This project is not affiliated with, endorsed by or supported by TorBox.

## Install

1. Download the latest `.xpi` from [Releases](https://github.com/Korel/torbox-send/releases/latest) and open it in Firefox 142 or newer. The builds are signed by Mozilla, so they install permanently.
2. Click the toolbar button, open **Settings** and paste your TorBox API key.

Firefox does not update add-ons installed this way; install the newer `.xpi` over the old one.

## Features

- **Right-click a link → Send to TorBox.** Magnets and `.torrent` files become torrents, `.nzb` files become Usenet downloads, and links to hosters TorBox supports (Mega, 1Fichier, …) become web downloads. The item is hidden on other links. Video and social sites from TorBox's list (YouTube, Twitter, Facebook, …) are ignored unless enabled in Settings.
- **Auto-capture.** Clicking a magnet, `.torrent` or `.nzb` link sends it to TorBox instead of opening it. Only your own clicks count; clicks a page's script makes are ignored. On by default; **Ask before sending** in Settings makes a clicked link show **Send** and **Cancel** on the page first. Hold Ctrl/Cmd, Shift or Alt to click through normally.
- **Hover badge.** With auto-capture on, hovering a link it will capture shows a small TorBox badge. Can be turned off.
- **The page you're on.** On a file-hoster page (e.g. a Mega or Pixeldrain file), right-click the page → **Send this page to TorBox**, or use the first row of the popup's Links tab.
- **Cached on TorBox.** **Check cache** in the popup asks TorBox which torrents on the page it already has cached; those get a ⚡ (adds instantly) in the Links list and the hover badge. On sites you add in Settings (or with **Check when the popup opens** in the popup), opening the popup runs the check for you, and resting the pointer on a link for 0.4 s checks just that link for the hover badge. Elsewhere the hover badge only shows earlier answers. Magnets are checked, and so are `.torrent` links named after their hash (e.g. `itorrents.org/torrent/<hash>.torrent`); other `.torrent` links are not, since that would mean downloading every file.
- **Check one torrent.** The popup's **Check** tab takes a pasted magnet or info-hash, or a `.torrent` file dropped anywhere on the popup, and says whether TorBox has it cached, with **Send** next to it. The file's info-hash is computed in the browser; only the hash is checked. **Choose file** opens the Check tab in a browser tab, since Firefox closes the popup when a file picker opens. v2-only torrents can't be checked.
- **Toolbar button** opens three tabs: **Links on this page** lists every sendable link (including ones hidden in collapsed menus), split into Magnets, .torrent and Other tabs, with **Send** and **Show** (scrolls to it and highlights it). A `.torrent` link labelled just "download" takes the name of the magnet with the same hash, else its file name; **Check** (above); **Settings** holds the API key and toggles.

## What leaves your browser

| Data | Goes to | When |
|---|---|---|
| API key + the link or file | `api.torbox.app` | Only when you click or right-click a link, or click **Send** in the Check tab (a dropped or picked `.torrent` is uploaded as is) |
| A GET for the link (with that site's cookies) | The site the link points to | Same, to fetch `.torrent`/`.nzb` files (up to 50 MB); aborted after the headers for other links |
| API key + info-hashes of the page's magnets and hash-named `.torrent` links, or of the magnet, hash or `.torrent` you give the Check tab | `api.torbox.app/v1/api/torrents/checkcached` | When you click **Check cache**, or paste, drop or pick something in the Check tab; on sites you listed, also when you open the popup (whole page) or rest the pointer on a link for 0.4 s (that link). Answers are kept for 10 minutes, so repeats aren't re-sent |
| API key | `api.torbox.app/v1/api/user/me` | When you click **Save** in Settings, to check the key before storing it |
| Nothing (plain GET, no key) | `api.torbox.app/v1/api/webdl/hosters` | At most once a day, to refresh the list of supported hosters |

There are no other hosts, no analytics and no remote code. The hoster list is a set of URL patterns from TorBox, used only to decide which links count as hoster links. The content script reads links only to capture clicks, list them, and show their cache state in the hover badge.

## Develop

```sh
npm install
npm run test:setup       # once: downloads Playwright's Firefox
npm test                 # unit tests + popup tests in headless Firefox
npx web-ext lint
npx web-ext run          # temporary Firefox profile with the add-on loaded
```

Popup tests write screenshots to `test-results/ui/`; look at them after UI changes.
`web-ext-config.cjs` keeps dev files out of the packaged add-on.

## License

[MIT](LICENSE)
