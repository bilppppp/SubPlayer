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
  provider?: string;
  error?: string;
}

export interface ReadableBlock {
  startSegmentIndex: number;
  endSegmentIndex: number;
  start: number;
  end: number;
  text: string;
  translation?: string;
}

export interface TranslateResult {
  ok: boolean;
  segments: Segment[];
  readableBlocks?: ReadableBlock[];
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

// ── Subtitle display mode ────────────────────────────────────────────

/** "bilingual" = both, "original" = source only, "translation" = translated only */
export type SubtitleMode = "bilingual" | "original" | "translation";

// ── Export format ────────────────────────────────────────────────────

export type ExportFormat = "srt" | "vtt" | "json" | "md" | "txt";

// ── Video proxy ─────────────────────────────────────────────────────

export type VideoPlayMode = "proxy-stream" | "download-fallback" | "direct";

export interface VideoPrepareResult {
  ok: boolean;
  streamUrl?: string;
  playMode?: VideoPlayMode;
  error?: string;
  code?: string;
}

export interface DirectCapturePayload {
  originUrl: string;
  mediaUrl: string;
  headers?: {
    referer?: string;
    origin?: string;
    userAgent?: string;
    cookie?: string;
  };
  kind?: "hls" | "dash" | "mp4" | "unknown";
}

// ── Preprocess Job ──────────────────────────────────────────────────

export type PreprocessJobStatus = "queued" | "processing" | "done" | "failed" | "not_found";

export interface PreprocessResultPayload {
  url: string;
  language: string;
  targetLang: string;
  provider?: string;
  segments: Segment[];
  createdAt: number;
}

export interface PreprocessResultResponse {
  ok: boolean;
  key?: string;
  status: PreprocessJobStatus;
  progress?: number;
  step?: string;
  message?: string;
  error?: string;
  result?: PreprocessResultPayload;
}

// ── ASR Capability ──────────────────────────────────────────────────

export interface AsrCapabilityPayload {
  localReady: boolean;
  localReason: string;
  localModelsLoaded: boolean;
  localHealthStatus: string;
  ffmpegReady: boolean;
  ffprobeReady: boolean;
  ytDlpReady: boolean;
  cloudAvailable: {
    volcengine: boolean;
    aliyun: boolean;
  };
  recommendedProvider: "local" | "volcengine" | "aliyun" | "none";
  canTranscribe: boolean;
}

export interface AsrCapabilityResponse {
  ok: boolean;
  configured_provider?: string;
  fallback_chain?: string[];
  capability?: AsrCapabilityPayload;
  provider_order_auto?: string[];
  error?: string;
}
