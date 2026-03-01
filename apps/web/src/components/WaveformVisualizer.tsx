"use client";

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
  return (
    <div className="flex h-12 items-end justify-center gap-[2px]">
      {Array.from({ length: barCount }).map((_, i) => {
        // Create a natural-looking wave pattern
        const center = barCount / 2;
        const distFromCenter = Math.abs(i - center) / center;
        const maxHeight = 1 - distFromCenter * 0.6;

        return (
          <motion.div
            key={i}
            className="w-[3px] rounded-full bg-gradient-to-t from-indigo-500 to-purple-400"
            initial={{ height: 4 }}
            animate={
              isActive
                ? {
                    height: [
                      4,
                      maxHeight * 48 * (0.4 + Math.random() * 0.6),
                      4,
                      maxHeight * 48 * (0.3 + Math.random() * 0.7),
                      4,
                    ],
                  }
                : { height: 4 }
            }
            transition={
              isActive
                ? {
                    duration: 1.2 + Math.random() * 0.8,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.03,
                  }
                : { duration: 0.3 }
            }
          />
        );
      })}
    </div>
  );
}
