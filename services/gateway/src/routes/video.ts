import { Hono } from "hono";
import { config } from "../config.js";
import { spawn } from "child_process";
import { mkdtemp, readdir, stat, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";
import { firstPlayableUrl } from "../lib/playable-url.js";

export const videoRoutes = new Hono();

interface CachedVideo {
  filePath: string;
  mimeType: string;
  size: number;
  createdAt: number;
  workDir: string;
}

interface ProxySession {
  token: string;
  originUrl: string;
  resolvedUrl: string;
  site: "youtube" | "bilibili" | "pornhub" | "generic";
  sourceType: "resolved" | "direct-captured";
  upstreamHeaders?: {
    referer?: string;
    origin?: string;
    userAgent?: string;
    cookie?: string;
  };
  createdAt: number;
  expiresAt: number;
  refreshRetries: number;
  refreshing: Promise<void> | null;
}

type VideoErrorCode =
  | "MISSING_URL"
  | "DIRECT_CAPTURE_DISABLED"
  | "DIRECT_CAPTURE_INVALID_URL"
  | "DIRECT_CAPTURE_DOMAIN_NOT_ALLOWED"
  | "DIRECT_CAPTURE_HEADERS_INVALID"
  | "RESOLVE_URL_FAILED"
  | "DOWNLOAD_FALLBACK_FAILED"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_FOUND";

const videoCache = new Map<string, CachedVideo>();
const proxySessions = new Map<string, ProxySession>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const REFRESH_RETRY_LIMIT = 1;
const DIRECT_CAPTURE_ENABLED = (process.env.DIRECT_CAPTURE_ENABLED ?? "true").toLowerCase() === "true";
const DIRECT_CAPTURE_ALLOWED_DOMAINS = (process.env.DIRECT_CAPTURE_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function videoLog(event: string, fields: Record<string, unknown>) {
  try {
    console.log(`[Video] ${event} ${JSON.stringify(fields)}`);
  } catch {
    console.log(`[Video] ${event}`);
  }
}

function cacheKey(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex").slice(0, 16);
}

export function getCachedVideoByOriginUrl(originUrl: string): CachedVideo | null {
  const key = cacheKey(originUrl);
  const cached = videoCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    return null;
  }
  if (!existsSync(cached.filePath)) return null;
  return cached;
}

function createProxyToken(url: string): string {
  return `p_${cacheKey(`${url}:${Date.now()}:${Math.random()}`)}`;
}

setInterval(() => {
  const now = Date.now();

  for (const [key, entry] of videoCache) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      rm(entry.workDir, { recursive: true, force: true }).catch(() => { });
      videoCache.delete(key);
    }
  }

  for (const [token, session] of proxySessions) {
    if (session.expiresAt <= now && !session.refreshing) {
      proxySessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => (stdout += d));
    p.stderr.on("data", (d: Buffer) => (stderr += d));
    p.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} failed (${code}): ${stderr.slice(0, 2000)}`)),
    );
  });
}

function runWithTimeout(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    run(cmd, args)
      .then((out) => {
        clearTimeout(timer);
        resolve(out);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function detectSite(url: string): ProxySession["site"] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube";
    if (hostname.includes("bilibili.com") || hostname.includes("b23.tv")) return "bilibili";
    if (hostname.includes("pornhub.com")) return "pornhub";
    return "generic";
  } catch {
    return "generic";
  }
}

function normalizeHost(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedDomain(hostname: string): boolean {
  if (!hostname) return false;
  if (DIRECT_CAPTURE_ALLOWED_DOMAINS.length === 0) return true;
  return DIRECT_CAPTURE_ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

function siteReferer(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("pornhub.com")) return `${u.protocol}//${u.host}/`;
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "https://www.bilibili.com/";
    return null;
  } catch {
    return null;
  }
}

function ytdlpBaseArgs(url?: string): string[] {
  const args = [
    "--force-ipv4",
    "--retries", "3",
    "--no-warnings",
    "--no-playlist",
    "--concurrent-fragments", "4",
    "--extractor-args", "generic:impersonate",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ];
  if (config.ytCookiesBrowser) {
    args.push("--cookies-from-browser", config.ytCookiesBrowser);
  }
  const referer = url ? siteReferer(url) : null;
  if (referer) {
    args.push("--referer", referer);
  }
  return args;
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".m4a": "audio/mp4",
    ".ogg": "video/ogg",
  };
  return map[ext.toLowerCase()] ?? "video/mp4";
}

