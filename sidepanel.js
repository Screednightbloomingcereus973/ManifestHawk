// ManifestHawk — side panel controller (v3)
//
// This panel never polls. The background service worker pushes throttled
// "STREAMS_PATCH" messages as new/updated records appear, and this script
// patches only the affected DOM node(s) in place — the list is only fully
// rebuilt on an explicit tab switch or an actual page navigation
// ("STREAMS_RESET"), both of which are legitimate resets, not artifacts of
// a refresh timer. That's what keeps the panel from flickering and what
// keeps an open "Details" drawer from snapping shut on its own.

(() => {
  "use strict";

  /* ---------- DOM refs ---------- */
  const el = {
    list: document.getElementById("list"),
    empty: document.getElementById("empty"),
    emptyTitle: document.getElementById("emptyTitle"),
    emptyDesc: document.getElementById("emptyDesc"),
    loading: document.getElementById("loading"),
    errorState: document.getElementById("errorState"),
    errorDesc: document.getElementById("errorDesc"),
    retryBtn: document.getElementById("retryBtn"),
    template: document.getElementById("itemTemplate"),
    statCount: document.getElementById("statCount"),
    statDomain: document.getElementById("statDomain"),
    typeChips: document.getElementById("typeChips"),
    filters: document.getElementById("filters"),
    searchToggle: document.getElementById("searchToggle"),
    searchBar: document.getElementById("searchBar"),
    searchInput: document.getElementById("searchInput"),
    clearBtn: document.getElementById("clearBtn"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsPanel: document.getElementById("settingsPanel"),
    settingsClose: document.getElementById("settingsClose"),
    themeSegmented: document.getElementById("themeSegmented"),
    optAutoScroll: document.getElementById("optAutoScroll"),
    optRememberFilters: document.getElementById("optRememberFilters"),
    optRememberSearch: document.getElementById("optRememberSearch"),
    exportJson: document.getElementById("exportJson"),
    exportCsv: document.getElementById("exportCsv"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    appVersion: document.getElementById("appVersion"),
    linkRepo: document.getElementById("linkRepo"),
    linkIssues: document.getElementById("linkIssues"),
    linkSupport: document.getElementById("linkSupport"),
    checkUpdatesBtn: document.getElementById("checkUpdatesBtn"),
    updateStatus: document.getElementById("updateStatus"),
    copyrightYear: document.getElementById("copyrightYear")
  };

  const LINKS = {
    repo: "https://github.com/istiakrahman15/manifesthawk",
    issues: "https://github.com/istiakrahman15/manifesthawk/issues",
    support: "https://www.supportkori.com/istiakrahman15",
    releasesApi: "https://api.github.com/repos/istiakrahman15/manifesthawk/releases/latest"
  };

  const EMPTY_DEFAULT = {
    title: "No media streams detected",
    desc: "Play media on the current page.<br />ManifestHawk will automatically detect supported media requests and display them here."
  };
  const EMPTY_NO_MATCH = {
    title: "No matching streams",
    desc: "Try a different filter or search term."
  };

  const DEFAULT_EXT = { HLS: ".m3u8", DASH: ".mpd", MP4: ".mp4", Audio: ".mp3", Other: "" };

  const TYPE_ICONS = {
    HLS: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16v2H4V5Zm0 6h10v2H4v-2Zm0 6h16v2H4v-2Zm13-6 5 3-5 3v-6Z"/></svg>',
    DASH: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 2 7v10l10 5 10-5V7L12 2Zm0 2.2 7 3.5-7 3.5-7-3.5 7-3.5ZM4 9.6l7 3.5v6.8l-7-3.5V9.6Zm9 10.3v-6.8l7-3.5v6.8l-7 3.5Z"/></svg>',
    MP4: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm6.5 4.6v6.8l5.5-3.4-5.5-3.4Z"/></svg>',
    Audio: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 3v10.6a3.5 3.5 0 1 0 2 3.15V8h7V5h-9V3H9Z"/></svg>',
    Other: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>'
  };

  /* ---------- State ---------- */
  const state = {
    tabId: null,
    domain: "—",
    // id -> record. Order for rendering is derived, not stored, so patches
    // never need to re-sort/rebuild the whole list.
    streamMap: new Map(),
    cardEls: new Map(), // id -> <li> element, so patches can update in place
    filter: "All",
    search: "",
    settings: {
      theme: "dark",
      autoScroll: false,
      rememberFilters: false,
      rememberSearch: false
    }
  };

  const DEFAULT_SETTINGS = { ...state.settings };

  /* ---------- Storage helpers ---------- */
  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["mh_settings"], (res) => {
        resolve({ ...DEFAULT_SETTINGS, ...(res.mh_settings || {}) });
      });
    });
  }
  function saveSettings() {
    chrome.storage.local.set({ mh_settings: state.settings });
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    let theme = state.settings.theme;
    if (theme === "system") {
      theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.body.setAttribute("data-theme", theme);
  }
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme();
  });

  /* ---------- Tab tracking ---------- */
  // Unlike a popup, the side panel survives tab switches — so it must
  // actively track which tab is active and reload data for it, rather than
  // being torn down and recreated by Chrome on every switch.
  async function resolveActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async function switchToTab(tabId, url) {
    state.tabId = tabId;
    try {
      state.domain = url ? new URL(url).hostname || "—" : "—";
    } catch {
      state.domain = "—";
    }
    state.streamMap.clear();
    state.cardEls.clear();
    el.list.innerHTML = "";
    await load(true);
  }

  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      if (tab.id === state.tabId) return;
      switchToTab(tab.id, tab.url).catch((err) => showError(err?.message || "Could not switch tabs."));
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== state.tabId) return;
    if (changeInfo.url) {
      try {
        state.domain = new URL(changeInfo.url).hostname || "—";
        renderDashboard();
      } catch {
        /* ignore unparsable URLs */
      }
    }
  });

  /* ---------- Data fetching ---------- */
  function fetchStreams(tabId) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "GET_STREAMS", tabId }, (res) => {
        if (chrome.runtime.lastError || !res) {
          reject(chrome.runtime.lastError || new Error("No response from the extension background."));
          return;
        }
        resolve(res);
      });
    });
  }

  // Rapid tab switching can fire several load() calls before earlier ones
  // resolve. Each call gets a token; a response only gets applied if it's
  // still the most recent request by the time it arrives — otherwise a
  // slow response for a tab the user has already switched away from could
  // overwrite the correct, newer data with stale data.
  let loadToken = 0;

  async function load(showLoading) {
    const myToken = ++loadToken;
    if (showLoading) setView("loading");
    try {
      let tabId = state.tabId;
      if (tabId == null) {
        const tab = await resolveActiveTab();
        if (!tab) throw new Error("No active tab found.");
        tabId = tab.id;
        if (myToken === loadToken) {
          state.tabId = tabId;
          try {
            state.domain = new URL(tab.url).hostname || "—";
          } catch {
            state.domain = "—";
          }
        }
      }

      const res = await fetchStreams(tabId);
      if (myToken !== loadToken) return; // a newer load has since started — discard

      if (res.domain) state.domain = res.domain;

      state.streamMap.clear();
      for (const rec of res.streams || []) state.streamMap.set(rec.id, rec);

      rebuildList();
      renderDashboard();
      setView("normal");
    } catch (err) {
      if (myToken !== loadToken) return;
      showError(err?.message || "Could not load stream data for this tab.");
    }
  }

  /* ---------- Push updates from background.js ---------- */
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.tabId !== state.tabId) return;

    if (msg.type === "STREAMS_PATCH") {
      const prevSize = state.streamMap.size;
      for (const rec of msg.records || []) {
        const isNew = !state.streamMap.has(rec.id);
        state.streamMap.set(rec.id, rec);
        patchCard(rec, isNew);
      }
      renderDashboard();
      updateEmptyState();
      if (state.settings.autoScroll && state.streamMap.size > prevSize && prevSize > 0) {
        el.list.scrollTo({ top: 0, behavior: "smooth" });
      }
    } else if (msg.type === "STREAMS_RESET") {
      state.streamMap.clear();
      state.cardEls.clear();
      el.list.innerHTML = "";
      renderDashboard();
      updateEmptyState();
    }
  });

  /* ---------- View state machine ---------- */
  function setView(view) {
    el.loading.classList.toggle("hidden", view !== "loading");
    el.errorState.classList.toggle("hidden", view !== "error");
  }

  function showError(msg) {
    console.error("[ManifestHawk]", msg);
    el.errorDesc.textContent = msg;
    setView("error");
    el.list.innerHTML = "";
    el.empty.classList.add("hidden");
  }

  /* ---------- Filtering / search ---------- */
  function matchesFilter(stream) {
    return state.filter === "All" || stream.category === state.filter;
  }

  function matchesSearch(stream) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return (
      stream.url.toLowerCase().includes(q) ||
      filenameOf(stream).toLowerCase().includes(q) ||
      hostnameOf(stream.url).toLowerCase().includes(q) ||
      stream.type.toLowerCase().includes(q)
    );
  }

  function visibleStreams() {
    return Array.from(state.streamMap.values())
      .filter((s) => matchesFilter(s) && matchesSearch(s))
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  function filenameOf(stream) {
    if (stream.kind === "segmentGroup") {
      try {
        const u = new URL(stream.normalizedUrl.endsWith("/") ? stream.normalizedUrl : stream.folderKey);
        const parts = u.pathname.split("/").filter(Boolean);
        return (parts[parts.length - 1] || u.hostname) + "/";
      } catch {
        return "segments/";
      }
    }
    try {
      const u = new URL(stream.url);
      return u.pathname.split("/").pop() || u.hostname;
    } catch {
      return stream.url;
    }
  }
  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  /* ---------- Rendering: dashboard ---------- */
  function renderDashboard() {
    el.statCount.textContent = String(state.streamMap.size);
    el.statDomain.textContent = state.domain;
    el.statDomain.title = state.domain;

    const counts = {};
    for (const s of state.streamMap.values()) counts[s.category] = (counts[s.category] || 0) + 1;

    el.typeChips.innerHTML = "";
    Object.entries(counts).forEach(([category, n]) => {
      const chip = document.createElement("span");
      chip.className = "type-chip";
      chip.textContent = `${n} ${category}`;
      el.typeChips.appendChild(chip);
    });
  }

  function setEmptyState(copy) {
    el.emptyTitle.textContent = copy.title;
    el.emptyDesc.innerHTML = copy.desc;
  }

  function updateEmptyState() {
    const items = visibleStreams();
    const noData = state.streamMap.size === 0;
    const noMatches = !noData && items.length === 0;
    el.empty.classList.toggle("hidden", !(noData || noMatches));
    setEmptyState(noData ? EMPTY_DEFAULT : EMPTY_NO_MATCH);
  }

  /* ---------- Rendering: full list (tab switch / reset only) ---------- */
  function rebuildList() {
    el.list.innerHTML = "";
    state.cardEls.clear();
    const items = visibleStreams();
    const frag = document.createDocumentFragment();
    for (const s of items) {
      const card = buildCard(s);
      frag.appendChild(card);
    }
    el.list.appendChild(frag);
    updateEmptyState();
  }

  /* ---------- Rendering: incremental patch ---------- */
  function patchCard(stream, isNew) {
    if (!matchesFilter(stream) || !matchesSearch(stream)) {
      // No longer visible under the current filter/search — remove if present.
      const existing = state.cardEls.get(stream.id);
      if (existing) {
        existing.remove();
        state.cardEls.delete(stream.id);
      }
      return;
    }

    const existing = state.cardEls.get(stream.id);
    if (existing) {
      updateCardContent(existing, stream);
      return;
    }

    const card = buildCard(stream);
    el.list.insertBefore(card, el.list.firstChild);
  }

  function buildCard(stream) {
    const node = el.template.content.cloneNode(true);
    const card = node.querySelector(".stream-card");
    card.dataset.id = stream.id;
    state.cardEls.set(stream.id, card);

    const main = node.querySelector(".card-main");
    const details = node.querySelector("[data-details]");

    function toggleOpen() {
      const isOpen = card.classList.toggle("open");
      details.classList.toggle("hidden", !isOpen);
      main.setAttribute("aria-expanded", String(isOpen));
    }
    main.addEventListener("click", toggleOpen);
    main.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleOpen();
      }
    });

    node.querySelector("[data-copy]").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const rec = state.streamMap.get(card.dataset.id);
      navigator.clipboard
        .writeText(rec?.url || "")
        .then(() => flash(btn, "Copied!"))
        .catch(() => flash(btn, "Copy failed"));
    });

    node.querySelector("[data-open]").addEventListener("click", (e) => {
      e.stopPropagation();
      const rec = state.streamMap.get(card.dataset.id);
      if (!rec || rec.kind === "segmentGroup") return;
      const playerUrl = chrome.runtime.getURL(
        `player.html?src=${encodeURIComponent(rec.url)}&type=${encodeURIComponent(rec.type)}`
      );
      chrome.tabs.create({ url: playerUrl });
    });

    node.querySelector("[data-download]").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const rec = state.streamMap.get(card.dataset.id);
      if (!rec || rec.kind === "segmentGroup") return;
      if (rec.type === "RTMP") {
        flash(btn, "Use ffmpeg cmd", 1600);
        return;
      }
      chrome.downloads.download(
        { url: rec.url, filename: suggestFilename(rec.url, rec.category) },
        (downloadId) => {
          if (chrome.runtime.lastError || downloadId === undefined) {
            flash(btn, "Download failed", 1600);
            return;
          }
          flash(btn, rec.category === "HLS" || rec.category === "DASH" ? "Manifest saved" : "Downloading…");
        }
      );
    });

    node.querySelector("[data-ffmpeg]").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const rec = state.streamMap.get(card.dataset.id);
      if (!rec || rec.kind === "segmentGroup") return;
      const cmd = `ffmpeg -i "${rec.url}" -c copy output.mp4`;
      navigator.clipboard
        .writeText(cmd)
        .then(() => flash(btn, "Cmd copied!"))
        .catch(() => flash(btn, "Copy failed"));
    });

    updateCardContent(card, stream);
    return node;
  }

  function updateCardContent(card, stream) {
    const filename = filenameOf(stream);
    const hostname = stream.kind === "segmentGroup" ? hostnameOf(stream.folderKey) : hostnameOf(stream.url);

    card.querySelector("[data-badge]").textContent = stream.kind === "segmentGroup" ? "Segments" : stream.type;

    const filenameEl = card.querySelector("[data-filename]");
    filenameEl.textContent = filename;
    filenameEl.title = filename;

    const hostnameEl = card.querySelector("[data-hostname]");
    hostnameEl.textContent = hostname;
    hostnameEl.title = hostname;

    card.querySelector("[data-icon]").innerHTML = TYPE_ICONS[stream.category] || TYPE_ICONS.Other;
    card.querySelector("[data-url]").textContent = stream.url;
    card.querySelector("[data-time]").textContent = "Last seen " + new Date(stream.lastSeen).toLocaleTimeString();

    const meta = card.querySelector("[data-meta]");
    meta.innerHTML = "";
    if (stream.requestCount > 1) {
      const pill = document.createElement("span");
      pill.className = "meta-pill meta-count";
      pill.textContent = `seen ${stream.requestCount}×`;
      meta.appendChild(pill);
    }
    if (stream.segmentCount > 0) {
      const pill = document.createElement("span");
      pill.className = "meta-pill meta-segments";
      pill.textContent = `${stream.segmentCount} segment${stream.segmentCount === 1 ? "" : "s"}`;
      meta.appendChild(pill);
    }
    if (stream.kind === "segmentGroup") {
      const pill = document.createElement("span");
      pill.className = "meta-pill";
      pill.textContent = "no manifest captured yet";
      meta.appendChild(pill);
    }

    const isGrouped = stream.kind === "segmentGroup";
    const openBtn = card.querySelector("[data-open]");
    const downloadBtn = card.querySelector("[data-download]");
    const ffmpegBtn = card.querySelector("[data-ffmpeg]");
    openBtn.disabled = isGrouped;
    downloadBtn.disabled = isGrouped;
    ffmpegBtn.disabled = isGrouped;
    openBtn.title = isGrouped ? "No single manifest URL to preview yet" : "Open an in-extension preview player";
    downloadBtn.title = isGrouped ? "No single manifest URL to download yet" : "Save this file with the browser's downloader";
  }

  function suggestFilename(url, category) {
    try {
      const u = new URL(url);
      const name = u.pathname.split("/").pop() || "stream";
      if (name.includes(".")) return name;
      return name + (DEFAULT_EXT[category] || "");
    } catch {
      return "stream" + (DEFAULT_EXT[category] || "");
    }
  }

  function flash(btn, text, duration = 1200) {
    if (btn.disabled) return;
    const original = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, duration);
  }

  /* ---------- Export ---------- */
  // Revoking the blob: URL immediately after downloads.download()'s callback
  // fires is a common extension bug: that callback only confirms the
  // download was *registered*, not that Chrome has finished reading the
  // blob — revoking too early can truncate the exported file. Wait for the
  // download to actually finish (or fall back to a generous timeout).
  function downloadTextFile(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        URL.revokeObjectURL(url);
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(url);
      };
      const onChanged = (delta) => {
        if (delta.id !== downloadId) return;
        if (delta.state && (delta.state.current === "complete" || delta.state.current === "interrupted")) {
          finish();
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      setTimeout(finish, 30000); // safety net in case onChanged never reports completion
    });
  }

  function exportJson() {
    downloadTextFile("manifesthawk-export.json", "application/json", JSON.stringify(visibleStreams(), null, 2));
  }

  function exportCsv() {
    const rows = [["type", "category", "url", "requestCount", "segmentCount", "firstSeen", "lastSeen"]];
    for (const s of visibleStreams()) {
      rows.push([
        s.type,
        s.category,
        s.url,
        s.requestCount,
        s.segmentCount,
        new Date(s.firstSeen).toISOString(),
        new Date(s.lastSeen).toISOString()
      ]);
    }
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadTextFile("manifesthawk-export.csv", "text/csv", csv);
  }

  function csvEscape(value) {
    let str = String(value ?? "");
    // Neutralize CSV/formula injection: a cell opened in Excel/Sheets that
    // starts with = + - @ can be interpreted as a formula.
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  /* ---------- Clear (shared by header button and settings button) ---------- */
  function clearStreams() {
    if (state.tabId == null) return;
    chrome.runtime.sendMessage({ type: "CLEAR_STREAMS", tabId: state.tabId }, () => {
      state.streamMap.clear();
      state.cardEls.clear();
      el.list.innerHTML = "";
      renderDashboard();
      updateEmptyState();
    });
  }

  /* ---------- Event wiring ---------- */
  el.filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    [...el.filters.children].forEach((c) => {
      const active = c === btn;
      c.classList.toggle("active", active);
      c.setAttribute("aria-pressed", String(active));
    });
    if (state.settings.rememberFilters) chrome.storage.local.set({ mh_lastFilter: state.filter });
    rebuildList();
  });

  el.searchToggle.addEventListener("click", () => toggleSearch());
  function toggleSearch(forceOpen) {
    const willOpen = forceOpen ?? el.searchBar.classList.contains("hidden");
    el.searchBar.classList.toggle("hidden", !willOpen);
    el.searchToggle.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) el.searchInput.focus();
  }

  let searchDebounceTimer = null;
  el.searchInput.addEventListener("input", (e) => {
    const value = e.target.value.trim();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.search = value;
      if (state.settings.rememberSearch) chrome.storage.local.set({ mh_lastSearch: state.search });
      rebuildList();
    }, 120);
  });

  el.clearBtn.addEventListener("click", clearStreams);
  el.clearHistoryBtn.addEventListener("click", () => {
    clearStreams();
    chrome.storage.local.remove(["mh_lastFilter", "mh_lastSearch"]);
  });

  el.retryBtn.addEventListener("click", () => load(true));

  function openSettings() {
    el.settingsPanel.classList.remove("hidden");
    el.settingsToggle.setAttribute("aria-expanded", "true");
    el.settingsClose.focus();
  }
  function closeSettings() {
    el.settingsPanel.classList.add("hidden");
    el.settingsToggle.setAttribute("aria-expanded", "false");
    el.settingsToggle.focus();
  }
  el.settingsToggle.addEventListener("click", openSettings);
  el.settingsClose.addEventListener("click", closeSettings);

  el.settingsPanel.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = el.settingsPanel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  el.themeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    state.settings.theme = btn.dataset.theme;
    [...el.themeSegmented.children].forEach((c) => {
      const active = c === btn;
      c.classList.toggle("active", active);
      c.setAttribute("aria-pressed", String(active));
    });
    applyTheme();
    saveSettings();
  });

  const simpleToggles = [
    { el: el.optAutoScroll, key: "autoScroll" },
    {
      el: el.optRememberFilters,
      key: "rememberFilters",
      onEnable: () => chrome.storage.local.set({ mh_lastFilter: state.filter })
    },
    {
      el: el.optRememberSearch,
      key: "rememberSearch",
      onEnable: () => chrome.storage.local.set({ mh_lastSearch: state.search })
    }
  ];
  for (const t of simpleToggles) {
    t.el.addEventListener("change", (e) => {
      state.settings[t.key] = e.target.checked;
      saveSettings();
      if (e.target.checked && t.onEnable) t.onEnable();
    });
  }

  el.exportJson.addEventListener("click", exportJson);
  el.exportCsv.addEventListener("click", exportCsv);

  /* ---------- About: links + update check ---------- */
  // Opened via chrome.tabs.create rather than a plain <a href> so the panel
  // itself never navigates away — it's a side panel, not the tab content.
  el.linkRepo.addEventListener("click", () => chrome.tabs.create({ url: LINKS.repo }));
  el.linkIssues.addEventListener("click", () => chrome.tabs.create({ url: LINKS.issues }));
  el.linkSupport.addEventListener("click", () => chrome.tabs.create({ url: LINKS.support }));

  function parseVersion(v) {
    return String(v || "")
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  }
  function isNewerVersion(remote, local) {
    const r = parseVersion(remote);
    const l = parseVersion(local);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  function setUpdateStatus(text, kind) {
    el.updateStatus.textContent = text;
    el.updateStatus.classList.remove("status-ok", "status-available", "status-error");
    if (kind) el.updateStatus.classList.add(kind);
  }

  el.checkUpdatesBtn.addEventListener("click", async () => {
    const btn = el.checkUpdatesBtn;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Checking…";
    setUpdateStatus("", null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(LINKS.releasesApi, {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal
      });
      if (res.status === 404) {
        setUpdateStatus("No releases have been published yet.", null);
      } else if (!res.ok) {
        throw new Error(`GitHub responded with ${res.status}`);
      } else {
        const data = await res.json();
        const localVersion = chrome.runtime.getManifest().version;
        const remoteVersion = data.tag_name || data.name;
        if (remoteVersion && isNewerVersion(remoteVersion, localVersion)) {
          setUpdateStatus(`Update available: ${remoteVersion} — click GitHub Repository to get it.`, "status-available");
        } else {
          setUpdateStatus(`You're up to date (v${localVersion}).`, "status-ok");
        }
      }
    } catch (err) {
      console.error("[ManifestHawk] update check failed:", err);
      const timedOut = err && err.name === "AbortError";
      setUpdateStatus(
        timedOut ? "Update check timed out. Try again." : "Could not check for updates. Check your connection and try again.",
        "status-error"
      );
    } finally {
      clearTimeout(timeoutId);
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  if (el.copyrightYear) el.copyrightYear.textContent = String(new Date().getFullYear());

  /* Keyboard shortcuts: Ctrl/Cmd+F to search, Esc to close/clear */
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggleSearch(true);
    } else if (e.key === "Escape") {
      if (!el.settingsPanel.classList.contains("hidden")) {
        closeSettings();
      } else if (!el.searchBar.classList.contains("hidden")) {
        clearTimeout(searchDebounceTimer);
        el.searchInput.value = "";
        state.search = "";
        rebuildList();
        toggleSearch(false);
      }
    }
  });

  /* ---------- Init ---------- */
  async function init() {
    el.appVersion.textContent = chrome.runtime.getManifest().version;

    state.settings = await loadSettings();
    applyTheme();

    el.optAutoScroll.checked = state.settings.autoScroll;
    el.optRememberFilters.checked = state.settings.rememberFilters;
    el.optRememberSearch.checked = state.settings.rememberSearch;
    [...el.themeSegmented.children].forEach((c) => {
      const active = c.dataset.theme === state.settings.theme;
      c.classList.toggle("active", active);
      c.setAttribute("aria-pressed", String(active));
    });

    if (state.settings.rememberFilters) {
      const { mh_lastFilter } = await chrome.storage.local.get(["mh_lastFilter"]);
      if (mh_lastFilter) {
        state.filter = mh_lastFilter;
        [...el.filters.children].forEach((c) => {
          const active = c.dataset.filter === mh_lastFilter;
          c.classList.toggle("active", active);
          c.setAttribute("aria-pressed", String(active));
        });
      }
    }
    if (state.settings.rememberSearch) {
      const { mh_lastSearch } = await chrome.storage.local.get(["mh_lastSearch"]);
      if (mh_lastSearch) {
        state.search = mh_lastSearch;
        el.searchInput.value = mh_lastSearch;
        toggleSearch(true);
      }
    }

    await load(true);
    // No setInterval polling — updates arrive as push messages from
    // background.js (see the STREAMS_PATCH / STREAMS_RESET listener above).
  }

  init().catch((err) => {
    console.error("[ManifestHawk] init() failed:", err);
    showError(err?.message || "ManifestHawk failed to start.");
  });

  window.addEventListener("error", (e) => {
    console.error("[ManifestHawk] uncaught error:", e.error || e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[ManifestHawk] unhandled rejection:", e.reason);
  });
})();
