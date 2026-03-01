import { Hono } from "hono";
import { config } from "../config.js";

export const translateRoutes = new Hono();

interface Segment {
  start: number;
  end: number;
  text: string;
  translation?: string;
}

// Old ResegmentConfig removed since we use ResegmentOptions on line 236

// ═══════════════════════════════════════════════════════════════════════
//  Gemini Translation Engine
// ═══════════════════════════════════════════════════════════════════════

async function translateWithGemini(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  customKey?: string,
  maxRetries = 3,
): Promise<string[]> {
  const activeKey = customKey || config.geminiApiKey;
  if (!activeKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const prompt = buildTranslationPrompt(texts, sourceLang, targetLang);
  const model = config.geminiModel; // e.g. "gemini-2.0-flash-lite"

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
      },
    );

    // Retry on 429 (rate limit) or 500/503 (transient server error)
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = parseRetryDelay(res) ?? (2 ** attempt) * 5;
      console.warn(
        `[Translate] Gemini ${res.status} — retrying in ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`,
      );
      await Bun.sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API error (${model}): ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as any;
    const output =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return parseTranslationOutput(output, texts.length);
  }

  throw new Error(`Gemini API: max retries exceeded for model ${model}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  DeepSeek Official Translation Engine (OpenAI-compatible)
// ═══════════════════════════════════════════════════════════════════════

async function translateWithDeepSeek(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  customKey?: string,
  maxRetries = 2,
): Promise<string[]> {
  const activeKey = customKey || config.deepseekApiKey;
  if (!activeKey) {
    throw new Error("DEEPSEEK_API_KEY (Official) not configured");
  }

  const prompt = buildTranslationPrompt(texts, sourceLang, targetLang);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a professional subtitle translator. Return ONLY the translations, one per line, matching the input line count exactly. No numbering, no explanations.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = (2 ** attempt) * 3;
      console.warn(`[Translate] DeepSeek ${res.status} — retrying in ${retryAfter}s`);
      await Bun.sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`DeepSeek API error: ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as any;
    const output = data?.choices?.[0]?.message?.content?.trim() ?? "";
    return parseTranslationOutput(output, texts.length);
  }
  throw new Error("DeepSeek API: max retries exceeded");
}

// ═══════════════════════════════════════════════════════════════════════
//  Aliyun Qwen Translation Engine (Dashscope)
// ═══════════════════════════════════════════════════════════════════════

