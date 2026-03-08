import { describe, expect, test } from "bun:test";
import { exportSubtitles, toMarkdown, toSrt, toTxt, toVtt } from "./subtitle-export";

describe("subtitle export", () => {
  const segments = [
    { start: 0, end: 1.23, text: "hello", translation: "你好" },
    { start: 1.23, end: 2.5, text: "world", translation: "世界" },
  ];

  test("toSrt outputs numbered blocks", () => {
    const out = toSrt(segments, true);
    expect(out).toContain("1");
    expect(out).toContain("00:00:00,000 --> 00:00:01,230");
    expect(out).toContain("hello");
    expect(out).toContain("你好");
  });

  test("toVtt outputs header", () => {
    const out = toVtt(segments, false);
    expect(out.startsWith("WEBVTT")).toBe(true);
    expect(out).toContain("00:00:01.230 --> 00:00:02.500");
  });

  test("toMarkdown and toTxt include content", () => {
    expect(toMarkdown(segments, true)).toContain("hello");
    expect(toMarkdown(segments, true)).toContain("你好");
    expect(toTxt(segments, false)).toContain("world");
  });

  test("exportSubtitles success path creates download link", () => {
    const originalDocument = globalThis.document;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    let clicked = 0;
    let revoked = "";
    const anchor = {
      href: "",
      download: "",
      click: () => {
        clicked += 1;
      },
    };

    (globalThis as unknown as { document: Document }).document = {
      createElement: () => anchor,
    } as unknown as Document;

    (URL as unknown as {
      createObjectURL: (blob: Blob) => string;
      revokeObjectURL: (url: string) => void;
    }).createObjectURL = (blob: Blob) => {
      void blob;
      return "blob:subplayer-test";
    };
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = (url: string) => {
      revoked = url;
    };

    try {
      exportSubtitles(segments, "srt", "demo", true);
      expect(anchor.download).toBe("demo.srt");
      expect(anchor.href).toBe("blob:subplayer-test");
      expect(clicked).toBe(1);
      expect(revoked).toBe("blob:subplayer-test");
    } finally {
      (globalThis as unknown as { document?: Document }).document = originalDocument;
      (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = originalCreateObjectURL;
      (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = originalRevokeObjectURL;
    }
  });

  test("exportSubtitles failure path propagates blob URL errors", () => {
    const originalDocument = globalThis.document;
    const originalCreateObjectURL = URL.createObjectURL;

    (globalThis as unknown as { document: Document }).document = {
      createElement: () => ({
        href: "",
        download: "",
        click: () => undefined,
      }),
    } as unknown as Document;

    (URL as unknown as { createObjectURL: (_blob: Blob) => string }).createObjectURL = () => {
      throw new Error("createObjectURL failed");
    };

    try {
      expect(() => exportSubtitles(segments, "vtt", "demo", false)).toThrow("createObjectURL failed");
    } finally {
      (globalThis as unknown as { document?: Document }).document = originalDocument;
      (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = originalCreateObjectURL;
    }
  });
});
