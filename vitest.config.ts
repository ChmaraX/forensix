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
    // Windows CI runners are slow spawning the compiled CLI + SQLite I/O, and
    // some runners are 3x slower than others: an E2E test that takes 10 s
    // there can take 30 s. Run E2E files serially there to remove resource
    // contention, and give tests and hooks more time (not a hang).
    // Linux/macOS stay parallel with the default hook timeout.
    testTimeout: isWindows ? 90_000 : 30_000,
    hookTimeout: isWindows ? 60_000 : 10_000,
    fileParallelism: !isWindows,
  },
});
