import { useCallback, useRef, useState } from "react";
import { Upload, Link, FileVideo, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MediaInput } from "@/types";

const LANGUAGES = [
  { value: "auto", label: "自动检测" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "yue", label: "粤语" },
];

interface FileUploadZoneProps {
  onSubmit: (input: MediaInput, language: string) => void;
  disabled?: boolean;
}

export function FileUploadZone({ onSubmit, disabled }: FileUploadZoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("auto");

  // ── file selection ──────────────────────────────────────────────
  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      onSubmit({ type: "file", file, name: file.name }, language);
    },
    [onSubmit, language],
  );

  // ── drag & drop ─────────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // ── URL submit ──────────────────────────────────────────────────
  const handleUrlSubmit = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onSubmit({ type: "url", url: trimmed, name: trimmed }, language);
    setUrl("");
  }, [url, onSubmit, language]);

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {disabled ? (
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-10 w-10 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium">拖放视频/音频文件到这里</p>
          <p className="text-xs text-muted-foreground">
            支持 MP4, WebM, MKV, MP3, WAV, M4A 等格式
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={disabled}>
          <FileVideo className="mr-1.5 h-3.5 w-3.5" />
          选择文件
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* URL input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
            placeholder="粘贴 YouTube / Bilibili / 视频直链..."
            className="pl-9"
            disabled={disabled}
          />
        </div>
        <Button onClick={handleUrlSubmit} disabled={disabled || !url.trim()}>
          开始
        </Button>
      </div>

      {/* Language selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">源语言:</span>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
