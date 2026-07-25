// ManifestHawk — background service worker (v3)
//
// Responsibilities:
//  - Watch network traffic per-tab and classify media manifest / segment / audio URLs.
//  - De-duplicate: the same manifest re-requested (token refresh, cache-bust query
//    params, live-playlist polling) updates ONE record and bumps a request counter
//    instead of creating a new entry.
//  - Group .ts / .m4s segments under their parent manifest instead of listing every
//    segment as its own "stream". If a segment arrives before its manifest has been
//    seen, it's aggregated into a single per-folder placeholder row that gets merged
//    into the real manifest record the moment that manifest is captured.
//  - Persist per-tab state to chrome.storage.session so a service-worker restart
//    (Chrome unloads idle MV3 workers after ~30s) doesn't lose captured data.
//  - Push incremental updates to the side panel (throttled) instead of relying on
//    the UI to poll — this is what keeps the panel from re-rendering/flickering.

"use strict";

/* ---------------------------------------------------------------------- */
/* Classification                                                          */
/* ---------------------------------------------------------------------- */

const MANIFEST_PATTERNS = [
  { type: "HLS", category: "HLS", kind: "manifest", regex: /\.m3u8(\?.*)?$/i },
  { type: "DASH", category: "DASH", kind: "manifest", regex: /\.mpd(\?.*)?$/i },
  { type: "RTMP", category: "Other", kind: "manifest", regex: /^rtmp[st]?:\/\// },
  { type: "MP4", category: "MP4", kind: "manifest", regex: /\.mp4(\?.*)?$/i },
  { type: "Audio", category: "Audio", kind: "manifest", regex: /\.(mp3|aac|m4a|wav|ogg|flac|opus)(\?.*)?$/i },
  { type: "TS Segment", category: "Segment", kind: "segment", regex: /\.ts(\?.*)?$/i },
  { type: "M4S Segment", category: "Segment", kind: "segment", regex: /\.m4s(\?.*)?$/i }
];

function classify(url) {
  for (const p of MANIFEST_PATTERNS) {
    if (p.regex.test(url)) return p;
  }
  return null;
}

// Content-type sniffing catches manifests served without a matching file
// extension (common behind CDNs / signed-URL proxies).
function classifyByContentType(ct) {
  if (ct.includes("mpegurl") || ct.includes("x-mpegurl")) {
    return { type: "HLS", category: "HLS", kind: "manifest" };
  }
  if (ct.includes("dash+xml")) {
    return { type: "DASH", category: "DASH", kind: "manifest" };
  }
  if (ct.startsWith("audio/")) {
    return { type: "Audio", category: "Audio", kind: "manifest" };
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/* URL normalization                                                       */
/* ---------------------------------------------------------------------- */

// Dedupe key: scheme + host (lower-cased) + path, with query string and
// fragment stripped. This is what makes "same manifest, different token /
// cache-buster query param" collapse into one record instead of a new one
// on every refresh.
function normalizeKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const port = u.port ? `:${u.port}` : "";
    return `${u.protocol}//${u.hostname.toLowerCase()}${port}${u.pathname}`;
  } catch {
    // Non-standard scheme (some RTMP variants) or malformed URL — fall back
    // to a best-effort string strip rather than throwing.
    return String(rawUrl).split("?")[0].split("#")[0];
  }
}

// Directory of a normalized URL — used to associate segments with the
// manifest that lives in (or above) the same folder.
function folderKey(rawUrl) {
  const key = normalizeKey(rawUrl);
  const idx = key.lastIndexOf("/");
  return idx >= 0 ? key.slice(0, idx + 1) : key;
}

/* ---------------------------------------------------------------------- */
/* Per-tab state                                                           */
/* ---------------------------------------------------------------------- */

// A tab left open on a live stream generates an unbounded number of unique
// manifest variants (bitrate ladders, ad-insertion redirects, etc). Cap it
// and evict oldest-inserted first (Map preserves insertion order).
const MAX_RECORDS_PER_TAB = 500;
const BADGE_COLOR = "#3B82F6";
const PERSIST_DEBOUNCE_MS = 800;
const BROADCAST_DEBOUNCE_MS = 250;

// tabId -> { streams: Map(normalizedKey -> record), orphanSegments: Map(folderKey -> record), domain }
const tabStates = new Map();
const persistTimers = new Map();
const broadcastTimers = new Map();
const pendingBroadcast = new Map(); // tabId -> Map(recordId -> record)

function storageKey(tabId) {
  return `mh_tab_${tabId}`;
}

function newRecord({ id, url, normalizedUrl, type, category, kind, folderKeyValue, now }) {
  return {
    id,
    url,
    normalizedUrl,
    type,
    category,
    kind, // 'manifest' | 'segmentGroup'
    folderKey: folderKeyValue,
    firstSeen: now,
    lastSeen: now,
    requestCount: kind === "manifest" ? 1 : 0,
    segmentCount: 0
  };
}

function getTabState(tabId) {
  let ts = tabStates.get(tabId);
  if (!ts) {
    ts = { streams: new Map(), orphanSegments: new Map(), domain: null };
    tabStates.set(tabId, ts);
    // Best-effort recovery from a previous service-worker lifetime. This
    // merges in without clobbering anything captured in the meantime.
    hydrateTabState(tabId);
  }
  return ts;
}

async function hydrateTabState(tabId) {
  try {
    const key = storageKey(tabId);
    const res = await chrome.storage.session.get([key]);
    const saved = res[key];
    if (!saved) return;
    const ts = tabStates.get(tabId);
    if (!ts) return; // tab was closed / reset while this was in flight

    for (const rec of saved.streams || []) {
      if (!ts.streams.has(rec.normalizedUrl)) ts.streams.set(rec.normalizedUrl, rec);
    }
    for (const rec of saved.orphanSegments || []) {
      if (!ts.orphanSegments.has(rec.folderKey)) ts.orphanSegments.set(rec.folderKey, rec);
    }
    if (!ts.domain && saved.domain) ts.domain = saved.domain;
    updateBadge(tabId);
  } catch (err) {
    console.error("[ManifestHawk] hydrate failed:", err);
  }
}

function schedulePersist(tabId) {
  if (persistTimers.has(tabId)) return;
  const t = setTimeout(() => {
    persistTimers.delete(tabId);
    persistNow(tabId);
  }, PERSIST_DEBOUNCE_MS);
  persistTimers.set(tabId, t);
}

async function persistNow(tabId) {
  const ts = tabStates.get(tabId);
  if (!ts) return;
  try {
    await chrome.storage.session.set({
      [storageKey(tabId)]: {
        domain: ts.domain,
        streams: Array.from(ts.streams.values()),
        orphanSegments: Array.from(ts.orphanSegments.values())
      }
    });
  } catch (err) {
    console.error("[ManifestHawk] persist failed:", err);
  }
}

async function clearTabStorage(tabId) {
  try {
    await chrome.storage.session.remove([storageKey(tabId)]);
  } catch (err) {
    console.error("[ManifestHawk] clearTabStorage failed:", err);
  }
}

/* ---------------------------------------------------------------------- */
/* Insert / merge logic                                                    */
/* ---------------------------------------------------------------------- */

function findManifestForFolder(ts, fKey) {
  let best = null;
  for (const rec of ts.streams.values()) {
    if (rec.category !== "HLS" && rec.category !== "DASH") continue;
    if (fKey === rec.folderKey || fKey.startsWith(rec.folderKey)) {
      if (!best || rec.folderKey.length > best.folderKey.length) best = rec;
    }
  }
  return best;
}

function recordStream(tabId, rawUrl, match) {
  if (tabId < 0 || !match) return;
  const ts = getTabState(tabId);
  const now = Date.now();

  if (match.kind === "manifest") {
    const key = normalizeKey(rawUrl);
    let rec = ts.streams.get(key);

    if (rec) {
      rec.requestCount += 1;
      rec.lastSeen = now;
      rec.url = rawUrl; // keep the freshest full URL (latest token/query)
    } else {
      if (ts.streams.size >= MAX_RECORDS_PER_TAB) {
        const oldestKey = ts.streams.keys().next().value;
        ts.streams.delete(oldestKey);
      }
      rec = newRecord({
        id: key,
        url: rawUrl,
        normalizedUrl: key,
        type: match.type,
        category: match.category,
        kind: "manifest",
        folderKeyValue: folderKey(rawUrl),
        now
      });
      ts.streams.set(key, rec);

      // Absorb any segments that were captured before this manifest was seen.
      const orphan = ts.orphanSegments.get(rec.folderKey);
      if (orphan) {
        rec.segmentCount += orphan.segmentCount;
        rec.lastSeen = Math.max(rec.lastSeen, orphan.lastSeen);
        ts.orphanSegments.delete(rec.folderKey);
      }
    }

    scheduleBroadcast(tabId, rec);
    schedulePersist(tabId);
    updateBadge(tabId);
    return;
  }

  // Segment (.ts / .m4s): never becomes its own visible entry.
  const fKey = folderKey(rawUrl);
  const parent = findManifestForFolder(ts, fKey);
  if (parent) {
    parent.segmentCount += 1;
    parent.lastSeen = now;
    scheduleBroadcast(tabId, parent);
    schedulePersist(tabId);
    return;
  }

  let orphan = ts.orphanSegments.get(fKey);
  if (!orphan) {
    if (ts.streams.size + ts.orphanSegments.size >= MAX_RECORDS_PER_TAB) return;
    orphan = newRecord({
      id: "seg:" + fKey,
      url: rawUrl,
      normalizedUrl: fKey,
      type: "Segment Group",
      category: "Other",
      kind: "segmentGroup",
      folderKeyValue: fKey,
      now
    });
    ts.orphanSegments.set(fKey, orphan);
  }
  orphan.segmentCount += 1;
  orphan.lastSeen = now;
  orphan.url = rawUrl;

  scheduleBroadcast(tabId, orphan);
  schedulePersist(tabId);
  updateBadge(tabId);
}

function addStream(tabId, url) {
  const match = classify(url);
  if (match) recordStream(tabId, url, match);
}

/* ---------------------------------------------------------------------- */
/* UI push updates (throttled — this is what prevents popup/panel churn)   */
/* ---------------------------------------------------------------------- */

function scheduleBroadcast(tabId, record) {
  if (!pendingBroadcast.has(tabId)) pendingBroadcast.set(tabId, new Map());
  pendingBroadcast.get(tabId).set(record.id, record);

  if (broadcastTimers.has(tabId)) return;
  const t = setTimeout(() => flushBroadcast(tabId), BROADCAST_DEBOUNCE_MS);
  broadcastTimers.set(tabId, t);
}

function flushBroadcast(tabId) {
  broadcastTimers.delete(tabId);
  const pending = pendingBroadcast.get(tabId);
  pendingBroadcast.delete(tabId);
  if (!pending || pending.size === 0) return;

  const records = Array.from(pending.values());
  // No listener (panel closed) is a normal, expected condition — swallow
  // the resulting lastError instead of logging noise.
  chrome.runtime.sendMessage({ type: "STREAMS_PATCH", tabId, records }, () => void chrome.runtime.lastError);
}

function broadcastReset(tabId) {
  chrome.runtime.sendMessage({ type: "STREAMS_RESET", tabId }, () => void chrome.runtime.lastError);
}

/* ---------------------------------------------------------------------- */
/* Badge                                                                   */
/* ---------------------------------------------------------------------- */

// A request can resolve for a tab that has *just* closed (normal navigation
// races). Without a callback, the resulting rejection becomes an unchecked
// "runtime.lastError" warning in the service-worker console — harmless but
// noisy, so it's explicitly swallowed here.
function updateBadge(tabId) {
  if (!chrome.action) return;
  const ts = tabStates.get(tabId);
  const count = ts ? ts.streams.size + ts.orphanSegments.size : 0;
  const text = count > 0 ? String(count) : "";

  chrome.action.setBadgeText({ tabId, text }, () => void chrome.runtime.lastError);
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }, () => void chrome.runtime.lastError);
}