async function probeStreamHasAudio(resolvedUrl: string, originUrl: string): Promise<boolean | null> {
  const referer = siteReferer(originUrl);
  const headers = [
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...(referer ? [`Referer: ${referer}`] : []),
  ].join("\r\n") + "\r\n";

  try {
    const out = await runWithTimeout("ffprobe", [
      "-v", "error",
      "-headers", headers,
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      resolvedUrl,
    ], 8000);
    return /\baudio\b/i.test(out);
  } catch (err: any) {
    videoLog("audio_probe_failed", {
      originUrl: originUrl.slice(0, 120),
      resolvedUrl: resolvedUrl.slice(0, 160),
      error: err?.message?.slice(0, 220) ?? "unknown",
    });
    return null;
  }
}

async function resolvePlayableUrl(url: string): Promise<string> {
  const attempts: string[][] = [
    ["-f", "best[protocol*=m3u8][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]", "-g"],
    ["-f", "best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]", "-g"],
    ["-f", "best[ext=mp4]/best", "-g"],
    ["-f", "best", "-g"],
    ["-g"],
  ];

  for (const fmt of attempts) {
    try {
      const out = await run("yt-dlp", [...fmt, ...ytdlpBaseArgs(url), url]);
      const streamUrl = firstPlayableUrl(out);
      if (streamUrl) return streamUrl;
    } catch (err: any) {
      videoLog("resolve_attempt_failed", {
        url: url.slice(0, 120),
        error: err.message?.slice(0, 220) ?? "unknown error",
      });
    }
  }

  throw new Error("Unable to resolve playable URL");
}

async function firstExistingNonEmptyVideoFile(workDir: string): Promise<string | null> {
  const files = await readdir(workDir);
  const videoFile = files.find((f) => f.startsWith("video."));
  if (!videoFile) return null;
  const filePath = join(workDir, videoFile);
  const info = await stat(filePath);
  if (info.size <= 0) return null;
  return filePath;
}

async function tryDownloadVideo(
  url: string,
  workDir: string,
  formatArgs: string[],
): Promise<string | null> {
  const outTemplate = join(workDir, "video.%(ext)s");
  try {
    await run("yt-dlp", [
      ...formatArgs,
      ...ytdlpBaseArgs(url),
      "-o", outTemplate,
      url,
    ]);
  } catch (err: any) {
    videoLog("download_attempt_failed", {
      url: url.slice(0, 120),
      error: err.message?.slice(0, 220) ?? "unknown error",
    });
  }

  return firstExistingNonEmptyVideoFile(workDir);
}

async function downloadAndCacheVideo(url: string, key: string): Promise<{ size: number; mimeType: string }> {
  const workDir = await mkdtemp(join(tmpdir(), "subplayer-video-"));

  try {
    let filePath = await tryDownloadVideo(url, workDir, [
      "-f", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
    ]);

    if (!filePath) {
      filePath = await tryDownloadVideo(url, workDir, ["-f", "best[ext=mp4]/best"]);
    }
    if (!filePath) {
      filePath = await tryDownloadVideo(url, workDir, ["-f", "best"]);
    }
    if (!filePath) {
      throw new Error("yt-dlp did not produce a non-empty video file");
    }

    const videoFile = basename(filePath);
    const fileInfo = await stat(filePath);
    if (fileInfo.size <= 0) {
      throw new Error("Downloaded file is empty");
    }

    const ext = videoFile.slice(videoFile.lastIndexOf("."));
    const mimeType = getMimeType(ext);

    videoCache.set(key, {
      filePath,
      mimeType,
      size: fileInfo.size,
      createdAt: Date.now(),
      workDir,
    });

    return { size: fileInfo.size, mimeType };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => { });
    throw err;
  }
}

