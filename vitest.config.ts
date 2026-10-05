import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Starting the in-process Postgres and applying the migrations takes a few seconds, which is
  // right at Vitest's default 5-second limit and made the migration test fail now and then.
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});
