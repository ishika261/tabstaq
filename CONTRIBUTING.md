# Contributing to Tabstaq

Thanks for your interest! Tabstaq is a small, dependency-free Chrome extension,
so the dev loop is intentionally simple — no build step, no `npm install`.

## Develop

1. Clone the repo.
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the `tabstaq` folder.
3. Edit the source. After a change:
   - **HTML / CSS / popup / options / `identify.js`** → click **↻ reload** on the
     Tabstaq card, then reopen the popup/Preferences.
   - **`manifest.json`** (esp. `commands`) → **remove and re-add** the extension;
     Chrome only re-reads commands on a fresh install.
4. Inspect the service worker via the **"Inspect views: service worker"** link on
   the extension card to see `background.js` logs and errors.

## Code layout

| File | Role |
|---|---|
| `identify.js` | Pure logic + config (no Chrome APIs). The grouping brain. |
| `background.js` | Service worker: engine, commands, message router. |
| `popup.html` / `popup.js` | Toolbar popup UI. |
| `options.html` / `options.js` | Preferences page. |
| `icons/generate-icons.py` | Regenerates the PNG icons (stdlib only). |
| `presets/` | Importable starter configs. |

**Design rule:** keep `identify.js` free of Chrome APIs. All grouping decisions
live there as plain functions over plain data, which keeps them pure and easy to
test. `background.js` is the only file that touches `chrome.*`.

## Test the logic

Because `identify.js` is an ES module of pure functions, you can exercise it in
plain Node — no browser needed:

```bash
node --input-type=module -e "
  import { DEFAULT_CONFIG, extractId } from './identify.js';
  console.log(extractId('https://github.com/acme/payments-api', DEFAULT_CONFIG));
  // -> { id: 'payments-api', raw: 'payments-api' }
"
```

Syntax-check everything before committing:

```bash
for f in identify.js background.js options.js popup.js; do node --check "$f"; done
```

## Regenerate icons

```bash
cd icons && python3 generate-icons.py
```

This rewrites `icon16/48/128.png` deterministically from the script — edit the
palette or geometry there, never the PNGs directly.

## Style

- Vanilla JS (ES modules), 2-space indent, semicolons.
- Comments explain **why**, not what. Keep them current with the code.
- No third-party runtime dependencies — keep it zero-install.
- Nothing company- or user-specific in shipped files; rules belong in `presets/`
  or the user's own imported config.

## Pull requests

1. Keep changes focused and the diff readable.
2. Run the syntax check above.
3. If you change grouping logic, include a one-line Node snippet (like the test
   above) in the PR showing the new behavior.
