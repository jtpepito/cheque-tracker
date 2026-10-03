import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server builds into its own folder so it can run next to a local production build.
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // Database drivers are loaded by Node at run time, not bundled.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;
