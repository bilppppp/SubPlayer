"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Languages, ListVideo, Pause, Play, SkipBack, SkipForward, Square, Subtitles, Type } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Header } from "@/components/layout/Header";
import { FileUploadZone } from "@/components/FileUploadZone";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { SubtitlePanel } from "@/components/SubtitlePanel";
import { TaskProgress } from "@/components/TaskProgress";
import { ExportDialog } from "@/components/ExportDialog";
import { useSubtitleSync } from "@/hooks/use-subtitle-sync";
import { getPreprocessResult, transcribeFile, transcribeUrl, translateSegments, prepareVideo, prepareVideoDirect } from "@/lib/api";
import { generateReadableBlocks, type ResegmentOptions } from "@/lib/resegment";
import { useSettings } from "@/store/settings";
import type { MediaInput, Segment, ReadableBlock, SubtitleMode, TaskState } from "@/types";

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract YouTube video ID from various URL formats */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtube.com/watch?v=ID
    if (
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname === "/watch"
    ) {
      return u.searchParams.get("v");
    }
    // youtu.be/ID
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1) || null;
    }
    // youtube.com/embed/ID
    if (u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }
    // youtube.com/shorts/ID
    if (u.pathname.startsWith("/shorts/")) {
      return u.pathname.split("/")[2] || null;
    }
  } catch { }
  return null;
}



/** Check if the URL points to a directly playable video */
function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(url);
}

/** Build a stable display name for URL-submitted media */
function buildUrlInputName(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "url-video";
  }
}

function decodePlaylistParam(encoded: string | null): string[] {
  if (!encoded) return [];
  try {
    const raw = atob(encoded);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x));
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitTextByPunctuation(text: string, fallbackMaxChars = 48): string[] {
  const src = (text || "").trim();
  if (!src) return [];
  const byPunct = src
    .match(/[^。！？!?；;，,、]+[。！？!?；;，,、]?/g)
    ?.map((x) => x.trim())
    .filter(Boolean) ?? [];

  if (byPunct.length > 1) return byPunct;

  // Fallback: hard wrap long plain text.
  if (src.length <= fallbackMaxChars) return [src];
  const out: string[] = [];
  for (let i = 0; i < src.length; i += fallbackMaxChars) {
    out.push(src.slice(i, i + fallbackMaxChars));
  }
  return out.filter(Boolean);
}

function ensurePartCount(parts: string[], desiredCount: number): string[] {
  const out = parts.filter(Boolean).map((x) => x.trim()).filter(Boolean);
  if (out.length === 0) return [];
  while (out.length < desiredCount) {
    // Split the longest chunk to improve temporal granularity.
    let longestIdx = 0;
    for (let i = 1; i < out.length; i += 1) {
      if (out[i].length > out[longestIdx].length) longestIdx = i;
    }
    const src = out[longestIdx];
    if (src.length <= 8) break;
    const cut = Math.floor(src.length / 2);
    out.splice(longestIdx, 1, src.slice(0, cut).trim(), src.slice(cut).trim());
  }
  return out.filter(Boolean);
}

function splitOversizedSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const duration = Math.max(0.001, seg.end - seg.start);
    const textParts0 = splitTextByPunctuation(seg.text, 42);
    const transParts0 = seg.translation ? splitTextByPunctuation(seg.translation, 42) : [];

    const looksLong = duration >= 8 || seg.text.length >= 70 || (seg.translation?.length ?? 0) >= 70;
    if (!looksLong) {
      out.push(seg);
      continue;
    }

    const desiredByDuration = Math.max(1, Math.ceil(duration / 4.5));
    const desiredByChars = Math.max(1, Math.ceil(seg.text.length / 42), Math.ceil((seg.translation?.length ?? 0) / 42));
    const desiredParts = Math.max(desiredByDuration, desiredByChars);

    const textParts = ensurePartCount(textParts0, desiredParts);
    const transParts = transParts0.length > 0 ? ensurePartCount(transParts0, desiredParts) : [];
    const partCount = Math.max(textParts.length, transParts.length, 1);
    if (partCount <= 1) {
      out.push(seg);
      continue;
    }

    const weights = new Array(partCount).fill(1).map((_, i) => {
      const t = textParts[i] ?? textParts[textParts.length - 1] ?? "";
      const tr = transParts[i] ?? transParts[transParts.length - 1] ?? "";
      return Math.max(1, Math.max(t.length, tr.length));
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let cursor = seg.start;
    for (let i = 0; i < partCount; i += 1) {
      const ratio = weights[i] / totalWeight;
      const end = i === partCount - 1 ? seg.end : Math.min(seg.end, cursor + duration * ratio);
      const text = textParts[i] ?? textParts[textParts.length - 1] ?? seg.text;
      const translation = seg.translation
        ? (transParts[i] ?? transParts[transParts.length - 1] ?? seg.translation)
        : undefined;
      out.push({
        start: cursor,
        end,
        text: text.trim(),
        translation: translation?.trim(),
      });
      cursor = end;
    }
  }
  return out;
}

