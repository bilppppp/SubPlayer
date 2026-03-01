import { describe, expect, it } from "bun:test";
import { firstPlayableUrl } from "./playable-url.js";

describe("firstPlayableUrl", () => {
  it("returns null for empty output", () => {
    expect(firstPlayableUrl("")).toBeNull();
  });

  it("returns single URL when only one exists", () => {
    const url = "https://cdn.example.com/video.mp4";
    expect(firstPlayableUrl(url)).toBe(url);
  });

  it("prefers manifest when yt-dlp outputs multiple lines", () => {
    const raw = [
      "https://cdn.example.com/video-only.mp4",
      "https://cdn.example.com/master.m3u8",
    ].join("\n");
    expect(firstPlayableUrl(raw)).toBe("https://cdn.example.com/master.m3u8");
  });

  it("returns null when multiple direct media URLs exist without manifest", () => {
    const raw = [
      "https://cdn.example.com/video-only.mp4",
      "https://cdn.example.com/audio-only.m4a",
    ].join("\n");
    expect(firstPlayableUrl(raw)).toBeNull();
  });
});

