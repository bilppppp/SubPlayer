/**
 * Volcengine (火山引擎) STT provider.
 *
 * Uses the "大模型录音文件识别极速版" REST API.
 * Docs: https://www.volcengine.com/docs/6561/1631584
 *
 * Auth: Bearer token via API Key generated in 火山引擎控制台.
 * The audio file must be accessible via a public URL, so this provider
 * first serves the file via a temporary HTTP endpoint or expects the
 * caller to provide a pre-uploaded URL.
 *
 * For MVP we read the file as base64 and send via the one-shot HTTP API.
 */
import type { ASRProvider, TranscribeOptions, TranscribeResult, Segment } from "./types.js";
import { config } from "../config.js";

const SUBMIT_URL = "https://openspeech.bytedance.com/api/v1/auc/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v1/auc/query";

export class VolcengineProvider implements ASRProvider {
  readonly name = "volcengine";

  private get appId() { return config.volcengineAppId; }
  private get accessToken() { return config.volcengineAccessToken; }

  async transcribe(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult> {
    const activeAppId = options.apiKeys?.volcengineAppId || this.appId;
    const activeToken = options.apiKeys?.volcengineToken || this.accessToken;

    if (!activeAppId || !activeToken) {
      return this.fail("Volcengine credentials not configured (VOLCENGINE_APP_ID / VOLCENGINE_ACCESS_TOKEN)");
    }

    try {
      // Read audio file as base64
      const fileBuffer = await Bun.file(audioPath).arrayBuffer();
      const base64Audio = Buffer.from(fileBuffer).toString("base64");

      // Submit transcription task
      const submitRes = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer; ${activeToken}`,
        },
        body: JSON.stringify({
          app: { appid: activeAppId, token: activeToken, cluster: config.volcengineCluster || "volcengine_streaming_common" },
          user: { uid: "subplayer-gateway" },
          audio: {
            format: options.format || "wav",
            rate: 16000,
            bits: 16,
            channel: 1,
            language: mapLanguage(options.language),
          },
          additions: {
            with_speaker_info: false,
          },
          audio_data: base64Audio,
        }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.text();
        return this.fail(`Volcengine submit error: ${submitRes.status} ${err}`);
      }

      const submitData = (await submitRes.json()) as any;

      if (submitData.code && submitData.code !== 0) {
        return this.fail(`Volcengine error: ${submitData.message || submitData.code}`);
      }

      // Parse result — the response format depends on the specific API version
      const segments = parseVolcengineResult(submitData);

      return {
        ok: true,
        language: options.language,
        segments,
        full_text: segments.map((s) => s.text).join(" "),
        provider: this.name,
      };
    } catch (err: any) {
      return this.fail(err.message);
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.appId && this.accessToken);
  }

  private fail(error: string): TranscribeResult {
    return { ok: false, language: "", segments: [], full_text: "", provider: this.name, error };
  }
}

// ── helpers ─────────────────────────────────────────────────────────

function mapLanguage(lang: string): string {
  const map: Record<string, string> = {
    zh: "zh-CN",
    en: "en-US",
    ja: "ja-JP",
    ko: "ko-KR",
    auto: "zh-CN",
  };
  return map[lang] ?? lang;
}

function parseVolcengineResult(data: any): Segment[] {
  const segments: Segment[] = [];

  // Handle utterances format (common in Volcengine responses)
  const utterances = data?.result?.[0]?.utterances ?? data?.utterances ?? [];
  for (const u of utterances) {
    if (u.text) {
      segments.push({
        start: (u.start_time ?? 0) / 1000,
        end: (u.end_time ?? 0) / 1000,
        text: u.text,
      });
    }
  }

  // Fallback: if no utterances, try full text
  if (segments.length === 0) {
    const text = data?.result?.[0]?.text ?? data?.text ?? "";
    if (text) {
      segments.push({ start: 0, end: 0, text });
    }
  }

  return segments;
}