function updateTabDomain(tabId, url) {
  try {
    const domain = new URL(url).hostname;
    const ts = getTabState(tabId);
    ts.domain = domain;
  } catch {
    /* chrome://, about:, file:// etc. — leave domain as-is */
  }
}

/* ---------------------------------------------------------------------- */
/* Reset / teardown                                                        */
/* ---------------------------------------------------------------------- */

function resetTab(tabId) {
  tabStates.delete(tabId);
  pendingBroadcast.delete(tabId);
  const bt = broadcastTimers.get(tabId);
  if (bt) {
    clearTimeout(bt);
    broadcastTimers.delete(tabId);
  }
  const pt = persistTimers.get(tabId);
  if (pt) {
    clearTimeout(pt);
    persistTimers.delete(tabId);
  }
  clearTabStorage(tabId);
  updateBadge(tabId);
}

/* ---------------------------------------------------------------------- */
/* Error containment                                                       */
/* ---------------------------------------------------------------------- */

// Every listener body is wrapped so one malformed/unexpected event can never
// throw uncaught inside the service worker. An uncaught exception on a hot
// listener like onBeforeRequest could otherwise destabilize the worker.
function safe(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.error("[ManifestHawk] listener error:", err);
    }
  };
}

/* ---------------------------------------------------------------------- */
/* Network listeners                                                       */
/* ---------------------------------------------------------------------- */