function pickForwardHeaders(c: any, session: ProxySession, targetUrl: string): Headers {
  const headers = new Headers();
  const range = c.req.header("range");
  const ifRange = c.req.header("if-range");
  const reqUA = c.req.header("user-agent");
  const isManifestTarget = targetUrl.toLowerCase().includes(".m3u8");

  // Never ask upstream for partial m3u8 content. Incomplete manifests can make
  // the browser stop requesting segments.
  if (!isManifestTarget) {
    if (range) headers.set("Range", range);
    if (ifRange) headers.set("If-Range", ifRange);
  }

  headers.set("User-Agent",
    session.upstreamHeaders?.userAgent ??
    reqUA ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  const referer = session.upstreamHeaders?.referer ?? siteReferer(session.originUrl);
  if (referer) headers.set("Referer", referer);
  if (session.upstreamHeaders?.origin) headers.set("Origin", session.upstreamHeaders.origin);
  if (session.upstreamHeaders?.cookie) headers.set("Cookie", session.upstreamHeaders.cookie);

  return headers;
}

function copyUpstreamHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const hopByHop = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);

  upstream.headers.forEach((value, key) => {
    if (!hopByHop.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  return headers;
}

function rewriteProxyUri(token: string, uri: string, baseUrl: string): string {
  if (!uri || uri.startsWith("data:")) return uri;
  try {
    const abs = new URL(uri, baseUrl).toString();
    return `/api/video/stream/${token}?u=${encodeURIComponent(abs)}`;
  } catch {
    return uri;
  }
}

function rewriteM3u8Manifest(manifest: string, baseUrl: string, token: string): string {
  const lines = manifest.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }

    // Rewrite URI="..." attributes (e.g. #EXT-X-KEY)
    if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
      const rewritten = line.replace(/URI="([^"]+)"/g, (_, uri: string) => {
        const nextUri = rewriteProxyUri(token, uri, baseUrl);
        return `URI="${nextUri}"`;
      });
      out.push(rewritten);
      continue;
    }

    // Rewrite media playlist/segment URIs (non-comment lines).
    if (!trimmed.startsWith("#")) {
      out.push(rewriteProxyUri(token, trimmed, baseUrl));
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

function isM3u8Like(upstream: Response, requestUrl: string): boolean {
  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/vnd.apple.mpegurl")) return true;
  if (contentType.includes("application/x-mpegurl")) return true;
  if (upstream.url.toLowerCase().includes(".m3u8")) return true;
  if (requestUrl.toLowerCase().includes(".m3u8")) return true;
  return false;
}

async function fetchUpstream(c: any, session: ProxySession, targetUrl?: string): Promise<Response> {
  const method = c.req.method === "HEAD" ? "HEAD" : "GET";
  const finalUrl = targetUrl ?? session.resolvedUrl;
  const headers = pickForwardHeaders(c, session, finalUrl);
  return fetch(finalUrl, {
    method,
    headers,
    redirect: "follow",
  });
}

async function refreshSessionUrl(session: ProxySession): Promise<void> {
  if (session.refreshRetries >= REFRESH_RETRY_LIMIT) {
    throw new Error("refresh retry limit reached");
  }

  if (session.refreshing) {
    await session.refreshing;
    return;
  }

  session.refreshing = (async () => {
    session.refreshRetries += 1;
    const resolvedUrl = await resolvePlayableUrl(session.originUrl);
    session.resolvedUrl = resolvedUrl;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    videoLog("refresh_success", {
      token: session.token,
      site: session.site,
      retries: session.refreshRetries,
    });
  })().finally(() => {
    session.refreshing = null;
  });

  await session.refreshing;
}

videoRoutes.post("/prepare", async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  if (!url) return c.json({ ok: false, code: "MISSING_URL" as VideoErrorCode, error: "Missing url" }, 400);

  const site = detectSite(url);

  try {
    const resolvedUrl = await resolvePlayableUrl(url);
    const hasAudio = await probeStreamHasAudio(resolvedUrl, url);
    if (hasAudio === false) {
      throw new Error("Resolved stream has no audio track");
    }
    const token = createProxyToken(url);
    const expiresAt = Date.now() + SESSION_TTL_MS;

    proxySessions.set(token, {
      token,
      originUrl: url,
      resolvedUrl,
      site,
      sourceType: "resolved",
      createdAt: Date.now(),
      expiresAt,
      refreshRetries: 0,
      refreshing: null,
    });
    videoLog("prepare_proxy_ok", {
      token,
      site,
      originUrl: url.slice(0, 120),
    });

    return c.json({
      ok: true,
      token,
      streamUrl: `/api/video/stream/${token}`,
      playMode: "proxy-stream",
      supportsRange: true,
      expiresAt,
    });
  } catch (proxyErr: any) {
    videoLog("prepare_proxy_failed", {
      site,
      originUrl: url.slice(0, 120),
      error: proxyErr.message,
    });

    const key = cacheKey(url);
    const cached = videoCache.get(key);
    if (cached && existsSync(cached.filePath)) {
      videoLog("prepare_fallback_cache_hit", {
        key,
        site,
      });
      return c.json({
        ok: true,
        streamUrl: `/api/video/stream/${key}`,
        size: cached.size,
        mimeType: cached.mimeType,
        playMode: "download-fallback",
        supportsRange: true,
      });
    }

    try {
      const { size, mimeType } = await downloadAndCacheVideo(url, key);
      videoLog("prepare_fallback_download_ok", {
        key,
        site,
        size,
      });
      return c.json({
        ok: true,
        streamUrl: `/api/video/stream/${key}`,
        size,
        mimeType,
        playMode: "download-fallback",
        supportsRange: true,
      });
    } catch (downloadErr: any) {
      videoLog("prepare_fallback_download_failed", {
        key,
        site,
        error: downloadErr.message,
      });
      return c.json({
        ok: false,
        code: "DOWNLOAD_FALLBACK_FAILED" as VideoErrorCode,
        error: downloadErr.message ?? "Video prepare failed",
      }, 500);
    }
  }
});

