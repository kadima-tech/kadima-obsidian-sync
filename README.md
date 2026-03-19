# Kadima Sync

Kadima Sync connects an Obsidian vault to Kadima and keeps notes and files in sync across devices through Kadima's hosted sync service.

## Features

- Connect an Obsidian vault to a Kadima account with a browser approval flow
- Sync notes and larger vault files through Kadima's sync API
- Keep local edits local-first and synchronize changes with per-file revisions
- Preserve conflicts as separate files instead of silently overwriting local work
- Support create, edit, rename, and delete operations

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
- Syncs vault content to Kadima's hosted service. Hidden files are excluded by default, but users can enable syncing hidden files, which may include vault configuration content.
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
