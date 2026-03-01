export function firstPlayableUrl(raw: string): string | null {
  const urls = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((line) => /^https?:\/\//i.test(line));
  if (urls.length === 0) return null;
  if (urls.length === 1) return urls[0];

  // Prefer master manifests (usually contain both audio/video renditions).
  const manifestLike = urls.find((u) =>
    /\.m3u8(\?|$)/i.test(u) ||
    /\.mpd(\?|$)/i.test(u) ||
    /playlist|manifest/i.test(u),
  );
  if (manifestLike) return manifestLike;

  // Multiple direct URLs are often split A/V tracks.
  return null;
}

