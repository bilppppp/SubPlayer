import { Hono } from "hono";
import { config } from "../config.js";
import {
  getProvider,
  getProviderByName,
  transcribeWithFallback,
  listProviders,
  type Segment,
} from "../providers/index.js";
import {
  FIXED_VOLCENGINE_RESOURCE_FLASH,
  FIXED_VOLCENGINE_RESOURCE_SAUC,
  probeVolcengineWs,
  transcribeVolcengineLive,
} from "../providers/volcengine.js";
import {
  buildYtDlpArgs,
  buildYtDlpArgVariants,
  summarizeYtDlpFailure,
  type YtDlpAttemptFailure,
} from "../lib/yt-dlp.js";
import { getCachedVideoByOriginUrl } from "./video.js";
import { spawn } from "child_process";
import { mkdtemp, unlink, readdir, readFile, rm, stat, open } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";
import { randomUUID } from "crypto";

export const asrRoutes = new Hono();
const ASR_PIPE_MAX_WAV_BYTES = Number(process.env.ASR_PIPE_MAX_WAV_MB ?? "200") * 1024 * 1024;

class AsrPipeMemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsrPipeMemoryLimitError";
  }
}

type UploadSession = {
  id: string;
  dir: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  received: Set<number>;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
};

const uploadSessions = new Map<string, UploadSession>();
const UPLOAD_SESSION_TTL_MS = Number(process.env.ASR_UPLOAD_SESSION_TTL_MS ?? String(6 * 60 * 60 * 1000));
const DEFAULT_UPLOAD_CHUNK_BYTES = Number(process.env.ASR_UPLOAD_CHUNK_BYTES ?? String(8 * 1024 * 1024));
const MIN_UPLOAD_CHUNK_BYTES = 1024 * 1024;
const MAX_UPLOAD_CHUNK_BYTES = 64 * 1024 * 1024;

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

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

async function splitAudio(
  audioPath: string,
  chunkSec: number,
  outDir: string
): Promise<string[]> {
  // Use ffmpeg segment muxer to avoid relying on a single duration probe,
  // which can become unreliable on some long files/codecs.
  const pattern = join(outDir, "chunk_%05d.wav");
  await run("ffmpeg", [
    "-y",
    "-i", audioPath,
    "-f", "segment",
    "-segment_time", String(chunkSec),
    "-c:a", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    pattern,
  ]);

  const files = (await readdir(outDir))
    .filter((f) => /^chunk_\d{5}\.wav$/.test(f))
    .sort((a, b) => a.localeCompare(b));

  const chunks: string[] = [];
  for (const file of files) {
    const p = join(outDir, file);
    try {
      const info = await stat(p);
      if (info.size > 0) chunks.push(p);
    } catch {
      // ignore unreadable chunk
    }
  }

  return chunks.length > 0 ? chunks : [audioPath];
}

async function cleanupDir(dir: string) {
  try {
    const files = await readdir(dir);
    for (const f of files) await unlink(join(dir, f)).catch(() => { });
    await rm(dir, { recursive: true, force: true }).catch(() => { });
  } catch { }
}

async function removeUploadSession(uploadId: string): Promise<void> {
  const session = uploadSessions.get(uploadId);
  if (!session) return;
  uploadSessions.delete(uploadId);
  await cleanupDir(session.dir);
}

async function pruneUploadSessions(): Promise<void> {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, s] of uploadSessions.entries()) {
    if (now - s.updatedAt > UPLOAD_SESSION_TTL_MS) {
      staleIds.push(id);
    }
  }
  for (const id of staleIds) {
    await removeUploadSession(id);
  }
}

function clampChunkSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_UPLOAD_CHUNK_BYTES;
  return Math.max(MIN_UPLOAD_CHUNK_BYTES, Math.min(MAX_UPLOAD_CHUNK_BYTES, Math.floor(n)));
}

