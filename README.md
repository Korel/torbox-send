# TorBox Send

Minimal Firefox add-on that sends links to your TorBox account.

- **Right-click a link → Send to TorBox.** Magnets and `.torrent` files become torrents, `.nzb` files become Usenet downloads, and links to hosters TorBox supports (Mega, 1Fichier, …) become web downloads. The item is hidden on other links. Video and social sites from TorBox's list (YouTube, Twitter, Facebook, …) are ignored unless enabled in Settings.
- **Auto-capture.** Clicking a magnet, `.torrent` or `.nzb` link sends it to TorBox instead of opening it. Hold Ctrl/Cmd, Shift or Alt to click through normally.
- **Hover badge.** With auto-capture on, hovering a link it will capture shows a small TorBox badge. Can be turned off.
- **The page you're on.** On a file-hoster page (e.g. a Mega or Pixeldrain file), right-click the page → **Send this page to TorBox**, or use the first row of the popup's Links tab.
- **Cached on TorBox.** **Check cache** in the popup asks TorBox which torrents on the page it already has cached; those get a ⚡ (adds instantly) in the Links list and the hover badge. On sites you add in Settings (or with **Check when the popup opens** in the popup), opening the popup runs the check for you, and resting the pointer on a link for 0.4 s checks just that link for the hover badge. Elsewhere the hover badge only shows earlier answers. Magnets are checked, and so are `.torrent` links named after their hash (e.g. `itorrents.org/torrent/<hash>.torrent`); other `.torrent` links are not, since that would mean downloading every file.
- **Toolbar button** opens two tabs: **Links on this page** lists every sendable link (including ones hidden in collapsed menus), split into Magnets, .torrent and Other tabs, with **Send** and **Show** (scrolls to it and highlights it). A `.torrent` link labelled just "download" takes the name of the magnet with the same hash, else its file name; **Settings** holds the API key and toggles.

## What leaves your browser

| Data | Goes to | When |
|---|---|---|
| API key + the link or file | `api.torbox.app` | Only when you click or right-click a link |
| A GET for the link (with that site's cookies) | The site the link points to | Same, to fetch `.torrent`/`.nzb` files; aborted after the headers for other links |
| API key + info-hashes of the page's magnets and hash-named `.torrent` links | `api.torbox.app/v1/api/torrents/checkcached` | When you click **Check cache**; on sites you listed, also when you open the popup (whole page) or rest the pointer on a link for 0.4 s (that link). Answers are kept for 10 minutes, so repeats aren't re-sent |
| Nothing (plain GET, no key) | `api.torbox.app/v1/api/webdl/hosters` | At most once a day, to refresh the list of supported hosters |

There are no other hosts, no analytics and no remote code. The content script reads links only to capture clicks, list them, and show their cache state in the hover badge.

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

## Sign for permanent install (unlisted, private)

1. Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Bump `version` in `manifest.json` (every signed upload needs a new version).
3. Run:

   ```sh
   WEB_EXT_API_KEY=user:… WEB_EXT_API_SECRET=… \
     npx web-ext sign --channel=unlisted
   ```

4. Open the signed `.xpi` from `web-ext-artifacts/` in Firefox to install it.
