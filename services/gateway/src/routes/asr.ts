import { Hono } from "hono";
import { config } from "../config.js";
import {
  getProvider,
  getProviderByName,
  transcribeWithFallback,
  listProviders,
  type Segment,
} from "../providers/index.js";
import { spawn } from "child_process";
import { mkdtemp, unlink, readdir, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";

export const asrRoutes = new Hono();
const ASR_PIPE_MAX_WAV_BYTES = Number(process.env.ASR_PIPE_MAX_WAV_MB ?? "200") * 1024 * 1024;

class AsrPipeMemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsrPipeMemoryLimitError";
  }
}

// ── helpers ─────────────────────────────────────────────────────────

type AsrCapability = {
  localReady: boolean;
  localReason: string;
  localModelsLoaded: boolean;
  localHealthStatus: string;
  ffmpegReady: boolean;
  ffprobeReady: boolean;
  ytDlpReady: boolean;
  cloudAvailable: {
    volcengine: boolean;
    aliyun: boolean;
  };
  recommendedProvider: "local" | "volcengine" | "aliyun" | "none";
  canTranscribe: boolean;
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} failed (${code}): ${stderr.slice(0, 2000)}`))
    );
  });
}

function runWithTimeout(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { p.kill("SIGKILL"); } catch {}
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} failed (${code}): ${stderr.slice(0, 400)}`));
    });
    p.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function checkCommandReady(cmd: string, args: string[] = ["--version"]): Promise<boolean> {
  try {
    await runWithTimeout(cmd, args, 2500);
    return true;
  } catch {
    return false;
  }
}

function hasVolcengineKeys(apiKeys: any): boolean {
  return Boolean(
    apiKeys?.volcengineAppId && apiKeys?.volcengineToken
  ) || Boolean(config.volcengineAppId && config.volcengineAccessToken);
}

function hasAliyunKeys(apiKeys: any): boolean {
  return Boolean(apiKeys?.aliyunKey) || Boolean(config.aliyunDashscopeKey);
}

