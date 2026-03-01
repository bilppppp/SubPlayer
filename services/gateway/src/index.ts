import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { asrRoutes } from "./routes/asr.js";
import { jobsRoutes } from "./routes/jobs.js";
import { translateRoutes } from "./routes/translate.js";
import { videoRoutes } from "./routes/video.js";

const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// ── Routes ───────────────────────────────────────────────────────────
app.route("/api/asr", asrRoutes);
app.route("/api/translate", translateRoutes);
app.route("/api/video", videoRoutes);
app.route("/api/jobs", jobsRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", gateway: true }));

// ── Start ────────────────────────────────────────────────────────────
console.log(`🚀 Gateway listening on http://localhost:${config.port}`);
export default {
  port: config.port,
  // HLS/MP4 proxy requests can stay open for a while when CDN/network jitters.
  // Bun default idle timeout (10s) is too aggressive and may reset sockets.
  idleTimeout: 120,
  fetch: app.fetch,
};
