import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Clone-context suites assert invariants of the dev-clone layout (the
// repos/devenv nested clone; devenv.config isolation from the real
// checkout). Those premises only hold in a dev clone: on the outer runtime
// workspace the checkout itself hosts repos/devenv, and the "real config"
// IS this checkout's config. Detection: a checkout hosting repos/devenv is
// the runtime workspace; a dev clone contains no nested devenv clone. See
// docs/Nested-Devenv-Development.md. (Vitest resolves the relative globs
// against the checkout root, which is also cwd in every supported
// invocation — the test runner cds to the checkout root first.)
const isRuntimeWorkspace = existsSync(join(process.cwd(), "repos", "devenv"));

export default defineConfig({
  test: {
    include: ["tools/tests/ts/**/*.test.ts"],
    exclude: [
      // Clone-context suites on the runtime workspace only (see above):
      ...(isRuntimeWorkspace
        ? [
            "tools/tests/ts/domain-cs-dependency-graph.test.ts",
          ]
        : []),
    ],
    environment: "node",
    // Black-box style is the port pattern: tests spawn tools and assert on
    // status/output. Unit tests of lib modules live alongside.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
