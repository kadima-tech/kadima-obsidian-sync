# Kadima Sync for Obsidian

Kadima Sync is a custom Obsidian plugin that syncs a vault through Kadima's centralized API available for all paid subscriptions to the Kadima ecosystem, including Kadima and Talebuddy.

## What It Does

- connects an Obsidian vault to a Kadima account with a browser approval flow
- syncs notes and larger vault files through centralized HTTP endpoints
- keeps local edits local-first and pushes/pulls changes using per-file revisions
- preserves conflicted changes as extra files instead of silently overwriting them

## Current Scope

Implemented now:

- Kadima pairing flow with short-lived access tokens and long-lived refresh tokens
- centralized bootstrap, pull, and push endpoints
- signed large-file upload/download flow through bucket-backed blobs
- text files and other inline payloads up to the configured limit
- create, modify, delete, and rename handling
- conflict preservation into `.kadima-conflicts`

Not implemented yet:

- stable vault identity independent of vault name
- dashboard UI for managing approved devices

## Local Prerequisites

- Node.js 20+
- pnpm for `../moodboard-designer`
- an Obsidian desktop install
- a Firebase project configured for the Kadima auth flow
- localhost or `127.0.0.1` added to Firebase Auth authorized domains

## Build And Add The Plugin To Obsidian

1. In this repo, install dependencies:

```bash
npm install
```

2. Build the plugin:

```bash
npm run build
```

3. Copy it into an Obsidian vault plugin folder.

Automatic:

```bash
npm run install:obsidian -- "/absolute/path/to/YourVault"
```

Or build and copy in one step with an env var:

```bash
OBSIDIAN_VAULT_PATH="/absolute/path/to/YourVault" npm run build
```

For watch mode during development:

```bash
OBSIDIAN_VAULT_PATH="/absolute/path/to/YourVault" npm run dev
```

That copies `manifest.json`, `main.js`, `styles.css`, and `versions.json` into:

```text
<Vault>/.obsidian/plugins/kadima-sync
```

4. In Obsidian:
   Open the target vault.
   Go to `Settings -> Community plugins`.
   If needed, turn off restricted mode.
   Enable `Kadima Sync`.

## Configure The Plugin For Local Testing

In the plugin settings:

- set `API base URL` to the exact local `kadima-landing` origin, for example
  `http://127.0.0.1:3000` or `http://127.0.0.1:3001`
- click `Connect Kadima`
- complete the Kadima approval flow in the browser

The centralized backend will create the pairing session locally and use your configured Firebase dev project for auth and Firestore persistence.

## Local Sync Smoke Test

The easiest test is with two separate local vaults using the same Kadima account.

1. Create two Obsidian vaults, for example `Sync Test A` and `Sync Test B`.
2. Install this plugin into both vaults.
3. Point both plugin instances to `http://127.0.0.1:3000`.
4. Connect both vaults with the same Kadima account.
5. In vault A, create or edit a note and run `Sync now`.
6. In vault B, run `Sync now` and verify the note appears.
7. Repeat with:
   rename in A, then sync B
   delete in A, then sync B
   simultaneous edits in both vaults to force a conflict

Expected conflict behavior:

- the winning revision is applied to the original path
- the non-winning local version is preserved under `.kadima-conflicts`

## Useful Commands

```bash
# Build plugin
npm run build

# Watch plugin and copy to an Obsidian vault on each rebuild
OBSIDIAN_VAULT_PATH="/absolute/path/to/YourVault" npm run dev

# Copy an existing build to a vault
npm run install:obsidian -- "/absolute/path/to/YourVault"
```