async function getLocalProviderStatus(): Promise<{
  ready: boolean;
  reason: string;
  modelsLoaded: boolean;
  healthStatus: string;
}> {
  const local = getProviderByName("local");
  if (!local) {
    return {
      ready: false,
      reason: "local provider not registered",
      modelsLoaded: false,
      healthStatus: "missing",
    };
  }

  try {
    const healthRes = await fetch(`${config.asrHost}:${config.asrPort}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthRes.ok) {
      return {
        ready: false,
        reason: `local asr service unhealthy (${healthRes.status})`,
        modelsLoaded: false,
        healthStatus: `http-${healthRes.status}`,
      };
    }
    const healthJson = await healthRes.json() as any;
    const modelsLoaded = Boolean(healthJson?.models_loaded);
    if (!modelsLoaded) {
      return {
        ready: false,
        reason: "models not loaded",
        modelsLoaded: false,
        healthStatus: String(healthJson?.status ?? "ok"),
      };
    }
    const available = await local.isAvailable();
    if (!available) {
      return {
        ready: false,
        reason: "local service unavailable",
        modelsLoaded,
        healthStatus: String(healthJson?.status ?? "ok"),
      };
    }
    return {
      ready: true,
      reason: "ok",
      modelsLoaded,
      healthStatus: String(healthJson?.status ?? "ok"),
    };
  } catch (err: any) {
    return {
      ready: false,
      reason: err?.message?.includes("ECONNREFUSED")
        ? "local asr service not running"
        : "local asr health check failed",
      modelsLoaded: false,
      healthStatus: "unreachable",
    };
  }
}

async function getAsrCapability(apiKeys: any = {}): Promise<AsrCapability> {
  const [ffmpegReady, ffprobeReady, ytDlpReady, local] = await Promise.all([
    checkCommandReady("ffmpeg", ["-version"]),
    checkCommandReady("ffprobe", ["-version"]),
    checkCommandReady("yt-dlp", ["--version"]),
    getLocalProviderStatus(),
  ]);

  const cloudAvailable = {
    volcengine: hasVolcengineKeys(apiKeys),
    aliyun: hasAliyunKeys(apiKeys),
  };

  const recommendedProvider: AsrCapability["recommendedProvider"] =
    local.ready ? "local"
    : cloudAvailable.volcengine ? "volcengine"
    : cloudAvailable.aliyun ? "aliyun"
    : "none";

  return {
    localReady: local.ready,
    localReason: local.reason,
    localModelsLoaded: local.modelsLoaded,
    localHealthStatus: local.healthStatus,
    ffmpegReady,
    ffprobeReady,
    ytDlpReady,
    cloudAvailable,
    recommendedProvider,
    canTranscribe: ffmpegReady && ffprobeReady && ytDlpReady && (local.ready || cloudAvailable.volcengine || cloudAvailable.aliyun),
  };
}

async function resolveProviderOrder(
  requestedProvider: string,
  apiKeys: any,
): Promise<string[]> {
  const requested = String(requestedProvider || "").trim().toLowerCase();
  if (requested && requested !== "auto") {
    return [requested];
  }

  const capability = await getAsrCapability(apiKeys);
  const order: string[] = [];
  if (capability.localReady) order.push("local");
  if (capability.cloudAvailable.volcengine) order.push("volcengine");
  if (capability.cloudAvailable.aliyun) order.push("aliyun");

  for (const p of config.asrFallbackChain) {
    const name = String(p).trim();
    if (!name || order.includes(name)) continue;
    if (name === "local" && !capability.localReady) continue;
    if (name === "volcengine" && !capability.cloudAvailable.volcengine) continue;
    if (name === "aliyun" && !capability.cloudAvailable.aliyun) continue;
    order.push(name);
  }

  // Last resort, keep a deterministic order to get a concrete error.
  if (order.length === 0) {
    order.push("local", "volcengine", "aliyun");
  }
  return order;
}

async function extractAudio(inputPath: string, outPath: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    outPath,
  ]);
}

async function getAudioDuration(filePath: string): Promise<number> {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return parseFloat(out.trim());
}

async function splitAudio(
  audioPath: string,
  chunkSec: number,
  outDir: string
): Promise<string[]> {
  const duration = await getAudioDuration(audioPath);
  if (duration <= chunkSec) return [audioPath];

  const chunks: string[] = [];
  for (let start = 0; start < duration; start += chunkSec) {
    const chunkPath = join(outDir, `chunk_${start}.wav`);
    await run("ffmpeg", [
      "-y",
      "-i", audioPath,
      "-ss", String(start),
      "-t", String(chunkSec),
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      chunkPath,
    ]);
    chunks.push(chunkPath);
  }
  return chunks;
}

async function cleanupDir(dir: string) {
  try {
    const files = await readdir(dir);
    for (const f of files) await unlink(join(dir, f)).catch(() => { });
    await rm(dir, { recursive: true, force: true }).catch(() => { });
  } catch { }
}

async function firstExistingNonEmptyFile(
  dir: string,
  prefixes: string[],
): Promise<string | null> {
  const files = await readdir(dir);
  for (const f of files) {
    if (!prefixes.some((p) => f.startsWith(p))) continue;
    try {
      const filePath = join(dir, f);
      const info = await stat(filePath);
      if (info.size > 0) return filePath;
    } catch {
      // Ignore transient fs errors and continue scan.
    }
  }
  return null;
}

async function tryYtDlpDownload(
  url: string,
  args: string[],
  workDir: string,
  outputPrefix: string,
): Promise<string | null> {
  try {
    await run("yt-dlp", [...args, ...ytdlpBaseArgs(url), "-o", join(workDir, `${outputPrefix}.%(ext)s`), url]);
  } catch (err: any) {
    console.log(`[ASR] yt-dlp attempt failed (${outputPrefix}): ${err.message?.slice(0, 220) ?? "unknown error"}`);
  }
  return firstExistingNonEmptyFile(workDir, [outputPrefix]);
}

/**
 * Some sites intermittently fail with `-x --audio-format wav` and produce
 * empty files. Use staged fallbacks to keep YouTube/Bilibili behavior intact
 * while improving extractor compatibility.
 */
async function downloadAudioSource(url: string, workDir: string): Promise<string> {
  // Attempt 1 (unchanged primary path): direct audio extraction.
  const extracted = await tryYtDlpDownload(url, [
    "-x",
    "--audio-format", "wav",
  ], workDir, "download");
  if (extracted) return extracted;

  // Attempt 2: download bestaudio container, convert later via ffmpeg.
  const bestAudio = await tryYtDlpDownload(url, [
    "-f", "bestaudio/best",
  ], workDir, "download-audio");
  if (bestAudio) return bestAudio;

  // Attempt 3: download muxed/best video as a final fallback, then extract audio.
  const bestVideo = await tryYtDlpDownload(url, [
    "-f", "bestvideo+bestaudio/best",
    "--merge-output-format", "mp4",
  ], workDir, "download-video");
  if (bestVideo) return bestVideo;

  throw new Error("yt-dlp failed to produce a non-empty media file");
}

function spawnPipeProcess(cmd: string, args: string[]) {
  return spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
}

async function audioFromUrlViaPipeToWavBuffer(url: string): Promise<Buffer> {
  const ytdlpAttempts: string[][] = [
    ["-f", "bestaudio/best", "-o", "-", ...ytdlpBaseArgs(url), url],
    ["-f", "best", "-o", "-", ...ytdlpBaseArgs(url), url],
  ];

  let lastError = "unknown error";

  for (const attemptArgs of ytdlpAttempts) {
    const ytdlp = spawnPipeProcess("yt-dlp", attemptArgs);
    const ffmpeg = spawnPipeProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-vn",
      "-f", "wav",
      "-ar", "16000",
      "-ac", "1",
      "pipe:1",
    ]);

    let ytdlpErr = "";
    let ffmpegErr = "";
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    ytdlp.stderr.on("data", (d: Buffer) => (ytdlpErr += d.toString()));
    ffmpeg.stderr.on("data", (d: Buffer) => (ffmpegErr += d.toString()));

    ytdlp.stdout.pipe(ffmpeg.stdin);

    const bufferPromise = new Promise<Buffer>((resolve, reject) => {
      ffmpeg.stdout.on("data", (d: Buffer) => {
        totalBytes += d.length;
        if (totalBytes > ASR_PIPE_MAX_WAV_BYTES) {
          ytdlp.kill("SIGKILL");
          ffmpeg.kill("SIGKILL");
          reject(new AsrPipeMemoryLimitError(
            `Pipe WAV exceeded memory limit (${Math.round(ASR_PIPE_MAX_WAV_BYTES / 1024 / 1024)}MB)`,
          ));
          return;
        }
        chunks.push(d);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0 && totalBytes > 0) {
          resolve(Buffer.concat(chunks, totalBytes));
          return;
        }
        reject(new Error(`ffmpeg pipe failed (${code}): ${ffmpegErr.slice(0, 500)}`));
      });

      ytdlp.on("close", (code) => {
        if (code !== 0) {
          lastError = `yt-dlp pipe failed (${code}): ${ytdlpErr.slice(0, 500)}`;
        }
      });
    });

    try {
      return await bufferPromise;
    } catch (err: any) {
      if (err instanceof AsrPipeMemoryLimitError) {
        throw err;
      }
      lastError = err.message ?? String(err);
      console.log(`[ASR] pipe attempt failed: ${lastError}`);
    }
  }

  throw new Error(lastError || "pipe audio extraction failed");
}

async function downloadOrPipeAudioSource(
  url: string,
  workDir: string,
  mode: "auto" | "pipe" | "download-fallback",
): Promise<string> {
  const pipeToFile = async (): Promise<string> => {
    const wavBuffer = await audioFromUrlViaPipeToWavBuffer(url);
    const wavPath = join(workDir, "audio_pipe.wav");
    await Bun.write(wavPath, wavBuffer);
    return wavPath;
  };

  if (mode === "download-fallback") {
    return downloadAudioSource(url, workDir);
  }

  if (mode === "pipe") {
    return pipeToFile();
  }

  try {
    return await pipeToFile();
  } catch (err: any) {
    if (err instanceof AsrPipeMemoryLimitError) {
      console.log(`[ASR] pipe mode exceeded memory threshold, fallback to download: ${err.message}`);
      return downloadAudioSource(url, workDir);
    }
    console.log(`[ASR] pipe mode failed, fallback to download: ${err.message}`);
    return downloadAudioSource(url, workDir);
  }
}

async function extractAudioFromDirectMediaUrl(
  mediaUrl: string,
  outPath: string,
  headers?: {
    referer?: string;
    origin?: string;
    userAgent?: string;
    cookie?: string;
  },
): Promise<void> {
  const args: string[] = ["-y"];

  if (headers?.userAgent) {
    args.push("-user_agent", headers.userAgent);
  }
  if (headers?.referer) {
    args.push("-referer", headers.referer);
  }

  const extra: string[] = [];
  if (headers?.origin) extra.push(`Origin: ${headers.origin}`);
  if (headers?.cookie) extra.push(`Cookie: ${headers.cookie}`);
  if (extra.length > 0) {
    args.push("-headers", `${extra.join("\r\n")}\r\n`);
  }

  args.push(
    "-i", mediaUrl,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    outPath,
  );

  await run("ffmpeg", args);
}

// ── Native subtitle extraction via yt-dlp ───────────────────────────

/**
 * Spawn yt-dlp and ignore exit code — we only care about whether subtitle
 * files were actually written to disk.
 */
function runIgnoreExit(
  cmd: string,
  args: string[],
  timeoutMs = 12000,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut?: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { p.kill("SIGKILL"); } catch {}
      resolve({ stdout, stderr: `${stderr}\n${cmd} subtitle probe timeout after ${timeoutMs}ms`, code: -1, timedOut: true });
    }, timeoutMs);

    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    p.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}

/**
 * Map user-facing language codes to yt-dlp --sub-langs patterns.
 * YouTube auto-captions use codes like zh-Hans, zh-Hant, not plain "zh".
 */
function buildSubLangs(language: string): string {
  if (language === "auto") return "en.*,zh.*,ja,ko";
  // Expand common short codes
  const map: Record<string, string> = {
    zh: "zh.*",
    "zh-cn": "zh-Hans",
    "zh-tw": "zh-Hant",
  };
  return map[language.toLowerCase()] ?? language;
}

/** Build common yt-dlp args (cookies, ipv4, retries, user-agent) */
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
  if (url) {
    try {
      const u = new URL(url);
      if (/pornhub\.com$/i.test(u.hostname)) {
        args.push("--referer", `${u.protocol}//${u.host}/`);
      }
    } catch {
      // Ignore malformed URLs, validation happens elsewhere.
    }
  }
  return args;
}

