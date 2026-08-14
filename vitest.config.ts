import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["core/test/**/*.test.ts", "e2e/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
