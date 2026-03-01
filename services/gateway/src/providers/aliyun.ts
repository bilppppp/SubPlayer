/**
 * Alibaba Cloud (阿里云百炼) Fun-ASR provider.
 *
 * Uses the DashScope Fun-ASR RESTful API for recorded file recognition.
 * Docs: https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-restful-api
 *
 * Flow:
 *   1. Upload audio to a temp public URL (or use OSS)
 *   2. POST submit task → get task_id
 *   3. Poll GET /tasks/{task_id} until SUCCEEDED
 *   4. Fetch transcription_url → parse sentences
 *
 * NOTE: Aliyun requires files as public URLs. For MVP, this provider
 *       expects the caller to provide a publicly accessible URL, or
 *       the gateway to have a file-serving endpoint.
 */
import type { ASRProvider, TranscribeOptions, TranscribeResult, Segment } from "./types.js";
import { config } from "../config.js";

const SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks";

export class AliyunProvider implements ASRProvider {
  readonly name = "aliyun";

  private get apiKey() { return config.aliyunDashscopeKey; }

  async transcribe(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult> {
    const activeKey = options.apiKeys?.aliyunKey || this.apiKey;
    if (!activeKey) {
      return this.fail("ALIYUN_DASHSCOPE_KEY not configured");
    }

    try {
      // For Aliyun, we need a public URL. If audioPath is a local file,
      // we use the gateway's temp file server at /api/files/:id
      const fileUrl = await this.ensurePublicUrl(audioPath);

      // 1. Submit task
      const taskId = await this.submitTask(fileUrl, options, activeKey);
      if (!taskId) return this.fail("Failed to submit Aliyun ASR task");

      // 2. Poll for result
      const result = await this.waitForResult(taskId, activeKey);
      if (!result) return this.fail("Aliyun ASR task timed out or failed");

      return result;
    } catch (err: any) {
      return this.fail(err.message);
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  // ── internal ────────────────────────────────────────────────────

  private async ensurePublicUrl(audioPath: string): Promise<string> {
    // If already a URL, return as-is
    if (audioPath.startsWith("http://") || audioPath.startsWith("https://")) {
      return audioPath;
    }

    // For local files, the gateway must expose them temporarily.
    // This is handled by the asr route which sets up a temp file server.
    // For now, throw an error if no public URL is available.
    throw new Error(
      "Aliyun STT requires a public audio URL. " +
      "Configure ALIYUN_FILE_BASE_URL or upload to OSS first."
    );
  }

  private async submitTask(fileUrl: string, options: TranscribeOptions, activeKey: string): Promise<string | null> {
    const languageHints = options.language === "auto" ? ["zh", "en"] : [options.language];

    const res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "fun-asr",
        input: { file_urls: [fileUrl] },
        parameters: {
          language_hints: languageHints,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Aliyun submit error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as any;
    return data?.output?.task_id ?? null;
  }

  private async waitForResult(taskId: string, activeKey: string, timeoutMs = 300_000): Promise<TranscribeResult | null> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${TASK_URL}/${taskId}`, {
        headers: { "Authorization": `Bearer ${activeKey}` },
      });

      if (!res.ok) {
        await Bun.sleep(2000);
        continue;
      }

      const data = (await res.json()) as any;
      const status = data?.output?.task_status;

      if (status === "SUCCEEDED") {
        return this.parseTaskResult(data);
      } else if (status === "FAILED") {
        const errMsg = data?.output?.message || "Task failed";
        return this.fail(errMsg);
      }

      // PENDING or RUNNING — wait and retry
      await Bun.sleep(2000);
    }

    return null; // timeout
  }

  private async parseTaskResult(data: any): Promise<TranscribeResult> {
    const results = data?.output?.results ?? [];
    const allSegments: Segment[] = [];

    for (const r of results) {
      if (r.subtask_status !== "SUCCEEDED" || !r.transcription_url) continue;

      // Fetch the transcription JSON
      const transRes = await fetch(r.transcription_url);
      if (!transRes.ok) continue;

      const transData = (await transRes.json()) as any;
      const transcripts = transData?.transcripts ?? [];

      for (const t of transcripts) {
        const sentences = t?.sentences ?? [];
        for (const s of sentences) {
          allSegments.push({
            start: (s.begin_time ?? 0) / 1000,
            end: (s.end_time ?? 0) / 1000,
            text: s.text ?? "",
          });
        }
      }
    }

    return {
      ok: true,
      language: "",
      segments: allSegments,
      full_text: allSegments.map((s) => s.text).join(" "),
      provider: this.name,
    };
  }

  private fail(error: string): TranscribeResult {
    return { ok: false, language: "", segments: [], full_text: "", provider: this.name, error };
  }
}
