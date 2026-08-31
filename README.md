# Kadima Sync

Kadima Sync connects an Obsidian vault to Kadima and keeps notes and files in sync across devices through Kadima's hosted sync service. Once a vault is synced, it is also readable from the Kadima apps — [Draggen](https://draggen.io) and [Talebuddy](https://talebuddy.io) — without exporting or copying anything by hand.

## Features

- Connect an Obsidian vault to a Kadima account with a browser approval flow
- Sync notes and larger vault files through Kadima's sync API
- Keep local edits local-first and synchronize changes with per-file revisions
- Preserve conflicts as separate files instead of silently overwriting local work
- Support create, edit, rename, and delete operations

## Works with Draggen and Talebuddy

A synced vault lives in your Kadima account, and the other Kadima apps read from that same copy:

- **[Draggen](https://draggen.io)** — the visual canvas and moodboard app. Its dashboard has a **Vault** tab that
  browses your synced vault, previews notes, and renders Obsidian Canvas (`.canvas`) files, so worldbuilding notes
  you already wrote in Obsidian can sit beside the board you are building.
- **[Talebuddy](https://talebuddy.io)** — the long-form writing app. The writing desk's sidebar has an **Obsidian**
  tab next to the Creative Ledger, so research, lore, and character notes stay one click from the manuscript
  instead of in another window.

Both apps read the vault; they never write back into it. Obsidian stays the place your notes are edited, and this
plugin stays the only thing that changes them.

Vault sync is part of a paid Kadima subscription and covers the same account across Draggen and Talebuddy.

## Installation

### Community Plugins

Once the plugin is approved, install `Kadima Sync` from `Settings -> Community plugins`.

### Manual Installation

1. Download the latest release assets.
2. Create the folder `<vault>/.obsidian/plugins/kadima-sync/`.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. In Obsidian, open `Settings -> Community plugins` and enable `Kadima Sync`.

## Usage

1. Open `Settings -> Kadima Sync`.
2. Click `Connect Kadima`.
3. Complete the approval flow in your browser.
4. Return to Obsidian and run `Sync now`.

Conflicted local changes are preserved in `.kadima-conflicts` by default.

## Disclosures

- Requires a Kadima account and an active paid Kadima subscription.
- Requires network access to Kadima services for authentication and synchronization.
- Opens an external browser window or tab during account connection.
- Stores Kadima authentication tokens and sync state in Obsidian's local plugin data on the device.
- Reads every file path in the vault. Working out what changed requires enumerating the whole vault, so the
  plugin sees all paths, including those it will not sync.
- Syncs vault content to Kadima's hosted service. Hidden files are excluded by default, but users can enable syncing hidden files, which may include vault configuration content.
- Deletes arriving from the sync service go through Obsidian's `FileManager.trashFile`, so they follow the
  vault's own "Deleted files" preference rather than bypassing it.
- Does not include ads or client-side telemetry.
- Source code is available in this repository.

## Development

```bash
npm install
npm run build
```

For local development:

```bash
OBSIDIAN_VAULT_PATH="/absolute/path/to/YourVault" npm run dev
```