/**
 * Try to download existing subtitles from the URL (YouTube, Bilibili, etc.).
 * Returns segments if subtitles are found, null otherwise.
 *
 * NOTE: yt-dlp may exit non-zero even when some subtitle files were written
 *       (e.g. one language 429'd but another succeeded). We ignore the exit
 *       code and just check for *.json3 files on disk.
 */
async function tryExtractNativeSubtitles(
  url: string,
  language: string,
  workDir: string,
): Promise<{ segments: Segment[]; language: string } | null> {
  try {
    const subLangs = buildSubLangs(language);

    // Try to download subtitles only (no video)
    // Use json3 as preferred format; --convert-subs handles conversion for
    // sites like Bilibili that may use different native formats.
    const { stderr, code, timedOut } = await runIgnoreExit("yt-dlp", [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", subLangs,
      "--sub-format", "json3",
      ...ytdlpBaseArgs(url),
      "-o", join(workDir, "subs"),
      url,
    ], 12000);

    if (timedOut) {
      console.log("[ASR] Native subtitle probe timed out, fallback to ASR");
    } else if (code !== 0) {
      console.log(`[ASR] yt-dlp subtitle extraction exited with code ${code} (may be partial): ${stderr.slice(0, 200)}`);
    }

    // Look for downloaded subtitle files — may exist even if exit != 0
    // Support: .json3 (YouTube), .json (Bilibili BCC), .vtt, .srt
    const files = await readdir(workDir);
    const subExts = [".json3", ".json", ".vtt", ".srt"];
    const subFiles = files
      .filter((f) => subExts.some((ext) => f.endsWith(ext)) && f.startsWith("subs"))
      .sort();

    if (subFiles.length === 0) {
      console.log("[ASR] No subtitle files found on disk, will use ASR");
      return null;
    }

    // Prefer: en > zh-Hans > first available
    const preferred = ["en", "zh-Hans", "zh-Hant", "ja", "ko"];
    let bestFile = subFiles[0];
    for (const pref of preferred) {
      const match = subFiles.find((f) => f.includes(`.${pref}.`));
      if (match) { bestFile = match; break; }
    }

    console.log(`[ASR] Using subtitle file: ${bestFile} (${subFiles.length} total available)`);

    // Detect subtitle language from filename (e.g. subs.en.json3, subs.zh-Hans.json3)
    const detectedLang = bestFile.match(/\.([a-zA-Z]{2,3}(?:-[A-Za-z]+)?)\.\w+$/)?.[1] ?? language;

    // Parse subtitle file (supports json3 + Bilibili BCC JSON)
    const raw = await readFile(join(workDir, bestFile), "utf-8");
    const data = JSON.parse(raw) as any;

    let segments: Segment[] = [];

    if (data?.events) {
      // ── YouTube json3 format: events[] with tStartMs, dDurationMs, segs[] ──
      for (const ev of data.events) {
        if (!ev.segs || ev.tStartMs == null) continue;

        const text = ev.segs
          .map((s: any) => s.utf8 ?? "")
          .join("")
          .replace(/\n/g, " ")
          .trim();

        if (!text || text === "\n") continue;

        const start = ev.tStartMs / 1000;
        const end = (ev.tStartMs + (ev.dDurationMs ?? 3000)) / 1000;

        segments.push({ start, end, text });
      }
    } else if (data?.body) {
      // ── Bilibili BCC format: body[] with from, to, content ──
      for (const item of data.body) {
        const text = (item.content ?? "").trim();
        if (!text) continue;
        segments.push({
          start: item.from ?? 0,
          end: item.to ?? (item.from ?? 0) + 3,
          text,
        });
      }
    }

    // ── De-overlap: ensure segments don't overlap in time ──────────
    // YouTube auto-captions often have overlapping events which causes
    // subtitle sync flickering. We trim each segment's end to not exceed
    // the next segment's start.
    if (segments.length > 1) {
      segments.sort((a, b) => a.start - b.start);
      for (let i = 0; i < segments.length - 1; i++) {
        if (segments[i].end > segments[i + 1].start) {
          segments[i].end = segments[i + 1].start;
        }
      }
      // Remove zero-duration segments after de-overlap
      segments = segments.filter((s) => s.end > s.start);
    }

    if (segments.length === 0) {
      console.log("[ASR] Subtitle file parsed but contained no usable segments");
      return null;
    }

    console.log(`[ASR] Found ${segments.length} native subtitle segments (${detectedLang}) for ${url}`);
    return { segments, language: detectedLang };
  } catch (err: any) {
    // Subtitle extraction failed — that's fine, fall back to ASR
    console.log(`[ASR] Native subtitle extraction error: ${err.message}`);
    return null;
  }
}

