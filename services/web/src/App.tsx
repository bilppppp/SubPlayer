import { useCallback, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/Header";
import { FileUploadZone } from "@/components/FileUploadZone";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { SubtitlePanel } from "@/components/SubtitlePanel";
import { TaskProgress } from "@/components/TaskProgress";
import { ExportDialog } from "@/components/ExportDialog";
import { useTheme } from "@/hooks/use-theme";
import { useSubtitleSync } from "@/hooks/use-subtitle-sync";
import { transcribeFile, transcribeUrl, translateSegments } from "@/lib/api";
import type { MediaInput, Segment, TaskState } from "@/types";

export default function App() {
  const { theme, toggleTheme } = useTheme();

  // ── state ───────────────────────────────────────────────────────
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [task, setTask] = useState<TaskState>({
    phase: "idle",
    progress: 0,
    message: "",
  });
  const [showTranslation, setShowTranslation] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);

  // ── refs ────────────────────────────────────────────────────────
  const playerRef = useRef<VideoPlayerHandle>(null);
  const syncVideoRef = useRef<HTMLVideoElement | null>(null);

  // ── subtitle sync ──────────────────────────────────────────────
  const activeIndex = useSubtitleSync(syncVideoRef, segments);
  const activeSegment = activeIndex >= 0 ? segments[activeIndex] : null;
  const hasTranslation = segments.some((s) => !!s.translation);

  // Update video ref when player mounts
  const setPlayerRef = useCallback(
    (handle: VideoPlayerHandle | null) => {
      (playerRef as React.MutableRefObject<VideoPlayerHandle | null>).current = handle;
      syncVideoRef.current = handle?.getVideo() ?? null;
    },
    [],
  );

  // ── pipeline ───────────────────────────────────────────────────
  const runPipeline = useCallback(
    async (input: MediaInput, language: string) => {
      try {
        setHasStarted(true);

        // 1. Set up video source
        if (input.type === "file" && input.file) {
          setVideoSrc(URL.createObjectURL(input.file));
        } else if (input.type === "url") {
          const u = input.url ?? "";
          const isDirectVideo = /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(u);
          setVideoSrc(isDirectVideo ? u : null);
        }
        setFileName(input.name);
        setSegments([]);

        // 2. Transcribe
        let newSegments: Segment[] = [];

        if (input.type === "file" && input.file) {
          setTask({ phase: "uploading", progress: 0, message: "正在上传文件..." });
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
          );
          setTask({ phase: "transcribing", progress: 95, message: "正在转写..." });
          if (!result.ok) throw new Error(result.error ?? "转写失败");
          newSegments = result.segments;
        } else if (input.type === "url") {
          setTask({ phase: "downloading", progress: 30, message: "正在下载..." });
          const result = await transcribeUrl(input.url!, language, "multilingual");
          if (!result.ok) throw new Error(result.error ?? "转写失败");
          newSegments = result.segments;
        }

        setSegments(newSegments);
        setTask({ phase: "transcribing", progress: 100, message: "转写完成" });

        // 3. Translate
        if (newSegments.length > 0) {
          setTask({ phase: "translating", progress: 50, message: "正在翻译..." });
          const sourceLang = language === "auto" ? "en" : language;
          const targetLang = sourceLang === "zh" ? "en" : "zh";
          const transResult = await translateSegments(
            newSegments,
            sourceLang,
            targetLang,
          );
          if (transResult.ok && transResult.segments.length > 0) {
            setSegments(transResult.segments);
          }
        }

        setTask({ phase: "done", progress: 100, message: "全部完成" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "未知错误";
        setTask({ phase: "error", progress: 0, message: msg });
      }
    },
    [],
  );

  const handleSeek = useCallback((time: number) => {
    playerRef.current?.seekTo(time);
  }, []);

  const isProcessing = !["idle", "done", "error"].includes(task.phase);

  // ── Initial landing ────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <Header theme={theme} onToggleTheme={toggleTheme} />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-bold tracking-tight">视频字幕识别 &amp; 翻译</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                上传视频/音频文件或粘贴链接，自动生成带时间轴的双语字幕
              </p>
            </div>
            <FileUploadZone onSubmit={runPipeline} disabled={isProcessing} />
          </div>
        </main>
      </div>
    );
  }

  // ── Working view ───────────────────────────────────────────────
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header theme={theme} onToggleTheme={toggleTheme} />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── Left: Video + Controls ────────────────────────────── */}
        <div className="flex shrink-0 flex-col gap-3 overflow-y-auto p-4 lg:w-[60%]">
          <VideoPlayer
            ref={setPlayerRef}
            src={videoSrc}
            activeSegment={activeSegment}
            translationVisible={showTranslation}
          />
          <TaskProgress {...task} />
          {(task.phase === "done" || task.phase === "error") && (
            <FileUploadZone onSubmit={runPipeline} disabled={isProcessing} />
          )}
        </div>

        {/* ── Right: Subtitle Panel ─────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col border-t border-border lg:border-l lg:border-t-0">
          {/* Panel header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">
              字幕列表
              {segments.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {segments.length} 条
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTranslation((v) => !v)}
                className="h-7 gap-1 text-xs"
              >
                {showTranslation ? (
                  <Eye className="h-3 w-3" />
                ) : (
                  <EyeOff className="h-3 w-3" />
                )}
                译文
              </Button>
              <ExportDialog
                segments={segments}
                filename={fileName}
                hasTranslation={hasTranslation}
              />
            </div>
          </div>

          {/* Panel body */}
          <div className="min-h-0 flex-1">
            <SubtitlePanel
              segments={segments}
              activeIndex={activeIndex}
              translationVisible={showTranslation}
              onSeek={handleSeek}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
