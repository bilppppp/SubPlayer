import { describe, expect, it } from "bun:test";
import {
  buildYtDlpArgs,
  buildYtDlpArgVariants,
  summarizeYtDlpFailure,
} from "./yt-dlp.js";

describe("buildYtDlpArgs", () => {
  it("adds explicit js runtime support for youtube urls", () => {
    const args = buildYtDlpArgs("https://www.youtube.com/watch?v=test123", {
      ytCookiesBrowser: "",
      ytDlpJsRuntimes: "deno,node",
      ytDlpRemoteComponents: "js",
      ytDlpYoutubePoToken: "",
      ytDlpYoutubePlayerClients: "",
    });

    expect(args).toContain("--js-runtimes");
    expect(args).toContain("deno,node");
    expect(args).toContain("--remote-components");
    expect(args).toContain("js");
  });

  it("adds youtube po token extractor args when configured", () => {
    const args = buildYtDlpArgs("https://youtu.be/test123", {
      ytCookiesBrowser: "",
      ytDlpJsRuntimes: "node",
      ytDlpRemoteComponents: "js",
      ytDlpYoutubePoToken: "web.gvs+TEST_TOKEN",
      ytDlpYoutubePlayerClients: "tv,web",
    });

    const extractorArgValues = args
      .map((arg, index) => (args[index - 1] === "--extractor-args" ? arg : null))
      .filter(Boolean);

    expect(extractorArgValues).toContain("youtube:player_client=tv,web;po_token=web.gvs+TEST_TOKEN");
  });
});

describe("buildYtDlpArgVariants", () => {
  it("tries youtube without browser cookies before the cookie-backed variant", () => {
    const variants = buildYtDlpArgVariants("https://www.youtube.com/watch?v=test123", {
      ytCookiesBrowser: "chrome",
      ytDlpJsRuntimes: "deno,node",
      ytDlpRemoteComponents: "js",
      ytDlpYoutubePoToken: "",
      ytDlpYoutubePlayerClients: "",
    });

    expect(variants).toHaveLength(2);
    expect(variants[0]).not.toContain("--cookies-from-browser");
    expect(variants[1]).toContain("--cookies-from-browser");
    expect(variants[1]).toContain("chrome");
  });

  it("keeps a single cookie-backed variant for non-youtube urls", () => {
    const variants = buildYtDlpArgVariants("https://example.com/video.mp4", {
      ytCookiesBrowser: "chrome",
      ytDlpJsRuntimes: "deno,node",
      ytDlpRemoteComponents: "js",
      ytDlpYoutubePoToken: "",
      ytDlpYoutubePlayerClients: "",
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toContain("--cookies-from-browser");
  });
});

describe("summarizeYtDlpFailure", () => {
  it("preserves the root cause in the final message", () => {
    const message = summarizeYtDlpFailure([
      {
        outputPrefix: "download-audio",
        args: ["-f", "bestaudio/best"],
        error: "yt-dlp failed (1): ERROR: [youtube] abc123: HTTP Error 403: Forbidden",
      },
    ]);

    expect(message).toContain("download-audio");
    expect(message).toContain("HTTP Error 403: Forbidden");
    expect(message).not.toContain("non-empty media file");
  });
});
