import type {
  TranscribeResult,
  TranslateResult,
  Segment,
  VideoPrepareResult,
  DirectCapturePayload,
  PreprocessResultResponse,
  AsrCapabilityResponse,
  VolcengineProbeResponse,
} from "@/types";

const API_BASE = "/api";
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 128 * 1024 * 1024;
const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

type LiveAsrMessage = {
  type?: "partial" | "done" | "error" | string;
  segments?: Segment[];
  language?: string;
  provider?: string;
  completion?: "final" | "partial_complete";
  error?: string;
};

function getGatewayApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("subplayer-settings");
    if (!raw) return "";
    const state = JSON.parse(raw)?.state;
    return typeof state?.gatewayApiKey === "string" ? state.gatewayApiKey.trim() : "";
  } catch {
    return "";
  }
}

function makeHeaders(opts?: { json?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts?.json) {
    headers["Content-Type"] = "application/json";
  }
  const gatewayApiKey = getGatewayApiKey();
  if (gatewayApiKey) {
    headers["x-api-key"] = gatewayApiKey;
  }
  return headers;
}

function getApiKeys() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("subplayer-settings");
    if (!raw) return {};
    const state = JSON.parse(raw)?.state;
    return {
      volcengineAppId: state?.volcengineAppId,
      volcengineToken: state?.volcengineToken,
      volcengineSecretKey: state?.volcengineSecretKey,
      volcengineResourceId: state?.volcengineResourceId,
      volcengineMode: state?.volcengineMode,
      aliyunKey: state?.aliyunKey,
      geminiKey: state?.geminiKey,
      deepseekKey: state?.deepseekKey,
      translateProvider: state?.translateProvider,
      asrProvider: state?.asrProvider,
      allowAsrAutoDowngrade: state?.allowAsrAutoDowngrade,
    };
  } catch {
    return {};
  }
}

function mergeApiKeys(override?: Record<string, unknown>) {
  return { ...getApiKeys(), ...(override || {}) };
}

function resolveDirectGatewayBase(): string {
  if (typeof window === "undefined") return "http://localhost:8080";
  const envGateway = (process.env.NEXT_PUBLIC_GATEWAY_URL || "").trim();
  if (envGateway) return envGateway;
  const host = window.location.hostname || "localhost";
  return `http://${host}:8080`;
}

function resolveLocalFileAsrEndpoint(fileSize: number): string {
  // Next.js dev/prod proxy has practical large-body limits for multi-GB uploads.
  // For very large local files, upload directly to gateway to avoid proxy truncation.
  const fourGb = 4 * 1024 * 1024 * 1024;
  if (fileSize >= fourGb) {
    return `${resolveDirectGatewayBase()}/api/asr/transcribe`;
  }
  return `${API_BASE}/asr/transcribe`;
}

function makeGatewayHeaders(opts?: { json?: boolean; binary?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts?.json) headers["Content-Type"] = "application/json";
  if (opts?.binary) headers["Content-Type"] = "application/octet-stream";
  const gatewayApiKey = getGatewayApiKey();
  if (gatewayApiKey) headers["x-api-key"] = gatewayApiKey;
  return headers;
}

async function parseJsonOrThrow<T>(res: Response, fallback = "Invalid response from server"): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || fallback);
  }
}

async function uploadFileForAsr(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ gatewayBase: string; uploadId: string }> {
  const gatewayBase = resolveDirectGatewayBase();
  const initRes = await fetch(`${gatewayBase}/api/asr/upload/init`, {
    method: "POST",
    headers: makeGatewayHeaders({ json: true }),
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      chunkSize: DEFAULT_UPLOAD_CHUNK_BYTES,
    }),
    signal,
  });
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => "");
    throw new Error(`上传初始化失败：${initRes.status} ${text}`);
  }
  const initData = await parseJsonOrThrow<{
    ok: boolean;
    uploadId: string;
    chunkSize: number;
    totalChunks: number;
    error?: string;
  }>(initRes, "上传初始化返回异常");
  if (!initData.ok || !initData.uploadId) {
    throw new Error(initData.error || "上传初始化失败");
  }

  const uploadId = initData.uploadId;
  try {
    const chunkSize = Math.max(1, Number(initData.chunkSize || DEFAULT_UPLOAD_CHUNK_BYTES));
    const totalChunks = Math.max(1, Number(initData.totalChunks || Math.ceil(file.size / chunkSize)));

    for (let index = 0; index < totalChunks; index += 1) {
      if (signal?.aborted) throw new Error("Request aborted");
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunkBuffer = await file.slice(start, end).arrayBuffer();

      const chunkRes = await fetch(`${gatewayBase}/api/asr/upload/${uploadId}/chunk?index=${index}`, {
        method: "PUT",
        headers: makeGatewayHeaders({ binary: true }),
        body: chunkBuffer,
        signal,
      });
      if (!chunkRes.ok) {
        const text = await chunkRes.text().catch(() => "");
        throw new Error(`分片上传失败（${index + 1}/${totalChunks}）：${chunkRes.status} ${text}`);
      }
      if (onProgress) {
        onProgress(Math.round(((index + 1) / totalChunks) * 100));
      }
    }

    const completeRes = await fetch(`${gatewayBase}/api/asr/upload/${uploadId}/complete`, {
      method: "POST",
      headers: makeGatewayHeaders({ json: true }),
      body: "{}",
      signal,
    });
    if (!completeRes.ok) {
      const text = await completeRes.text().catch(() => "");
      throw new Error(`上传完成确认失败：${completeRes.status} ${text}`);
    }
    const completeData = await parseJsonOrThrow<{ ok: boolean; error?: string }>(
      completeRes,
      "上传完成确认返回异常",
    );
    if (!completeData.ok) throw new Error(completeData.error || "上传完成确认失败");
    return { gatewayBase, uploadId };
  } catch (err) {
    fetch(`${gatewayBase}/api/asr/upload/${uploadId}`, {
      method: "DELETE",
      headers: makeGatewayHeaders({ json: true }),
    }).catch(() => {});
    throw err;
  }
}

