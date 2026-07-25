// ManifestHawk — preview player controller
//
// hls.js (~530KB) and dash.js (~1MB) are loaded on demand, not both up
// front on every preview — a page previewing an MP4 or an audio file has
// no use for either, so paying that parse/compile cost for every preview
// was wasted memory and a slower first paint.

const params = new URLSearchParams(location.search);
const src = params.get("src");
const type = params.get("type");
const video = document.getElementById("video");
const status = document.getElementById("status");

document.getElementById("urlLabel").textContent = src || "No URL provided";

function loadScript(path) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = path;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + path));
    document.head.appendChild(s);
  });
}

async function main() {
  if (!src) {
    status.textContent = "No stream URL provided.";
    return;
  }

  if (type === "HLS") {
    // Prefer native HLS support (Safari-style) when available so the
    // hls.js download can be skipped entirely.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      status.textContent = "Loading via native HLS support…";
      return;
    }
    status.textContent = "Loading hls.js…";
    try {
      await loadScript("libs/hls.min.js");
    } catch {
      status.textContent = "Could not load the HLS playback library.";
      return;
    }
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) status.textContent = "Playback error: " + data.details;
      });
      status.textContent = "Loading via hls.js…";
    } else {
      status.textContent = "HLS is not supported in this browser.";
    }
  } else if (type === "DASH") {
    status.textContent = "Loading dash.js…";
    try {
      await loadScript("libs/dash.all.min.js");
    } catch {
      status.textContent = "Could not load the DASH playback library.";
      return;
    }
    if (window.dashjs) {
      const player = dashjs.MediaPlayer().create();
      player.initialize(video, src, true);
      player.on("error", (e) => {
        status.textContent = "Playback error: " + (e?.error?.message || "DASH playback failed.");
      });
      status.textContent = "Loading via dash.js…";
    } else {
      status.textContent = "dash.js failed to load.";
    }
  } else if (type === "RTMP") {
    // Browsers cannot play RTMP natively — there is no fallback here.
    status.textContent = "RTMP streams can't be previewed in-browser. Use the ffmpeg command or VLC instead.";
  } else {
    // Audio, MP4 (progressive), and TS segments — try native playback.
    video.src = src;
    video.addEventListener(
      "error",
      () => {
        status.textContent = "This URL could not be played directly — try downloading it or using the ffmpeg command.";
      },
      { once: true }
    );
    status.textContent = type === "Audio" ? "Playing via native audio support…" : "Attempting native playback…";
  }
}

main().catch((err) => {
  console.error("[ManifestHawk] player init failed:", err);
  status.textContent = "Something went wrong loading the preview.";
});