function toRawTimelineSegments(segments: Segment[]): Segment[] {
  return segments.map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));
}

function toTranslatedTexts(segments: Segment[]): string[] {
  return segments.map((s) => s.translation || "");
}

function composeAlignedSegments(raw: Segment[], translations: string[]): Segment[] {
  return raw.map((s, i) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    translation: translations[i] || undefined,
  }));
}

type PipelineCheckpoint = {
  version: 1;
  url: string;
  language: string;
  fileName: string;
  detectedLang: string;
  targetLang: string;
  segments: Segment[];
  nextTranslateIndex: number;
  updatedAt: number;
};

function hashString(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function checkpointKey(url: string): string {
  return `subplayer:checkpoint:${hashString(url)}`;
}

// ═══════════════════════════════════════════════════════════════════════

export default function AppPage() {
  const searchParams = useSearchParams();

  type CaptureCandidate = {
    mediaUrl: string;
    kind?: "hls" | "dash" | "mp4" | "unknown";
    host?: string;
    score?: number;
    headers?: { referer?: string; origin?: string; userAgent?: string; cookie?: string };
  };

  // ── state ───────────────────────────────────────────────────────
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [rawTimelineSegments, setRawTimelineSegments] = useState<Segment[]>([]);
  const [translatedTexts, setTranslatedTexts] = useState<string[]>([]);
  const [targetLang, setTargetLang] = useState<string>("zh");
  const [task, setTask] = useState<TaskState>({
    phase: "idle",
    progress: 0,
    message: "",
  });
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("bilingual");
  const [hasStarted, setHasStarted] = useState(false);
  const [captureCandidates, setCaptureCandidates] = useState<CaptureCandidate[]>([]);
  const [selectedCaptureIdx, setSelectedCaptureIdx] = useState(0);
  const [pendingInput, setPendingInput] = useState<MediaInput | null>(null);
  const [pendingLanguage, setPendingLanguage] = useState("auto");
  const [pendingTargetLang, setPendingTargetLang] = useState("auto");
  const [playlistUrls, setPlaylistUrls] = useState<string[]>([]);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [autoNext, setAutoNext] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [resumableInfo, setResumableInfo] = useState<{ next: number; total: number } | null>(null);
  const [lastCompletedPlaylistIndex, setLastCompletedPlaylistIndex] = useState<number | null>(null);
  const [lastCompletedRunMode, setLastCompletedRunMode] = useState<"manual" | "auto" | null>(null);

  const {
    useReadableBlocks,
    blockMaxCharsZh,
    blockMaxCharsEn,
    blockMaxLines,
    blockMaxDuration,
    blockMinDuration,
    blockTolerance,
  } = useSettings();

  const alignedSegments = useMemo(
    () => composeAlignedSegments(rawTimelineSegments, translatedTexts),
    [rawTimelineSegments, translatedTexts],
  );

  const setTracksFromAligned = useCallback((segments: Segment[]) => {
    setRawTimelineSegments(toRawTimelineSegments(segments));
    setTranslatedTexts(toTranslatedTexts(segments));
  }, []);

  const readableBlocks = useMemo(() => {
    if (!useReadableBlocks || alignedSegments.length === 0) return undefined;

    const isZh = targetLang.startsWith("zh");
    const options: ResegmentOptions = {
      maxCharsPerLine: isZh ? blockMaxCharsZh : blockMaxCharsEn,
      maxLines: blockMaxLines,
      overflowTolerance: blockTolerance,
      minDurationSec: blockMinDuration,
      maxDurationSec: blockMaxDuration
    };
    return generateReadableBlocks(alignedSegments, targetLang, options);
  }, [alignedSegments, useReadableBlocks, blockMaxCharsZh, blockMaxCharsEn, blockMaxLines, blockMaxDuration, blockMinDuration, blockTolerance, targetLang]);

  // ── refs ────────────────────────────────────────────────────────
  const playerRef = useRef<VideoPlayerHandle>(null);
  const currentRunIdRef = useRef(0);
  const queryInitRef = useRef(false);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(false);

  // ── subtitle sync (generic time source) ────────────────────────
  const getTime = useCallback(
    () => playerRef.current?.getCurrentTime() ?? 0,
    [],
  );
  const activeIndex = useSubtitleSync(getTime, rawTimelineSegments);
  const activeSegment = activeIndex >= 0 ? alignedSegments[activeIndex] : null;
  const hasTranslation = translatedTexts.some((s) => !!s);

  const setPlayerRef = useCallback(
    (handle: VideoPlayerHandle | null) => {
      (playerRef as React.MutableRefObject<VideoPlayerHandle | null>).current =
        handle;
    },
    [],
  );

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const readCheckpoint = useCallback((url: string): PipelineCheckpoint | null => {
    if (!url || typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(checkpointKey(url));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PipelineCheckpoint;
      if (!parsed || parsed.version !== 1 || parsed.url !== url || !Array.isArray(parsed.segments)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const writeCheckpoint = useCallback((cp: PipelineCheckpoint) => {
    if (!cp.url || typeof window === "undefined") return;
    try {
      localStorage.setItem(checkpointKey(cp.url), JSON.stringify(cp));
      setResumableInfo({ next: cp.nextTranslateIndex, total: cp.segments.length });
    } catch {
      // ignore quota/storage failures
    }
  }, []);

  const clearCheckpoint = useCallback((url: string) => {
    if (!url || typeof window === "undefined") return;
    try {
      localStorage.removeItem(checkpointKey(url));
      setResumableInfo(null);
    } catch {
      // ignore
    }
  }, []);

  const stopPipeline = useCallback(() => {
    currentRunIdRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    setIsPaused(false);
    setTask({ phase: "idle", progress: 0, message: "已停止" });
  }, []);

  const togglePausePipeline = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  // ── pipeline ───────────────────────────────────────────────────
  const runPipeline = useCallback(
    async (
      input: MediaInput,
      language: string,
      targetLangPreference: string = "auto",
      forcedCapture?: CaptureCandidate,
      runMode: "manual" | "auto" = "manual",
    ) => {
      const runPlaylistIndex = input.type === "url"
        ? playlistUrls.findIndex((u) => u === (input.url ?? ""))
        : -1;
      const runId = ++currentRunIdRef.current;
      const assertRunActive = () => {
        if (currentRunIdRef.current !== runId) {
          throw new Error("任务已停止");
        }
      };
      const waitIfPaused = async () => {
        while (isPausedRef.current && currentRunIdRef.current === runId) {
          await sleep(200);
        }
        assertRunActive();
      };
      const nextSignal = () => {
        activeRequestControllerRef.current?.abort();
        const controller = new AbortController();
        activeRequestControllerRef.current = controller;
        return controller.signal;
      };
      try {
        setIsPaused(false);
        setHasStarted(true);
        setTracksFromAligned([]);
        setYoutubeId(null);
        setVideoSrc(null);
        setCaptureCandidates([]);
        setSelectedCaptureIdx(0);
        if (input.type === "url") {
          setPendingInput(input);
          setPendingLanguage(language);
          setPendingTargetLang(targetLangPreference);
        }
        const inputUrl = input.type === "url" ? (input.url ?? "") : "";
        const checkpoint = inputUrl ? readCheckpoint(inputUrl) : null;
        if (checkpoint) {
          setResumableInfo({
            next: checkpoint.nextTranslateIndex,
            total: checkpoint.segments.length,
          });
        } else if (input.type === "url") {
          setResumableInfo(null);
        }
        await waitIfPaused();
        let capturedForAsr: {
          mediaUrl: string;
          headers?: { referer?: string; origin?: string; userAgent?: string; cookie?: string };
        } | null = null;

        // ── Determine video source ───────────────────────────────
        if (input.type === "file" && input.file) {
          setVideoSrc(URL.createObjectURL(input.file));
        } else if (input.type === "url") {
          const u = input.url ?? "";
          const ytId = extractYouTubeId(u);

          if (ytId) {
            setYoutubeId(ytId);
          } else {
            if (forcedCapture?.mediaUrl) {
              capturedForAsr = {
                mediaUrl: forcedCapture.mediaUrl,
                headers: forcedCapture.headers ?? {},
              };
              await waitIfPaused();
              const directRes = await prepareVideoDirect({
                originUrl: u,
                mediaUrl: forcedCapture.mediaUrl,
                headers: forcedCapture.headers ?? {},
                kind: forcedCapture.kind ?? "unknown",
              }, nextSignal());
              if (directRes.ok && directRes.streamUrl) {
                setVideoSrc(directRes.streamUrl);
              } else {
                throw new Error(directRes.error ?? "prepare-direct failed");
              }
            } else {
            // For Bilibili or other URLs, try to proxy them via backend
            // This ensures we can get a streamable MP4 for the HTML5 player
            // which allows proper subtitle sync (via currentTime).
            setTask({
              phase: "downloading",
              progress: 10,
              message: "正在准备视频流...",
            });
            await waitIfPaused();

            try {
              const videoRes = await prepareVideo(u, nextSignal());
              if (videoRes.ok && videoRes.streamUrl) {
                if (videoRes.playMode === "download-fallback") {
                  setTask({
                    phase: "downloading",
                    progress: 20,
                    message: "代理失败，正在使用下载回退模式...",
                  });
                }
                // Use the proxied stream URL (relative to API base, handled by backend)
                // Note: prepareVideo returns /api/video/stream/..., we need full URL if on different domain
                // but since we are same origin / proxy, direct path works.
                setVideoSrc(videoRes.streamUrl);
              } else {
                console.warn("Video prepare failed:", videoRes.error, videoRes.code);
                // Optional recovery path:
                // Ask the extension to capture a real media request from the
                // active tab, then hand it to /api/video/prepare-direct.
                let recovered = false;
                try {
                  const runtime = (globalThis as any)?.chrome?.runtime;
                  setTask({
                    phase: "downloading",
                    progress: 18,
                    message: "主链路失败，尝试浏览器会话抓流...",
                  });
                  await waitIfPaused();

                  const captureViaWindowBridge = () =>
                    new Promise<any>((resolve) => {
                      const reqId = `cap_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                      const onMessage = (ev: MessageEvent) => {
                        const data = ev.data;
                        if (!data || data.type !== "SUBPLAYER_CAPTURE_MEDIA_ONCE_RESULT") return;
                        if (data.requestId !== reqId) return;
                        window.removeEventListener("message", onMessage);
                        resolve(data.result);
                      };
                      window.addEventListener("message", onMessage);
                      window.postMessage(
                        {
                          type: "SUBPLAYER_CAPTURE_MEDIA_ONCE",
                          requestId: reqId,
                          pageUrl: u,
                          timeoutMs: 15000,
                        },
                        "*",
                      );
                      setTimeout(() => {
                        window.removeEventListener("message", onMessage);
                        resolve({ ok: false, error: "bridge-timeout" });
                      }, 17000);
                    });

                  const captureRes = runtime?.sendMessage
                    ? await new Promise<any>((resolve) => {
                      runtime.sendMessage(
                        {
                          type: "CAPTURE_MEDIA_ONCE",
                          pageUrl: u,
                          timeoutMs: 15000,
                        },
                        resolve,
                      );
                    })
                    : await captureViaWindowBridge();

                  if (captureRes?.candidates?.length) {
                    console.log("[Capture] Top candidates:", captureRes.candidates);
                  }

                  if (captureRes?.ok && captureRes.mediaUrl) {
                    const candidates: CaptureCandidate[] = (
                      Array.isArray(captureRes.candidates) && captureRes.candidates.length > 0
                        ? captureRes.candidates
                        : [{
                          mediaUrl: captureRes.mediaUrl,
                          kind: captureRes.kind ?? "unknown",
                          host: "",
                          score: 0,
                          headers: captureRes.headers ?? {},
                        }]
                    ).filter((c: CaptureCandidate) => !!c.mediaUrl);

                    if (candidates.length > 1) {
                      setCaptureCandidates(candidates);
                      setSelectedCaptureIdx(0);
                      setTask({
                        phase: "error",
                        progress: 0,
                        message: "检测到多个媒体流，请手动选择正确视频后重试",
                      });
                      return;
                    }

                    const chosen = candidates[0];
                    capturedForAsr = {
                      mediaUrl: chosen.mediaUrl,
                      headers: chosen.headers ?? {},
                    };
                    const directRes = await prepareVideoDirect({
                      originUrl: u,
                      mediaUrl: chosen.mediaUrl,
                      headers: chosen.headers ?? {},
                      kind: chosen.kind ?? "unknown",
                    }, nextSignal());
                    if (directRes.ok && directRes.streamUrl) {
                      setVideoSrc(directRes.streamUrl);
                      recovered = true;
                    } else {
                      setTask({
                        phase: "error",
                        progress: 0,
                        message: `抓流重试失败：${directRes.error ?? "prepare-direct failed"}`,
                      });
                    }
                  } else {
                    const hint = captureRes?.error?.includes("only-ad-stream-detected")
                      ? "当前仅检测到广告流。请先在原网站播放/关闭广告进入正片后，再点击重试"
                      : captureRes?.error?.includes("timeout")
                      ? "抓流超时，请先在目标网页点击播放 3-5 秒后重试"
                      : (captureRes?.error?.includes("bridge-timeout")
                        ? "抓流桥接未响应，请刷新扩展与页面后重试"
                        : (captureRes?.error ?? "扩展未捕获到媒体请求"));
                    setTask({
                      phase: "error",
                      progress: 0,
                      message: hint,
                    });
                  }
                } catch (captureErr) {
                  console.warn("Video direct-capture fallback failed:", captureErr);
                  setTask({
                    phase: "error",
                    progress: 0,
                    message: "浏览器抓流异常，请刷新页面后重试",
                  });
                }

                // Final fallback: if direct URL, use it; otherwise no video
                if (!recovered && isDirectVideoUrl(u)) setVideoSrc(u);
              }
            } catch (e) {
              console.warn("Video prepare error:", e);
              if (isDirectVideoUrl(u)) setVideoSrc(u);
            }
            }
          }
        }
        setFileName(input.name);

        let newSegments: Segment[] = [];
        let detectedLang = ""; // language detected by ASR
        let resumeTranslateIndex = 0;

        // ── Preprocess cache shortcut (queue result) ────────────
        if (input.type === "url" && inputUrl && !checkpoint) {
          await waitIfPaused();
          let pre = await getPreprocessResult(inputUrl, targetLangPreference, nextSignal());
          if (pre.ok && (pre.status === "queued" || pre.status === "processing")) {
            while (pre.status === "queued" || pre.status === "processing") {
              setTask({
                phase: "downloading",
                progress: Math.max(10, Math.min(pre.progress ?? 10, 95)),
                message: pre.message || `预处理中 ${pre.progress ?? 0}%`,
              });
              await sleep(2500);
              await waitIfPaused();
              pre = await getPreprocessResult(inputUrl, targetLangPreference, nextSignal());
            }
          }

          if (pre.ok && pre.status === "done" && pre.result?.segments?.length) {
            setTracksFromAligned(splitOversizedSegments(pre.result.segments));
            if (pre.result.targetLang) {
              setTargetLang(pre.result.targetLang);
            }
            setLastCompletedPlaylistIndex(runPlaylistIndex >= 0 ? runPlaylistIndex : null);
            setLastCompletedRunMode(runMode);
            setTask({
              phase: "done",
              progress: 100,
              message: `已命中预处理结果 — ${pre.result.segments.length} 段`,
            });
            clearCheckpoint(inputUrl);
            return;
          }
        }

        // ── Transcribe ───────────────────────────────────────────
        if (checkpoint && checkpoint.segments.length > 0) {
          newSegments = splitOversizedSegments(checkpoint.segments);
          detectedLang = checkpoint.detectedLang;
          resumeTranslateIndex = Math.max(
            0,
            Math.min(checkpoint.nextTranslateIndex, newSegments.length),
          );
          if (checkpoint.targetLang) {
            setTargetLang(checkpoint.targetLang);
          }
          setFileName(checkpoint.fileName || input.name);
          setTracksFromAligned(newSegments);
          setTask({
            phase: "transcribing",
            progress: 100,
            message: `已恢复断点 — ${newSegments.length} 段`,
          });
        } else if (input.type === "file" && input.file) {
          await waitIfPaused();
          setTask({
            phase: "uploading",
            progress: 0,
            message: "正在上传文件...",
          });
          const result = await transcribeFile(
            input.file,
            language,
            "multilingual",
            (pct) => {
              setTask({
                phase: "uploading",
                progress: Math.min(pct, 95),
                message: `上传 ${pct}%`,
              });
            },
            nextSignal(),
          );
          setTask({
            phase: "transcribing",
            progress: 95,
            message: "AI 正在转写...",
          });
          if (!result.ok) throw new Error(result.error ?? "转写失败");
          newSegments = splitOversizedSegments(result.segments);
          detectedLang = result.language ?? "";
        } else if (input.type === "url") {
          await waitIfPaused();
          setTask({
            phase: "downloading",
            progress: 30,
            message: "正在获取字幕 / 下载音频...",
          });
          const result = await transcribeUrl(
            input.url!,
            language,
            "multilingual",
            capturedForAsr ?? undefined,
            nextSignal(),
          );
          if (!result.ok) throw new Error(result.error ?? "转写失败");
          newSegments = splitOversizedSegments(result.segments);
          detectedLang = result.language ?? "";
        }

        setTracksFromAligned(newSegments);
        setTask({
          phase: "transcribing",
          progress: 100,
          message: `转写完成 — ${newSegments.length} 段`,
        });
        if (input.type === "url" && inputUrl && !checkpoint) {
          writeCheckpoint({
            version: 1,
            url: inputUrl,
            language,
            fileName: input.name,
            detectedLang,
            targetLang: targetLangPreference,
            segments: newSegments,
            nextTranslateIndex: 0,
            updatedAt: Date.now(),
          });
        }

        // ── Translate (progressive batches — avoids proxy timeouts) ─────
        if (newSegments.length > 0) {
          try {
            const sourceLang =
              detectedLang && detectedLang !== "auto"
                ? detectedLang
                : language === "auto"
                  ? "en"
                  : language;
            const target = targetLangPreference && targetLangPreference !== "auto"
              ? targetLangPreference
              : (sourceLang === "zh" ? "en" : "zh");
            setTargetLang(target);
            console.log(
              `[Translate] source=${sourceLang}, target=${target}, segments=${newSegments.length}`,
            );

            // Translate in small client-side chunks to avoid Next.js proxy
            // 30 s timeout. Each chunk finishes in ~10-15 s.
            const CHUNK = 10;
            const merged = [...newSegments];
            let translated = merged.filter((s) => !!s.translation).length;
            const startAt = Math.max(0, Math.min(resumeTranslateIndex, newSegments.length));

            for (let i = startAt; i < newSegments.length; i += CHUNK) {
              await waitIfPaused();
              const chunk = newSegments.slice(i, i + CHUNK);
              setTask({
                phase: "translating",
                progress: Math.round((i / newSegments.length) * 100),
                message: `翻译中 ${Math.min(i + CHUNK, newSegments.length)}/${newSegments.length}...`,
              });

              const transResult = await translateSegments(
                chunk,
                sourceLang,
                target,
                nextSignal(),
              );

              if (transResult.ok && transResult.segments.length > 0) {
                for (let j = 0; j < transResult.segments.length; j++) {
                  merged[i + j] = transResult.segments[j];
                }
                translated += transResult.segments.filter(
                  (s) => s.translation,
                ).length;
                // Update UI progressively — user sees translations appear
                setTracksFromAligned([...merged]);
                if (input.type === "url" && inputUrl) {
                  writeCheckpoint({
                    version: 1,
                    url: inputUrl,
                    language,
                    fileName: input.name,
                    detectedLang,
                    targetLang: target,
                    segments: [...merged],
                    nextTranslateIndex: Math.min(i + CHUNK, newSegments.length),
                    updatedAt: Date.now(),
                  });
                }
              }
            }

            console.log(
              `[Translate] Done: ${translated}/${newSegments.length} translated`,
            );
          } catch (translationErr) {
            // Translation failed but transcription succeeded — still show subtitles
            console.warn("Translation failed:", translationErr);
          }
        }

        setTask({ phase: "done", progress: 100, message: "全部完成" });
        setLastCompletedPlaylistIndex(runPlaylistIndex >= 0 ? runPlaylistIndex : null);
        setLastCompletedRunMode(runMode);
        if (input.type === "url" && inputUrl) {
          clearCheckpoint(inputUrl);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "未知错误";
        if (msg.includes("aborted") || msg.includes("任务已停止")) {
          setTask({ phase: "idle", progress: 0, message: "已停止（可继续上次进度）" });
        } else {
          setTask({ phase: "error", progress: 0, message: msg });
        }
      } finally {
        if (currentRunIdRef.current === runId) {
          activeRequestControllerRef.current = null;
        }
      }
    },
    [clearCheckpoint, playlistUrls, readCheckpoint, setTracksFromAligned, writeCheckpoint],
  );

  const retryWithSelectedCapture = useCallback(() => {
    if (!pendingInput || pendingInput.type !== "url") return;
    const chosen = captureCandidates[selectedCaptureIdx];
    if (!chosen?.mediaUrl) return;
    runPipeline(pendingInput, pendingLanguage, pendingTargetLang, chosen);
  }, [captureCandidates, pendingInput, pendingLanguage, pendingTargetLang, runPipeline, selectedCaptureIdx]);

  const handleSeek = useCallback((time: number) => {
    playerRef.current?.seekTo(time);
  }, []);

  const isProcessing = !["idle", "done", "error"].includes(task.phase);

  const startPlaylistItem = useCallback((idx: number, mode: "manual" | "auto" = "manual") => {
    const url = playlistUrls[idx];
    if (!url) return;
    if (idx === playlistIndex && task.phase === "done") return;
    setPlaylistIndex(idx);
    setLastCompletedPlaylistIndex(null);
    setLastCompletedRunMode(null);
    runPipeline(
      {
        type: "url",
        url,
        name: buildUrlInputName(url),
      },
      "auto",
      "auto",
      undefined,
      mode,
    );
  }, [playlistIndex, playlistUrls, runPipeline, task.phase]);

  // ── Initial query parse (?url=...&autorun=1&playlist=...&idx=...) ──
  useEffect(() => {
    if (queryInitRef.current) return;
    queryInitRef.current = true;

    const playlist = decodePlaylistParam(searchParams.get("playlist"));
    const requestedIdx = Number(searchParams.get("idx") ?? "0");
    const safeIdx = Number.isFinite(requestedIdx)
      ? Math.max(0, Math.min(Math.trunc(requestedIdx), Math.max(playlist.length - 1, 0)))
      : 0;

    if (playlist.length > 0) {
      setPlaylistUrls(playlist);
      setPlaylistIndex(safeIdx);
    }

    const queryUrl = searchParams.get("url")?.trim() || playlist[safeIdx];
    const shouldAutorun = searchParams.get("autorun") === "1";
    if (!queryUrl || !shouldAutorun) return;

    runPipeline(
      {
        type: "url",
        url: queryUrl,
        name: buildUrlInputName(queryUrl),
      },
      "auto",
      "auto",
    );
  }, [runPipeline, searchParams]);

  // ── Auto-play next in playlist ──────────────────────────────────
  useEffect(() => {
    if (task.phase !== "done" || !autoNext || lastCompletedRunMode !== "auto" || playlistUrls.length === 0) return;
    if (lastCompletedPlaylistIndex === null || lastCompletedPlaylistIndex !== playlistIndex) return;
    const nextIdx = lastCompletedPlaylistIndex + 1;
    if (nextIdx >= playlistUrls.length) return;
    const timer = setTimeout(() => {
      startPlaylistItem(nextIdx, "auto");
    }, 800);
    return () => clearTimeout(timer);
  }, [autoNext, lastCompletedPlaylistIndex, lastCompletedRunMode, playlistIndex, playlistUrls, startPlaylistItem, task.phase]);

  // ── Initial landing ────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <Header />
        <main className="flex flex-1 items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-xl"
          >
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-bold tracking-tight">
                视频字幕识别 & 翻译
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                上传视频/音频文件或粘贴链接，自动生成带时间轴的双语字幕
              </p>
            </div>
            <FileUploadZone onSubmit={runPipeline} disabled={isProcessing} />
          </motion.div>
        </main>
      </div>
    );
  }

  // ── Working view ───────────────────────────────────────────────
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── Left: Video + Controls ────────────────────────────── */}
        <div className="flex shrink-0 flex-col gap-3 overflow-y-auto p-4 lg:w-[60%]">
          <AnimatePresence mode="wait">
            <motion.div
              key="player"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <VideoPlayer
                ref={setPlayerRef}
                src={videoSrc}
                youtubeId={youtubeId}
                activeSegment={activeSegment}
                activeIndex={activeIndex}
                subtitleMode={subtitleMode}
                readableBlocks={readableBlocks}
              />
            </motion.div>
          </AnimatePresence>
          <TaskProgress {...task} />
          {isProcessing && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
              <Button size="sm" variant="secondary" onClick={togglePausePipeline}>
                {isPaused ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
                {isPaused ? "继续" : "暂停"}
              </Button>
              <Button size="sm" variant="destructive" onClick={stopPipeline}>
                <Square className="mr-1.5 h-3.5 w-3.5" />
                停止
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {isPaused ? "已暂停（当前子任务完成后生效）" : "处理中"}
              </span>
            </div>
          )}
          {!isProcessing && task.phase === "idle" && pendingInput?.type === "url" && resumableInfo && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
              <span className="text-xs text-muted-foreground">
                可继续: {resumableInfo.next}/{resumableInfo.total}
              </span>
              <Button size="sm" variant="secondary" onClick={() => runPipeline(pendingInput, pendingLanguage, pendingTargetLang)}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                继续上次进度
              </Button>
            </div>
          )}
          {playlistUrls.length > 0 && (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <ListVideo className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">
                  播放列表 {playlistIndex + 1}/{playlistUrls.length}
                </p>
                <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={autoNext}
                    onChange={(e) => setAutoNext(e.target.checked)}
                  />
                  自动下一条
                </label>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={playlistIndex <= 0}
                  onClick={() => startPlaylistItem(playlistIndex - 1)}
                >
                  <SkipBack className="mr-1.5 h-3.5 w-3.5" />
                  上一条
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={playlistIndex >= playlistUrls.length - 1}
                  onClick={() => startPlaylistItem(playlistIndex + 1)}
                >
                  <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                  下一条
                </Button>
              </div>
              <select
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                value={String(playlistIndex)}
                onChange={(e) => startPlaylistItem(Number(e.target.value))}
              >
                {playlistUrls.map((u, idx) => (
                  <option key={`${u}-${idx}`} value={String(idx)}>
                    {idx + 1}. {u}
                  </option>
                ))}
              </select>
            </div>
          )}
          {captureCandidates.length > 0 && (
            <div className="rounded-md border border-border bg-card p-3">
              <p className="mb-2 text-sm font-medium">手动选择视频流</p>
              <p className="mb-2 text-xs text-muted-foreground">
                自动抓流命中了多个候选，请选择最像主视频的一项（优先 `hls/mpd`，避开广告域）。
              </p>
              <select
                className="mb-2 w-full rounded border border-input bg-background px-2 py-1 text-xs"
                value={String(selectedCaptureIdx)}
                onChange={(e) => setSelectedCaptureIdx(Number(e.target.value))}
              >
                {captureCandidates.map((c, idx) => (
                  <option key={`${c.mediaUrl}-${idx}`} value={String(idx)}>
                    {idx + 1}. [{c.kind ?? "unknown"}] {c.host ?? "-"} score={c.score ?? 0}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={retryWithSelectedCapture}>
                使用候选重试
              </Button>
            </div>
          )}
          {(task.phase === "done" || task.phase === "error") && (
            <FileUploadZone
              onSubmit={runPipeline}
              disabled={isProcessing}
              compact
            />
          )}
        </div>

        {/* ── Right: Subtitle Panel ─────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col border-t border-border lg:border-l lg:border-t-0">
          {/* Panel header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">
              字幕列表
              {rawTimelineSegments.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {rawTimelineSegments.length} 条
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                    {subtitleMode === "bilingual" && (
                      <>
                        <Languages className="h-3 w-3" />
                        双语
                      </>
                    )}
                    {subtitleMode === "original" && (
                      <>
                        <Type className="h-3 w-3" />
                        原文
                      </>
                    )}
                    {subtitleMode === "translation" && (
                      <>
                        <Subtitles className="h-3 w-3" />
                        译文
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuRadioGroup
                    value={subtitleMode}
                    onValueChange={(v) => setSubtitleMode(v as SubtitleMode)}
                  >
                    <DropdownMenuRadioItem value="bilingual">
                      <Languages className="mr-2 h-3.5 w-3.5" />
                      双语字幕
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="original">
                      <Type className="mr-2 h-3.5 w-3.5" />
                      仅原文
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="translation">
                      <Subtitles className="mr-2 h-3.5 w-3.5" />
                      仅译文
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <ExportDialog
                segments={alignedSegments}
                readableBlocks={readableBlocks}
                filename={fileName}
                hasTranslation={hasTranslation}
              />
            </div>
          </div>

          {/* Panel body */}
          <div className="min-h-0 flex-1">
            <SubtitlePanel
              segments={useReadableBlocks ? rawTimelineSegments : alignedSegments}
              readableBlocks={readableBlocks}
              activeIndex={activeIndex}
              subtitleMode={subtitleMode}
              onSeek={handleSeek}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
