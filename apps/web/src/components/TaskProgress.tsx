"use client";

import { Loader2, CheckCircle2, AlertCircle, Upload, Download, Mic, Languages } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import type { TaskState, TaskPhase } from "@/types";

const PHASE_META: Record<TaskPhase, { icon: React.ElementType; label: string; color: string; gradient: string }> = {
  idle: { icon: Upload, label: "等待输入", color: "text-muted-foreground", gradient: "" },
  uploading: { icon: Upload, label: "上传中", color: "text-blue-400", gradient: "from-blue-500 to-cyan-500" },
  downloading: { icon: Download, label: "下载中", color: "text-blue-400", gradient: "from-blue-500 to-cyan-500" },
  transcribing: { icon: Mic, label: "AI 转写中", color: "text-indigo-400", gradient: "from-indigo-500 to-purple-500" },
  translating: { icon: Languages, label: "AI 翻译中", color: "text-purple-400", gradient: "from-purple-500 to-pink-500" },
  done: { icon: CheckCircle2, label: "完成", color: "text-emerald-400", gradient: "from-emerald-500 to-teal-500" },
  error: { icon: AlertCircle, label: "错误", color: "text-destructive", gradient: "from-red-500 to-orange-500" },
};

export function TaskProgress({ phase, progress, message }: TaskState) {
  if (phase === "idle") return null;

  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  const isActive = !["done", "error", "idle"].includes(phase);
  const isTranscribing = phase === "transcribing";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm"
      >
        {/* Waveform during transcription */}
        {isTranscribing && (
          <WaveformVisualizer isActive={true} barCount={40} />
        )}

        <div className="flex items-center gap-2">
          {isActive ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 className={`h-4 w-4 ${meta.color}`} />
            </motion.div>
          ) : (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500 }}
            >
              <Icon className={`h-4 w-4 ${meta.color}`} />
            </motion.div>
          )}
          <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
          {message && (
            <span className="ml-auto text-xs text-muted-foreground">{message}</span>
          )}
        </div>

        {isActive && (
          <div className="relative">
            <Progress value={progress} className="h-1.5" />
            {/* Animated glow effect */}
            <motion.div
              className="absolute inset-0 h-1.5 rounded-full opacity-40 blur-sm"
              style={{
                background: `linear-gradient(90deg, var(--tw-gradient-from, #6366f1), var(--tw-gradient-to, #a855f7))`,
                width: `${progress}%`,
              }}
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
