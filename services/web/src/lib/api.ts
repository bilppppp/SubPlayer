import type { TranscribeResult, TranslateResult, Segment } from "@/types";

const API_BASE = "/api";

// ── ASR ─────────────────────────────────────────────────────────────

export async function transcribeFile(
  file: File,
  language = "auto",
  model = "multilingual",
  onProgress?: (pct: number) => void,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  form.append("model", model);

  // Use XMLHttpRequest for upload progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/asr/transcribe`);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText) as TranscribeResult;
        resolve(data);
      } catch {
        reject(new Error("Invalid response from server"));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Request aborted")));

    xhr.send(form);
  });
}

export async function transcribeUrl(
  url: string,
  language = "auto",
  model = "multilingual",
): Promise<TranscribeResult> {
  const res = await fetch(`${API_BASE}/asr/transcribe-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, language, model }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Translation ─────────────────────────────────────────────────────

export async function translateSegments(
  segments: Segment[],
  sourceLang = "en",
  targetLang = "zh",
): Promise<TranslateResult> {
  const res = await fetch(`${API_BASE}/translate/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      segments,
      source_lang: sourceLang,
      target_lang: targetLang,
      batch_size: 20,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Translation error: ${res.status} ${text}`);
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
