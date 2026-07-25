# ManifestHawk — Media Stream Inspector

**v1.0.0** · Chrome extension (Manifest V3)

Detect, inspect, and analyze HLS (`.m3u8`), DASH (`.mpd`), MP4, audio, and RTMP
media streams on any page — deduplicated, segment-aware, and shown live in a
stable Chrome side panel.

## Features

- **Passive network capture** — watches requests per tab and classifies media
  manifests, segments, and audio by extension and by `Content-Type` (catches
  manifests served without a matching file extension behind CDNs).
- **Deduplication** — the same manifest re-requested (token refresh,
  cache-busting query params, live-playlist polling) updates one record and
  bumps a request counter instead of spamming the list.
- **Segment grouping** — `.ts` / `.m4s` segments are grouped under their
  parent manifest instead of listed individually.
- **DOM fallback scan** — a content script also inspects `<video>`, `<audio>`,
  and `<source>` elements for players that set `src` via JavaScript without a
  plain network request ManifestHawk's listener can see.
- **Live side panel** — pushed, throttled updates from the background service
  worker; no polling, no flicker, survives tab switches.
- **In-extension preview player** — HLS via hls.js, DASH via dash.js, native
  playback for MP4/audio, loaded on demand.
- **Search, filters, export** (JSON/CSV), **copy URL**, **download**, and a
  generated **ffmpeg command** per stream.
- **Persistence across service-worker restarts** via `chrome.storage.session`.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Click the ManifestHawk toolbar icon to open the side panel, then play
   media on any page.

## Permissions

| Permission | Why it's needed |
|---|---|
| `webRequest` | Observe request URLs and response `Content-Type` headers to classify media streams. |
| `webNavigation` | Detect full-page navigations so stale, previous-page data is cleared. |
| `tabs` | Track the active tab and open the preview player / links in a new tab. |
| `storage` | Persist per-tab captures across service-worker restarts and save user settings. |
| `downloads` | Power the Download and Export actions. |
| `sidePanel` | Show ManifestHawk as a side panel instead of a popup. |
| `host_permissions: <all_urls>` | Media requests can be made to any origin — narrowing this would silently break detection on many sites. |

ManifestHawk does not send any captured data off your device; the only
outbound request it makes on its own is the optional **Check for Updates**
call to the GitHub Releases API.

## Project structure

```
background.js     Service worker: capture, classify, dedupe, persist, push updates
content.js         DOM fallback scan (video/audio/source elements)
sidepanel.html/.js/.css   Side panel UI: list, filters, search, settings, export
player.html/.js    In-extension preview player (lazy-loads hls.js / dash.js)
libs/              Bundled hls.js and dash.js
icons/             Toolbar and store icons
```

## Verified for v1.0.0

Every feature below was manually re-verified before this release:

- ✅ Capture (network + DOM fallback), dedupe, and segment grouping
- ✅ Side panel: live push updates, tab-switch handling, no polling
- ✅ Search (debounced), Filters, and combined filter+search state
- ✅ Copy URL, Open (preview player), Download, ffmpeg command
- ✅ Export JSON / CSV
- ✅ Settings: theme (dark/light/system), remember-filter, remember-search, clear all
- ✅ Update Checker against the GitHub Releases API, with a request timeout
- ✅ About panel and all outbound links (Repository / Issues / Support)
- ✅ Manifest V3 compliance, minimal permissions, no remote code

## Known limitations

- RTMP detection is opportunistic: Chrome's network stack generally doesn't
  expose native `rtmp://` traffic to extensions, so this mainly catches RTMP
  URLs surfaced indirectly (e.g. embedded in page JS/JSON).
- The stream list is a plain DOM list, capped at 500 records per tab; there's
  no virtual scrolling for extremely long-lived, high-churn pages.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT — see [LICENSE](LICENSE).
