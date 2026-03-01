import type {
  TranscribeResult,
  TranslateResult,
  Segment,
  VideoPrepareResult,
  DirectCapturePayload,
  PreprocessResultResponse,
  AsrCapabilityResponse,
} from "@/types";

const API_BASE = "/api";

function getApiKeys() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("subplayer-settings");
    if (!raw) return {};
    const state = JSON.parse(raw)?.state;
    return {
      volcengineAppId: state?.volcengineAppId,
      volcengineToken: state?.volcengineToken,
      aliyunKey: state?.aliyunKey,
      geminiKey: state?.geminiKey,
      deepseekKey: state?.deepseekKey,
      translateProvider: state?.translateProvider,
      asrProvider: state?.asrProvider,
    };
  } catch {
    return {};
  }
}

// ── ASR ─────────────────────────────────────────────────────────────

export async function transcribeFile(
  file: File,
  language = "auto",
  model = "multilingual",
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  form.append("model", model);
  form.append("apiKeys", JSON.stringify(getApiKeys()));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/asr/transcribe`);
    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        reject(new Error("Request aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText) as TranscribeResult;
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(data);
      } catch {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(new Error("Invalid response from server"));
      }
    });

    xhr.addEventListener("error", () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error("Network error"));
    });
    xhr.addEventListener("abort", () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error("Request aborted"));
    });
    xhr.send(form);
  });
}

export async function transcribeUrl(
  url: string,
  language = "auto",
  model = "multilingual",
  directCapture?: {
    mediaUrl: string;
    headers?: {
      referer?: string;
      origin?: string;
      userAgent?: string;
      cookie?: string;
    };
  },
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  // ASR can take minutes for long videos — use 5min timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const res = await fetch(`${API_BASE}/asr/transcribe-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        url,
        language,
        model,
        mode: "auto",
        apiKeys: getApiKeys(),
        mediaUrl: directCapture?.mediaUrl,
        mediaHeaders: directCapture?.headers,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Server error: ${res.status} ${text}`);
    }

    return res.json();
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    clearTimeout(timeout);
  }
}

// ── Translation ─────────────────────────────────────────────────────

export async function translateSegments(
  segments: Segment[],
  sourceLang = "en",
  targetLang = "zh",
  signal?: AbortSignal,
): Promise<TranslateResult> {
  // Translation can take a while for many segments — use 120s timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const res = await fetch(`${API_BASE}/translate/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        segments,
        source_lang: sourceLang,
        target_lang: targetLang,
        batch_size: 15,
        apiKeys: getApiKeys(),
      }),
    });

    if (!res.ok) {
      // Translation failure is non-fatal — return original segments without translations
      console.warn(`Translation failed: ${res.status}`);
      return {
        ok: false,
        segments,
        error: `翻译失败 (${res.status})`,
      } as TranslateResult;
    }

    return res.json();
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    clearTimeout(timeout);
  }
}

// ── Video Proxy ─────────────────────────────────────────────────────

export async function prepareVideo(
  url: string,
  signal?: AbortSignal,
): Promise<VideoPrepareResult> {
  const res = await fetch(`${API_BASE}/video/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `Video prepare failed: ${res.status}`, code: "VIDEO_PREPARE_HTTP_ERROR" };
    }
  }

  return res.json();
}

export async function prepareVideoDirect(
  payload: DirectCapturePayload,
  signal?: AbortSignal,
): Promise<VideoPrepareResult> {
  const res = await fetch(`${API_BASE}/video/prepare-direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `Video prepare-direct failed: ${res.status}`, code: "VIDEO_PREPARE_DIRECT_HTTP_ERROR" };
    }
  }

  return res.json();
}

// ── Health ───────────────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Preprocess Jobs ────────────────────────────────────────────────

export async function enqueuePreprocessJob(
  url: string,
  sourceLang = "auto",
  targetLang = "auto",
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/jobs/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      sourceLang,
      targetLang,
      apiKeys: getApiKeys(),
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `enqueue failed (${res.status})` };
  }
  const json = await res.json();
  return { ok: !!json?.ok, error: json?.error };
}

export async function getPreprocessResult(
  url: string,
  targetLang = "auto",
  signal?: AbortSignal,
): Promise<PreprocessResultResponse> {
  const res = await fetch(
    `${API_BASE}/jobs/result?url=${encodeURIComponent(url)}&targetLang=${encodeURIComponent(targetLang)}`,
    { signal },
  );
  if (!res.ok) {
    return { ok: false, status: "failed", error: `result failed (${res.status})` };
  }
  return res.json();
}

export async function getAsrCapability(): Promise<AsrCapabilityResponse> {
  const apiKeys = getApiKeys();
  const q = encodeURIComponent(JSON.stringify(apiKeys));
  const res = await fetch(`${API_BASE}/asr/capability?apiKeys=${q}`);
  if (!res.ok) {
    return { ok: false, error: `capability failed (${res.status})` };
  }
  return res.json();
}
