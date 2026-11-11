// The sibling helper: tool-to-tool calls run the sibling's TypeScript entry
// point from this checkout, never a generated depth-1 stub.
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { siblingCommand, siblingScript } from "../../lib/core/sibling.ts";
import { TOOLS } from "./harness/index.ts";

describe("core/sibling", () => {
  it("resolves a sibling to this checkout's tools/ts/<name>.ts", () => {
    expect(siblingScript("repo-get")).toBe(join(TOOLS, "ts", "repo-get.ts"));
    expect(existsSync(siblingScript("repo-get"))).toBe(true);
  });

  it("runs the sibling with the current node binary by default", () => {
    expect(siblingCommand("pr-create")).toEqual([process.execPath, join(TOOLS, "ts", "pr-create.ts")]);
  });

  it("never points at the depth-1 stub path", () => {
    expect(siblingCommand("repo-get").join(" ")).not.toContain(join(TOOLS, "repo-get"));
  });

  it("honors an override root exactly as the injected directory lays it out", () => {
    expect(siblingCommand("pr-create", "/fixture/tools")).toEqual(["/fixture/tools/pr-create"]);
    expect(siblingCommand("pr-create", "/fixture/tools", true)).toEqual(["bash", "/fixture/tools/pr-create"]);
  });

  it("serves a fixture checkout that has only a script at its root", () => {
    const fixture = mkdtempSync(join(tmpdir(), "sibling-fixture-"));
    try {
      mkdirSync(join(fixture, "lib", "core"), { recursive: true });
      cpSync(join(TOOLS, "lib", "core", "sibling.ts"), join(fixture, "lib", "core", "sibling.ts"));
      writeFileSync(join(fixture, "fake-tool"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
      const r = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `import { siblingCommand } from ${JSON.stringify(join(fixture, "lib", "core", "sibling.ts"))};\nconsole.log(JSON.stringify([siblingCommand("fake-tool"), siblingCommand("absent-tool")]));`],
        { encoding: "utf8" },
      );
      expect(r.status).toBe(0);
      const [present, absent] = JSON.parse(r.stdout) as string[][];
      expect(present).toEqual([join(fixture, "fake-tool")]);
      expect(absent).toEqual([process.execPath, join(fixture, "ts", "absent-tool.ts")]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("treats an empty override as unset", () => {
    expect(siblingCommand("pr-create", "")).toEqual([process.execPath, join(TOOLS, "ts", "pr-create.ts")]);
  });
});
