// Port of tools/tests/lib/test_provider_azure_capabilities.bats (2 tests):
// the azure provider's capability declarations. The capability contract
// (provider-core) declares four canonical capabilities — rulesets,
// project-boards, native-issue-types, pipelines. Azure implements all four
// but historically declared none: these tests lock the dual-provider truth.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

describe("azure capability declarations", () => {
  it("azure declares all four canonical capabilities", () => {
    const devenvRoot = mkdtempSync(join(tmpdir(), `azcap-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    mkdirSync(devenvRoot, { recursive: true });
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
        `PROVIDER_NAME=azure\n` +
        `provider_load issues projects pipelines org\n` +
        `for cap in rulesets project-boards native-issue-types pipelines; do\n` +
        `  provider_has_capability "$cap" || { echo "MISSING: $cap" >&2; exit 1; }\n` +
        `done`,
      ],
      { encoding: "utf8", env: { ...process.env, DEVENV_ROOT: devenvRoot } },
    );
    expect(r.status ?? 1).toBe(0);
  });

  it("azure capability declarations match github's canonical set", () => {
    // Compare each provider's loaded capability set in its own subshell —
    // provider-core's loaded-guard makes a second in-shell source a no-op,
    // so cross-provider comparison must not share one shell.
    const caps = (provider: string): string[] => {
      const devenvRoot = mkdtempSync(join(tmpdir(), `azcap2-${Date.now()}-${Math.random().toString(36).slice(2)}`));
      mkdirSync(devenvRoot, { recursive: true });
      const r = spawnSync(
        "bash",
        [
          "-c",
          `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
          `PROVIDER_NAME=${provider}\n` +
          `provider_load issues projects pipelines org\n` +
          `echo "$PROVIDER_CAPABILITIES"`,
        ],
        { encoding: "utf8", env: { ...process.env, DEVENV_ROOT: devenvRoot } },
      );
      return (r.stdout ?? "").trim().split(/\s+/).filter(Boolean);
    };
    const azureCaps = caps("azure");
    const githubCaps = caps("github");
    expect(azureCaps.length, "azure set empty").toBeGreaterThan(0);
    expect(githubCaps.length, "github set empty").toBeGreaterThan(0);
    for (const cap of githubCaps) {
      expect(azureCaps, `azure missing github capability: ${cap}`).toContain(cap);
    }
  });
});
