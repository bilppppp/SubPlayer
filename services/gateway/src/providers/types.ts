// ── ASR Provider unified interface ──────────────────────────────────

export interface Segment {
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

export interface TranscribeOptions {
  language: string;        // "auto" | "zh" | "en" | "ja" | "ko" | ...
  format?: string;         // "wav" | "mp3" | "m4a" — hint for cloud APIs
  enableTimestamp?: boolean;
  apiKeys?: {
    volcengineAppId?: string;
    volcengineToken?: string;
    volcengineSecretKey?: string;
    volcengineResourceId?: string;
    volcengineMode?: "bigmodel_nostream" | "bigmodel" | "bigmodel_async" | "flash" | "legacy_auc";
    allowAsrAutoDowngrade?: boolean;
    aliyunKey?: string;
  };
}

export interface TranscribeResult {
  ok: boolean;
  language: string;
  segments: Segment[];
  full_text: string;
  provider: string;        // which provider fulfilled this request
  completion?: "final" | "partial_complete";
  error?: string;
}

/**
 * Every ASR provider must implement this interface.
 * The gateway calls `transcribe()` with a local file path.
 */
export interface ASRProvider {
  /** Human-readable name, e.g. "local-funasr" */
  readonly name: string;

  /**
   * Transcribe an audio file and return timed segments.
   * @param audioPath  Absolute path to a local WAV/MP3 file.
   * @param options    Language, format hints, etc.
   */
  transcribe(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult>;

  /** Quick connectivity / credential check. */
  isAvailable(): Promise<boolean>;
}
