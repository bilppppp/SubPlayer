import { Hono } from "hono";
import { config } from "../config.js";

export const jobsRoutes = new Hono();

type JobStatus = "queued" | "processing" | "done" | "failed";

interface JobRecord {
  id: string;
  key: string;
  url: string;
  sourceLang: string;
  targetLang: string;
  status: JobStatus;
  progress: number;
  step: "queued" | "asr" | "translate" | "done" | "failed";
  message: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  apiKeys?: any;
}

interface JobResult {
  key: string;
  url: string;
  language: string;
  targetLang: string;
  provider?: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    translation?: string;
  }>;
  createdAt: number;
}

const jobsByKey = new Map<string, JobRecord>();
const resultsByKey = new Map<string, JobResult>();
const queue: string[] = [];
let running = 0;

const JOB_CONCURRENCY = Number(process.env.JOBS_CONCURRENCY ?? "1");
const RESULT_TTL_MS = Number(process.env.JOBS_RESULT_TTL_MS ?? String(24 * 60 * 60 * 1000));
const JOB_TTL_MS = Number(process.env.JOBS_TTL_MS ?? String(24 * 60 * 60 * 1000));

function now() {
  return Date.now();
}

function hashString(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex").slice(0, 24);
}

function normalizedUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return "";
  }
}

function jobKey(url: string, targetLang: string): string {
  return hashString(`${url}|${targetLang}`);
}

function summarize(job: JobRecord) {
  return {
    id: job.id,
    url: job.url,
    targetLang: job.targetLang,
    sourceLang: job.sourceLang,
    status: job.status,
    progress: job.progress,
    step: job.step,
    message: job.message,
    error: job.error,
    updatedAt: job.updatedAt,
  };
}

async function postJson(path: string, body: any) {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error ?? `Request failed: ${path}`);
  }
  return json;
}

function pickTargetLang(detectedLang: string, requested: string): string {
  if (requested && requested !== "auto") return requested;
  return detectedLang === "zh" ? "en" : "zh";
}

function baseLang(lang: string): string {
  return String(lang || "auto").toLowerCase().split("-")[0];
}

function shouldSkipTranslation(sourceLang: string, targetLang: string): boolean {
  const s = baseLang(sourceLang);
  const t = baseLang(targetLang);
  if (!s || !t) return false;
  if (s === "auto" || t === "auto") return false;
  return s === t;
}

async function runJob(job: JobRecord) {
  const touch = (patch: Partial<JobRecord>) => {
    const next: JobRecord = {
      ...job,
      ...patch,
      updatedAt: now(),
    };
    jobsByKey.set(job.key, next);
    job = next;
  };

  try {
    touch({
      status: "processing",
      progress: 5,
      step: "asr",
      message: "正在提取字幕/音频...",
      error: undefined,
    });

    const asr = await postJson("/api/asr/transcribe-url", {
      url: job.url,
      language: job.sourceLang || "auto",
      model: "multilingual",
      mode: "auto",
      apiKeys: job.apiKeys ?? {},
    });

    const baseSegments = Array.isArray(asr.segments) ? asr.segments : [];
    const detectedLang = String(asr.language || job.sourceLang || "auto");
    let targetLang = pickTargetLang(detectedLang, job.targetLang);
    let merged = [...baseSegments];
    const skipTranslation = shouldSkipTranslation(detectedLang, targetLang);

    touch({
      progress: 35,
      step: "translate",
      message: skipTranslation ? "源/目标语言一致，跳过翻译" : "正在翻译字幕...",
      targetLang,
    });

    if (skipTranslation) {
      merged = merged.map((s) => ({ ...s, translation: s.text }));
    } else if (merged.length > 0) {
      const CHUNK = 10;
      for (let i = 0; i < merged.length; i += CHUNK) {
        const chunk = merged.slice(i, i + CHUNK);
        const trans = await postJson("/api/translate/batch", {
          segments: chunk,
          source_lang: detectedLang === "auto" ? "en" : detectedLang,
          target_lang: targetLang,
          batch_size: 10,
          apiKeys: job.apiKeys ?? {},
        });
        if (Array.isArray(trans.segments)) {
          for (let j = 0; j < trans.segments.length; j += 1) {
            merged[i + j] = trans.segments[j];
          }
        }
        touch({
          progress: 35 + Math.round(((i + CHUNK) / Math.max(merged.length, 1)) * 60),
          message: `翻译中 ${Math.min(i + CHUNK, merged.length)}/${merged.length}`,
        });
      }
    }

    resultsByKey.set(job.key, {
      key: job.key,
      url: job.url,
      language: detectedLang,
      targetLang,
      provider: asr.provider,
      segments: merged,
      createdAt: now(),
    });

    touch({
      status: "done",
      progress: 100,
      step: "done",
      message: "预处理完成",
    });
  } catch (err: any) {
    touch({
      status: "failed",
      step: "failed",
      progress: Math.max(job.progress, 1),
      message: "预处理失败",
      error: err?.message ?? "unknown error",
    });
  }
}