async function transcribePreparedInput(
  inputPath: string,
  workDir: string,
  language: string,
  apiKeys: any,
  providerOrder: string[],
  logPrefix: string,
): Promise<{
  language: string;
  provider: string;
  completion: "final" | "partial_complete";
  segments: Segment[];
}> {
  const inputDuration = await getAudioDuration(inputPath).catch(() => NaN);
  if (Number.isFinite(inputDuration)) {
    console.log(`[ASR] ${logPrefix}_input_ready duration_sec=${inputDuration.toFixed(1)}`);
  }

  const audioPath = join(workDir, `${logPrefix}_audio.wav`);
  await extractAudio(inputPath, audioPath);
  const audioDuration = await getAudioDuration(audioPath).catch(() => NaN);
  if (Number.isFinite(audioDuration)) {
    console.log(`[ASR] ${logPrefix}_audio_ready duration_sec=${audioDuration.toFixed(1)}`);
  }

  if (
    Number.isFinite(inputDuration) &&
    Number.isFinite(audioDuration) &&
    inputDuration > 1800 &&
    audioDuration < inputDuration * 0.7
  ) {
    throw new Error(
      `检测到媒体不完整：容器时长 ${fmtDuration(inputDuration)}，可提取音频仅 ${fmtDuration(audioDuration)}。请重试上传，或先上传音频文件。`,
    );
  }

  const chunks = await splitAudio(audioPath, config.maxChunkSec, workDir);
  console.log(`[ASR] ${logPrefix}_audio_chunks count=${chunks.length} chunkSec=${config.maxChunkSec}`);

  const allSegments: Segment[] = [];
  let timeOffset = 0;
  let usedProvider = "";
  let detectedLanguage = language;
  let completion: "final" | "partial_complete" = "final";

  for (const chunk of chunks) {
    const options = { language, format: "wav", apiKeys };
    const result = await transcribeWithFallback(chunk, options, providerOrder);

    if (!result.ok) {
      throw new Error(result.error || "转写失败");
    }

    usedProvider = result.provider;
    if (result.language && result.language !== "auto") {
      detectedLanguage = result.language;
    }
    if (result.completion === "partial_complete") {
      completion = "partial_complete";
    }

    for (const seg of result.segments) {
      allSegments.push({
        start: seg.start + timeOffset,
        end: seg.end + timeOffset,
        text: seg.text,
      });
    }

    const chunkDuration = await getAudioDuration(chunk).catch(() => NaN);
    if (Number.isFinite(chunkDuration)) {
      timeOffset += chunkDuration;
    } else {
      timeOffset += config.maxChunkSec;
    }
  }

  return {
    language: detectedLanguage,
    provider: usedProvider,
    completion,
    segments: allSegments,
  };
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
): Promise<{ filePath: string | null; failure: YtDlpAttemptFailure | null }> {
  for (const baseArgs of buildYtDlpArgVariants(url, config)) {
    try {
      await run("yt-dlp", [...args, ...baseArgs, "-o", join(workDir, `${outputPrefix}.%(ext)s`), url]);
      return {
        filePath: await firstExistingNonEmptyFile(workDir, [outputPrefix]),
        failure: null,
      };
    } catch (err: any) {
      const error = err.message?.slice(0, 1200) ?? "unknown error";
      console.log(`[ASR] yt-dlp attempt failed (${outputPrefix}): ${error.slice(0, 220)}`);
      const filePath = await firstExistingNonEmptyFile(workDir, [outputPrefix]);
      if (filePath) {
        return { filePath, failure: null };
      }
      if (baseArgs.includes("--cookies-from-browser")) {
        return {
          filePath: null,
          failure: { outputPrefix, args, error },
        };
      }
    }
  }
  return {
    filePath: null,
    failure: { outputPrefix, args, error: "yt-dlp failed without stderr output" },
  };
}

/**
 * Some sites intermittently fail with `-x --audio-format wav` and produce
 * empty files. Use staged fallbacks to keep YouTube/Bilibili behavior intact
 * while improving extractor compatibility.
 */
