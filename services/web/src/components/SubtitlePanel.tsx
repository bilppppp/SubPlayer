import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Segment } from "@/types";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface SubtitlePanelProps {
  segments: Segment[];
  activeIndex: number;
  translationVisible: boolean;
  onSeek: (time: number) => void;
}

export function SubtitlePanel({
  segments,
  activeIndex,
  translationVisible,
  onSeek,
}: SubtitlePanelProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-center text-sm text-muted-foreground">
          字幕将在转写完成后显示在这里
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 p-3">
        {segments.map((seg, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek(seg.start)}
              className={`group flex cursor-pointer gap-3 rounded-lg px-3 py-2 transition-colors ${
                isActive
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : "hover:bg-muted/60"
              }`}
            >
              {/* Timestamp */}
              <span
                className={`mt-0.5 shrink-0 font-mono text-xs ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {formatTime(seg.start)}
              </span>

              {/* Text */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <p
                  className={`text-sm leading-relaxed ${
                    isActive ? "font-medium text-foreground" : "text-foreground/80"
                  }`}
                >
                  {seg.text}
                </p>
                {translationVisible && seg.translation && (
                  <p className="text-xs leading-relaxed text-amber-500/90 dark:text-amber-400/80">
                    {seg.translation}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
