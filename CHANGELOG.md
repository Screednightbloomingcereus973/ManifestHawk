# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-25

Initial public release.

### Added
- Passive network capture of HLS, DASH, MP4, audio, and RTMP media streams,
  classified by URL extension and by response `Content-Type`.
- Deduplication: repeated requests for the same manifest (token refresh,
  cache-busting params, live-playlist polling) update one record instead of
  creating duplicates.
- Segment grouping: `.ts` / `.m4s` segments are grouped under their parent
  manifest rather than listed individually.
- DOM fallback scan (content script) for players that set `src` via
  JavaScript without a plain network request.
- Live-updating side panel with throttled push updates from the background
  service worker — no polling, no flicker, survives tab switches.
- Search, category filters, and combined filter+search state.
- Per-stream actions: Copy URL, Open (in-extension preview), Download,
  generate ffmpeg command.
- In-extension preview player (HLS via hls.js, DASH via dash.js, native
  playback for MP4/audio), with libraries loaded on demand per stream type.
- Export to JSON and CSV.
- Settings panel: theme (dark/light/system), remember-filter,
  remember-search, clear all results.
- Update checker against the GitHub Releases API.
- About panel with links to the repository, issue tracker, and support page.
- Per-tab capture state persisted to `chrome.storage.session`, surviving
  Manifest V3 service-worker restarts.

### Fixed (pre-release QA passes)
- Rapid tab switching could apply a stale response from a previously active
  tab over the currently active tab's data — now guarded with a request
  token so only the latest response is applied.
- Exported JSON/CSV files could occasionally be truncated because the blob
  URL was revoked before Chrome finished writing the download — now waits
  for `chrome.downloads.onChanged` to report completion.
- CSV export could be interpreted as a spreadsheet formula if a cell began
  with `=`, `+`, `-`, or `@` — such cells are now escaped.
- The content script could throw repeatedly on an already-open tab after
  the extension was reloaded/updated ("Extension context invalidated") —
  it now detects this and stops observing instead of erroring.
- The in-extension preview player loaded both the HLS and DASH playback
  libraries (~1.5MB) on every open regardless of stream type — now loads
  only the library the current stream needs.
- Search input rebuilt the entire visible list on every keystroke — now
  debounced.
- The "Check for Updates" button had no timeout and could get stuck on
  "Checking…" indefinitely on a hung request — now times out after 10s.
- The Settings panel lacked dialog semantics and focus management for
  keyboard/screen-reader users — added `role="dialog"`, a focus trap, and
  focus return to the trigger button on close.

### Notes
- RTMP capture is best-effort: Chrome's `webRequest` API generally does not
  expose native `rtmp://` traffic to extensions.
