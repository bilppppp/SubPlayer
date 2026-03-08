"use client";

import { Loader2, CheckCircle2, AlertCircle, Upload, Download, Mic, Languages } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import type { TaskState, TaskPhase } from "@/types";

const PHASE_META: Record<TaskPhase, { icon: React.ElementType; label: string; color: string }> = {
  idle: { icon: Upload, label: "等待输入", color: "text-foreground/60" },
  uploading: { icon: Upload, label: "上传中", color: "text-foreground/80" },
  downloading: { icon: Download, label: "下载中", color: "text-foreground/80" },
  transcribing: { icon: Mic, label: "AI 转写中", color: "text-[#6f8a00]" },
  translating: { icon: Languages, label: "AI 翻译中", color: "text-[#6f8a00]" },
  done: { icon: CheckCircle2, label: "完成", color: "text-[#6f8a00]" },
  error: { icon: AlertCircle, label: "错误", color: "text-red-600" },
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
        className="flex flex-col gap-3 rounded-[24px] border border-black/70 bg-white/45 p-4"
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
            <span className="ml-auto font-mono text-xs uppercase tracking-wide text-foreground/60">{message}</span>
          )}
        </div>

        {isActive && (
          <div className="relative">
            <Progress value={progress} className="h-1.5" />
            <motion.div
              className="absolute inset-0 h-1.5 rounded-full opacity-40 blur-sm"
              style={{
                background: "linear-gradient(90deg, #050505, #ccff00)",
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
