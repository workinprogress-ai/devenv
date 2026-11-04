// Minimal config for run-smoke-tests: the azure smoke-harness suite runs
// here EXPLICITLY (it is excluded from the default lane in vitest.config.ts
// because it takes many minutes). Same base settings, no exclude.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/tests/ts/azure-smoke-harness.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