function shouldProbeNativeSubtitles(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // These sites almost always require ASR path; probing subtitles only adds delay.
    if (host.includes("pornhub.com")) return false;
  } catch {
    // ignore parse errors and keep default behavior
  }
  return true;
}

// ── GET /api/asr/providers — list available providers ───────────────
asrRoutes.get("/providers", (c) => {
  return c.json({
    active: config.asrProvider,
    fallback_chain: config.asrFallbackChain,
    providers: listProviders(),
  });
});

// ── GET /api/asr/capability — runtime capability probe ──────────────
asrRoutes.get("/capability", async (c) => {
  const raw = c.req.query("apiKeys");
  let apiKeys: any = {};
  if (raw) {
    try { apiKeys = JSON.parse(raw); } catch { apiKeys = {}; }
  }

  const capability = await getAsrCapability(apiKeys);
  const providerOrder = await resolveProviderOrder("auto", apiKeys);

  return c.json({
    ok: true,
    configured_provider: config.asrProvider,
    fallback_chain: config.asrFallbackChain,
    capability,
    provider_order_auto: providerOrder,
  });
});

// ── POST /api/asr/transcribe — upload file ──────────────────────────
asrRoutes.post("/transcribe", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") {
    return c.json({ ok: false, error: "Missing file" }, 400);
  }

  const language = String(body.language ?? "auto");
  const apiKeysStr = String(body.apiKeys ?? "{}");
  let apiKeys: any = {};
  try { apiKeys = JSON.parse(apiKeysStr); } catch { }

  const requestedProvider = String(apiKeys.asrProvider || body.provider || config.asrProvider || "auto");
  const providerOrder = await resolveProviderOrder(requestedProvider, apiKeys);

  const workDir = await mkdtemp(join(tmpdir(), "subplayer-"));

  try {
    // Save uploaded file
    const ext = extname((file as File).name || ".mp4");
    const inputPath = join(workDir, `input${ext}`);
    await Bun.write(inputPath, file as Blob);

    // Extract audio
    const audioPath = join(workDir, "audio.wav");
    await extractAudio(inputPath, audioPath);

    // Split if long
    const chunks = await splitAudio(audioPath, config.maxChunkSec, workDir);

    // Transcribe each chunk using provider
    const allSegments: Segment[] = [];
    let timeOffset = 0;
    let usedProvider = "";
    let detectedLanguage = language;

    for (const chunk of chunks) {
      const options = { language, format: "wav", apiKeys };
      const result = await transcribeWithFallback(chunk, options, providerOrder);

      if (!result.ok) {
        return c.json({ ok: false, error: result.error, provider: result.provider }, 500);
      }

      usedProvider = result.provider;
      if (result.language && result.language !== "auto") {
        detectedLanguage = result.language;
      }

      for (const seg of result.segments) {
        allSegments.push({
          start: seg.start + timeOffset,
          end: seg.end + timeOffset,
          text: seg.text,
        });
      }
      if (chunks.length > 1) {
        timeOffset += config.maxChunkSec;
      }
    }

    return c.json({
      ok: true,
      language: detectedLanguage,
      provider: usedProvider,
      full_text: allSegments.map((s) => s.text).join(" "),
      segments: allSegments,
    });
  } catch (err: any) {
    console.error("Transcribe error:", err);
    return c.json({ ok: false, error: err.message }, 500);
  } finally {
    await cleanupDir(workDir);
  }
});

