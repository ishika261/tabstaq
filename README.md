<div align="center">

# 🗂️ Tabstaq

**Smart Chrome tab grouping — by *project*, not just by domain.**

Tabstaq reads each tab's URL, works out which project it belongs to, and folds
related tabs into native Chrome tab groups. Group the repo, its CI pipeline, its
docs, and its ticket together — even though they live on four different sites.

</div>

---

## Why

Browsers order tabs by **recency** — the order you opened them. But real work is
**thematic**: a single feature spans a repo, a pipeline, a doc, and a ticket,
scattered across different domains. The browser can't see they belong together,
so forty tabs pile up with no structure and you end up "declaring tab
bankruptcy" — closing everything and losing your context.

Tabstaq groups by the **project name embedded in the URL**, so your tab strip
mirrors how you actually think about your work.

## Features

- **Group by project** — one click (or a keyboard shortcut) folds scattered tabs
  into named, colored native tab groups.
- **Fully configurable rules** — `host | regex` rules extract the group name from
  any site. Nothing is hardcoded; ship-default rules cover GitHub/GitLab/Bitbucket.
- **Keywords** — group any tabs that merely *mention* a word (great for codenames).
- **Site groups** — funnel everything on a host into one named group, used as a
  fallback for tabs the rules can't name individually.
- **Suffix stripping** — collapse `MyAppApi`, `MyAppTests`, `MyApp` into one group.
- **Colors & emojis** — auto-assigned (collision-aware) or pinned per group.
- **Collapse / expand / dedupe** — tidy the strip and close duplicate tabs.
- **Close a whole group** — retire a finished project in one tap.
- **Search & jump** — fuzzy-find any open tab and switch to it.
- **Import / export** — your whole configuration is a portable JSON file.
- **100% local** — no network calls, no tracking, no analytics.

## Install (unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `tabstaq` folder.
5. Pin the Tabstaq icon — click it, or press the shortcut, to group.

> Updating later? After pulling changes, click the **↻ reload** icon on the
> Tabstaq card. If you change `manifest.json` (e.g. shortcuts), **remove and
> re-add** the extension — Chrome only re-reads commands on a fresh install.

## Usage

- **Group these tabs** — the primary action (toolbar icon, popup, or shortcut).
- **Collapse / Expand / Dedupe / Ungroup** — the icon row in the popup.
- **Close a group** — tap a group chip in the popup, then tap the ✕.
- **Search** — type in the popup's search box; `↑/↓` to move, `↵` to jump.
- **Preferences** — add rules, keywords, colors, and emojis.

### Keyboard shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Group tabs | `⌃G` | `Ctrl+Shift+0` |
| Ungroup all | `⌃U` | `Ctrl+Shift+9` |
| Collapse all | `⌃C` | `Ctrl+Shift+8` |
| Expand all | `⌃E` | `Ctrl+Shift+7` |
| Open popup | *(unbound — assign it)* | *(unbound — assign it)* |

Rebind any of these at `chrome://extensions/shortcuts`. If a shortcut shows
**"Not set"** in the popup's Shortcuts panel, Chrome dropped it due to a
conflict — assign one there.

## How grouping works

For each tab, Tabstaq assigns a group in this priority order:

1. **Keyword** — the tab's URL/title contains one of your keywords → that group.
2. **Abstraction** — a `host | regex` rule extracts a name from the URL; known
   suffixes are stripped so related tabs share one name. Tabs that share a name
   form a group (once `minGroupSize` is met).
3. **Site group** — a tab whose extracted name is a lone singleton (can't form
   its own group) falls back into its host's named group, pooling with other
   orphans from the same site.

Tabs that match nothing are left untouched. Pinned tabs are never grouped or
closed.

### Configuration

Everything is editable in **Preferences**, and your setup is portable:

- **Export** downloads `tabstaq-settings.json`.
- **Import** loads a JSON file (review the fields, then **Save**).

Ready-made starting points live in [`presets/`](./presets):

| Preset | What it does |
|---|---|
| `tabstaq-generic.json` | GitHub / GitLab / Bitbucket repo grouping (the shipped default). |
| `tabstaq-empty.json` | A blank slate to build your own from scratch. |

To use one: **Preferences → Import →** pick the file **→ Save**.

## Project structure

```
tabstaq/
├── manifest.json      # MV3 manifest: permissions, commands, action, icons
├── background.js      # service worker: wraps the engine with chrome.* + messaging
├── identify.js        # pure config + URL→name extraction (no Chrome APIs)
├── grouping.js        # pure grouping engine: classifyTab, computeBuckets
├── grouping.test.js   # unit tests for the engine (node --test)
├── popup.html/.js     # toolbar popup: actions, preview, search, shortcuts
├── options.html/.js   # Preferences page: rules, keywords, colors, import/export
├── icons/             # 16/48/128px icons + generate-icons.py
└── presets/           # importable starter configs
```

`identify.js` and `grouping.js` are intentionally free of Chrome APIs, so the
grouping logic is pure and unit-testable in plain Node.

## Tests

The grouping engine is covered by unit tests using Node's built-in runner — no
dependencies to install:

```bash
node --test
```

Run them before committing any change to `identify.js` or `grouping.js`.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read tab URLs/titles to decide grouping; move/close tabs. |
| `tabGroups` | Create, name, color, and collapse native tab groups. |
| `storage` | Persist your preferences (synced via `chrome.storage.sync`). |
| `<all_urls>` | Read the URL of any tab so it can be grouped. No page content is read. |

## License

[MIT](./LICENSE) © 2026 ishika261

Made with ♥ by [ishika261](https://github.com/ishika261).
