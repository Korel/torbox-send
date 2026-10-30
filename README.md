# TorBox Send

Minimal Firefox add-on that sends links to your TorBox account.

- **Right-click a link → Send to TorBox.** Magnets and `.torrent` files become torrents, `.nzb` files become Usenet downloads, and links to hosters TorBox supports (Mega, 1Fichier, …) become web downloads. The item is hidden on other links. Video and social sites from TorBox's list (YouTube, Twitter, Facebook, …) are ignored unless enabled in Settings.
- **Auto-capture.** Clicking a magnet, `.torrent` or `.nzb` link sends it to TorBox instead of opening it. Hold Ctrl/Cmd, Shift or Alt to click through normally.
- **Hover badge.** With auto-capture on, hovering a link it will capture shows a small TorBox badge. Can be turned off.
- **The page you're on.** On a file-hoster page (e.g. a Mega or Pixeldrain file), right-click the page → **Send this page to TorBox**, or use the first row of the popup's Links tab.
- **Mark sendable links on this page**: right-click anywhere on a page (or use the toolbar button) to put a green cube next to every magnet, `.torrent` and `.nzb` link and a blue one next to hoster links.
- **Toolbar button** opens two tabs: **Links on this page** lists every sendable link (including ones hidden in collapsed menus) with **Send** and **Show** (scrolls to it and highlights it); **Settings** holds the API key and toggles.

## What leaves your browser

| Data | Goes to | When |
|---|---|---|
| API key + the link or file | `api.torbox.app` | Only when you click or right-click a link |
| A GET for the link (with that site's cookies) | The site the link points to | Same, to fetch `.torrent`/`.nzb` files; aborted after the headers for other links |
| Nothing (plain GET, no key) | `api.torbox.app/v1/api/webdl/hosters` | At most once a day, to refresh the list of supported hosters |

There are no other hosts, no analytics and no remote code. The content script only listens for clicks.

## Develop

```sh
npx web-ext lint
npx web-ext run          # temporary Firefox profile with the add-on loaded
```

## Sign for permanent install (unlisted, private)

1. Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Bump `version` in `manifest.json` (every signed upload needs a new version).
3. Run:

   ```sh
   WEB_EXT_API_KEY=user:… WEB_EXT_API_SECRET=… \
     npx web-ext sign --channel=unlisted --ignore-files README.md
   ```

4. Open the signed `.xpi` from `web-ext-artifacts/` in Firefox to install it.
