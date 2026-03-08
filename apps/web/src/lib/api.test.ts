import { describe, expect, test } from "bun:test";
import { transcribeUrl } from "./api";

describe("api.transcribeUrl", () => {
  test("URL transcribe success path posts expected payload", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json({
        ok: true,
        language: "en",
        provider: "native-subtitle",
        segments: [{ start: 0, end: 1, text: "hello" }],
        full_text: "hello",
      });
    }) as typeof fetch;

    try {
      const result = await transcribeUrl("https://example.com/video", "en", "multilingual");

      expect(result.ok).toBe(true);
      expect(result.provider).toBe("native-subtitle");
      expect(result.segments.length).toBe(1);

      expect(calls.length).toBe(1);
      expect(String(calls[0].input)).toBe("/api/asr/transcribe-url");
      expect(calls[0].init?.method).toBe("POST");

      const body = JSON.parse(String(calls[0].init?.body)) as {
        url: string;
        language: string;
        model: string;
        mode: string;
      };
      expect(body.url).toBe("https://example.com/video");
      expect(body.language).toBe("en");
      expect(body.model).toBe("multilingual");
      expect(body.mode).toBe("auto");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