async function translateWithQwen(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  customKey?: string,
  maxRetries = 2,
): Promise<string[]> {
  const activeKey = customKey || config.aliyunDashscopeKey;
  if (!activeKey) {
    throw new Error("Aliyun Dashscope key not configured for Qwen");
  }

  const prompt = buildTranslationPrompt(texts, sourceLang, targetLang);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        model: "qwen-max", // or qwen-plus
        messages: [
          {
            role: "system",
            content: "You are a professional subtitle translator. Return ONLY the translations, one per line, matching the input line count exactly. No numbering, no explanations.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = (2 ** attempt) * 3;
      console.warn(`[Translate] Qwen ${res.status} — retrying in ${retryAfter}s`);
      await Bun.sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Qwen API error: ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as any;
    const output = data?.choices?.[0]?.message?.content?.trim() ?? "";
    return parseTranslationOutput(output, texts.length);
  }
  throw new Error("Qwen API: max retries exceeded");
}

// ═══════════════════════════════════════════════════════════════════════
//  Unified Translation — auto fallback: Gemini → DeepSeek
// ═══════════════════════════════════════════════════════════════════════

async function translate(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKeys: any = {},
): Promise<{ translations: string[]; provider: string }> {
  const provider = apiKeys.translateProvider || config.translateProvider || "auto";

  if (provider === "gemini") {
    return {
      translations: await translateWithGemini(texts, sourceLang, targetLang, apiKeys.geminiKey, 3),
      provider: `gemini/${config.geminiModel}`,
    };
  }

  if (provider === "deepseek") {
    return {
      translations: await translateWithDeepSeek(texts, sourceLang, targetLang, apiKeys.deepseekKey, 2),
      provider: "deepseek/official",
    };
  }

  if (provider === "qwen") {
    return {
      translations: await translateWithQwen(texts, sourceLang, targetLang, apiKeys.aliyunKey, 2),
      provider: "aliyun/qwen-max",
    };
  }

  // ── auto mode: try Gemini first, fallback to Qwen ─────────
  if (config.geminiApiKey || apiKeys.geminiKey) {
    try {
      const translations = await translateWithGemini(texts, sourceLang, targetLang, apiKeys.geminiKey, 3);
      return { translations, provider: `gemini/${config.geminiModel}` };
    } catch (err: any) {
      console.warn(`[Translate] Gemini failed, falling back to Qwen: ${err.message}`);
    }
  }

  if (config.aliyunDashscopeKey || apiKeys.aliyunKey) {
    try {
      const translations = await translateWithQwen(texts, sourceLang, targetLang, apiKeys.aliyunKey, 2);
      return { translations, provider: "aliyun/qwen-max" };
    } catch (err: any) {
      console.error(`[Translate] Qwen also failed: ${err.message}`);
      throw new Error(
        `All translation providers failed. Gemini → Qwen both errored. Last: ${err.message}`,
      );
    }
  }

  throw new Error(
    "No translation API key configured. Provide Gemini, DeepSeek, or Aliyun Qwen keys via settings",
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function buildTranslationPrompt(
  texts: string[],
  sourceLang: string,
  targetLang: string,
): string {
  return `You are a strict subtitle translator machine. Translate the following ${sourceLang} subtitles into ${targetLang}. 
CRITICAL RULES:
1. Return EXACTLY ${texts.length} lines of translation.
2. Each translated line MUST correspond mathematically 1:1 to the input line.
3. ABSOLUTELY NO internal line breaks, carriage returns, or \n within a translation.
4. Do NOT add numbering, explanations, or quotes. Output ONLY raw translated text.

${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
}

function parseTranslationOutput(output: string, expectedCount: number): string[] {
  // 1. Split raw lines
  let lines = output.split("\n").map(l => l.trim()).filter(Boolean);

  // 2. Remove any numbering prefixes like "1. ", "02) ", etc
  lines = lines.map(l => l.replace(/^\d+[\.\)\]]\s*/, ""));

  // 3. Fallback: If model hallucinated internal newlines and we have too many lines, 
  // try to squish them linearly based on closest character boundaries or just truncate.
  // The prompt usually prevents this now, but just in case.
  if (lines.length > expectedCount) {
    console.warn(`[Translate] Strip: expected ${expectedCount} lines, got ${lines.length}. Force truncating.`);
    // We take just the first N lines. (A smarter squish would require semantic alignment, 
    // but truncation strictly honors the 1:1 mapping length requirement to prevent cascade failure).
    lines = lines.slice(0, expectedCount);
  }

  // 4. Pad if too few lines
  while (lines.length < expectedCount) {
    lines.push("");
  }

  return lines;
}

export interface ReadableBlock {
  startSegmentIndex: number;
  endSegmentIndex: number;
  start: number;
  end: number;
  text: string;
  translation?: string;
}

export interface ResegmentOptions {
  maxCharsPerLine: number;
  maxLines: number;
  overflowTolerance: number;
  minDurationSec: number;
  maxDurationSec: number;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function joinSubtitleText(a: string, b: string): string {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left) return right;
  if (!right) return left;

  const cjk = /[\u3400-\u9fff]/;
  const leftEndsCjk = cjk.test(left[left.length - 1] ?? "");
  const rightStartsCjk = cjk.test(right[0] ?? "");

  if (leftEndsCjk || rightStartsCjk) {
    if (/^[，。！？；：,.!?;:)]/.test(right)) return `${left}${right}`;
    return `${left}${right}`;
  }

  if (/^[,.;:!?，。！？；：)\]}]/.test(right)) return `${left}${right}`;
  if (/[([{\-\u2014]$/.test(left)) return `${left}${right}`;
  return `${left} ${right}`;
}

export function generateReadableBlocks(
  segments: Segment[],
  targetLang: string,
  options: ResegmentOptions
): ReadableBlock[] {
  if (segments.length === 0) return [];

  const targetChars = options.maxCharsPerLine * options.maxLines;
  const hardMaxChars = targetChars * (1 + options.overflowTolerance);

  const blocks: ReadableBlock[] = [];
  let currentBlockSegments: Segment[] = [];
  let currentStartIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];

    currentBlockSegments.push(seg);

    const startObj = currentBlockSegments[0];
    const endObj = currentBlockSegments[currentBlockSegments.length - 1];
    const duration = endObj.end - startObj.start;

    const combinedText = currentBlockSegments.reduce((acc, s) => joinSubtitleText(acc, s.text), "");
    const combinedTrans = currentBlockSegments.reduce((acc, s) => joinSubtitleText(acc, s.translation || ""), "");

    const anchorText = combinedTrans || combinedText;
    const charCount = normalizeText(anchorText).replace(/\s+/g, "").length;

    const canCloseShortly = duration >= options.minDurationSec;
    const forceClose = duration >= options.maxDurationSec || charCount >= hardMaxChars;

    const isStrongEnd = /[.!?。！？]["')\]}\u201d\u2019]*\s*$/.test(normalizeText(anchorText));
    const isSoftEnd = /[,;:，；：]["')\]}\u201d\u2019]*\s*$/.test(normalizeText(anchorText));

    let isContin = false;
    if (nextSeg) {
      const t = normalizeText(nextSeg.translation || nextSeg.text).toLowerCase();
      if (targetLang.startsWith("zh")) {
        isContin = /^(而|而且|并且|并|但|但是|不过|然后|所以|因此|同时|以及|还有|因为|如果|虽然|并不|而是)/.test(t);
      } else {
        isContin = /^(and|but|or|so|because|that|which|who|whose|when|while|then|also|to|of|for|with)\b/.test(t);
      }
    }

    const closeBySentence = canCloseShortly && isStrongEnd && !isContin;
    const closeBySoftBoundary = canCloseShortly && duration >= (options.maxDurationSec * 0.7) && isSoftEnd && charCount > targetChars * 0.5;

    if (closeBySentence || closeBySoftBoundary || forceClose || i === segments.length - 1) {
      blocks.push({
        startSegmentIndex: currentStartIndex,
        endSegmentIndex: i,
        start: startObj.start,
        end: endObj.end,
        text: combinedText,
        translation: combinedTrans
      });
      currentBlockSegments = [];
      currentStartIndex = i + 1;
    }
  }

  return mergeShortReadableBlocks(blocks, options);
}

function mergeShortReadableBlocks(blocks: ReadableBlock[], options: ResegmentOptions): ReadableBlock[] {
  if (blocks.length <= 1) return blocks;

  const out = [...blocks];
  let i = 0;
  while (i < out.length) {
    const block = out[i];
    const duration = block.end - block.start;

    if (duration < options.minDurationSec && out.length > 1) {
      if (i < out.length - 1) {
        const next = out[i + 1];
        out.splice(i, 2, {
          startSegmentIndex: block.startSegmentIndex,
          endSegmentIndex: next.endSegmentIndex,
          start: block.start,
          end: next.end,
          text: joinSubtitleText(block.text, next.text),
          translation: joinSubtitleText(block.translation || "", next.translation || "")
        });
        continue;
      } else if (i > 0) {
        const prev = out[i - 1];
        out.splice(i - 1, 2, {
          startSegmentIndex: prev.startSegmentIndex,
          endSegmentIndex: block.endSegmentIndex,
          start: prev.start,
          end: block.end,
          text: joinSubtitleText(prev.text, block.text),
          translation: joinSubtitleText(prev.translation || "", block.translation || "")
        });
        i = Math.max(0, i - 1);
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Extract retry delay in seconds from a 429 response */
function parseRetryDelay(res: Response): number | null {
  try {
    const header = res.headers.get("retry-after");
    if (header) return Math.ceil(parseFloat(header));
  } catch { }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Routes
// ═══════════════════════════════════════════════════════════════════════

// ── POST /api/translate ─────────────────────────────────────────────
translateRoutes.post("/", async (c) => {
  const {
    segments,
    source_lang = "en",
    target_lang = "zh",
  } = await c.req.json<{
    segments: Segment[];
    source_lang?: string;
    target_lang?: string;
  }>();

  if (!segments?.length) {
    return c.json({ ok: false, error: "No segments provided" }, 400);
  }

  try {
    const texts = segments.map((s) => s.text);
    const { translations, provider } = await translate(texts, source_lang, target_lang);

    const translated = segments.map((s, i) => ({
      ...s,
      translation: translations[i] ?? "",
    }));

    const isZh = target_lang.toLowerCase().startsWith("zh");
    const options: ResegmentOptions = {
      maxCharsPerLine: isZh ? 22 : 42,
      maxLines: 2,
      overflowTolerance: 0.15,
      minDurationSec: 1.2,
      maxDurationSec: 4.5
    };

    const readableBlocks = generateReadableBlocks(translated, target_lang.toLowerCase(), options);
    return c.json({ ok: true, segments: translated, readableBlocks, provider });
  } catch (err: any) {
    console.error("Translate error:", err);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ── POST /api/translate/batch — batch translate ─────────────────────
translateRoutes.post("/batch", async (c) => {
  const {
    segments,
    source_lang = "en",
    target_lang = "zh",
    batch_size = 50,
    apiKeys = {},
  } = await c.req.json<{
    segments: Segment[];
    source_lang?: string;
    target_lang?: string;
    batch_size?: number;
    apiKeys?: any;
  }>();

  if (!segments?.length) {
    return c.json({ ok: false, error: "No segments provided" }, 400);
  }

  try {
    const translated: Segment[] = [];
    let usedProvider = "";
    const totalBatches = Math.ceil(segments.length / batch_size);

    for (let i = 0; i < segments.length; i += batch_size) {
      const batchIdx = Math.floor(i / batch_size) + 1;
      const batch = segments.slice(i, i + batch_size);
      const texts = batch.map((s) => s.text);

      // ── Per-batch retry (up to 2 retries for transient failures) ──
      let translations: string[] = [];
      let success = false;
      let lastErr: Error | null = null;

      for (let retry = 0; retry < 3; retry++) {
        try {
          const result = await translate(texts, source_lang, target_lang, apiKeys);
          translations = result.translations;
          usedProvider = result.provider;
          success = true;
          break;
        } catch (err: any) {
          lastErr = err;
          console.warn(
            `[Translate] Batch ${batchIdx}/${totalBatches} failed (attempt ${retry + 1}/3): ${err.message}`,
          );
          if (retry < 2) await Bun.sleep(3000 * (retry + 1)); // 3s, 6s backoff
        }
      }

      if (!success) {
        // If all retries failed, fill with empty strings and continue
        console.error(
          `[Translate] Batch ${batchIdx}/${totalBatches} permanently failed: ${lastErr?.message}`,
        );
        batch.forEach((s) => translated.push({ ...s, translation: "" }));
      } else {
        batch.forEach((s, j) => {
          translated.push({ ...s, translation: translations[j] ?? "" });
        });
      }

      // ── Inter-batch delay to avoid RPM limits ─────────────────────
      if (i + batch_size < segments.length) {
        await Bun.sleep(1500); // 1.5s pause between batches
      }
    }

    const isZh = target_lang.toLowerCase().startsWith("zh");
    const options: ResegmentOptions = {
      maxCharsPerLine: isZh ? 22 : 42,
      maxLines: 2,
      overflowTolerance: 0.15,
      minDurationSec: 1.2,
      maxDurationSec: 4.5
    };

    const readableBlocks = generateReadableBlocks(translated, target_lang.toLowerCase(), options);

    console.log(
      `[Translate] Completed ${totalBatches} batches, ${translated.filter((s) => s.translation).length}/${segments.length} translated`,
    );

    return c.json({ ok: true, segments: translated, readableBlocks, provider: usedProvider });
  } catch (err: any) {
    console.error("Batch translate error:", err);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ── GET /api/translate/providers — list available providers ─────────
translateRoutes.get("/providers", (c) => {
  const providers: Array<{ name: string; available: boolean; model?: string }> = [
    {
      name: "gemini",
      available: !!config.geminiApiKey,
      model: config.geminiModel,
    },
    {
      name: "deepseek",
      available: !!config.deepseekApiKey,
    },
  ];

  return c.json({
    current: config.translateProvider,
    providers,
  });
});
