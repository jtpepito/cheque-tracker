import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server builds into its own folder so it can run next to a local production build.
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // The Docker image (Fly.io) uses Next's self-contained server.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
