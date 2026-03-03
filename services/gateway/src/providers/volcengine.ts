import { randomUUID } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import WebSocket from "ws";
import type { ASRProvider, Segment, TranscribeOptions, TranscribeResult } from "./types.js";
import { config } from "../config.js";

const LEGACY_SUBMIT_URL = "https://openspeech.bytedance.com/api/v1/auc/submit";
const LEGACY_QUERY_URL = "https://openspeech.bytedance.com/api/v1/auc/query";
const BIGMODEL_WS = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";
const BIGMODEL_NOSTREAM_WS = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
const BIGMODEL_ASYNC_WS = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const FLASH_RECOGNIZE_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
export const FIXED_VOLCENGINE_RESOURCE_SAUC = "volc.seedasr.sauc.duration";
export const FIXED_VOLCENGINE_RESOURCE_FLASH = "volc.bigasr.auc_turbo";
const VOLC_PACKET_BYTES = Number(process.env.VOLCENGINE_PACKET_BYTES ?? 6400); // 200ms @ 16k/16bit/mono pcm
// Packet interval tuning:
// - nostream can run faster to reduce total wall time for long audio.
// - stream/async keep a safer default.
const VOLC_PACKET_INTERVAL_MS_NOSTREAM = Number(
  process.env.VOLCENGINE_PACKET_INTERVAL_MS_NOSTREAM
  ?? process.env.VOLCENGINE_PACKET_INTERVAL_MS
  ?? 60,
);
const VOLC_PACKET_INTERVAL_MS_STREAM = Number(
  process.env.VOLCENGINE_PACKET_INTERVAL_MS_STREAM
  ?? process.env.VOLCENGINE_PACKET_INTERVAL_MS
  ?? 100,
);

type VolcCred = {
  appId: string;
  accessKey: string;
  secretKey: string;
  resourceId: string;
  mode: "bigmodel_nostream" | "bigmodel" | "bigmodel_async" | "flash" | "legacy_auc";
};

function allowAutoDowngrade(apiKeys?: TranscribeOptions["apiKeys"]): boolean {
  return Boolean(apiKeys?.allowAsrAutoDowngrade);
}

function resourceByMode(mode: VolcCred["mode"]): string {
  return mode === "flash" ? FIXED_VOLCENGINE_RESOURCE_FLASH : FIXED_VOLCENGINE_RESOURCE_SAUC;
}

export type VolcengineProbeAttempt = {
  resourceId: string;
  ok: boolean;
  logid?: string;
  error?: string;
};

export type VolcengineProbeResult = {
  ok: boolean;
  mode: string;
  attempts: VolcengineProbeAttempt[];
  chosenResourceId?: string;
  message: string;
};

export class VolcengineProvider implements ASRProvider {
  readonly name = "volcengine";

