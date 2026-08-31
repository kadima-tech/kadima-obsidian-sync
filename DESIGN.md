# Design language

Kadima Sync has a small user-facing surface: one settings tab, one status-bar item, and Obsidian `Notice`
toasts. The design language is deliberately *Obsidian's own* — the plugin should be indistinguishable from a
core settings pane, in any theme the user has installed.

## Colour

No plugin-defined colours. Everything inherits from the active theme through Obsidian's CSS variables. The only
colour reference in `styles.css` is `var(--text-muted)`, used to de-emphasise secondary notes.

Never hard-code a hex value or a light/dark assumption. If a new element needs colour, take it from the theme
variables (`--text-normal`, `--text-muted`, `--text-error`, `--background-modifier-*`) so custom themes and dark
mode keep working.

## Typography

Theme-supplied. Type size steps come from Obsidian's UI scale variables — `styles.css` uses
`var(--font-ui-smaller)` for the muted notes. No font families are declared.

## Layout and spacing

The settings tab is built entirely from Obsidian's `Setting` builder (`src/settings.ts`), which supplies the
row layout, label/description column split, and control alignment. Spacing is whatever `Setting` gives; the
plugin adds none. Free-form text lives in a `div.kadima-sync-setting-note` rather than in a bare paragraph.

All plugin CSS classes are prefixed `kadima-sync-`, and all of it lives in `styles.css` — no inline styles, no
`innerHTML`.

## Components and patterns

- **Settings rows** — `new Setting(containerEl)` with sentence-case names and a one-line description that says
  what the control does, not what it is.
- **Headings** — `.setHeading()` sections for grouping.
- **Explanatory notes** — muted `kadima-sync-setting-note` divs, used for the per-vault explanation at the top
  and the last-sync / last-error line at the bottom.
- **Status** — a single status-bar item, set through `setStatus`, holding the current sync state.
- **Feedback** — `Notice` for anything that happened because the user pressed a button.
- **Developer-only controls** — API base URL, auto-sync interval, and the inline payload limit render only when
  `IS_DEV_BUILD`, keeping the shipped settings tab down to the five settings a user can meaningfully answer.

## Motion

None. No transitions, no animation.

## Tone of voice

Plain, short, present tense. Describe the effect on the user's vault rather than the mechanism: "Run an
immediate sync when the vault opens", not "Triggers a sync request on layout-ready". Destructive or surprising
actions state their consequence up front ("The current connection stays active until the new pairing is
approved"). Sentence case everywhere, including buttons.
