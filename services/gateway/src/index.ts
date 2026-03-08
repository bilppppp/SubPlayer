import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { asrRoutes } from "./routes/asr.js";
import { jobsRoutes } from "./routes/jobs.js";
import { translateRoutes } from "./routes/translate.js";
import { videoRoutes } from "./routes/video.js";

const app = new Hono();
const rateLimitBucket = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: Context): string {
  const xForwardedFor = c.req.header("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = c.req.header("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function getRequestApiKey(c: Context): string {
  const headerKey = c.req.header("x-api-key")?.trim();
  if (headerKey) return headerKey;
  const auth = c.req.header("authorization")?.trim();
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function isOriginAllowed(origin: string): boolean {
  if (!origin) return true;
  if (!config.isProduction) return true;
  if (config.corsAllowOrigins.length === 0) return false;
  return config.corsAllowOrigins.includes(origin);
}

// ── Middleware ────────────────────────────────────────────────────────
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => (isOriginAllowed(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposeHeaders: ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    credentials: true,
    maxAge: 86400,
  })
);
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") {
    return next();
  }

  // API key authentication (optional, recommended for production).
  if (config.gatewayApiKeyRequired) {
    const expected = config.gatewayApiKey;
    const provided = getRequestApiKey(c);
    if (!expected || !provided || provided !== expected) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
  }

  // Per-IP fixed-window rate limiting.
  const ip = getClientIp(c);
  const now = Date.now();
  const windowMs = Math.max(1000, config.rateLimitWindowMs);
  const limit = Math.max(1, config.rateLimitMax);
  const existing = rateLimitBucket.get(ip);

  if (!existing || existing.resetAt <= now) {
    rateLimitBucket.set(ip, { count: 1, resetAt: now + windowMs });
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(limit - 1));
    c.header("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));
    return next();
  }

  if (existing.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    c.header("Retry-After", String(retryAfterSec));
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(Math.ceil(existing.resetAt / 1000)));
    return c.json({ ok: false, error: "Too Many Requests" }, 429);
  }

  existing.count += 1;
  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(Math.max(0, limit - existing.count)));
  c.header("X-RateLimit-Reset", String(Math.ceil(existing.resetAt / 1000)));
  return next();
});

// ── Routes ───────────────────────────────────────────────────────────
app.route("/api/asr", asrRoutes);
app.route("/api/translate", translateRoutes);
app.route("/api/video", videoRoutes);
app.route("/api/jobs", jobsRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", gateway: true }));

// ── Start ────────────────────────────────────────────────────────────
console.log(`🚀 Gateway listening on http://localhost:${config.port}`);
if (config.isProduction && config.corsAllowOrigins.length === 0) {
  console.warn("[Gateway] CORS_ALLOW_ORIGINS is empty in production; cross-origin browser requests will be rejected.");
}
if (config.gatewayApiKeyRequired && !config.gatewayApiKey) {
  console.warn("[Gateway] GATEWAY_API_KEY_REQUIRED=true but GATEWAY_API_KEY is empty; all protected API requests will be rejected.");
}
export default {
  port: config.port,
  // HLS/MP4 proxy requests can stay open for a while when CDN/network jitters.
  // Bun default idle timeout (10s) is too aggressive and may reset sockets.
  idleTimeout: 120,
  fetch: app.fetch,
};
