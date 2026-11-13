# Handoff

## Goal
Reverse engineer Chrome extension "Telegram Video Downloader – TVDownloader" (ID `ddkogamcapjjcjpeapeagfklmaodgagk`, v1.3.2) and ship a human-readable vanilla-JS rewrite in `new_extension/` that downloads media (image, video, audio) from Telegram Web chat bubbles.

## Layout
- `extension/` – original (minified) extension copy, reference only.
- `new_extension/`
  - `manifest.json` – fixed: `icon.webp` in web_accessible_resources, removed `default_locale` and `update_url`, `background` commented out.
  - `content-ui.js` – content script. Throttled (100ms) MutationObserver on `body`, host check `/^web[k,z]*.telegram.org$/`, reads `td-configs.enable` from `chrome.storage.local`. Finds media in chat bubbles only (incl. `div.album-item`), injects 32x32 `icon.webp` into `.td-download-action`, cleanup removes those nodes. `onDownloadClick` is implemented: image/video go through Telegram's media viewer download button (`downloadViaMediaViewer`); audio plays the track to expose the stream URL, then dispatches `tvd_media_download` (`downloadAudio`).
  - `downloader.js` – page-world script injected by content-ui. Listens for `tvd_media_download`, chunked `Range: bytes=N-` fetch, retries 408 up to 3 times, saves Blob via `<a download>`, reports `tvd_media_download_progress` (0-100, -1 on failure).
  - `background.js` – empty, unused (original background only sets language on install; not part of the download flow).
  - `popup/index.html` – not inspected.

## Key findings
- Telegram Web exposes media via a service worker at `/stream/<URI-encoded JSON {location:{id}, mimeType, fileName}>`; Range requests return 206 + `Content-Range`.
- The original never builds the first URL; it simulates clicks so Telegram creates `<audio src=".../stream/...">` or the viewer, then reads the URL from the DOM.
- Image/video in the original use Telegram's own viewer download button; only audio uses `downloader.js`.
- Content script (isolated world) and `downloader.js` (page world) talk via `document` CustomEvents.

## Status
- `node --check` passes on both JS files. **Not tested in a browser.**
- Load: `chrome://extensions` → Developer mode → Load unpacked → `/Users/aidardarmesh/epam/tgm/new_extension`.
- Git: repo has no commits.

## Next steps
1. Load unpacked, test on web.telegram.org (icons appear, audio download, image/video viewer automation); fix selectors if Telegram DOM changed.
2. Inspect `popup/index.html`; if a toggle is wanted, write `td-configs` (`{enable, lang}`) to `chrome.storage.local`.
3. Optional: icon positioning CSS (currently inline), capture `<video src>` stream URL so video uses `downloader.js`.

## Constraints
Human-readable vanilla JS, no styling beyond 32x32 icon and minimal functional CSS, faithful copy of original trigger/injection/cleanup. Concise answers; ponytail mode (laziest working solution) is active.
