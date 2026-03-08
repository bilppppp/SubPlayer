"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Maximize, Minimize } from "lucide-react";
import type { Segment, ReadableBlock, SubtitleMode } from "@/types";
import { useSettings } from "@/store/settings";

interface YouTubePlayer {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  getCurrentTime: () => number;
  destroy: () => void;
}

interface YouTubePlayerOptions {
  videoId: string;
  playerVars?: Record<string, number>;
  events?: {
    onReady?: () => void;
  };
}

interface YouTubeNamespace {
  Player: new (elementId: string, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: YouTubeNamespace;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

interface VideoPlayerProps {
  /** Direct video URL or blob URL (for local files / direct links) */
  src: string | null;
  /** YouTube video ID (e.g. "dQw4w9WgXcQ") — takes priority over src */
  youtubeId?: string | null;
  activeSegment?: Segment | null;
  activeIndex?: number;
  /** Controls which subtitle lines appear on the overlay */
  subtitleMode?: SubtitleMode;
  readableBlocks?: ReadableBlock[];
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void;
  getVideo: () => HTMLVideoElement | null;
  /** Generic current time getter — works for both HTML5 video & YouTube */
  getCurrentTime: () => number;
}

// ═══════════════════════════════════════════════════════════════════════
//  YouTube IFrame API loader (singleton)
// ═══════════════════════════════════════════════════════════════════════

let ytApiLoaded = false;
let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    // The API calls this global callback when ready
    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      resolve();
    };

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
  });

  return ytApiPromise;
}