  async transcribe(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult> {
    const cred = this.resolveCred(options);
    if (!cred.appId || !cred.accessKey) {
      return this.fail("Volcengine credentials not configured (VOLCENGINE_APP_ID / VOLCENGINE_ACCESS_TOKEN)");
    }

    if (cred.mode === "flash") {
      try {
        const flashSegs = await transcribeViaFlash(audioPath, options, cred);
        if (flashSegs.length > 0) {
          return this.ok(options.language, flashSegs, "final");
        }
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if (
          allowAutoDowngrade(options.apiKeys) &&
          /resource.*not.*allowed|requested resource not granted|45000030|45000000/i.test(msg)
        ) {
          // Some accounts don't have flash resource grant; optionally fallback
          // to websocket nostream when auto-downgrade is enabled.
          console.warn(`[ASR] Volcengine flash not granted, fallback to nostream: ${msg.slice(0, 220)}`);
          try {
            const wsSegs = await transcribeViaBigModelWsWithResourceFallback(
              audioPath,
              options,
              { ...cred, mode: "bigmodel_nostream" },
            );
            if (wsSegs.segments.length > 0) return this.ok(options.language, wsSegs.segments, wsSegs.final ? "final" : "partial_complete");
          } catch (wsErr: any) {
            return this.fail(`Volcengine flash+nostream fallback failed: ${wsErr?.message || wsErr}`);
          }
        }
        return this.fail(`Volcengine flash failed: ${msg}`);
      }
    }

    // Prefer current bigmodel websocket API.
    if (cred.mode !== "legacy_auc") {
      try {
        const wsSegments = await transcribeViaBigModelWsWithResourceFallback(audioPath, options, cred);
        if (wsSegments.segments.length > 0) {
          return this.ok(options.language, wsSegments.segments, wsSegments.final ? "final" : "partial_complete");
        }
      } catch (err: any) {
        // Keep explicit error for users using new volc bigmodel service.
        // Legacy AUC often has no grant and only adds noisy 403s.
        return this.fail(`Volcengine bigmodel failed: ${err?.message || err}`);
      }
    }

    try {
      const legacy = await transcribeViaLegacyAuc(audioPath, options, cred);
      if (legacy.length > 0) {
        return this.ok(options.language, legacy, "final");
      }
      return this.fail("Volcengine returned empty result");
    } catch (err: any) {
      return this.fail(err?.message || "Volcengine transcription failed");
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!(config.volcengineAppId && config.volcengineAccessToken);
  }

  private resolveCred(options: TranscribeOptions): VolcCred {
    return resolveVolcCred(options.apiKeys);
  }

  private ok(language: string, segments: Segment[], completion: "final" | "partial_complete"): TranscribeResult {
    return {
      ok: true,
      language,
      segments,
      full_text: segments.map((s) => s.text).join(" "),
      provider: this.name,
      completion,
    };
  }

  private fail(error: string): TranscribeResult {
    return { ok: false, language: "", segments: [], full_text: "", provider: this.name, error };
  }
}

function resolveVolcCred(apiKeys?: TranscribeOptions["apiKeys"]): VolcCred {
  const mode = apiKeys?.volcengineMode || (config.volcengineMode as VolcCred["mode"]) || "bigmodel_nostream";
  return {
    appId: apiKeys?.volcengineAppId || config.volcengineAppId,
    accessKey: apiKeys?.volcengineToken || config.volcengineAccessToken,
    secretKey: apiKeys?.volcengineSecretKey || config.volcengineSecretKey || "",
    // Product decision: fixed resource by mode.
    resourceId: resourceByMode(mode),
    mode,
  };
}

export async function probeVolcengineWs(apiKeys?: TranscribeOptions["apiKeys"]): Promise<VolcengineProbeResult> {
  const cred = resolveVolcCred(apiKeys);
  if (!cred.appId || !cred.accessKey) {
    return {
      ok: false,
      mode: cred.mode,
      attempts: [],
      message: "missing volcengine appId/accessToken",
    };
  }
  if (cred.mode === "legacy_auc") {
    return {
      ok: false,
      mode: cred.mode,
      attempts: [],
      message: "legacy_auc mode has no websocket probe; switch to bigmodel_nostream/bigmodel_async",
    };
  }

  const attempts: VolcengineProbeAttempt[] = [];
  const wsUrl =
    cred.mode === "bigmodel"
      ? BIGMODEL_WS
      : cred.mode === "bigmodel_async"
        ? BIGMODEL_ASYNC_WS
        : BIGMODEL_NOSTREAM_WS;

  for (const rid of uniqueResourceIds(cred.resourceId)) {
    try {
      const logid = await probeSingleResource(wsUrl, cred, rid);
      attempts.push({ resourceId: rid, ok: true, logid });
      return {
        ok: true,
        mode: cred.mode,
        attempts,
        chosenResourceId: rid,
        message: "volcengine probe ok",
      };
    } catch (err: any) {
      attempts.push({
        resourceId: rid,
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  return {
    ok: false,
    mode: cred.mode,
    attempts,
    message: "all resource ids failed",
  };
}

export async function transcribeVolcengineLive(
  audioPath: string,
  options: TranscribeOptions,
  onPartial?: (segments: Segment[]) => void,
): Promise<{ language: string; segments: Segment[]; completion: "final" | "partial_complete" }> {
  const cred = resolveVolcCred(options.apiKeys);
  if (!cred.appId || !cred.accessKey) {
    throw new Error("Volcengine credentials not configured");
  }
  if (cred.mode === "legacy_auc" || cred.mode === "flash") {
    throw new Error(`Live streaming not available in ${cred.mode} mode`);
  }
  const result = await transcribeViaBigModelWsWithResourceFallback(audioPath, options, cred, onPartial);
  return {
    language: options.language,
    segments: result.segments,
    completion: result.final ? "final" : "partial_complete",
  };
}

async function transcribeViaFlash(
  audioPath: string,
  options: TranscribeOptions,
  cred: VolcCred,
): Promise<Segment[]> {
  const audioBytes = new Uint8Array(await Bun.file(audioPath).arrayBuffer());
  const payload = {
    user: { uid: "subplayer-gateway" },
    audio: {
      format: "wav",
      codec: "raw",
      rate: 16000,
      bits: 16,
      channel: 1,
      language: mapLanguage(options.language),
      data: Buffer.from(audioBytes).toString("base64"),
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      show_utterances: true,
      result_type: "full",
    },
  };

  const resourceCandidates = allowAutoDowngrade(options.apiKeys)
    ? uniqueFlashResourceIds(cred.resourceId)
    : [cred.resourceId];
  let lastErr: any = null;
  for (const rid of resourceCandidates) {
    const reqId = randomUUID();
    try {
      console.log(`[ASR] Volcengine flash_start resource=${rid} language=${options.language}`);
      const res = await fetch(FLASH_RECOGNIZE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-App-Key": cred.appId,
          "X-Api-Access-Key": cred.accessKey,
          "X-Api-Resource-Id": rid,
          "X-Api-Request-Id": reqId,
          "X-Api-Sequence": "-1",
          ...(cred.secretKey ? { "X-Api-Secret-Key": cred.secretKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`flash http ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = JSON.parse(text);
      const segs = parseBigModelResponse(json);
      if (segs.length > 0) {
        console.log(`[ASR] Volcengine flash_done resource=${rid} segments=${segs.length}`);
        return segs;
      }
      throw new Error("flash returned empty utterances");
    } catch (err: any) {
      lastErr = err;
      console.warn(`[ASR] Volcengine flash resource failed (${rid}): ${err?.message || err}`);
    }
  }
  throw lastErr ?? new Error("flash failed for all resource ids");
}

async function transcribeViaBigModelWs(
  audioPath: string,
  options: TranscribeOptions,
  cred: VolcCred,
  onPartial?: (segments: Segment[]) => void,
): Promise<{ segments: Segment[]; final: boolean }> {
  const t0 = Date.now();
  const effectiveMode =
    cred.mode === "bigmodel_async" && options.language !== "auto"
      ? "bigmodel_nostream"
      : cred.mode;
  if (effectiveMode !== cred.mode) {
    console.log(`[ASR] Volcengine mode overridden: ${cred.mode} -> ${effectiveMode} (language pin requires nostream)`);
  }

  const wsUrl =
    effectiveMode === "bigmodel"
      ? BIGMODEL_WS
      : effectiveMode === "bigmodel_async"
        ? BIGMODEL_ASYNC_WS
        : BIGMODEL_NOSTREAM_WS;
  console.log(`[ASR] Volcengine ws_start mode=${effectiveMode} resource=${cred.resourceId} language=${options.language}`);
  const connectId = randomUUID();
  const wav = new Uint8Array(await Bun.file(audioPath).arrayBuffer());
  const audioBytes = stripWavHeaderIfPresent(wav);
  const reqPayload = buildBigModelInitPayload(options.language);
  const estimatedAudioSec = audioBytes.byteLength / (16000 * 2); // pcm_s16le mono
  const packetIntervalMs =
    effectiveMode === "bigmodel_nostream"
      ? Math.max(0, VOLC_PACKET_INTERVAL_MS_NOSTREAM)
      : Math.max(0, VOLC_PACKET_INTERVAL_MS_STREAM);

  return new Promise<{ segments: Segment[]; final: boolean }>((resolve, reject) => {
    const outSegments: Segment[] = [];
    let sawFinal = false;
    let settled = false;
    let firstPartialAt = 0;
    let sendStartAt = 0;
    let sendDoneAt = 0;
    let partialLogCount = 0;
    let tailWaitInterval: ReturnType<typeof setInterval> | null = null;
    const ws = new WebSocket(wsUrl, {
      headers: {
        "X-Api-App-Key": cred.appId,
        "X-Api-Access-Key": cred.accessKey,
        "X-Api-Resource-Id": cred.resourceId,
        "X-Api-Connect-Id": connectId,
        ...(cred.secretKey ? { "X-Api-Secret-Key": cred.secretKey } : {}),
      },
      handshakeTimeout: 10000,
    });

    const packetBytes = Math.max(1600, VOLC_PACKET_BYTES);
    const packetCount = Math.max(1, Math.ceil(audioBytes.byteLength / packetBytes));
    const sendDurationMs = packetCount * packetIntervalMs;
    const timeoutMs = Math.max(120_000, sendDurationMs + 90_000);
    console.log(
      `[ASR] Volcengine ws_plan bytes=${audioBytes.byteLength} audio_sec=${estimatedAudioSec.toFixed(1)} packets=${packetCount} interval_ms=${packetIntervalMs} est_send_ms=${sendDurationMs} timeout_ms=${timeoutMs}`,
    );
    const finishResolve = (value: Segment[], final: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (tailWaitInterval) clearInterval(tailWaitInterval);
      try { ws.close(); } catch {}
      console.log(`[ASR] Volcengine ws_done mode=${effectiveMode} resource=${cred.resourceId} final=${sawFinal} segments=${value.length}`);
      console.log(
        `[ASR] Volcengine ws_timing total_ms=${Date.now() - t0} send_ms=${sendDoneAt && sendStartAt ? (sendDoneAt - sendStartAt) : -1} first_partial_ms=${firstPartialAt ? (firstPartialAt - t0) : -1}`,
      );
      resolve({ segments: value, final });
    };
    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (tailWaitInterval) clearInterval(tailWaitInterval);
      try { ws.close(); } catch {}
      console.warn(
        `[ASR] Volcengine ws_fail mode=${effectiveMode} resource=${cred.resourceId} elapsed_ms=${Date.now() - t0} error=${err.message}`,
      );
      reject(err);
    };
    const timer = setTimeout(() => {
      finishReject(new Error(`Volcengine bigmodel ws timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    ws.once("open", async () => {
      // 1) full client request (json + gzip)
      const full = encodeFullClientRequest(reqPayload);
      ws.send(full);
      sendStartAt = Date.now();

      // 2) send audio in 200ms chunks (recommended by docs), then send final packet.
      for (let i = 0; i < audioBytes.byteLength; i += packetBytes) {
        const chunk = audioBytes.slice(i, Math.min(i + packetBytes, audioBytes.byteLength));
        const isLast = i + packetBytes >= audioBytes.byteLength;
        const packetIdx = Math.floor(i / packetBytes) + 1;
        // Volc V1 treats full-client-request as sequence #1 internally.
        // So audio-only packets must start from sequence #2.
        const sequence = packetIdx + 1;
        ws.send(encodeAudioOnlyRequest(chunk, sequence, isLast));
        if (packetIdx === 1 || packetIdx % 200 === 0 || isLast) {
          const pct = Math.min(100, Math.round((packetIdx / packetCount) * 100));
          console.log(
            `[ASR] Volcengine ws_send packet=${packetIdx}/${packetCount} pct=${pct}% elapsed_ms=${Date.now() - sendStartAt}`,
          );
        }
        if (!isLast && packetIntervalMs > 0) {
          await Bun.sleep(packetIntervalMs);
        }
      }
      sendDoneAt = Date.now();
      const sendMs = sendDoneAt - sendStartAt;
      const sendRtf = estimatedAudioSec > 0 ? (sendMs / 1000) / estimatedAudioSec : 0;
      console.log(`[ASR] Volcengine ws_send_done elapsed_ms=${sendMs} send_rtf=${sendRtf.toFixed(3)}`);
      // Instrument the tail phase after all audio is sent.
      console.log("[ASR] Volcengine ws_tail_wait_start");
      tailWaitInterval = setInterval(() => {
        if (settled) return;
        console.log(
          `[ASR] Volcengine ws_tail_wait elapsed_ms=${Date.now() - sendDoneAt} segments=${outSegments.length} partial_updates=${partialLogCount} final=${sawFinal}`,
        );
      }, 10000);
    });

    // NOTE: bun's ws compatibility layer does not implement
    // "unexpected-response"/"upgrade" events, so we only rely on open/error.

    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const frame = parseServerFrame(raw);
        if (frame.type === "error") {
          throw new Error(`Volcengine ws error ${frame.errorCode}: ${frame.errorMessage}`);
        }
        if (frame.type !== "server") return;
        const payload = frame.payloadJson;
        const segs = parseBigModelResponse(payload);
        if (segs.length > 0) {
          if (!firstPartialAt) {
            firstPartialAt = Date.now();
            console.log(
              `[ASR] Volcengine ws_first_partial segments=${segs.length} elapsed_ms=${firstPartialAt - t0}`,
            );
          }
          // Incremental frames may carry partial sets; merge instead of replace
          // so we don't lose earlier utterances.
          mergeSegmentsInPlace(outSegments, segs);
          partialLogCount += 1;
          if (partialLogCount % 10 === 0) {
            console.log(
              `[ASR] Volcengine ws_partial_updates=${partialLogCount} merged_segments=${outSegments.length} elapsed_ms=${Date.now() - t0}`,
            );
          }
          onPartial?.([...outSegments]);
        }
        if (frame.isFinal) {
          sawFinal = true;
          console.log(
            `[ASR] Volcengine ws_final_frame sequence=${frame.sequence ?? "none"} elapsed_ms=${Date.now() - t0}`,
          );
          finishResolve(outSegments, true);
        }
      } catch (err: any) {
        finishReject(new Error(err?.message || String(err)));
      }
    });

    ws.once("error", (err: Error) => {
      finishReject(err);
    });

    ws.once("close", () => {
      if (settled) return;
      if (sawFinal) {
        finishResolve(outSegments, true);
      } else {
        console.warn(
          `[ASR] Volcengine ws_close_no_final elapsed_ms=${Date.now() - t0} segments=${outSegments.length}`,
        );
        if (outSegments.length > 0) {
          console.warn(`[ASR] Volcengine ws closed before final frame; using partial result (${outSegments.length} segments)`);
          finishResolve(outSegments, false);
        } else {
          finishReject(new Error("Volcengine ws closed before final frame"));
        }
      }
    });
  });
}

function stripWavHeaderIfPresent(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 44) return bytes;
  const tag = Buffer.from(bytes.slice(0, 4)).toString("ascii");
  if (tag !== "RIFF") return bytes;
  // Typical PCM wav header size is 44 bytes.
  return bytes.slice(44);
}

async function transcribeViaBigModelWsWithResourceFallback(
  audioPath: string,
  options: TranscribeOptions,
  cred: VolcCred,
  onPartial?: (segments: Segment[]) => void,
): Promise<{ segments: Segment[]; final: boolean }> {
  const candidates = allowAutoDowngrade(options.apiKeys)
    ? uniqueResourceIds(cred.resourceId)
    : [cred.resourceId];
  let lastErr: any = null;
  if (candidates.length === 1) {
    console.log(`[ASR] Volcengine ws_resource_locked resource=${candidates[0]} mode=${cred.mode}`);
  }
  for (const rid of candidates) {
    try {
      const segs = await transcribeViaBigModelWs(audioPath, options, { ...cred, resourceId: rid }, onPartial);
      console.log(`[ASR] Volcengine ws_selected mode=${cred.mode} resource=${rid} final=${segs.final} segments=${segs.segments.length}`);
      return segs;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[ASR] Volcengine ws resource failed (${rid}): ${err?.message || err}`);
    }
  }
  throw lastErr ?? new Error("Volcengine ws failed for all resource ids");
}

function uniqueResourceIds(primary: string): string[] {
  const all = [
    primary,
    "volc.seedasr.sauc.duration",
    "volc.bigasr.sauc.duration",
  ].map((x) => String(x || "").trim()).filter(Boolean);
  return Array.from(new Set(all));
}

function uniqueFlashResourceIds(primary: string): string[] {
  const all = [
    primary,
    "volc.bigasr.auc_turbo",
    "volc.seedasr.auc_turbo",
  ].map((x) => String(x || "").trim()).filter(Boolean);
  return Array.from(new Set(all));
}

async function probeSingleResource(wsUrl: string, cred: VolcCred, resourceId: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve, reject) => {
    const connectId = randomUUID();
    const ws = new WebSocket(wsUrl, {
      headers: {
        "X-Api-App-Key": cred.appId,
        "X-Api-Access-Key": cred.accessKey,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Connect-Id": connectId,
        ...(cred.secretKey ? { "X-Api-Secret-Key": cred.secretKey } : {}),
      },
      handshakeTimeout: 8000,
    });
    let done = false;
    let logid = "";
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      reject(new Error("probe timeout"));
    }, 15000);

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(logid || undefined);
    };

    // bun ws doesn't provide `upgrade` event headers consistently.

    ws.once("open", () => {
      // Send minimal init + one final 200ms silence packet.
      ws.send(encodeFullClientRequest(buildBigModelInitPayload("zh")));
      // Same sequence rule as main path: first audio packet should be #2.
      ws.send(encodeAudioOnlyRequest(new Uint8Array(6400), 2, true));
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const frame = parseServerFrame(raw);
        if (frame.type === "error") {
          finish(new Error(`probe ws error ${frame.errorCode}: ${frame.errorMessage}`));
          return;
        }
        // Getting any valid server frame means handshake + recognize path is alive.
        finish();
      } catch (err: any) {
        finish(new Error(err?.message || String(err)));
      }
    });

    ws.once("error", (err: Error) => finish(err));
    ws.once("close", () => {
      // If closed before any message, still treat as error.
      if (!done) finish(new Error("probe ws closed before response"));
    });
  });
}

async function transcribeViaLegacyAuc(
  audioPath: string,
  options: TranscribeOptions,
  cred: VolcCred,
): Promise<Segment[]> {
  const fileBuffer = await Bun.file(audioPath).arrayBuffer();
  const base64Audio = Buffer.from(fileBuffer).toString("base64");
  const submitRes = await fetch(LEGACY_SUBMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // legacy AUC auth style
      "Authorization": `Bearer;${cred.accessKey}`,
    },
    body: JSON.stringify({
      app: {
        appid: cred.appId,
        token: cred.accessKey,
        cluster: config.volcengineCluster || "volcengine_streaming_common",
      },
      user: { uid: "subplayer-gateway" },
      audio: {
        format: options.format || "wav",
        rate: 16000,
        bits: 16,
        channel: 1,
        language: mapLanguage(options.language),
      },
      additions: { with_speaker_info: false },
      audio_data: base64Audio,
    }),
  });
  if (!submitRes.ok) {
    throw new Error(`Volcengine submit error: ${submitRes.status} ${await submitRes.text()}`);
  }
  const submitData = (await submitRes.json()) as any;
  if (submitData.code && submitData.code !== 0) {
    throw new Error(`Volcengine submit error: ${submitData.message || submitData.code}`);
  }
  const immediate = parseVolcengineResult(submitData);
  if (immediate.length > 0) return immediate;

  const taskId = submitData.id || submitData.task_id || submitData.data?.id;
  if (!taskId) return [];

  for (let i = 0; i < 40; i += 1) {
    await Bun.sleep(500);
    const qRes = await fetch(LEGACY_QUERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer;${cred.accessKey}`,
      },
      body: JSON.stringify({
        app: {
          appid: cred.appId,
          token: cred.accessKey,
          cluster: config.volcengineCluster || "volcengine_streaming_common",
        },
        id: taskId,
      }),
    });
    if (!qRes.ok) continue;
    const qData = await qRes.json() as any;
    const segs = parseVolcengineResult(qData);
    if (segs.length > 0) return segs;
    const st = String(qData?.status ?? qData?.data?.status ?? "").toLowerCase();
    if (st.includes("failed")) break;
  }
  return [];
}

function buildBigModelInitPayload(language: string) {
  return {
    user: { uid: "subplayer-gateway" },
    audio: {
      format: "pcm",
      codec: "raw",
      rate: 16000,
      bits: 16,
      channel: 1,
      language: mapLanguage(language),
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      show_utterances: true,
      result_type: "full",
    },
  };
}

function buildHeader(messageType: number, flags: number, serialization: number, compression: number): Uint8Array {
  // byte0: protocol version (1) + header size (1 => 4 bytes)
  const b0 = (0b0001 << 4) | 0b0001;
  const b1 = ((messageType & 0x0f) << 4) | (flags & 0x0f);
  const b2 = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  const b3 = 0x00;
  return new Uint8Array([b0, b1, b2, b3]);
}

function withUint32BE(n: number): Uint8Array {
  const out = new Uint8Array(4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, n >>> 0, false);
  return out;
}

function withInt32BE(n: number): Uint8Array {
  const out = new Uint8Array(4);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, n | 0, false);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function encodeFullClientRequest(payloadObj: any): Uint8Array {
  const raw = Buffer.from(JSON.stringify(payloadObj), "utf-8");
  const gz = new Uint8Array(gzipSync(raw));
  const header = buildHeader(0b0001, 0b0000, 0b0001, 0b0001);
  return concatBytes(header, withUint32BE(gz.byteLength), gz);
}

function encodeAudioOnlyRequest(audioBytes: Uint8Array, sequence: number, isLast: boolean): Uint8Array {
  const gz = new Uint8Array(gzipSync(audioBytes));
  const seq = isLast ? -Math.max(1, sequence | 0) : Math.max(1, sequence | 0);
  const header = buildHeader(0b0010, isLast ? 0b0011 : 0b0001, 0b0000, 0b0001);
  return concatBytes(header, withInt32BE(seq), withUint32BE(gz.byteLength), gz);
}

function parseServerFrame(raw: WebSocket.RawData): {
  type: "server" | "error";
  isFinal: boolean;
  sequence?: number;
  payloadJson?: any;
  errorCode?: number;
  errorMessage?: string;
} {
  const bytes = raw instanceof Buffer ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer);
  if (bytes.byteLength < 8) {
    throw new Error("Invalid Volcengine frame: too short");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b1 = bytes[1];
  const b2 = bytes[2];
  const messageType = (b1 >> 4) & 0x0f;
  const flags = b1 & 0x0f;
  const compression = b2 & 0x0f;
  const headerSize = (bytes[0] & 0x0f) * 4;

  if (messageType === 0b1111) {
    const code = dv.getUint32(headerSize, false);
    const msgLen = dv.getUint32(headerSize + 4, false);
    const msgRaw = bytes.slice(headerSize + 8, headerSize + 8 + msgLen);
    return {
      type: "error",
      isFinal: true,
      errorCode: code,
      errorMessage: Buffer.from(msgRaw).toString("utf-8"),
    };
  }

  if (messageType !== 0b1001) {
    return { type: "server", isFinal: false, payloadJson: {} };
  }

  // server response may or may not carry sequence number, depending on flags.
  const hasSequence = flags === 0b0001 || flags === 0b0011;
  const sequence = hasSequence ? dv.getInt32(headerSize, false) : undefined;
  const payloadSizeOffset = headerSize + (hasSequence ? 4 : 0);
  const payloadSize = dv.getUint32(payloadSizeOffset, false);
  const payloadStart = payloadSizeOffset + 4;
  const payloadRaw = bytes.slice(payloadStart, payloadStart + payloadSize);
  const payload = compression === 0b0001 ? gunzipSync(payloadRaw) : payloadRaw;
  const payloadText = Buffer.from(payload).toString("utf-8").trim();
  const payloadJson = payloadText ? JSON.parse(extractJsonText(payloadText)) : {};
  const isFinalByPayload =
    payloadJson?.is_final === true
    || payloadJson?.result?.is_final === true
    || payloadJson?.result?.final === true
    || payloadJson?.final === true;
  const isFinalByFlags =
    flags === 0b0010
    || (flags === 0b0011)
    || ((sequence ?? 0) < 0);
  return {
    type: "server",
    isFinal: isFinalByPayload || isFinalByFlags,
    sequence,
    payloadJson,
  };
}

function extractJsonText(text: string): string {
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const startCandidates = [objStart, arrStart].filter((n) => n >= 0);
  const start = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
  const objEnd = text.lastIndexOf("}");
  const arrEnd = text.lastIndexOf("]");
  const end = Math.max(objEnd, arrEnd);
  if (start >= 0 && end >= start) return text.slice(start, end + 1);
  return text;
}

function parseBigModelResponse(data: any): Segment[] {
  const utterances = data?.result?.utterances ?? data?.result?.[0]?.utterances ?? data?.utterances ?? [];
  const out: Segment[] = [];
  for (const u of utterances) {
    const text = String(u?.text ?? "").trim();
    if (!text) continue;
    const start = Number(u?.start_time ?? 0) / 1000;
    const end = Number(u?.end_time ?? u?.start_time ?? 0) / 1000;
    if (end > start) {
      out.push({ start, end, text });
    }
  }
  if (out.length > 0) return dedupeSegments(out);

  const text = String(data?.result?.text ?? data?.text ?? "").trim();
  if (!text) return [];
  return [{ start: 0, end: 0, text }];
}

function dedupeSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  const seen = new Set<string>();
  for (const s of segments.sort((a, b) => a.start - b.start)) {
    const key = `${s.start.toFixed(3)}-${s.end.toFixed(3)}-${s.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function mergeSegmentsInPlace(base: Segment[], incoming: Segment[]): void {
  const map = new Map<string, Segment>();
  for (const s of base) {
    map.set(`${s.start.toFixed(3)}-${s.end.toFixed(3)}-${s.text}`, s);
  }
  for (const s of incoming) {
    map.set(`${s.start.toFixed(3)}-${s.end.toFixed(3)}-${s.text}`, s);
  }
  const merged = Array.from(map.values()).sort((a, b) => a.start - b.start);
  base.splice(0, base.length, ...merged);
}

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
  const utterances = data?.result?.[0]?.utterances ?? data?.result?.utterances ?? data?.utterances ?? [];
  for (const u of utterances) {
    const text = String(u?.text ?? "").trim();
    if (!text) continue;
    const start = Number(u?.start_time ?? 0) / 1000;
    const end = Number(u?.end_time ?? u?.start_time ?? 0) / 1000;
    if (end > start) segments.push({ start, end, text });
  }
  if (segments.length > 0) return dedupeSegments(segments);

  const text = String(data?.result?.[0]?.text ?? data?.result?.text ?? data?.text ?? "").trim();
  if (!text) return [];
  return [{ start: 0, end: 0, text }];
}