chrome.webRequest.onBeforeRequest.addListener(
  safe((details) => addStream(details.tabId, details.url)),
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  safe((details) => {
    if (details.tabId < 0) return;
    const ctHeader = details.responseHeaders?.find((h) => h.name.toLowerCase() === "content-type");
    if (!ctHeader) return;
    const match = classifyByContentType(ctHeader.value.toLowerCase());
    if (match) recordStream(details.tabId, details.url, match);
  }),
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

/* ---------------------------------------------------------------------- */
/* Tab lifecycle                                                           */
/* ---------------------------------------------------------------------- */

chrome.tabs.onUpdated.addListener(
  safe((tabId, changeInfo) => {
    if (changeInfo.url) updateTabDomain(tabId, changeInfo.url);
  })
);

chrome.tabs.onRemoved.addListener(
  safe((tabId) => {
    resetTab(tabId);
  })
);

chrome.webNavigation?.onCommitted.addListener(
  safe((details) => {
    if (details.frameId !== 0) return; // ignore iframe navigations
    // New top-level navigation -> the previous page's captures are stale.
    resetTab(details.tabId);
    updateTabDomain(details.tabId, details.url);
    broadcastReset(details.tabId);
  })
);

/* ---------------------------------------------------------------------- */
/* Side panel wiring                                                       */
/* ---------------------------------------------------------------------- */

// Makes the toolbar icon open the side panel directly. The side panel is
// not subject to Chrome's "close the popup on focus loss / tab switch"
// behavior, which is what eliminates the blink/auto-close problem entirely.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.error("[ManifestHawk] setPanelBehavior failed:", err);
});

