# Maintenance

## Maintenance Log

### 2026-08-31 — Community-plugin submission preparation
- Added a `LICENSE` (MIT, matching the other public `kadima-tech` repositories). The Obsidian community-plugin
  review requires one; the repository had none.
- Rewrote `manifest.json`'s `description` to satisfy the listing guidelines (no "Obsidian", ends with a period)
  and added `authorUrl`.
- Cleared the review findings most likely to come back from an Obsidian reviewer: `window.confirm` in the
  re-pair flow replaced with an Obsidian `Modal` (`src/modals.ts`), the redundant `Kadima Sync` heading removed
  from the top of the settings tab, the auto-sync poll registered through `Plugin.registerInterval`, and the
  `as any` on `requestUrl` removed along with the unused `timeout` option that forced it.

### 2026-08-31 — Automated directory review findings (0.2.0 → 0.2.1)
The Obsidian Community automated review flagged two errors and five warnings against release `0.2.0`. Fixed:
- `navigator.userAgent` OS sniffing replaced with the `Platform` API (`src/auth.ts`).
- `minAppVersion` raised `1.6.0` → `1.6.6`, the version that introduced `FileManager.trashFile`. The runtime
  `typeof … === "function"` guard and its `vault.delete` fallback existed only for older apps and are gone, so
  remote deletes now always honour the user's "Deleted files" preference.
- `any` from `JSON.parse` and `RequestUrlResponse.json` funnelled through `unknown` before narrowing
  (`src/api.ts`).
- `onunload` made synchronous — `Plugin` declares it `void` and Obsidian never awaited it.
- The hardcoded `.obsidian` config folder replaced with `Vault#configDir` (`src/utils.ts`, `src/settings.ts`).
  The test mock was missing `configDir` entirely, so the engine had been passing `undefined` in tests.
- Release assets now carry GitHub build-provenance attestations (`actions/attest-build-provenance`).

Not acted on: the review's suggestion to adopt the 1.13.0 declarative settings API (`getSettingDefinitions()`).
It is advisory, the shipped `obsidian` typings (1.12.3) do not declare it, and adopting it would mean raising
`minAppVersion` to 1.13.0 and dropping users on older builds. Revisit when 1.13 is the floor worth requiring.

## Recurring Patterns

### Releasing a plugin version
**Triggers:** any user-visible change that should reach installed vaults. **Recurs:** every release.

Obsidian serves updates straight from the latest GitHub release, so a release is the whole distribution
mechanism — there is no second submission after the initial listing.

1. Bump the version in `manifest.json`, `package.json`, and add a `versions.json` entry mapping the new version
   to the minimum Obsidian version it supports. All three must agree.
2. Tag with the **exact version number and no `v` prefix** (`git tag 0.2.0`, not `v0.2.0`) and push the tag.
   The `v` prefix is the most common cause of a failed Obsidian validation.
3. `.github/workflows/release.yml` builds and creates a **draft** release with `main.js`, `manifest.json` and
   `styles.css` attached as loose files. **Publish the draft** — a draft is invisible to Obsidian.
4. Verify by installing the release assets into a real vault before announcing.

### Keeping up with Obsidian's plugin guidelines
**Triggers:** an Obsidian API release, or any new UI code. **Recurs:** roughly per major Obsidian version.

The guidelines tighten over time and the reviewer checklist is the same one used for updates. The recurring
offenders in a plugin shaped like this one: browser dialogs (`window.confirm`/`alert`) instead of `Modal`,
`innerHTML` instead of `createEl`, timers not registered with `registerInterval`, `any` casts around the
Obsidian API, hard-coded colours instead of theme CSS variables, and the plugin name repeated in settings
headings. Sweep for these before cutting a release rather than after.
