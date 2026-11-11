// harness/scrub-env.ts — vitest setup file: runs before every test file so the
// worker (and every child process a suite spawns from it) starts hermetic, and
// every test is checked afterwards for an escape to a provider backend.
import { afterAll, afterEach, beforeEach } from "vitest";
import { assertNoCanaryHits } from "./canary.ts";
import { installFetchCanary } from "./canary-fetch.ts";
import { applyHermeticEnv, restoreAnchors } from "./env.ts";

applyHermeticEnv();
installFetchCanary(process.env["DEVENV_TEST_CANARY_LOG"] ?? "");

beforeEach(() => {
  restoreAnchors();
});

afterEach(() => {
  assertNoCanaryHits();
});

// A call made in beforeAll/afterAll, at module scope or by a child that outlives
// the last test is attributed here instead of being lost.
afterAll(() => {
  assertNoCanaryHits();
});
