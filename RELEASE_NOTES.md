# ManifestHawk v1.0.0 — Release Notes

**First public release.** ManifestHawk is a Chrome (Manifest V3) extension
that detects, inspects, and analyzes HLS, DASH, MP4, audio, and RTMP media
streams on any page, and shows them live in a side panel.

## Highlights

- **Passive, deduplicated capture** — watches network traffic per tab and
  collapses repeated requests for the same manifest (token refresh,
  cache-busting, live-playlist polling) into a single record with a request
  counter, instead of flooding the list.
- **Segment-aware** — `.ts` / `.m4s` segments are grouped under their parent
  manifest automatically.
- **Stable side panel, not a popup** — survives tab switches and doesn't
  auto-close on focus loss; updates are pushed live from the background
  worker with no polling.
- **In-extension preview player** — HLS via hls.js, DASH via dash.js, native
  playback for MP4/audio — with the relevant library loaded only when
  needed.
- **Search, filters, export (JSON/CSV), copy URL, download, and a generated
  ffmpeg command** for every captured stream.
- **Settings**: theme (dark/light/system), remember filter/search, clear
  history.
- **Update checker** against GitHub Releases, and an About panel linking to
  the repository, issue tracker, and support page.

## Install

Download the release zip below, or clone the repository, then:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the extracted/cloned folder

See [README.md](README.md) for permission details and project structure.

## Compatibility

Requires Chrome 114+ (for the Side Panel API).

## Known limitations

- RTMP detection is opportunistic — Chrome's network stack generally doesn't
  expose native `rtmp://` traffic to extensions.
- No virtual scrolling on the stream list (capped at 500 records per tab).

Full history in [CHANGELOG.md](CHANGELOG.md).
