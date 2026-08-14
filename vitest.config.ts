import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

export default defineConfig({
  test: {
    include: ["core/test/**/*.test.ts", "e2e/**/*.test.ts"],
    testTimeout: 30_000,
    // Windows CI runners are slow spawning the compiled CLI + SQLite I/O; run
    // E2E files serially there to remove resource contention (not a hang).
    // Linux/macOS stay parallel.
    fileParallelism: !isWindows,
  },
});
