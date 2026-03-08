"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Segment, ReadableBlock, SubtitleMode } from "@/types";
import { useSettings } from "@/store/settings";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface SubtitlePanelProps {
  segments: Segment[];
  activeIndex: number;
  subtitleMode: SubtitleMode;
  readableBlocks?: ReadableBlock[];
  onSeek: (time: number) => void;
}

export function SubtitlePanel({
  segments,
  activeIndex,
  subtitleMode,
  readableBlocks,
  onSeek,
}: SubtitlePanelProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isUserInteracting = useRef(false);
  const interactionTimeout = useRef<NodeJS.Timeout | null>(null);
  const settings = useSettings();

  // ── Smart Auto-Scroll ─────────────────────────────────────────────
  // Only scroll if user hasn't interacted recently
  useEffect(() => {
    if (activeRef.current && !isUserInteracting.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  const handleInteraction = () => {
    isUserInteracting.current = true;
    if (interactionTimeout.current) {
      clearTimeout(interactionTimeout.current);
    }
    // Resume auto-scroll after 30 seconds of inactivity
    interactionTimeout.current = setTimeout(() => {
      isUserInteracting.current = false;
    }, 30000);
  };

  useEffect(() => {
    return () => {
      if (interactionTimeout.current) clearTimeout(interactionTimeout.current);
    };
  }, []);

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-black/70 bg-white/60">
            <svg
              className="h-6 w-6 text-foreground/55"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
          </div>
          <p className="text-sm text-foreground/70">
            字幕将在转写完成后显示在这里
          </p>
        </div>
      </div>
    );
  }

  const showOriginal = subtitleMode === "bilingual" || subtitleMode === "original";
  const showTranslation = subtitleMode === "bilingual" || subtitleMode === "translation";

  return (
    <div
      className="h-full"
      ref={scrollAreaRef}
      onWheel={handleInteraction}
      onTouchMove={handleInteraction}
      onMouseDown={handleInteraction}
      onKeyDown={handleInteraction}
      onScrollCapture={handleInteraction}
    >
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-0.5 p-3">
          {(readableBlocks || segments).map((item, i) => {
            const isBlock = !!readableBlocks;
            const block = isBlock ? (item as ReadableBlock) : null;
            const seg = isBlock ? null : (item as Segment);

            const isActive = isBlock
              ? activeIndex >= block!.startSegmentIndex && activeIndex <= block!.endSegmentIndex
              : i === activeIndex;

            const startTime = isBlock ? block!.start : seg!.start;

            let highlightClasses = "";
            let highlightStyleObj: CSSProperties = {};

            if (isActive) {
              if (settings.highlightStyle === "underline") {
                highlightClasses = "border-b-2 border-[#ccff00] bg-transparent rounded-none";
              } else if (settings.highlightStyle === "left-border") {
                highlightClasses = "border-l-4 border-[#ccff00] bg-black/5 rounded-none ring-0 shadow-none";
              } else if (settings.highlightStyle === "glow") {
                highlightClasses = "bg-black/10";
                highlightStyleObj = { boxShadow: "0 0 0 1px rgba(5, 5, 5, 0.7), 0 0 10px rgba(204, 255, 0, 0.2)" };
              } else {
                highlightClasses = "bg-black/8 ring-1 ring-black/20";
                highlightStyleObj = { backgroundColor: "rgba(5, 5, 5, 0.07)" };
              }
            } else {
              highlightClasses = "hover:bg-black/6";
            }

            return (
              <motion.div
                key={isBlock ? `block-${i}` : `seg-${i}`}
                ref={isActive ? activeRef : undefined}
                onClick={() => onSeek(startTime)}
                initial={false}
                animate={{ opacity: isActive ? 1 : 0.85 }}
                className={`group relative flex cursor-pointer gap-3 px-3 py-2 transition-all ${settings.highlightStyle === "default" ? "rounded-lg" : ""
                  } ${highlightClasses}`}
                style={{
                  ...highlightStyleObj,
                  fontFamily: settings.panelFontFamily,
                  fontSize: settings.panelFontSize,
                }}
              >
                {/* Timestamp */}
                <span
                  className={`mt-0.5 shrink-0 font-mono text-xs uppercase tracking-wide ${isActive ? "text-[#6f8a00]" : "text-foreground/45"
                    }`}
                >
                  {formatTime(startTime)}
                </span>

                {/* Text Node */}
                <div className="flex min-w-0 flex-col gap-1">
                  {showOriginal && (
                    <p className={`leading-relaxed ${isActive ? "text-foreground" : "text-foreground/80"}`}>
                      {isBlock ? (
                        segments.slice(block!.startSegmentIndex, block!.endSegmentIndex + 1).map((subSeg, idx) => {
                          const realSegIdx = block!.startSegmentIndex + idx;
                          const isSubSegActive = realSegIdx === activeIndex;
                          return (
                            <span
                              key={idx}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSeek(subSeg.start);
                              }}
                            className={`transition-colors duration-200 ${isSubSegActive
                                  ? "bg-[#ccff00]/25 font-medium text-foreground"
                                  : "hover:bg-black/10"
                                }`}
                            >
                              {subSeg.text}{" "}
                            </span>
                          );
                        })
                      ) : (
                        seg!.text
                      )}
                    </p>
                  )}

                  {/* Translation Node */}
                  {showTranslation && (isBlock ? block!.translation : seg!.translation) && (
                    <p
                      className={
                        subtitleMode === "translation"
                          ? `leading-relaxed ${isActive ? "font-medium text-foreground" : "text-foreground/80"}`
                          : "text-[0.9em] leading-relaxed text-[#6f8a00]"
                      }
                    >
                      {isBlock ? block!.translation : seg!.translation}
                    </p>
                  )}
                </div>

                {/* Active indicator line */}
                {isActive && (settings.highlightStyle === "default" || settings.highlightStyle === "glow") && (
                  <motion.div
                    layoutId="activeIndicator"
                    className="absolute left-0 top-0 h-full w-0.5 rounded-full bg-[#ccff00]"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
