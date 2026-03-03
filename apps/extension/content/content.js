// ── SubPlayer Content Script ────────────────────────────────────────
// Injected into YouTube / Bilibili video pages.
// Creates a subtitle overlay that syncs with the video player.

let overlay = null;
let segments = [];
let isVisible = false;

// ── Create overlay ──────────────────────────────────────────────────
function createOverlay() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "subplayer-overlay";
  overlay.innerHTML = `
    <div id="subplayer-subtitle-text"></div>
    <div id="subplayer-subtitle-translation"></div>
  `;
  document.body.appendChild(overlay);
}

function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

// ── Find video element ──────────────────────────────────────────────
function getVideoElement() {
  // YouTube
  const ytVideo = document.querySelector("video.html5-main-video");
  if (ytVideo) return ytVideo;

  // Bilibili
  const biliVideo = document.querySelector("video");
  return biliVideo;
}

// ── Sync subtitles ──────────────────────────────────────────────────
let rafId = 0;

function syncSubtitles() {
  const video = getVideoElement();
  if (!video || !overlay || segments.length === 0) {
    rafId = requestAnimationFrame(syncSubtitles);
    return;
  }

  const t = video.currentTime;
  let activeSegment = null;

  for (const seg of segments) {
    if (t >= seg.start && t < seg.end) {
      activeSegment = seg;
      break;
    }
    if (t < seg.start) break;
  }

  const textEl = overlay.querySelector("#subplayer-subtitle-text");
  const transEl = overlay.querySelector("#subplayer-subtitle-translation");

  if (activeSegment) {
    textEl.textContent = activeSegment.text;
    transEl.textContent = activeSegment.translation || "";
    overlay.style.opacity = "1";
  } else {
    overlay.style.opacity = "0";
  }

  rafId = requestAnimationFrame(syncSubtitles);
}

// ── Message listener ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SHOW_SUBTITLES") {
    segments = message.segments || [];
    createOverlay();
    isVisible = true;
    overlay.style.display = "flex";
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(syncSubtitles);
  }

  if (message.type === "HIDE_SUBTITLES") {
    isVisible = false;
    if (overlay) {
      overlay.style.display = "none";
    }
    cancelAnimationFrame(rafId);
  }

  if (message.type === "SEEK_TO") {
    const video = getVideoElement();
    if (video) {
      video.currentTime = message.time;
      video.play().catch(() => {});
    }
  }

  if (message.type === "EXPORT_SUBPLAYER_SETTINGS") {
    try {
      const raw = window.localStorage.getItem("subplayer-settings");
      if (!raw) {
        sendResponse?.({ ok: false, error: "subplayer-settings not found in localStorage" });
        return false;
      }
      const parsed = JSON.parse(raw);
      const state = parsed?.state || {};
      sendResponse?.({ ok: true, settings: state });
      return false;
    } catch (err) {
      sendResponse?.({ ok: false, error: `read settings failed: ${err?.message || "unknown"}` });
      return false;
    }
  }
});

// ── Web Page Bridge ────────────────────────────────────────────────
// Allow normal web pages (e.g. localhost app) to request one-shot media
// capture via window.postMessage, then relay to extension background.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== "SUBPLAYER_CAPTURE_MEDIA_ONCE") return;
  const requestId = data.requestId;
  const respondError = (error) => {
    try {
      window.postMessage(
        {
          type: "SUBPLAYER_CAPTURE_MEDIA_ONCE_RESULT",
          requestId,
          result: { ok: false, error },
        },
        "*",
      );
    } catch {}
  };

  if (!chrome?.runtime?.id || !chrome?.runtime?.sendMessage) {
    respondError("extension-context-invalid");
    return;
  }

  try {
    chrome.runtime.sendMessage(
      {
        type: "CAPTURE_MEDIA_ONCE",
        pageUrl: data.pageUrl,
        timeoutMs: data.timeoutMs,
      },
      (res) => {
        if (chrome.runtime?.lastError) {
          respondError(`extension-runtime-error:${chrome.runtime.lastError.message}`);
          return;
        }
        try {
          window.postMessage(
            {
              type: "SUBPLAYER_CAPTURE_MEDIA_ONCE_RESULT",
              requestId,
              result: res || { ok: false, error: "No response from extension background" },
            },
            "*",
          );
        } catch {}
      },
    );
  } catch (err) {
    respondError(`extension-send-error:${err?.message || "unknown"}`);
  }
});
