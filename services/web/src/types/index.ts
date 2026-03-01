// ── Core data types ─────────────────────────────────────────────────

export interface Segment {
  start: number;
  end: number;
  text: string;
  translation?: string;
}

export interface TranscribeResult {
  ok: boolean;
  language: string;
  full_text: string;
  segments: Segment[];
  error?: string;
}

export interface TranslateResult {
  ok: boolean;
  segments: Segment[];
  error?: string;
}

// ── Task status ─────────────────────────────────────────────────────

export type TaskPhase =
  | "idle"
  | "uploading"
  | "downloading"
  | "transcribing"
  | "translating"
  | "done"
  | "error";

export interface TaskState {
  phase: TaskPhase;
  progress: number; // 0-100
  message: string;
}

// ── Media source ────────────────────────────────────────────────────

export type MediaSourceType = "file" | "url";

export interface MediaInput {
  type: MediaSourceType;
  file?: File;
  url?: string;
  name: string;
}

// ── Export format ────────────────────────────────────────────────────

export type ExportFormat = "srt" | "vtt" | "json";
