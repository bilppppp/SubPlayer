// ── SubPlayer Chrome Extension — Background Service Worker ──────────

// Default API base URL (can be configured)
const DEFAULT_API_BASE = "https://your-domain.com";
const MEDIA_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CANDIDATES_PER_TAB = 200;
const latestMediaByTab = new Map();
const mediaCandidatesByTab = new Map();

function isMediaLikeUrl(url) {
  return /\.(m3u8|mpd|mp4|m4s|ts)(\?|$)/i.test(url) || /m3u8/i.test(url);
}

function detectKind(url) {
  if (/\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url)) return "hls";
  if (/\.mpd(\?|$)/i.test(url)) return "dash";
  if (/\.mp4(\?|$)/i.test(url)) return "mp4";
  return "unknown";
}

function isLikelySegmentUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Common segment patterns (including some fMP4 chunk URLs ending with .mp4).
  if (/\/seg-\d+/.test(lower)) return true;
  if (/\/chunk[-_/]?\d+/.test(lower)) return true;
  if (/\/frag[-_/]?\d+/.test(lower)) return true;
  if (/\.(ts|m4s)(\?|$)/.test(lower)) return true;
  if (/_h264_\d+/.test(lower) && /b-hls-/.test(lower)) return true;
  return false;
}

function mediaScore(url) {
  const kind = detectKind(url);
  if (kind === "hls") return 100;
  if (kind === "dash") return 90;
  if (kind === "mp4") return isLikelySegmentUrl(url) ? 20 : 60;
  return 10;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostContainsAdKeyword(host) {
  return /(ad|ads|doubleclick|googlesyndication|adservice|analytics|saawsedge)/i.test(host || "");
}

function pathLooksAdLike(url) {
  return /(ad|ads|promo|trailer|preroll|vast|banner|teaser)/i.test(url || "");
}

function tokenHits(url, pageUrl) {
  try {
    const parts = new URL(pageUrl).pathname
      .split("/")
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p && p.length >= 4 && /[a-z0-9]/i.test(p));
    const target = (url || "").toLowerCase();
    let hits = 0;
    for (const p of parts) {
      if (target.includes(p)) hits += 1;
    }
    return hits;
  } catch {
    return 0;
  }
}

function scoreForPage(candidate, pageUrl) {
  const pageHost = normalizeHost(pageUrl || "");
  const mediaHost = hostFromUrl(candidate.mediaUrl);
  const refererHost = hostFromUrl(candidate.headers?.referer || "");
  const originHost = hostFromUrl(candidate.headers?.origin || "");

  let score = candidate.score || mediaScore(candidate.mediaUrl);

  if (pageHost && (refererHost === pageHost || originHost === pageHost)) score += 60;
  if (pageHost && mediaHost === pageHost) score += 40;
  if (pageHost && mediaHost.endsWith(`.${pageHost}`)) score += 20;

  score += tokenHits(candidate.mediaUrl, pageUrl) * 15;

  if (hostContainsAdKeyword(mediaHost)) score -= 80;
  if (pathLooksAdLike(candidate.mediaUrl)) score -= 40;

  return score;
}

function isAdCandidate(candidate) {
  const host = hostFromUrl(candidate?.mediaUrl || "");
  const refererHost = hostFromUrl(candidate?.headers?.referer || "");
  const originHost = hostFromUrl(candidate?.headers?.origin || "");
  if (/(creative|mavrtracktor|xxxvjmp)/i.test(refererHost)) return true;
  if (/(creative|mavrtracktor|xxxvjmp)/i.test(originHost)) return true;
  return hostContainsAdKeyword(host) || pathLooksAdLike(candidate?.mediaUrl || "");
}

function rankCandidates(tabId, pageUrl) {
  return (mediaCandidatesByTab.get(tabId) || [])
    .filter((x) => Date.now() - x.capturedAt <= MEDIA_CACHE_TTL_MS)
    .map((x) => ({ ...x, finalScore: scoreForPage(x, pageUrl || "") }))
    .sort((a, b) => b.finalScore - a.finalScore || b.capturedAt - a.capturedAt);
}

function isGoodPrimaryCandidate(c) {
  if (!c) return false;
  if (isAdCandidate(c)) return false;
  if (c.kind === "hls" || c.kind === "dash") return true;
  return c.finalScore >= 130;
}