/* ---------------------------------------------------------------------- */
/* Messaging                                                               */
/* ---------------------------------------------------------------------- */

function buildStreamList(ts) {
  if (!ts) return [];
  const all = [...ts.streams.values(), ...ts.orphanSegments.values()];
  all.sort((a, b) => b.lastSeen - a.lastSeen);
  return all;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg?.type === "GET_STREAMS") {
      (async () => {
        let ts = tabStates.get(msg.tabId);
        if (!ts) {
          ts = getTabState(msg.tabId);
          await hydrateTabState(msg.tabId);
        }
        sendResponse({ streams: buildStreamList(ts), domain: ts.domain });
      })();
      return true; // keep the message channel open for the async response
    }

    if (msg?.type === "DOM_STREAMS_FOUND" && sender.tab) {
      for (const url of msg.urls || []) addStream(sender.tab.id, url);
      return false;
    }

    if (msg?.type === "CLEAR_STREAMS") {
      resetTab(msg.tabId);
      sendResponse({ ok: true });
      return true;
    }
  } catch (err) {
    console.error("[ManifestHawk] onMessage error:", err);
    try {
      sendResponse({ error: String(err) });
    } catch {
      /* channel already closed — nothing more to do */
    }
  }
  return false;
});

/* ---------------------------------------------------------------------- */
/* Last line of defense                                                    */
/* ---------------------------------------------------------------------- */

self.addEventListener("error", (e) => console.error("[ManifestHawk] uncaught error:", e.message));
self.addEventListener("unhandledrejection", (e) => console.error("[ManifestHawk] unhandled rejection:", e.reason));
