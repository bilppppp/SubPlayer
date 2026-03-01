/**
 * Local FunASR provider — calls the self-hosted FastAPI ASR service.
 * Best for development (Mac M4 / GPU server).
 */
import type { ASRProvider, TranscribeOptions, TranscribeResult } from "./types.js";
import { config } from "../config.js";

export class FunASRProvider implements ASRProvider {
  readonly name = "local-funasr";

  async transcribe(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult> {
    const url = `${config.asrHost}:${config.asrPort}/asr/offline/transcribe`;

    const form = new FormData();
    form.append("file", Bun.file(audioPath));
    form.append("language", options.language);
    form.append("model", "multilingual");

    const res = await fetch(url, { method: "POST", body: form });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        language: options.language,
        segments: [],
        full_text: "",
        provider: this.name,
        error: `FunASR service error: ${res.status} ${text}`,
      };
    }

    const data = (await res.json()) as any;
    return {
      ok: data.ok ?? true,
      language: data.language ?? options.language,
      segments: data.segments ?? [],
      full_text: data.full_text ?? "",
      provider: this.name,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${config.asrHost}:${config.asrPort}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