async function downloadAudioSource(url: string, workDir: string): Promise<string> {
  const failures: YtDlpAttemptFailure[] = [];

  // Attempt 1 (unchanged primary path): direct audio extraction.
  const extracted = await tryYtDlpDownload(url, [
    "-x",
    "--audio-format", "wav",
  ], workDir, "download");
  if (extracted.filePath) return extracted.filePath;
  if (extracted.failure) failures.push(extracted.failure);

  // Attempt 2: download bestaudio container, convert later via ffmpeg.
  const bestAudio = await tryYtDlpDownload(url, [
    "-f", "bestaudio/best",
  ], workDir, "download-audio");
  if (bestAudio.filePath) return bestAudio.filePath;
  if (bestAudio.failure) failures.push(bestAudio.failure);

  // Attempt 3: download muxed/best video as a final fallback, then extract audio.
  const bestVideo = await tryYtDlpDownload(url, [
    "-f", "bestvideo+bestaudio/best",
    "--merge-output-format", "mp4",
  ], workDir, "download-video");
  if (bestVideo.filePath) return bestVideo.filePath;
  if (bestVideo.failure) failures.push(bestVideo.failure);

  throw new Error(summarizeYtDlpFailure(failures));
}

function spawnPipeProcess(cmd: string, args: string[]) {
  return spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
}

async function audioFromUrlViaPipeToWavBuffer(url: string): Promise<Buffer> {
  const ytdlpAttempts = buildYtDlpArgVariants(url, config).flatMap((baseArgs) => ([
    ["-f", "bestaudio/best", "-o", "-", ...baseArgs, url],
    ["-f", "best", "-o", "-", ...baseArgs, url],
  ]));

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
    let lastProbe: { stderr: string; code: number | null; timedOut?: boolean } | null = null;

    for (const baseArgs of buildYtDlpArgVariants(url, config)) {
      const probe = await runIgnoreExit("yt-dlp", [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", subLangs,
        "--sub-format", "json3",
        ...baseArgs,
        "-o", join(workDir, "subs"),
        url,
      ], 12000);
      lastProbe = probe;

      if (probe.timedOut) {
        console.log("[ASR] Native subtitle probe timed out, fallback to ASR");
      } else if (probe.code !== 0) {
        console.log(`[ASR] yt-dlp subtitle extraction exited with code ${probe.code} (may be partial): ${probe.stderr.slice(0, 200)}`);
      }

      const files = await readdir(workDir);
      const subExts = [".json3", ".json", ".vtt", ".srt"];
      const subFiles = files
        .filter((f) => subExts.some((ext) => f.endsWith(ext)) && f.startsWith("subs"))
        .sort();

      if (subFiles.length > 0) {
        console.log(`[ASR] Native subtitle probe wrote ${subFiles.length} file(s)`);
        break;
      }
    }

    // Look for downloaded subtitle files — may exist even if exit != 0
    // Support: .json3 (YouTube), .json (Bilibili BCC), .vtt, .srt
    const files = await readdir(workDir);
    const subExts = [".json3", ".json", ".vtt", ".srt"];
    const subFiles = files
      .filter((f) => subExts.some((ext) => f.endsWith(ext)) && f.startsWith("subs"))
      .sort();

    if (subFiles.length === 0) {
      if (lastProbe?.code && !lastProbe?.timedOut) {
        console.log(`[ASR] No subtitle files found after probe, last yt-dlp stderr: ${lastProbe.stderr.slice(0, 200)}`);
      }
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

// ── POST /api/asr/volcengine-probe — handshake + minimal roundtrip ─
asrRoutes.post("/volcengine-probe", async (c) => {
  try {
    const body = await c.req.json<{ apiKeys?: any }>();
    const probe = await probeVolcengineWs(body?.apiKeys ?? {});
    return c.json(probe);
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || "probe failed" }, 500);
  }
});