async function processQueue() {
  while (running < JOB_CONCURRENCY && queue.length > 0) {
    const key = queue.shift()!;
    const job = jobsByKey.get(key);
    if (!job || job.status !== "queued") continue;
    running += 1;
    runJob(job)
      .catch(() => {})
      .finally(() => {
        running -= 1;
        processQueue().catch(() => {});
      });
  }
}

setInterval(() => {
  const t = now();
  for (const [key, result] of resultsByKey) {
    if (t - result.createdAt > RESULT_TTL_MS) {
      resultsByKey.delete(key);
    }
  }
  for (const [key, job] of jobsByKey) {
    if (t - job.updatedAt > JOB_TTL_MS) {
      jobsByKey.delete(key);
    }
  }
}, 5 * 60 * 1000);

jobsRoutes.post("/enqueue", async (c) => {
  const body = await c.req.json<{
    url?: string;
    sourceLang?: string;
    targetLang?: string;
    apiKeys?: any;
    force?: boolean;
  }>();

  const url = normalizedUrl(String(body.url ?? ""));
  if (!url) return c.json({ ok: false, error: "Invalid url" }, 400);

  const sourceLang = String(body.sourceLang ?? "auto");
  const targetLang = String(body.targetLang ?? "auto");
  const key = jobKey(url, targetLang);
  const existing = jobsByKey.get(key);

  if (existing && !body.force) {
    return c.json({
      ok: true,
      deduped: true,
      key,
      job: summarize(existing),
      hasResult: resultsByKey.has(key),
    });
  }

  const record: JobRecord = {
    id: `j_${hashString(`${url}:${now()}`)}`,
    key,
    url,
    sourceLang,
    targetLang,
    status: "queued",
    progress: 0,
    step: "queued",
    message: "等待处理",
    createdAt: now(),
    updatedAt: now(),
    apiKeys: body.apiKeys ?? {},
  };
  jobsByKey.set(key, record);
  queue.push(key);
  processQueue().catch(() => {});

  return c.json({
    ok: true,
    key,
    job: summarize(record),
  });
});

jobsRoutes.get("/status", (c) => {
  const rawUrl = String(c.req.query("url") ?? "");
  const targetLang = String(c.req.query("targetLang") ?? "auto");
  const url = normalizedUrl(rawUrl);
  if (!url) return c.json({ ok: false, error: "Invalid url" }, 400);

  const key = jobKey(url, targetLang);
  const job = jobsByKey.get(key);
  if (!job) {
    return c.json({ ok: true, key, status: "not_found" });
  }
  return c.json({
    ok: true,
    key,
    status: job.status,
    progress: job.progress,
    step: job.step,
    message: job.message,
    error: job.error,
    updatedAt: job.updatedAt,
    hasResult: resultsByKey.has(key),
  });
});

jobsRoutes.get("/result", (c) => {
  const rawUrl = String(c.req.query("url") ?? "");
  const targetLang = String(c.req.query("targetLang") ?? "auto");
  const url = normalizedUrl(rawUrl);
  if (!url) return c.json({ ok: false, error: "Invalid url" }, 400);

  const key = jobKey(url, targetLang);
  const job = jobsByKey.get(key);
  const result = resultsByKey.get(key);
  if (result) {
    return c.json({
      ok: true,
      key,
      status: "done",
      result,
      job: job ? summarize(job) : undefined,
    });
  }
  if (!job) return c.json({ ok: true, key, status: "not_found" });
  return c.json({
    ok: true,
    key,
    status: job.status,
    progress: job.progress,
    step: job.step,
    message: job.message,
    error: job.error,
    job: summarize(job),
  });
});

jobsRoutes.post("/status-batch", async (c) => {
  const body = await c.req.json<{ urls?: string[]; targetLang?: string }>();
  const targetLang = String(body.targetLang ?? "auto");
  const urls = Array.isArray(body.urls) ? body.urls : [];

  const statuses = urls.map((u) => {
    const url = normalizedUrl(String(u));
    if (!url) return { url: u, status: "invalid" };
    const key = jobKey(url, targetLang);
    const job = jobsByKey.get(key);
    if (!job) return { url, key, status: "not_found" };
    return {
      url,
      key,
      status: job.status,
      progress: job.progress,
      step: job.step,
      message: job.message,
      error: job.error,
      hasResult: resultsByKey.has(key),
      updatedAt: job.updatedAt,
    };
  });

  return c.json({ ok: true, statuses });
});

jobsRoutes.post("/clear", async (c) => {
  const body = await c.req.json<{ scope?: "all" | "queue-only" }>().catch(() => ({} as { scope?: "all" | "queue-only" }));
  const scope = body.scope || "all";

  const removedJobs = jobsByKey.size;
  const removedResults = resultsByKey.size;
  const removedQueued = queue.length;

  queue.splice(0, queue.length);

  if (scope === "all") {
    jobsByKey.clear();
    resultsByKey.clear();
  } else {
    for (const [key, job] of jobsByKey) {
      if (job.status === "queued") jobsByKey.delete(key);
    }
  }

  return c.json({
    ok: true,
    scope,
    removedJobs,
    removedResults,
    removedQueued,
    running,
    message: running > 0
      ? "Cleared cache/queue. Running jobs may still finish and create new results."
      : "Cleared cache/queue.",
  });
});