// ── POST /api/asr/transcribe-url — from URL ────────────────────────
asrRoutes.post("/transcribe-url", async (c) => {
  const {
    url,
    language = "auto",
    provider: bodyProvider,
    apiKeys = {},
    mode = "auto",
    mediaUrl,
    mediaHeaders,
  } = await c.req.json<{
    url: string;
    language?: string;
    provider?: string;
    apiKeys?: any;
    mode?: "auto" | "pipe" | "download-fallback";
    mediaUrl?: string;
    mediaHeaders?: {
      referer?: string;
      origin?: string;
      userAgent?: string;
      cookie?: string;
    };
  }>();

  if (!url) return c.json({ ok: false, error: "Missing url" }, 400);

  const requestedProvider = String(apiKeys.asrProvider || bodyProvider || config.asrProvider || "auto");
  const providerOrder = await resolveProviderOrder(requestedProvider, apiKeys);

  const workDir = await mkdtemp(join(tmpdir(), "subplayer-"));

  try {
    // ── Step 1: Try native subtitles first (much faster, no ASR needed)
    // Skip this step when direct media URL is provided from extension capture.
    const nativeSubs = mediaUrl
      ? null
      : shouldProbeNativeSubtitles(url)
        ? await tryExtractNativeSubtitles(url, language, workDir)
        : null;
    if (!mediaUrl && !shouldProbeNativeSubtitles(url)) {
      console.log("[ASR] Skip native subtitle probe for this site, use ASR directly");
    }

    if (nativeSubs && nativeSubs.segments.length > 0) {
      return c.json({
        ok: true,
        language: nativeSubs.language,
        provider: "native-subtitle",
        full_text: nativeSubs.segments.map((s) => s.text).join(" "),
        segments: nativeSubs.segments,
      });
    }

    const audioPath = join(workDir, "audio.wav");
    if (mediaUrl) {
      // Direct-capture ASR path: bypass yt-dlp source extraction completely.
      console.log(`[ASR] Using direct-captured mediaUrl for ASR: ${mediaUrl.slice(0, 120)}`);
      await extractAudioFromDirectMediaUrl(mediaUrl, audioPath, mediaHeaders);
    } else {
      // Standard path: use yt-dlp (pipe or download fallback), then normalize.
      const rawPath = await downloadOrPipeAudioSource(url, workDir, mode);
      await extractAudio(rawPath, audioPath);
    }

    // Split if long
    const chunks = await splitAudio(audioPath, config.maxChunkSec, workDir);

    const allSegments: Segment[] = [];
    let timeOffset = 0;
    let usedProvider = "";
    let detectedLanguage = language; // will be updated from ASR result

    for (const chunk of chunks) {
      const options = { language, format: "wav", apiKeys };
      const result = await transcribeWithFallback(chunk, options, providerOrder);

      if (!result.ok) {
        return c.json({ ok: false, error: result.error, provider: result.provider }, 500);
      }

      usedProvider = result.provider;
      // Use detected language from ASR (e.g. "en", "zh", "ja")
      if (result.language && result.language !== "auto") {
        detectedLanguage = result.language;
      }

      for (const seg of result.segments) {
        allSegments.push({
          start: seg.start + timeOffset,
          end: seg.end + timeOffset,
          text: seg.text,
        });
      }
      if (chunks.length > 1) timeOffset += config.maxChunkSec;
    }

    return c.json({
      ok: true,
      language: detectedLanguage,
      provider: usedProvider,
      full_text: allSegments.map((s) => s.text).join(" "),
      segments: allSegments,
    });
  } catch (err: any) {
    console.error("Transcribe-url error:", err);
    return c.json({ ok: false, error: err.message }, 500);
  } finally {
    await cleanupDir(workDir);
  }
});
