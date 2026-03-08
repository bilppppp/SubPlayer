import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { translateRoutes } from "./translate";

const app = new Hono();
app.route("/api/translate", translateRoutes);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("translate /batch", () => {
  test("falls back to qwen when gemini fails in auto mode", async () => {
    const called: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      called.push(url);

      if (url.includes("generativelanguage.googleapis.com")) {
        return new Response("gemini bad request", { status: 400 });
      }

      if (url.includes("dashscope.aliyuncs.com")) {
        return Response.json({
          choices: [{ message: { content: "你好" } }],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}; method=${init?.method}`);
    }) as typeof fetch;

    const res = await app.request("http://local/api/translate/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        segments: [{ start: 0, end: 1, text: "hello" }],
        source_lang: "en",
        target_lang: "zh",
        batch_size: 10,
        apiKeys: {
          translateProvider: "auto",
          geminiKey: "test-gemini",
          aliyunKey: "test-aliyun",
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as {
      ok: boolean;
      provider: string;
      segments: Array<{ translation?: string }>;
    };

    expect(data.ok).toBe(true);
    expect(data.provider).toBe("aliyun/qwen-max");
    expect(data.segments[0]?.translation).toBe("你好");
    expect(called.some((x) => x.includes("generativelanguage.googleapis.com"))).toBe(true);
    expect(called.some((x) => x.includes("dashscope.aliyuncs.com"))).toBe(true);
  });
});
