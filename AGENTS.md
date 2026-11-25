# AGENTS.md

Firefox MV3 add-on, no build step. `lib.js` holds pure helpers shared by
background.js, content.js and options.js.

## Test
- Setup once: `npm install && npm run test:setup` (Playwright's Firefox).
- `npm test` runs everything: unit tests for lib.js (`tests/*.test.js`) and UI tests
  (`tests/ui/`) that render pages in Playwright's Firefox, the engine this add-on
  ships on, with a stubbed `browser` API (`tests/ui/browser-stub.js`).
- Write the test first for behaviour changes and bug fixes, and see it fail.
- UI changes (popup, settings, toast, hover badge): extend the UI
  tests' layout checks (no horizontal overflow, no clipped or wrapped labels, nothing
  moves when its text changes; long names, every button label, light and dark), then
  look at the screenshots in `test-results/ui/`. No screenshot baselines.
- Dev files stay out of the add-on via `web-ext-config.cjs`; add new ones there.
- Manual: `npx web-ext run`.

## Rules
- Nothing leaves the browser without a user action or a site the user listed.
  Keep README's "What leaves your browser" table exact whenever a request changes.
- No new permissions or hosts without asking.
- Don't bump the version, sign, or release unless asked.

## Sign a build (only when asked)
1. Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Bump `version` in `manifest.json` (every signed upload needs a new version).
3. Run:

   ```sh
   WEB_EXT_API_KEY=user:… WEB_EXT_API_SECRET=… \
     npx web-ext sign --channel=unlisted
   ```

4. The signed `.xpi` lands in `web-ext-artifacts/`; attach it to the GitHub release.
