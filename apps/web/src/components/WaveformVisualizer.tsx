"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

interface WaveformVisualizerProps {
  isActive: boolean;
  barCount?: number;
}

/**
 * Animated audio waveform — shows during transcription
 * to give visual feedback instead of a boring progress bar.
 */
export function WaveformVisualizer({ isActive, barCount = 32 }: WaveformVisualizerProps) {
  const bars = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => {
        const center = barCount / 2;
        const distFromCenter = Math.abs(i - center) / center;
        const maxHeight = 1 - distFromCenter * 0.6;
        const wobbleA = 0.5 + 0.25 * Math.sin(i * 0.77 + barCount * 0.13);
        const wobbleB = 0.5 + 0.25 * Math.cos(i * 0.61 + barCount * 0.17);
        return {
          maxHeight,
          peakA: maxHeight * 48 * wobbleA,
          peakB: maxHeight * 48 * wobbleB,
          duration: 1.2 + ((i * 7) % 9) / 10,
          delay: i * 0.03,
        };
      }),
    [barCount]
  );

  return (
    <div className="flex h-12 items-end justify-center gap-[2px]">
      {bars.map((bar, i) => {
        return (
          <motion.div
            key={i}
            className="w-[3px] rounded-full bg-gradient-to-t from-black to-[#ccff00]"
            initial={{ height: 4 }}
            animate={
              isActive
                ? {
                    height: [
                      4,
                      bar.peakA,
                      4,
                      bar.peakB,
                      4,
                    ],
                  }
                : { height: 4 }
            }
            transition={
              isActive
                ? {
                    duration: bar.duration,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: bar.delay,
                  }
                : { duration: 0.3 }
            }
          />
        );
      })}
    </div>
  );
}
