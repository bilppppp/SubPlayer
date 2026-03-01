import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API requests → Gateway (dev: localhost:8080, prod: set via env)
  async rewrites() {
    const gateway =
      process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8080";
    return [
      {
        source: "/api/:path*",
        destination: `${gateway}/api/:path*`,
      },
    ];
  },

  // Increase proxy timeout for long-running ASR / translation requests.
  // Default ~30 s is too short for large batch translations or long audio ASR.
  httpAgentOptions: {
    keepAlive: true,
  },

  experimental: {
    proxyTimeout: 600000, // 10 minutes
  },
};

export default nextConfig;