videoRoutes.post("/prepare-direct", async (c) => {
  if (!DIRECT_CAPTURE_ENABLED) {
    return c.json({
      ok: false,
      code: "DIRECT_CAPTURE_DISABLED" as VideoErrorCode,
      error: "Direct capture is disabled",
    }, 403);
  }

  const body = await c.req.json<{
    originUrl?: string;
    mediaUrl?: string;
    headers?: {
      referer?: string;
      origin?: string;
      userAgent?: string;
      cookie?: string;
    };
    kind?: string;
  }>();

  const originUrl = String(body.originUrl ?? "");
  const mediaUrl = String(body.mediaUrl ?? "");
  if (!originUrl || !mediaUrl) {
    return c.json({
      ok: false,
      code: "DIRECT_CAPTURE_INVALID_URL" as VideoErrorCode,
      error: "Missing originUrl or mediaUrl",
    }, 400);
  }

  let parsedMedia: URL;
  let parsedOrigin: URL;
  try {
    parsedMedia = new URL(mediaUrl);
    parsedOrigin = new URL(originUrl);
  } catch {
    return c.json({
      ok: false,
      code: "DIRECT_CAPTURE_INVALID_URL" as VideoErrorCode,
      error: "Invalid URL",
    }, 400);
  }

  if (parsedMedia.protocol !== "https:" || parsedOrigin.protocol !== "https:") {
    return c.json({
      ok: false,
      code: "DIRECT_CAPTURE_INVALID_URL" as VideoErrorCode,
      error: "Only https URLs are allowed",
    }, 400);
  }

  const mediaHost = parsedMedia.hostname.toLowerCase();
  if (!isAllowedDomain(mediaHost)) {
    return c.json({
      ok: false,
      code: "DIRECT_CAPTURE_DOMAIN_NOT_ALLOWED" as VideoErrorCode,
      error: "Media host is not allowed",
    }, 403);
  }

  const h = body.headers ?? {};
  const headerValues = {
    referer: h.referer ? String(h.referer) : undefined,
    origin: h.origin ? String(h.origin) : undefined,
    userAgent: h.userAgent ? String(h.userAgent) : undefined,
    cookie: h.cookie ? String(h.cookie) : undefined,
  };
  if ((headerValues.cookie?.length ?? 0) > 8 * 1024) {
    return c.json({
      ok: false,
      code: "DIRECT_CAPTURE_HEADERS_INVALID" as VideoErrorCode,
      error: "Cookie header too large",
    }, 400);
  }

  const token = createProxyToken(originUrl);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const site = detectSite(originUrl);

  proxySessions.set(token, {
    token,
    originUrl,
    resolvedUrl: mediaUrl,
    site,
    sourceType: "direct-captured",
    upstreamHeaders: headerValues,
    createdAt: Date.now(),
    expiresAt,
    refreshRetries: 0,
    refreshing: null,
  });

  videoLog("prepare_direct_ok", {
    token,
    site,
    originHost: normalizeHost(originUrl),
    mediaHost,
    kind: body.kind ?? "unknown",
  });

  return c.json({
    ok: true,
    token,
    streamUrl: `/api/video/stream/${token}`,
    playMode: "proxy-stream",
    supportsRange: true,
    expiresAt,
  });
});

