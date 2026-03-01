"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExportFormat, Segment, ReadableBlock } from "@/types";
import { exportSubtitles } from "@/lib/subtitle-export";

interface ExportDialogProps {
  segments: Segment[];
  readableBlocks?: ReadableBlock[];
  filename: string;
  hasTranslation: boolean;
}

export function ExportDialog({ segments, readableBlocks, filename, hasTranslation }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("srt");
  const [includeTranslation, setIncludeTranslation] = useState(true);
  const [open, setOpen] = useState(false);

  const handleExport = () => {
    const baseName = filename.replace(/\.[^.]+$/, "") || "subtitles";
    // For txt/md we prefer readableBlocks if available, otherwise segments.
    // For srt/vtt we prefer segments (pure timing).
    // Let's pass readableBlocks down to exportSubtitles if format is txt/md.
    const exportData = (format === "md" || format === "txt" || format === "json") && readableBlocks ? readableBlocks : segments;
    exportSubtitles(exportData as any, format, baseName, includeTranslation && hasTranslation);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={segments.length === 0}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          导出
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>导出字幕</DialogTitle>
          <DialogDescription>选择格式并下载字幕文件</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm">格式</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="srt">SRT</SelectItem>
                <SelectItem value="vtt">WebVTT</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="md">Markdown</SelectItem>
                <SelectItem value="txt">TXT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasTranslation && (
            <div className="flex items-center gap-3">
              <Label className="w-16 shrink-0 text-right text-sm">译文</Label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeTranslation}
                  onChange={(e) => setIncludeTranslation(e.target.checked)}
                  className="rounded"
                />
                包含译文
              </label>
            </div>
          )}
        </div>

        <Button onClick={handleExport} className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
          <Download className="mr-1.5 h-4 w-4" />
          下载 .{format} 文件
        </Button>
      </DialogContent>
    </Dialog>
  );
}
