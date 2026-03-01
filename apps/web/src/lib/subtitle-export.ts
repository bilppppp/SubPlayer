import type { Segment, ExportFormat } from "@/types";

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function formatVttTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad3(ms)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export function toSrt(segments: Segment[], includeTranslation = false): string {
  return (
    segments
      .map((seg, i) => {
        const lines = [`${i + 1}`, `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}`];
        lines.push(seg.text);
        if (includeTranslation && seg.translation) {
          lines.push(seg.translation);
        }
        return lines.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

export function toVtt(segments: Segment[], includeTranslation = false): string {
  const lines = ["WEBVTT", ""];
  for (const seg of segments) {
    lines.push(`${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}`);
    lines.push(seg.text);
    if (includeTranslation && seg.translation) {
      lines.push(seg.translation);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function toJson(segments: Segment[]): string {
  return JSON.stringify(segments, null, 2);
}

export function toMarkdown(segments: Segment[], includeTranslation = false): string {
  return segments
    .map((seg) => {
      let md = `- **${formatSrtTime(seg.start).slice(0, 8)}**: ${seg.text}`;
      if (includeTranslation && seg.translation) {
        md += `\n  - *${seg.translation}*`;
      }
      return md;
    })
    .join("\n\n");
}

export function toTxt(segments: Segment[], includeTranslation = false): string {
  return segments
    .map((seg) => {
      let txt = seg.text;
      if (includeTranslation && seg.translation) {
        txt += `\n${seg.translation}`;
      }
      return txt;
    })
    .join("\n\n");
}

export function exportSubtitles(
  segments: Segment[],
  format: ExportFormat,
  filename: string,
  includeTranslation = false,
): void {
  let content: string;
  let mimeType: string;
  let ext: string;

  switch (format) {
    case "srt":
      content = toSrt(segments, includeTranslation);
      mimeType = "text/plain";
      ext = "srt";
      break;
    case "vtt":
      content = toVtt(segments, includeTranslation);
      mimeType = "text/vtt";
      ext = "vtt";
      break;
    case "json":
      content = toJson(segments);
      mimeType = "application/json";
      ext = "json";
      break;
    case "md":
      content = toMarkdown(segments, includeTranslation);
      mimeType = "text/markdown";
      ext = "md";
      break;
    case "txt":
      content = toTxt(segments, includeTranslation);
      mimeType = "text/plain";
      ext = "txt";
      break;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}
