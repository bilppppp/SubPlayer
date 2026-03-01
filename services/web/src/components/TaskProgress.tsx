import { Loader2, CheckCircle2, AlertCircle, Upload, Download, Mic, Languages } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { TaskState, TaskPhase } from "@/types";

const PHASE_META: Record<TaskPhase, { icon: React.ElementType; label: string; color: string }> = {
  idle: { icon: Upload, label: "等待输入", color: "text-muted-foreground" },
  uploading: { icon: Upload, label: "上传中", color: "text-blue-400" },
  downloading: { icon: Download, label: "下载中", color: "text-blue-400" },
  transcribing: { icon: Mic, label: "转写中", color: "text-violet-400" },
  translating: { icon: Languages, label: "翻译中", color: "text-amber-400" },
  done: { icon: CheckCircle2, label: "完成", color: "text-emerald-400" },
  error: { icon: AlertCircle, label: "错误", color: "text-destructive" },
};

export function TaskProgress({ phase, progress, message }: TaskState) {
  if (phase === "idle") return null;

  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  const isActive = !["done", "error", "idle"].includes(phase);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {isActive ? (
          <Loader2 className={`h-4 w-4 animate-spin ${meta.color}`} />
        ) : (
          <Icon className={`h-4 w-4 ${meta.color}`} />
        )}
        <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
        {message && (
          <span className="ml-auto text-xs text-muted-foreground">{message}</span>
        )}
      </div>
      {isActive && <Progress value={progress} className="h-1.5" />}
    </div>
  );
}
