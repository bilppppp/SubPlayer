import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Segment } from "@/types";

interface VideoPlayerProps {
  src: string | null;
  activeSegment?: Segment | null;
  translationVisible?: boolean;
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void;
  getVideo: () => HTMLVideoElement | null;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ src, activeSegment, translationVisible = true }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [, setTime] = useState(0); // force re-render for controls

    useImperativeHandle(ref, () => ({
      seekTo(time: number) {
        const v = videoRef.current;
        if (v) {
          v.currentTime = time;
          v.play().catch(() => {});
        }
      },
      getVideo() {
        return videoRef.current;
      },
    }));

    // Update time display
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const handler = () => setTime(v.currentTime);
      v.addEventListener("timeupdate", handler);
      return () => v.removeEventListener("timeupdate", handler);
    }, [src]);

    return (
      <div className="relative overflow-hidden rounded-xl bg-black">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            controls
            className="aspect-video w-full"
            playsInline
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-muted/30">
            <p className="text-sm text-muted-foreground">上传文件或输入 URL 开始</p>
          </div>
        )}

        {/* Subtitle overlay */}
        {src && activeSegment && (
          <div className="pointer-events-none absolute bottom-14 left-0 right-0 flex flex-col items-center gap-0.5 px-4">
            <span className="rounded bg-black/70 px-3 py-1 text-center text-sm font-medium text-white backdrop-blur-sm md:text-base">
              {activeSegment.text}
            </span>
            {translationVisible && activeSegment.translation && (
              <span className="rounded bg-black/60 px-3 py-0.5 text-center text-xs text-amber-300 backdrop-blur-sm md:text-sm">
                {activeSegment.translation}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
);
