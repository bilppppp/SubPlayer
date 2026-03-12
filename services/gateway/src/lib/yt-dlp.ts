const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type YtDlpConfig = {
  ytCookiesBrowser: string;
  ytDlpJsRuntimes: string;
  ytDlpRemoteComponents: string;
  ytDlpYoutubePoToken: string;
  ytDlpYoutubePlayerClients: string;
};

export type YtDlpAttemptFailure = {
  outputPrefix: string;
  args: string[];
  error: string;
};

function isYoutubeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "youtu.be" || hostname.endsWith("youtube.com");
  } catch {
    return false;
  }
}

function siteReferer(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("pornhub.com")) return `${u.protocol}//${u.host}/`;
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "https://www.bilibili.com/";
    return null;
  } catch {
    return null;
  }
}

export function buildYtDlpArgs(url: string | undefined, cfg: YtDlpConfig): string[] {
  const args = [
    "--force-ipv4",
    "--retries", "3",
    "--no-warnings",
    "--no-playlist",
    "--concurrent-fragments", "4",
    "--extractor-args", "generic:impersonate",
    "--user-agent", DEFAULT_USER_AGENT,
  ];

  if (cfg.ytCookiesBrowser) {
    args.push("--cookies-from-browser", cfg.ytCookiesBrowser);
  }

  const referer = siteReferer(url);
  if (referer) {
    args.push("--referer", referer);
  }

  if (!isYoutubeUrl(url)) {
    return args;
  }

  if (cfg.ytDlpJsRuntimes) {
    args.push("--js-runtimes", cfg.ytDlpJsRuntimes);
  }
  if (cfg.ytDlpRemoteComponents) {
    args.push("--remote-components", cfg.ytDlpRemoteComponents);
  }

  const youtubeExtractorArgs: string[] = [];
  if (cfg.ytDlpYoutubePlayerClients) {
    youtubeExtractorArgs.push(`player_client=${cfg.ytDlpYoutubePlayerClients}`);
  }
  if (cfg.ytDlpYoutubePoToken) {
    youtubeExtractorArgs.push(`po_token=${cfg.ytDlpYoutubePoToken}`);
  }
  if (youtubeExtractorArgs.length > 0) {
    args.push("--extractor-args", `youtube:${youtubeExtractorArgs.join(";")}`);
  }

  return args;
}

export function buildYtDlpArgVariants(url: string | undefined, cfg: YtDlpConfig): string[][] {
  if (!cfg.ytCookiesBrowser) {
    return [buildYtDlpArgs(url, cfg)];
  }

  if (!isYoutubeUrl(url)) {
    return [buildYtDlpArgs(url, cfg)];
  }

  const withoutCookies = buildYtDlpArgs(url, {
    ...cfg,
    ytCookiesBrowser: "",
  });
  const withCookies = buildYtDlpArgs(url, cfg);
  return [withoutCookies, withCookies];
}

export function summarizeYtDlpFailure(failures: YtDlpAttemptFailure[]): string {
  const summary = failures
    .map(({ outputPrefix, error }) => {
      const compactError = error.replace(/\s+/g, " ").trim();
      return `${outputPrefix}: ${compactError}`;
    })
    .join(" | ");

  return summary || "yt-dlp failed without stderr output";
}
