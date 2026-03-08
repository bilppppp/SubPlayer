import { resolve } from "path";

// Load .env from repo root
const envPath = resolve(import.meta.dir, "../../../.env");
const envFile = Bun.file(envPath);
if (await envFile.exists()) {
  const text = await envFile.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export const config = {
  // ── Server ─────────────────────────────────────────────────────
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: (process.env.NODE_ENV ?? "development") === "production",

  // ── Gateway security ───────────────────────────────────────────
  /** Comma-separated CORS allowlist in production, e.g. "https://a.com,https://b.com" */
  corsAllowOrigins: (process.env.CORS_ALLOW_ORIGINS ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean),

  /** Enable API key authentication for /api/* except /api/health */
  gatewayApiKeyRequired: (process.env.GATEWAY_API_KEY_REQUIRED ?? "false").toLowerCase() === "true",
  gatewayApiKey: (process.env.GATEWAY_API_KEY ?? "").trim(),

  /** Fixed-window, per-IP rate limiting */
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),

  // ── ASR — Provider selection ───────────────────────────────────
  /** "local" | "volcengine" | "aliyun" */
  asrProvider: (process.env.ASR_PROVIDER ?? "local") as string,

  /** Fallback chain: try providers in order. Comma-separated. */
  asrFallbackChain: (process.env.ASR_FALLBACK_CHAIN ?? process.env.ASR_PROVIDER ?? "local")
    .split(",")
    .map((s: string) => s.trim()),

  // ── ASR — Local FunASR ─────────────────────────────────────────
  asrPort: Number(process.env.ASR_PORT ?? 8765),
  asrHost: process.env.ASR_HOST ?? "http://localhost",

  // ── ASR — Volcengine (火山云) ──────────────────────────────────
  volcengineAppId: process.env.VOLCENGINE_APP_ID ?? "",
  volcengineAccessToken: process.env.VOLCENGINE_ACCESS_TOKEN ?? "",
  volcengineSecretKey: process.env.VOLCENGINE_SECRET_KEY ?? "",
  volcengineResourceId: process.env.VOLCENGINE_RESOURCE_ID ?? "volc.seedasr.sauc.duration",
  /** bigmodel_nostream | bigmodel | bigmodel_async | flash | legacy_auc */
  volcengineMode: process.env.VOLCENGINE_MODE ?? "bigmodel_nostream",
  volcengineCluster: process.env.VOLCENGINE_CLUSTER ?? "volcengine_streaming_common",

  // ── ASR — Aliyun (阿里云百炼 DashScope) ────────────────────────
  aliyunDashscopeKey: process.env.ALIYUN_DASHSCOPE_KEY ?? "",

  // ── Translation ────────────────────────────────────────────────
  /** "gemini" | "deepseek" | "auto" (auto = gemini → deepseek fallback) */
  translateProvider: (process.env.TRANSLATE_PROVIDER ?? "auto") as string,

  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  /** Model name for Gemini REST API
   *  Free tier:  gemini-2.0-flash-lite / gemini-flash-lite-latest
   *  Paid tier:  gemini-2.0-flash / gemini-3-flash-preview / gemini-2.5-flash-preview
   */
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",

  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",

  // ── yt-dlp ────────────────────────────────────────────────────
  /** Browser to extract cookies from for yt-dlp (chrome, firefox, safari, or empty) */
  ytCookiesBrowser: (process.env.YT_COOKIES_BROWSER ?? "").trim(),

  // ── Audio processing ───────────────────────────────────────────
  /** Max chunk duration in seconds for long audio splitting */
  maxChunkSec: 480,
} as const;

export function getAsrUrl(path: string): string {
  return `${config.asrHost}:${config.asrPort}${path}`;
}