// ── Local chunk upload pipeline (for very large local files) ───────
asrRoutes.post("/upload/init", async (c) => {
  await pruneUploadSessions();
  const body = await c.req.json<{
    fileName?: string;
    fileSize?: number;
    chunkSize?: number;
  }>();

  const fileName = String(body?.fileName || "upload.bin");
  const fileSize = Number(body?.fileSize || 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return c.json({ ok: false, error: "Invalid fileSize" }, 400);
  }

  const chunkSize = clampChunkSize(Number(body?.chunkSize || DEFAULT_UPLOAD_CHUNK_BYTES));
  const totalChunks = Math.ceil(fileSize / chunkSize);
  if (totalChunks <= 0) {
    return c.json({ ok: false, error: "Invalid chunk plan" }, 400);
  }

  const id = randomUUID();
  const dir = await mkdtemp(join(tmpdir(), "subplayer-upload-"));
  const ext = extname(fileName) || ".bin";
  const filePath = join(dir, `input${ext}`);
  const fh = await open(filePath, "w");
  try {
    await fh.truncate(fileSize);
  } finally {
    await fh.close();
  }

  uploadSessions.set(id, {
    id,
    dir,
    filePath,
    fileName,
    fileSize,
    chunkSize,
    totalChunks,
    received: new Set<number>(),
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return c.json({
    ok: true,
    uploadId: id,
    fileSize,
    chunkSize,
    totalChunks,
  });
});

asrRoutes.put("/upload/:id/chunk", async (c) => {
  await pruneUploadSessions();
  const id = c.req.param("id");
  const session = uploadSessions.get(id);
  if (!session) return c.json({ ok: false, error: "Upload session not found" }, 404);
  if (session.completed) return c.json({ ok: false, error: "Upload session already completed" }, 409);

  const index = Number(c.req.query("index"));
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    return c.json({ ok: false, error: "Invalid chunk index" }, 400);
  }

  const chunk = Buffer.from(await c.req.arrayBuffer());
  const expectedSize = index === session.totalChunks - 1
    ? session.fileSize - index * session.chunkSize
    : session.chunkSize;
  if (chunk.length !== expectedSize) {
    return c.json(
      { ok: false, error: `Chunk size mismatch: got ${chunk.length}, expected ${expectedSize}` },
      400,
    );
  }

  const fh = await open(session.filePath, "r+");
  try {
    await fh.write(chunk, 0, chunk.length, index * session.chunkSize);
  } finally {
    await fh.close();
  }

  session.received.add(index);
  session.updatedAt = Date.now();

  return c.json({
    ok: true,
    uploadId: id,
    receivedChunks: session.received.size,
    totalChunks: session.totalChunks,
  });
});

asrRoutes.post("/upload/:id/complete", async (c) => {
  await pruneUploadSessions();
  const id = c.req.param("id");
  const session = uploadSessions.get(id);
  if (!session) return c.json({ ok: false, error: "Upload session not found" }, 404);

  if (session.received.size !== session.totalChunks) {
    return c.json({
      ok: false,
      error: `Upload incomplete: ${session.received.size}/${session.totalChunks} chunks`,
    }, 400);
  }

  const info = await stat(session.filePath).catch(() => null);
  if (!info || info.size < session.fileSize) {
    return c.json({ ok: false, error: "Uploaded file is incomplete on disk" }, 400);
  }

  session.completed = true;
  session.updatedAt = Date.now();

  return c.json({
    ok: true,
    uploadId: id,
    fileSize: session.fileSize,
    totalChunks: session.totalChunks,
  });
});

asrRoutes.delete("/upload/:id", async (c) => {
  const id = c.req.param("id");
  await removeUploadSession(id);
  return c.json({ ok: true });
});

asrRoutes.post("/transcribe-upload", async (c) => {
  await pruneUploadSessions();
  const body = await c.req.json<{
    uploadId?: string;
    language?: string;
    provider?: string;
    apiKeys?: any;
  }>();

  const uploadId = String(body?.uploadId || "");
  if (!uploadId) return c.json({ ok: false, error: "Missing uploadId" }, 400);

  const session = uploadSessions.get(uploadId);
  if (!session) return c.json({ ok: false, error: "Upload session not found" }, 404);
  if (!session.completed) {
    return c.json({ ok: false, error: "Upload session not completed" }, 400);
  }

  const language = String(body?.language ?? "auto");
  const apiKeys = body?.apiKeys ?? {};
  const requestedProvider = String(apiKeys.asrProvider || body?.provider || config.asrProvider || "auto");
  const providerOrder = await resolveProviderOrder(requestedProvider, apiKeys);

  try {
    const result = await transcribePreparedInput(
      session.filePath,
      session.dir,
      language,
      apiKeys,
      providerOrder,
      "upload",
    );
    const lastEnd = result.segments.length > 0 ? result.segments[result.segments.length - 1].end : 0;
    console.log(
      `[ASR] upload_transcribe_done segments=${result.segments.length} last_end_sec=${lastEnd.toFixed(1)} provider=${result.provider} completion=${result.completion}`,
    );

    await removeUploadSession(uploadId);
    return c.json({
      ok: true,
      language: result.language,
      provider: result.provider,
      completion: result.completion,
      full_text: result.segments.map((s) => s.text).join(" "),
      segments: result.segments,
    });
  } catch (err: any) {
    const msg = err?.message || "transcribe upload failed";
    await removeUploadSession(uploadId);
    const status = msg.includes("检测到媒体不完整") ? 400 : 500;
    return c.json({ ok: false, error: msg }, status);
  }
});

// ── POST /api/asr/transcribe-upload-live — NDJSON stream for local uploads ──
asrRoutes.post("/transcribe-upload-live", async (c) => {
  await pruneUploadSessions();
  const body = await c.req.json<{
    uploadId?: string;
    language?: string;
    provider?: string;
    apiKeys?: any;
  }>();

  const uploadId = String(body?.uploadId || "");
  if (!uploadId) return c.json({ ok: false, error: "Missing uploadId" }, 400);

  const session = uploadSessions.get(uploadId);
  if (!session) return c.json({ ok: false, error: "Upload session not found" }, 404);
  if (!session.completed) {
    return c.json({ ok: false, error: "Upload session not completed" }, 400);
  }

  const language = String(body?.language ?? "auto");
  const apiKeys = body?.apiKeys ?? {};
  const requestedProvider = String(apiKeys.asrProvider || body?.provider || config.asrProvider || "auto");
  const providerOrder = await resolveProviderOrder(requestedProvider, apiKeys);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const safeSend = (obj: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore double-close race
        }
      };

      (async () => {
        try {
          const inputDuration = await getAudioDuration(session.filePath).catch(() => NaN);
          if (Number.isFinite(inputDuration)) {
            console.log(`[ASR] upload_live_input_ready duration_sec=${inputDuration.toFixed(1)}`);
          }

          const audioPath = join(session.dir, "upload_live_audio.wav");
          await extractAudio(session.filePath, audioPath);
          const audioDuration = await getAudioDuration(audioPath).catch(() => NaN);
          if (Number.isFinite(audioDuration)) {
            console.log(`[ASR] upload_live_audio_ready duration_sec=${audioDuration.toFixed(1)}`);
          }

          if (
            Number.isFinite(inputDuration) &&
            Number.isFinite(audioDuration) &&
            inputDuration > 1800 &&
            audioDuration < inputDuration * 0.7
          ) {
            throw new Error(
              `检测到媒体不完整：容器时长 ${fmtDuration(inputDuration)}，可提取音频仅 ${fmtDuration(audioDuration)}。请重试上传，或先上传音频文件。`,
            );
          }

          const chunks = await splitAudio(audioPath, config.maxChunkSec, session.dir);
          console.log(`[ASR] upload_live_audio_chunks count=${chunks.length} chunkSec=${config.maxChunkSec}`);

          const allSegments: Segment[] = [];
          let timeOffset = 0;
          let usedProvider = "";
          let detectedLanguage = language;
          let completion: "final" | "partial_complete" = "final";

          for (let idx = 0; idx < chunks.length; idx += 1) {
            const chunk = chunks[idx];
            const options = { language, format: "wav", apiKeys };
            const result = await transcribeWithFallback(chunk, options, providerOrder);
            if (!result.ok) {
              throw new Error(result.error || "转写失败");
            }

            usedProvider = result.provider;
            if (result.language && result.language !== "auto") {
              detectedLanguage = result.language;
            }
            if (result.completion === "partial_complete") {
              completion = "partial_complete";
            }

            const chunkSegments: Segment[] = result.segments.map((seg) => ({
              start: seg.start + timeOffset,
              end: seg.end + timeOffset,
              text: seg.text,
            }));
            allSegments.push(...chunkSegments);

            safeSend({
              type: "partial",
              language: detectedLanguage,
              provider: usedProvider,
              completion,
              chunkIndex: idx + 1,
              chunkTotal: chunks.length,
              segments: chunkSegments,
              totalSegments: allSegments.length,
            });

            const chunkDuration = await getAudioDuration(chunk).catch(() => NaN);
            if (Number.isFinite(chunkDuration)) {
              timeOffset += chunkDuration;
            } else {
              timeOffset += config.maxChunkSec;
            }
          }

          const lastEnd = allSegments.length > 0 ? allSegments[allSegments.length - 1].end : 0;
          console.log(
            `[ASR] upload_live_done segments=${allSegments.length} last_end_sec=${lastEnd.toFixed(1)} provider=${usedProvider} completion=${completion}`,
          );
          safeSend({
            type: "done",
            language: detectedLanguage,
            provider: usedProvider,
            completion,
            segments: allSegments,
          });
        } catch (err: any) {
          safeSend({ type: "error", error: err?.message || "live transcribe failed" });
        } finally {
          await removeUploadSession(uploadId);
          safeClose();
        }
      })().catch((err) => {
        safeSend({ type: "error", error: err?.message || "live transcribe crashed" });
        safeClose();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

// ── POST /api/asr/transcribe — upload file ──────────────────────────
asrRoutes.post("/transcribe", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") {
    return c.json({ ok: false, error: "Missing file" }, 400);
  }
  const uploadFile = file as File;
  console.log(
    `[ASR] upload_transcribe_start name=${uploadFile.name || "unknown"} size=${uploadFile.size || 0}`,
  );

  const language = String(body.language ?? "auto");
  const apiKeysStr = String(body.apiKeys ?? "{}");
  let apiKeys: any = {};
  try { apiKeys = JSON.parse(apiKeysStr); } catch { }

  const requestedProvider = String(apiKeys.asrProvider || body.provider || config.asrProvider || "auto");
  const providerOrder = await resolveProviderOrder(requestedProvider, apiKeys);

  const workDir = await mkdtemp(join(tmpdir(), "subplayer-"));

  try {
    // Save uploaded file
    const ext = extname(uploadFile.name || ".mp4");
    const inputPath = join(workDir, `input${ext}`);
    await Bun.write(inputPath, uploadFile as Blob);
    const result = await transcribePreparedInput(
      inputPath,
      workDir,
      language,
      apiKeys,
      providerOrder,
      "upload",
    );

    return c.json({
      ok: true,
      language: result.language,
      provider: result.provider,
      completion: result.completion,
      full_text: result.segments.map((s) => s.text).join(" "),
      segments: result.segments,
    });
  } catch (err: any) {
    console.error("Transcribe error:", err);
    const msg = err?.message || "transcribe failed";
    const status = msg.includes("检测到媒体不完整") ? 400 : 500;
    return c.json({ ok: false, error: msg }, status);
  } finally {
    await cleanupDir(workDir);
  }
});

// ── POST /api/asr/transcribe-url-live — NDJSON stream (volcengine) ──
asrRoutes.post("/transcribe-url-live", async (c) => {
  const {
    url,
    language = "auto",
    apiKeys = {},
    mode = "auto",
    mediaUrl,
    mediaHeaders,
  } = await c.req.json<{
    url: string;
    language?: string;
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
  if ((apiKeys?.asrProvider || config.asrProvider) !== "volcengine") {
    return c.json({ ok: false, error: "live route currently supports volcengine only" }, 400);
  }
  const liveMode = String(apiKeys?.volcengineMode || config.volcengineMode || "bigmodel_nostream");
  const liveResource = liveMode === "flash" ? FIXED_VOLCENGINE_RESOURCE_FLASH : FIXED_VOLCENGINE_RESOURCE_SAUC;
  console.log(
    `[ASR] mode_lock route=live provider=volcengine mode=${liveMode} resource=${liveResource} allowAutoDowngrade=${Boolean(apiKeys?.allowAsrAutoDowngrade)}`,
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const safeSend = (obj: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore double-close race
        }
      };

      (async () => {
        const workDir = await mkdtemp(join(tmpdir(), "subplayer-"));
        try {
          // Native subtitles shortcut: if exists, return immediately.
          const nativeSubs = mediaUrl ? null : await tryExtractNativeSubtitles(url, language, workDir);
          if (nativeSubs && nativeSubs.segments.length > 0) {
            safeSend({
              type: "done",
              language: nativeSubs.language,
              provider: "native-subtitle",
              segments: nativeSubs.segments,
            });
            return;
          }

          const audioPath = join(workDir, "audio.wav");
          if (mediaUrl) {
            await extractAudioFromDirectMediaUrl(mediaUrl, audioPath, mediaHeaders);
          } else {
            const cached = getCachedVideoByOriginUrl(url);
            if (cached) {
              console.log(`[ASR] Reusing cached video for ASR: ${cached.filePath}`);
              await extractAudio(cached.filePath, audioPath);
            } else {
              const rawPath = await downloadOrPipeAudioSource(url, workDir, mode);
              await extractAudio(rawPath, audioPath);
            }
          }

          const live = await transcribeVolcengineLive(
            audioPath,
            {
              language,
              format: "wav",
              apiKeys,
            },
            (segments) => {
              safeSend({
                type: "partial",
                language,
                provider: "volcengine",
                segments,
              });
            },
          );

          safeSend({
            type: "done",
            language: live.language || language,
            provider: "volcengine",
            segments: live.segments,
            completion: live.completion,
          });
        } catch (err: any) {
          safeSend({ type: "error", error: err?.message || "live transcribe failed" });
        } finally {
          await cleanupDir(workDir);
          safeClose();
        }
      })().catch((err) => {
        safeSend({ type: "error", error: err?.message || "live transcribe crashed" });
        safeClose();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
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
  const classicMode = String(apiKeys?.volcengineMode || config.volcengineMode || "bigmodel_nostream");
  const classicResource = classicMode === "flash" ? FIXED_VOLCENGINE_RESOURCE_FLASH : FIXED_VOLCENGINE_RESOURCE_SAUC;
  console.log(
    `[ASR] mode_lock route=classic requested=${requestedProvider} order=${providerOrder.join(">")} mode=${classicMode} resource=${classicResource} allowAutoDowngrade=${Boolean(apiKeys?.allowAsrAutoDowngrade)}`,
  );

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
      const cached = getCachedVideoByOriginUrl(url);
      if (cached) {
        console.log(`[ASR] Reusing cached video for ASR: ${cached.filePath}`);
        await extractAudio(cached.filePath, audioPath);
      } else {
        // Standard path: use yt-dlp (pipe or download fallback), then normalize.
        const rawPath = await downloadOrPipeAudioSource(url, workDir, mode);
        await extractAudio(rawPath, audioPath);
      }
    }

    const audioDuration = await getAudioDuration(audioPath).catch(() => NaN);
    if (Number.isFinite(audioDuration)) {
      console.log(`[ASR] url_audio_ready duration_sec=${audioDuration.toFixed(1)}`);
    }

    // Split if long
    const chunks = await splitAudio(audioPath, config.maxChunkSec, workDir);
    console.log(`[ASR] url_audio_chunks count=${chunks.length} chunkSec=${config.maxChunkSec}`);

    const allSegments: Segment[] = [];
    let timeOffset = 0;
    let usedProvider = "";
    let detectedLanguage = language; // will be updated from ASR result
    let completion: "final" | "partial_complete" = "final";

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
      if (result.completion === "partial_complete") {
        completion = "partial_complete";
      }

      for (const seg of result.segments) {
        allSegments.push({
          start: seg.start + timeOffset,
          end: seg.end + timeOffset,
          text: seg.text,
        });
      }
      const chunkDuration = await getAudioDuration(chunk).catch(() => NaN);
      if (Number.isFinite(chunkDuration)) {
        timeOffset += chunkDuration;
      } else {
        timeOffset += config.maxChunkSec;
      }
    }

    return c.json({
      ok: true,
      language: detectedLanguage,
      provider: usedProvider,
      completion,
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
