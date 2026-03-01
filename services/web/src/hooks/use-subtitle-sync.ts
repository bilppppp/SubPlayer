import { useCallback, useEffect, useRef, useState } from "react";
import type { Segment } from "@/types";

/**
 * Keeps track of which subtitle segment is "active" based on
 * the current playback time.  Uses requestAnimationFrame for
 * smooth, low-overhead synchronisation.
 */
export function useSubtitleSync(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  segments: Segment[],
) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rafRef = useRef(0);

  const sync = useCallback(() => {
    const video = videoRef.current;
    if (!video || segments.length === 0) {
      rafRef.current = requestAnimationFrame(sync);
      return;
    }

    const t = video.currentTime;
    let idx = -1;

    // Binary-ish search for active segment — segments are sorted by start
    for (let i = 0; i < segments.length; i++) {
      if (t >= segments[i].start && t < segments[i].end) {
        idx = i;
        break;
      }
      // If we're past this segment's end and before next start, gap
      if (t < segments[i].start) break;
    }

    setActiveIndex((prev) => (prev === idx ? prev : idx));
    rafRef.current = requestAnimationFrame(sync);
  }, [videoRef, segments]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sync]);

  return activeIndex;
}
