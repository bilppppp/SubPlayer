import { useCallback, useEffect, useRef, useState } from "react";
import type { Segment } from "@/types";

/**
 * Synchronise subtitle highlighting with a generic time source.
 *
 * @param getTime  A callback that returns the current playback time (seconds).
 *                 Works with both HTML5 `<video>` and YouTube IFrame API.
 * @param segments The list of subtitle segments.
 * @returns        The index of the currently active segment (-1 if none).
 */
export function useSubtitleSync(
  getTime: () => number,
  segments: Segment[],
) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rafRef = useRef(0);

  const sync = useCallback(() => {
    if (segments.length === 0) {
      rafRef.current = requestAnimationFrame(sync);
      return;
    }

    const t = getTime();
    let idx = -1;

    for (let i = 0; i < segments.length; i++) {
      if (t >= segments[i].start && t < segments[i].end) {
        idx = i;
        break;
      }
      if (t < segments[i].start) break;
    }

    setActiveIndex((prev) => (prev === idx ? prev : idx));
    rafRef.current = requestAnimationFrame(sync);
  }, [getTime, segments]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sync]);

  return activeIndex;
}
