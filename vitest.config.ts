import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/tests/ts/**/*.test.ts"],
    environment: "node",
    // Every worker starts hermetic: no host devenv root, credentials or provider
    // config, so a regular run can never reach a real backend.
    setupFiles: ["./tools/tests/ts/harness/scrub-env.ts"],
    // Black-box style is the port pattern: tests spawn tools and assert on
    // status/output. Unit tests of lib modules live alongside.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
