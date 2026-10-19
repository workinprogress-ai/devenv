import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/tests/ts/**/*.test.ts"],
    environment: "node",
    // Black-box style is the port pattern: tests spawn tools and assert on
    // status/output. Unit tests of lib modules live alongside.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
