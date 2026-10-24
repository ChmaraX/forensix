import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

export default defineConfig({
  // The client's own `@/…` import alias (client/tsconfig.json `paths`), so
  // client unit tests can import modules that use it.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("client/src", import.meta.url)),
    },
  },
  test: {
    include: [
      "core/test/**/*.test.ts",
      "e2e/**/*.test.ts",
      // Pure client rules (no DOM): the secret-field classifier, day bounds,
      // the download size reading.
      "client/src/**/*.test.ts",
    ],
    testTimeout: 30_000,
    // Windows CI runners are slow spawning the compiled CLI + SQLite I/O; run
    // E2E files serially there to remove resource contention (not a hang).
    // Linux/macOS stay parallel.
    fileParallelism: !isWindows,
  },
});