// ═══════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    { src, youtubeId, activeSegment, activeIndex = -1, subtitleMode = "bilingual" },
    ref
  ) {
    // ── Container & UI ref ───────────────────────────────────────
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // ── HTML5 video ref ──────────────────────────────────────────
    const videoRef = useRef<HTMLVideoElement>(null);

    // ── YouTube player ref ───────────────────────────────────────
    const ytContainerRef = useRef<HTMLDivElement>(null);
    const ytPlayerRef = useRef<YouTubePlayer | null>(null);

    // ── Settings ─────────────────────────────────────────────────
    const settings = useSettings();

    // Keep overlay synced to the current active segment (not merged block),
    // otherwise long readable blocks stay static and feel "laggy".
    const overlayOriginalText = activeSegment?.text ?? "";
    const overlayTranslationText = activeSegment?.translation ?? "";

    // ── Determine mode ───────────────────────────────────────────
    const mode = youtubeId
      ? "youtube"
      : src
        ? "html5"
        : "placeholder";

    // ── Imperative handle ────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      seekTo(time: number) {
        if (mode === "youtube" && ytPlayerRef.current?.seekTo) {
          ytPlayerRef.current.seekTo(time, true);
          ytPlayerRef.current.playVideo();
        } else if (mode === "html5" && videoRef.current) {
          videoRef.current.currentTime = time;
          videoRef.current.play().catch(() => { });
        }
      },
      getVideo() {
        return videoRef.current;
      },
      getCurrentTime() {
        if (mode === "youtube" && ytPlayerRef.current?.getCurrentTime) {
          return ytPlayerRef.current.getCurrentTime() ?? 0;
        }
        return videoRef.current?.currentTime ?? 0;
      },
    }));

    // NOTE: Subtitle sync is handled by the useSubtitleSync hook in page.tsx
    // which runs its own rAF loop calling getCurrentTime(). No need to
    // force re-renders here.

    // ── YouTube player lifecycle ─────────────────────────────────
    useEffect(() => {
      if (mode !== "youtube" || !youtubeId) return;

      let player: YouTubePlayer | null = null;
      let destroyed = false;

      const initPlayer = async () => {
        await loadYouTubeApi();
        if (destroyed) return;

        // We need a fresh div for YT.Player each time
        const container = ytContainerRef.current;
        if (!container) return;

        // Clear any previous iframe
        container.innerHTML = "";
        const playerDiv = document.createElement("div");
        playerDiv.id = `yt-player-${Date.now()}`;
        container.appendChild(playerDiv);

        const yt = window.YT;
        if (!yt?.Player) return;

        player = new yt.Player(playerDiv.id, {
          videoId: youtubeId,
          playerVars: {
            autoplay: 0,
            modestbranding: 1,
            rel: 0,
            cc_load_policy: 0, // Don't show YT's own captions
            iv_load_policy: 3, // No annotations
            playsinline: 1,
            fs: 0, // Disable native fullscreen
          },
          events: {
            onReady: () => {
              if (!destroyed) {
                ytPlayerRef.current = player;
              }
            },
          },
        });
      };

      initPlayer();

      return () => {
        destroyed = true;
        if (player?.destroy) {
          try {
            player.destroy();
          } catch { }
        }
        ytPlayerRef.current = null;
      };
    }, [youtubeId, mode]);

    // NOTE: YouTube time is read via getCurrentTime() in the imperative handle.
    // The useSubtitleSync hook polls it via its own rAF loop — no extra
    // polling needed here.

    // ── Fullscreen Listeners ─────────────────────────────────────
    useEffect(() => {
      const onFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener("fullscreenchange", onFullscreenChange);
      return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    const toggleFullscreen = async () => {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen().catch((err) => {
          console.warn("Fullscreen error", err);
        });
      } else {
        await document.exitFullscreen().catch(() => { });
      }
    };

    // ── Render ───────────────────────────────────────────────────
    return (
      <div
        ref={containerRef}
        className={`group relative flex flex-col justify-center overflow-hidden border-2 border-black bg-[#050505] ${isFullscreen ? "h-full w-full object-contain" : "aspect-video w-full rounded-[30px]"
          }`}
      >
        {/* ── YouTube embed ──────────────────────────────────────── */}
        {mode === "youtube" && (
          <div
            ref={ytContainerRef}
            className={`w-full bg-black [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full ${isFullscreen ? "h-full" : "aspect-video"
              }`}
          />
        )}



        {/* ── HTML5 video ───────────────────────────────────────── */}
        {mode === "html5" && (
          <video
            ref={videoRef}
            src={src!}
            controls
            controlsList="nofullscreen"
            className={`w-full bg-black ${isFullscreen ? "h-full object-contain" : "aspect-video"}`}
            playsInline
          />
        )}

        {/* ── Placeholder ───────────────────────────────────────── */}
        {mode === "placeholder" && (
          <div className="flex aspect-video w-full items-center justify-center bg-[#050505]">
            <div className="flex flex-col items-center gap-3 text-white/55">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-white/30">
                <svg
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-sm">上传文件或输入 URL 开始</p>
            </div>
          </div>
        )}

        {/* ── Custom Fullscreen Button ──────────────────────────── */}
        {mode !== "placeholder" && (
          <div className="absolute top-4 right-4 z-[60] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <button
              onClick={toggleFullscreen}
              className="rounded-xl border border-white/30 bg-black/65 p-2 text-white transition-colors hover:bg-black/85"
              title="全屏播放"
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        )}

        {/* ── Subtitle overlay ──────────────────────────────────── */}
        <AnimatePresence>
          {mode !== "placeholder" && (overlayOriginalText || overlayTranslationText) && (
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none absolute bottom-14 left-0 right-0 z-50 flex flex-col items-center gap-1 px-4"
            >
              {/* Original text line */}
              {(subtitleMode === "bilingual" || subtitleMode === "original") && !!overlayOriginalText && (
                <span
                  className="max-w-[82vw] lg:max-w-[70vw] rounded-2xl border border-white/20 bg-black/88 px-4 py-1.5 text-center font-medium text-white break-words"
                  style={{
                    fontFamily: settings.playerFontFamily,
                    fontSize: settings.playerFontSize || "1rem",
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 3,
                    overflow: "hidden",
                    maxHeight: "8.2em",
                  }}
                >
                  {overlayOriginalText}
                </span>
              )}
              {/* Translation line */}
              {(subtitleMode === "bilingual" || subtitleMode === "translation") &&
                overlayTranslationText && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: subtitleMode === "bilingual" ? 0.1 : 0 }}
                    className={
                      subtitleMode === "translation"
                        ? "max-w-[82vw] lg:max-w-[70vw] rounded-2xl border border-white/20 bg-black/88 px-4 py-1.5 text-center font-medium text-white break-words"
                        : "max-w-[82vw] lg:max-w-[70vw] rounded-2xl border border-[#ccff00]/45 bg-black/76 px-3 py-1 text-center text-[#ccff00] break-words"
                    }
                    style={{
                      fontFamily: settings.playerFontFamily,
                      fontSize: subtitleMode === "bilingual"
                        ? `calc(${settings.playerFontSize || "1rem"} * 0.75)`
                        : settings.playerFontSize || "1rem",
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 3,
                      overflow: "hidden",
                      maxHeight: "8.2em",
                    }}
                  >
                    {overlayTranslationText}
                  </motion.span>
                )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);