async function transcribeFileChunked(
  file: File,
  language: string,
  model: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  const { gatewayBase, uploadId } = await uploadFileForAsr(file, onProgress, signal);
  try {
    const transcribeRes = await fetch(`${gatewayBase}/api/asr/transcribe-upload`, {
      method: "POST",
      headers: makeGatewayHeaders({ json: true }),
      body: JSON.stringify({
        uploadId,
        language,
        model,
        apiKeys: getApiKeys(),
      }),
      signal,
    });

    if (!transcribeRes.ok) {
      const text = await transcribeRes.text().catch(() => "");
      throw new Error(`Server error: ${transcribeRes.status} ${text}`);
    }
    return parseJsonOrThrow<TranscribeResult>(transcribeRes);
  } finally {
    fetch(`${gatewayBase}/api/asr/upload/${uploadId}`, {
      method: "DELETE",
      headers: makeGatewayHeaders({ json: true }),
    }).catch(() => {});
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
  if (file.size >= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
    return transcribeFileChunked(file, language, model, onProgress, signal);
  }

  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  form.append("model", model);
  form.append("apiKeys", JSON.stringify(getApiKeys()));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const endpoint = resolveLocalFileAsrEndpoint(file.size);
    xhr.open("POST", endpoint);
    const gatewayApiKey = getGatewayApiKey();
    if (gatewayApiKey) {
      xhr.setRequestHeader("x-api-key", gatewayApiKey);
    }
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
        const raw = String(xhr.responseText || "");
        if (raw.includes("Request body exceeded")) {
          reject(new Error("上传失败：文件体积超出代理限制。请确认网关服务已启动后重试。"));
          return;
        }
        reject(new Error("Invalid response from server"));
      }
    });

    xhr.addEventListener("error", () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(`上传失败：无法连接网关服务（${endpoint}）`));
    });
    xhr.addEventListener("abort", () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error("Request aborted"));
    });
    xhr.send(form);
  });
}

