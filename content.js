// ManifestHawk — DOM fallback scan
// Catches streams set directly as element.src via JS (some players never
// trigger a plain network request the webRequest listener can see cleanly,
// e.g. blob: wrapped players). Also covers <audio> elements.

let contextValid = true;
let observer = null;

function sendFound(urls) {
  if (!contextValid || urls.length === 0) return;
  try {
    chrome.runtime.sendMessage({ type: "DOM_STREAMS_FOUND", urls }, () => void chrome.runtime.lastError);
  } catch (err) {
    // "Extension context invalidated" — happens when the extension is
    // reloaded/updated while this content script is still attached to an
    // already-open tab. The script is now orphaned until the page reloads,
    // so stop observing instead of spamming the console on every mutation.
    contextValid = false;
    if (observer) observer.disconnect();
  }
}

function scanDom() {
  const found = new Set();
  document.querySelectorAll("video, audio, source").forEach((el) => {
    const src = el.src || el.getAttribute("src");
    if (src && /\.(m3u8|mpd|mp3|aac|m4a|wav|ogg|flac|opus)(\?.*)?$/i.test(src)) {
      found.add(src);
    }
  });
  sendFound(Array.from(found));
}

// Debounce: pages with heavy, frequent DOM churn (SPAs, chat widgets, ad
// slots) can fire many MutationObserver batches per second. Re-walking the
// whole document on every batch is wasteful, so scans are coalesced.
let scanQueued = false;
function scheduleScan() {
  if (!contextValid || scanQueued) return;
  scanQueued = true;
  setTimeout(() => {
    scanQueued = false;
    scanDom();
  }, 400);
}

scanDom();

// `childList`/`subtree` catches new <video>/<audio>/<source> elements being
// added to the page. `attributes` on `src` is required too: many players
// reuse a single existing <video> element and just reassign `video.src`,
// which is an attribute mutation on a node that already existed and would
// otherwise be missed entirely.
observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src"]
});