function pickHeader(requestHeaders, name) {
  const hit = (requestHeaders || []).find((h) => h.name?.toLowerCase() === name);
  return hit?.value;
}

function normalizeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cacheMediaFromRequest(details) {
  if (!details?.url || !isMediaLikeUrl(details.url)) return;
  if (typeof details.tabId !== "number" || details.tabId < 0) return;

  const headers = details.requestHeaders || [];
  const candidate = {
    mediaUrl: details.url,
    kind: detectKind(details.url),
    capturedAt: Date.now(),
    pageHost: normalizeHost(details.documentUrl || details.initiator || ""),
    score: mediaScore(details.url),
    headers: {
      referer: pickHeader(headers, "referer"),
      origin: pickHeader(headers, "origin"),
      userAgent: pickHeader(headers, "user-agent"),
      cookie: pickHeader(headers, "cookie"),
    },
  };

  const list = mediaCandidatesByTab.get(details.tabId) || [];
  const merged = [candidate, ...list].filter((x, idx, arr) => arr.findIndex((y) => y.mediaUrl === x.mediaUrl) === idx);
  const fresh = merged
    .filter((x) => Date.now() - x.capturedAt <= MEDIA_CACHE_TTL_MS)
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, MAX_CANDIDATES_PER_TAB);
  mediaCandidatesByTab.set(details.tabId, fresh);

  const nonAd = fresh.find((x) => !isAdCandidate(x));
  latestMediaByTab.set(details.tabId, nonAd || fresh[0]);
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  cacheMediaFromRequest,
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"],
);

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Listen for messages from side panel or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_API_BASE") {
    chrome.storage.sync.get(["apiBase"], (result) => {
      sendResponse({ apiBase: result.apiBase || DEFAULT_API_BASE });
    });
    return true; // async response
  }

  if (message.type === "SET_API_BASE") {
    chrome.storage.sync.set({ apiBase: message.apiBase }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "GET_PAGE_URL") {
    // Get the URL of the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ url: tabs[0]?.url ?? "" });
    });
    return true;
  }

  if (message.type === "GET_BROWSER_SETTINGS_FROM_ACTIVE_TAB") {
    const requestSettingsFromTab = (tabId, done) => {
      chrome.tabs.sendMessage(tabId, { type: "EXPORT_SUBPLAYER_SETTINGS" }, (res) => {
        if (chrome.runtime?.lastError) {
          done({ ok: false, error: chrome.runtime.lastError.message || "sendMessage failed" });
          return;
        }
        if (!res?.ok) {
          done({ ok: false, error: res?.error || "No settings found in current tab" });
          return;
        }
        done({ ok: true, settings: res.settings || {} });
      });
    };

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }

      requestSettingsFromTab(tabId, (firstTry) => {
        if (firstTry.ok) {
          sendResponse({
            ok: true,
            settings: firstTry.settings || {},
            source: "active-tab",
          });
          return;
        }

        // After extension reload, existing tabs may not have content script yet.
        // Inject once and retry.
        chrome.scripting.executeScript(
          { target: { tabId }, files: ["content/content.js"] },
          () => {
            if (chrome.runtime?.lastError) {
              sendResponse({
                ok: false,
                error: `sync runtime error: ${firstTry.error}`,
              });
              return;
            }

            requestSettingsFromTab(tabId, (secondTry) => {
              if (!secondTry.ok) {
                sendResponse({
                  ok: false,
                  error: `sync runtime error: ${secondTry.error}`,
                });
                return;
              }
              sendResponse({
                ok: true,
                settings: secondTry.settings || {},
                source: "active-tab",
              });
            });
          },
        );
      });
    });
    return true;
  }

  // Capture one real media request from the active tab to reuse its
  // authenticated URL + headers in gateway prepare-direct.
  if (message.type === "CAPTURE_MEDIA_ONCE") {
    const timeoutMs = Number(message.timeoutMs || 15000);
    const pageHost = normalizeHost(message.pageUrl || "");

    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      // Prefer explicit tabId, then exact URL match, then same host, then active tab.
      let targetTab =
        (typeof message.tabId === "number" && tabs.find((t) => t.id === message.tabId)) ||
        (message.pageUrl && tabs.find((t) => t.url === message.pageUrl)) ||
        (pageHost && tabs.find((t) => normalizeHost(t.url || "") === pageHost)) ||
        tabs.find((t) => t.active);

      if (!targetTab?.id) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }

      const tabId = targetTab.id;
      let done = false;
      let timer = null;

      const cached = latestMediaByTab.get(tabId);
      if (cached && Date.now() - cached.capturedAt <= MEDIA_CACHE_TTL_MS) {
        const candidates = rankCandidates(tabId, message.pageUrl || "");
        const primary = candidates.find((c) => !isAdCandidate(c));
        const picked = primary || candidates[0] || cached;
        if (!primary && picked && isAdCandidate(picked)) {
          sendResponse({
            ok: false,
            error: "only-ad-stream-detected",
            candidates: candidates.slice(0, 5).map((c) => ({
              mediaUrl: c.mediaUrl,
              kind: c.kind,
              score: c.finalScore,
              host: hostFromUrl(c.mediaUrl),
              isAd: isAdCandidate(c),
              headers: c.headers,
            })),
            source: "cache",
          });
          return;
        }
        sendResponse({
          ok: true,
          mediaUrl: picked.mediaUrl,
          kind: picked.kind,
          headers: picked.headers,
          candidates: candidates.slice(0, 5).map((c) => ({
            mediaUrl: c.mediaUrl,
            kind: c.kind,
            score: c.finalScore,
            host: hostFromUrl(c.mediaUrl),
            isAd: isAdCandidate(c),
            headers: c.headers,
          })),
          source: "cache",
        });
        return;
      }

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        try {
          chrome.webRequest.onBeforeSendHeaders.removeListener(listener);
        } catch {}
      };

      const finish = (payload) => {
        if (done) return;
        done = true;
        cleanup();
        sendResponse(payload);
      };

      const listener = (details) => {
        if (done) return;
        if (details.tabId !== tabId) return;
        if (!details.url || !isMediaLikeUrl(details.url)) return;

        // Accumulate candidates; do not finish immediately on first match,
        // otherwise we often capture an ad stream before the main playlist.
        cacheMediaFromRequest(details);
        const ranked = rankCandidates(tabId, message.pageUrl || "");
        const best = ranked[0] || latestMediaByTab.get(tabId);
        if (!best) return;

        // Early-finish only when a high-confidence primary stream is found.
        if (isGoodPrimaryCandidate(best)) {
          finish({
            ok: true,
            mediaUrl: best.mediaUrl,
            kind: best.kind,
            headers: best.headers,
          candidates: ranked.slice(0, 5).map((c) => ({
            mediaUrl: c.mediaUrl,
            kind: c.kind,
            score: c.finalScore,
            host: hostFromUrl(c.mediaUrl),
            isAd: isAdCandidate(c),
            headers: c.headers,
          })),
          source: "live",
        });
        }
      };

      chrome.webRequest.onBeforeSendHeaders.addListener(
        listener,
        { urls: ["<all_urls>"], tabId },
        ["requestHeaders", "extraHeaders"],
      );

      timer = setTimeout(() => {
        const ranked = rankCandidates(tabId, message.pageUrl || "");
        const best = ranked.find((c) => !isAdCandidate(c));
        if (best) {
          finish({
            ok: true,
            mediaUrl: best.mediaUrl,
            kind: best.kind,
            headers: best.headers,
            candidates: ranked.slice(0, 5).map((c) => ({
              mediaUrl: c.mediaUrl,
              kind: c.kind,
              score: c.finalScore,
              host: hostFromUrl(c.mediaUrl),
              isAd: isAdCandidate(c),
              headers: c.headers,
            })),
            source: "timeout-best",
          });
          return;
        }
        finish({
          ok: false,
          error: ranked.length > 0 ? "only-ad-stream-detected" : "Capture timeout: no media request observed",
          candidates: ranked.slice(0, 5).map((c) => ({
            mediaUrl: c.mediaUrl,
            kind: c.kind,
            score: c.finalScore,
            host: hostFromUrl(c.mediaUrl),
            isAd: isAdCandidate(c),
            headers: c.headers,
          })),
        });
      }, timeoutMs);
    });
    return true;
  }

  // Relay subtitle data to content script
  if (message.type === "SHOW_SUBTITLES") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message);
      }
    });
  }

  if (message.type === "HIDE_SUBTITLES") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message);
      }
    });
  }
});