export async function transcribeFileLive(
  file: File,
  language = "auto",
  model = "multilingual",
  handlers?: {
    onPartial?: (payload: { segments: Segment[]; language?: string; provider?: string }) => void | Promise<void>;
    onDone?: (payload: { segments: Segment[]; language?: string; provider?: string; completion?: "final" | "partial_complete" }) => void | Promise<void>;
  },
  onUploadProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  if (file.size < CHUNKED_UPLOAD_THRESHOLD_BYTES) {
    const oneShot = await transcribeFile(file, language, model, onUploadProgress, signal);
    if (oneShot.ok) {
      await handlers?.onDone?.({
        segments: oneShot.segments || [],
        language: oneShot.language,
        provider: oneShot.provider,
        completion: oneShot.completion,
      });
    }
    return oneShot;
  }

  const { gatewayBase, uploadId } = await uploadFileForAsr(file, onUploadProgress, signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900_000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  let uploadOwnedByServer = false;
  try {
    const res = await fetch(`${gatewayBase}/api/asr/transcribe-upload-live`, {
      method: "POST",
      headers: makeGatewayHeaders({ json: true }),
      signal: controller.signal,
      body: JSON.stringify({
        uploadId,
        language,
        model,
        apiKeys: getApiKeys(),
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server error: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalResult: TranscribeResult | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) {
          const msg = JSON.parse(line) as LiveAsrMessage;
          if (msg.type === "partial") {
            await handlers?.onPartial?.({
              segments: msg.segments || [],
              language: msg.language || language,
              provider: msg.provider,
            });
          } else if (msg.type === "done") {
            uploadOwnedByServer = true;
            const payload = {
              ok: true,
              language: msg.language || language,
              provider: msg.provider,
              completion: msg.completion,
              segments: msg.segments || [],
              full_text: (msg.segments || []).map((s: Segment) => s.text).join(" "),
            } as TranscribeResult;
            finalResult = payload;
            await handlers?.onDone?.(payload);
          } else if (msg.type === "error") {
            throw new Error(msg.error || "Live ASR failed");
          }
        }
        idx = buf.indexOf("\n");
      }
    }

    if (finalResult) return finalResult;
    throw new Error("Live ASR stream ended without final result");
  } finally {
    if (!uploadOwnedByServer) {
      fetch(`${gatewayBase}/api/asr/upload/${uploadId}`, {
        method: "DELETE",
        headers: makeGatewayHeaders({ json: true }),
      }).catch(() => {});
    }
    if (signal) signal.removeEventListener("abort", onAbort);
    clearTimeout(timeout);
  }
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
  apiKeysOverride?: Record<string, unknown>,
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
      headers: makeHeaders({ json: true }),
      signal: controller.signal,
      body: JSON.stringify({
        url,
        language,
        model,
        mode: "auto",
        apiKeys: mergeApiKeys(apiKeysOverride),
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

export async function transcribeUrlLive(
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
  handlers?: {
    onPartial?: (payload: { segments: Segment[]; language?: string }) => void | Promise<void>;
    onDone?: (payload: { segments: Segment[]; language?: string; provider?: string; completion?: "final" | "partial_complete" }) => void | Promise<void>;
  },
  apiKeysOverride?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(`${API_BASE}/asr/transcribe-url-live`, {
      method: "POST",
      headers: makeHeaders({ json: true }),
      signal: controller.signal,
      body: JSON.stringify({
        url,
        language,
        model,
        mode: "auto",
        apiKeys: mergeApiKeys(apiKeysOverride),
        mediaUrl: directCapture?.mediaUrl,
        mediaHeaders: directCapture?.headers,
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server error: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalResult: TranscribeResult | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        idx = buf.indexOf("\n");
        if (!line) continue;
        let msg: LiveAsrMessage | null = null;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (parsed && typeof parsed === "object") {
            msg = parsed as LiveAsrMessage;
          }
        } catch {
          continue;
        }
        if (!msg?.type) continue;
        if (msg.type === "partial") {
          await handlers?.onPartial?.({
            segments: msg.segments || [],
            language: msg.language,
          });
        } else if (msg.type === "done") {
          const payload = {
            ok: true,
            language: msg.language || language,
            provider: msg.provider,
            completion: msg.completion,
            segments: msg.segments || [],
            full_text: (msg.segments || []).map((s: Segment) => s.text).join(" "),
          } as TranscribeResult;
          finalResult = payload;
          await handlers?.onDone?.(payload);
        } else if (msg.type === "error") {
          throw new Error(msg.error || "Live ASR failed");
        }
      }
    }

    if (finalResult) return finalResult;
    throw new Error("Live ASR stream ended without final result");
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
  timeoutMs = 120_000,
): Promise<TranslateResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(10_000, timeoutMs));
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(`${API_BASE}/translate/batch`, {
          method: "POST",
          headers: makeHeaders({ json: true }),
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
      } catch (err: any) {
        if (timedOut && err?.name === "AbortError") {
          return {
            ok: false,
            segments,
            error: "翻译请求超时（本批）",
          } as TranslateResult;
        }
        if (controller.signal.aborted || err?.name === "AbortError") {
          throw err;
        }
        lastErr = err?.message || String(err);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
          continue;
        }
      }
    }

    return {
      ok: false,
      segments,
      error: `翻译请求失败：${lastErr || "unknown"}`,
    } as TranslateResult;
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
    headers: makeHeaders({ json: true }),
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
    headers: makeHeaders({ json: true }),
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
    const res = await fetch(`${API_BASE}/health`, { headers: makeHeaders() });
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
    headers: makeHeaders({ json: true }),
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
    { signal, headers: makeHeaders() },
  );
  if (!res.ok) {
    return { ok: false, status: "failed", error: `result failed (${res.status})` };
  }
  return res.json();
}

export async function getAsrCapability(): Promise<AsrCapabilityResponse> {
  const apiKeys = getApiKeys();
  const q = encodeURIComponent(JSON.stringify(apiKeys));
  const res = await fetch(`${API_BASE}/asr/capability?apiKeys=${q}`, { headers: makeHeaders() });
  if (!res.ok) {
    return { ok: false, error: `capability failed (${res.status})` };
  }
  return res.json();
}

export async function probeVolcengine(): Promise<VolcengineProbeResponse> {
  const res = await fetch(`${API_BASE}/asr/volcengine-probe`, {
    method: "POST",
    headers: makeHeaders({ json: true }),
    body: JSON.stringify({ apiKeys: getApiKeys() }),
  });
  if (!res.ok) {
    return { ok: false, error: `probe failed (${res.status})` };
  }
  return res.json();
}
