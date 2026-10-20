# KiBrain Extension (Chrome, Manifest V3)

Backs up conversations from visited platform pages to your own KiBrain API
(`POST /api/v1/chats`).

- **Config**: API endpoint + API token (scope `save`), stored only in the local
  browser profile via `chrome.storage.local` — never synced.
- **Automatic**: a daily `chrome.alarms` run detects conversations on the active
  tab, converts them to `brain.chat.v1`, and transmits them.
- **Manual**: the popup has a "Backup now" button.
- **Error handling**: failed transmissions are logged locally and retried on the
  next run. No data is sent to any third party — only to the configured endpoint.

## Build

```sh
npm run build:extension
```

This bundles `extension/src/*.ts` into `extension/background.js`,
`extension/content.js`, and `extension/popup.js` using esbuild. Load the
`extension/` folder as an unpacked extension via `chrome://extensions`.

## Source layout

- `src/lib/` — pure, testable core logic (detection, conversion, transmission,
  backup orchestration, error log).
- `src/background.ts` — service worker: daily alarm + popup-triggered backup; injects
  the detection script on demand via `chrome.scripting.executeScript`.
- `src/content.ts` — detection script, injected on demand (not declared as a
  content script) to detect conversations per platform.
- `src/popup.ts` — popup UI (config + manual backup).

