"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
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
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
            <svg
              className="h-6 w-6 text-muted-foreground"
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
          <p className="text-sm text-muted-foreground">
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
            let highlightStyleObj: any = {};

            if (isActive) {
              if (settings.highlightStyle === "underline") {
                highlightClasses = "border-b-2 border-indigo-500 bg-transparent rounded-none";
              } else if (settings.highlightStyle === "left-border") {
                highlightClasses = "border-l-4 border-indigo-500 bg-indigo-500/5 rounded-none ring-0 shadow-none";
              } else if (settings.highlightStyle === "glow") {
                highlightClasses = "bg-indigo-500/10";
                highlightStyleObj = { boxShadow: "0 0 10px rgba(99, 102, 241, 0.5)" };
              } else {
                highlightClasses = "bg-indigo-500/10 shadow-sm shadow-indigo-500/5 ring-1 ring-indigo-500/20";
                highlightStyleObj = { backgroundColor: "rgba(99, 102, 241, 0.1)" };
              }
            } else {
              highlightClasses = "hover:bg-muted/60";
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
                  className={`mt-0.5 shrink-0 font-mono text-xs ${isActive ? "text-indigo-500 dark:text-indigo-400" : "text-muted-foreground"
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
                                  ? "bg-indigo-500/20 font-medium text-foreground dark:bg-indigo-500/40"
                                  : "hover:bg-muted"
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
                          : "text-[0.9em] leading-relaxed text-amber-500/90 dark:text-amber-400/80"
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
                    className="absolute left-0 top-0 h-full w-0.5 rounded-full bg-indigo-500"
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
