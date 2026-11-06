// Tests for the setup orchestrator's version-pin consistency: the TS step
// modules duplicate pins from .devcontainer/tool-versions.bash (their shell
// single home) and devcontainer.json pins the image's node feature version.
// These are drift guards, not behavior tests: bumping a version means
// bumping it in the bash file AND the TS constant (and the feature pin for
// node) in one reviewed change — these tests fail if any side is forgotten.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/** Extract a `export NAME="value"` (or bare) assignment from tool-versions.bash. */
function toolVersion(name: string): string {
  const m = read(".devcontainer/tool-versions.bash").match(
    new RegExp(`^export ${name}="([^"]+)"`, "m"),
  );
  expect(m, `tool-versions.bash must export ${name}`).toBeTruthy();
  return m![1] as string;
}

/** Extract a `const NAME = "value"` (or array literal) from a TS module. */
function tsConst(file: string, name: string): string {
  const src = read(file);
  const m = src.match(new RegExp(`const ${name}(?:: [^=]+)? = ("[^"]+"|\\[[^\\]]*\\])`));
  expect(m, `${file} must declare const ${name}`).toBeTruthy();
  return m![1] as string;
}

describe("setup version-pin consistency (drift guards)", () => {
  it("NODE_VERSION: setup.ts == tool-versions.bash == devcontainer.json feature pin", () => {
    const ts = tsConst("tools/ts/setup.ts", "NODE_VERSION").replaceAll('"', "");
    const bash = toolVersion("NODE_VERSION");
    const devcontainer = read(".devcontainer/devcontainer.json");
    const fm = devcontainer.match(
      /features\/node:1[\s\S]*?"version":\s*"([^"]+)"/,
    );
    expect(fm, "devcontainer.json must pin the node feature version").toBeTruthy();
    expect(ts).toBe(bash);
    expect(ts).toBe(fm![1]);
  });

  it("PNPM_VERSION: node-globals.ts == tool-versions.bash", () => {
    expect(tsConst("tools/ts/setup-steps/node-globals.ts", "PNPM_VERSION").replaceAll('"', ""))
      .toBe(toolVersion("PNPM_VERSION"));
  });

  it("TURBO_VERSION: node-globals.ts == tool-versions.bash", () => {
    expect(tsConst("tools/ts/setup-steps/node-globals.ts", "TURBO_VERSION").replaceAll('"', ""))
      .toBe(toolVersion("TURBO_VERSION"));
  });

  it("DOTNET_CHANNELS: dotnet.ts == tool-versions.bash (same set, same order)", () => {
    const bash = toolVersion("DOTNET_CHANNELS").split(/\s+/);
    const m = tsConst("tools/ts/setup-steps/dotnet.ts", "DOTNET_CHANNELS")
      .match(/\[([^\]]*)\]/)!;
    const ts = (m![1] as string)
      .split(",")
      .map((s) => s.trim().replaceAll('"', ""))
      .filter(Boolean);
    expect(ts).toEqual(bash);
  });

  it("K8S_APT_TRACK: apt-repos.ts == tool-versions.bash", () => {
    expect(tsConst("tools/ts/setup-steps/apt-repos.ts", "K8S_APT_TRACK").replaceAll('"', ""))
      .toBe(toolVersion("K8S_APT_TRACK"));
  });
});