async function handleProxyStream(c: any, session: ProxySession): Promise<Response> {
  if (session.expiresAt <= Date.now()) {
    proxySessions.delete(session.token);
    return c.json({
      ok: false,
      code: "SESSION_EXPIRED" as VideoErrorCode,
      error: "Session expired",
    }, 410);
  }

  const range = c.req.header("range") ?? "";
  const overrideUrl = c.req.query("u") ?? "";
  const targetUrl = overrideUrl || session.resolvedUrl;
  let upstream = await fetchUpstream(c, session, targetUrl);

  if ((upstream.status === 403 || upstream.status === 410) && !overrideUrl && session.refreshRetries < REFRESH_RETRY_LIMIT) {
    videoLog("stream_upstream_expired", {
      token: session.token,
      site: session.site,
      status: upstream.status,
      hasRange: Boolean(range),
    });
    try {
      await refreshSessionUrl(session);
      upstream = await fetchUpstream(c, session, session.resolvedUrl);
    } catch (err: any) {
      videoLog("refresh_failed", {
        token: session.token,
        site: session.site,
        error: err.message,
      });
    }
  }

  const headers = copyUpstreamHeaders(upstream);

  // Segment/key URL may expire even within a live playback session.
  // If a proxied sub-resource fails with 403/410, force player back to
  // the master playlist endpoint so it can reload fresh URLs.
  if ((upstream.status === 403 || upstream.status === 410) && !!overrideUrl) {
    headers.set("Location", `/api/video/stream/${session.token}`);
    videoLog("stream_subresource_expired_redirect", {
      token: session.token,
      site: session.site,
      status: upstream.status,
    });
    return new Response(null, { status: 307, headers });
  }

  if (upstream.status === 403 || upstream.status === 410) {
    headers.set("X-SubPlayer-Error-Code", "UPSTREAM_URL_EXPIRED");
  }

  // HLS manifests often contain relative segment URIs. Rewrite them back to
  // our proxy endpoint, otherwise browser requests /api/video/stream/<segment>
  // and bypasses token session, causing 404.
  if (c.req.method !== "HEAD" && upstream.ok && isM3u8Like(upstream, targetUrl)) {
    const original = await upstream.text();
    const rewritten = rewriteM3u8Manifest(original, upstream.url || targetUrl, session.token);
    // We rewrote body content, so response encoding/range metadata from
    // upstream is no longer valid and can break player parsing.
    headers.delete("content-encoding");
    headers.delete("content-range");
    headers.delete("accept-ranges");
    headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    headers.set("cache-control", "no-store");
    headers.set("content-length", String(Buffer.byteLength(rewritten)));
    videoLog("stream_manifest_status_normalized", {
      token: session.token,
      site: session.site,
      upstreamStatus: upstream.status,
    });
    videoLog("stream_manifest_rewritten", {
      token: session.token,
      site: session.site,
    });
    return new Response(rewritten, {
      status: 200,
      headers,
    });
  }

  videoLog("stream_proxy_response", {
    token: session.token,
    site: session.site,
    status: upstream.status,
    hasRange: Boolean(range),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleCachedFileStream(c: any, token: string): Promise<Response> {
  const cached = videoCache.get(token);
  if (!cached || !existsSync(cached.filePath)) {
    return c.json({
      ok: false,
      code: "SESSION_NOT_FOUND" as VideoErrorCode,
      error: "Video not found or expired",
    }, 404);
  }

  const { filePath, mimeType, size } = cached;
  const rangeHeader = c.req.header("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      const chunkSize = end - start + 1;

      const stream = createReadStream(filePath, { start, end });
      const readable = Readable.toWeb(stream) as unknown as ReadableStream;

      return new Response(readable, {
        status: 206,
        headers: {
          "Content-Type": mimeType,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(chunkSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=1800",
        },
      });
    }
  }

  const stream = createReadStream(filePath);
  const readable = Readable.toWeb(stream) as unknown as ReadableStream;

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=1800",
    },
  });
}

videoRoutes.on("GET", "/stream/:token", async (c) => {
  const token = c.req.param("token");
  const session = proxySessions.get(token);
  if (session) {
    return handleProxyStream(c, session);
  }
  return handleCachedFileStream(c, token);
});

videoRoutes.on("HEAD", "/stream/:token", async (c) => {
  const token = c.req.param("token");
  const session = proxySessions.get(token);
  if (session) {
    return handleProxyStream(c, session);
  }
  return handleCachedFileStream(c, token);
});
