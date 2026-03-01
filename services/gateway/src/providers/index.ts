/**
 * Provider factory — returns the active ASR provider based on config.
 *
 * Supports fallback: if the primary provider fails, try the next one.
 */
import type { ASRProvider, TranscribeOptions, TranscribeResult } from "./types.js";
import { FunASRProvider } from "./funasr.js";
import { VolcengineProvider } from "./volcengine.js";
import { AliyunProvider } from "./aliyun.js";
import { config } from "../config.js";

export type { ASRProvider, TranscribeOptions, TranscribeResult, Segment } from "./types.js";

// ── singleton instances ─────────────────────────────────────────────
const providers: Record<string, ASRProvider> = {
  local: new FunASRProvider(),
  volcengine: new VolcengineProvider(),
  aliyun: new AliyunProvider(),
};

/** Get the primary provider as configured in .env ASR_PROVIDER */
export function getProvider(): ASRProvider {
  const name = config.asrProvider;
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown ASR_PROVIDER "${name}". Valid values: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

/** Get a specific provider by name */
export function getProviderByName(name: string): ASRProvider | undefined {
  return providers[name];
}

/** List all registered providers */
export function listProviders(): { name: string; configured: boolean }[] {
  return Object.entries(providers).map(([key, p]) => ({
    name: key,
    configured: key === "local" ? true : isConfigured(key),
  }));
}

/**
 * Transcribe with fallback support.
 * Tries providers in order: primary → fallback chain.
 */
export async function transcribeWithFallback(
  audioPath: string,
  options: TranscribeOptions,
  providerOrder?: string[],
): Promise<TranscribeResult> {
  const order = providerOrder ?? config.asrFallbackChain;

  for (const name of order) {
    const provider = providers[name];
    if (!provider) continue;

    try {
      const result = await provider.transcribe(audioPath, options);
      if (result.ok) return result;
      console.warn(`[ASR] Provider ${name} failed: ${result.error}`);
    } catch (err: any) {
      console.warn(`[ASR] Provider ${name} threw: ${err.message}`);
    }
  }

  return {
    ok: false,
    language: options.language,
    segments: [],
    full_text: "",
    provider: "none",
    error: `All providers failed: ${order.join(" → ")}`,
  };
}

// ── helpers ─────────────────────────────────────────────────────────

function isConfigured(name: string): boolean {
  switch (name) {
    case "volcengine":
      return !!(config.volcengineAppId && config.volcengineAccessToken);
    case "aliyun":
      return !!config.aliyunDashscopeKey;
    default:
      return false;
  }
}
