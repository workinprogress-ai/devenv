// Tests for devenv root resolution: tools derive their checkout from their own
// module location, never from the process working directory.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, copyFileSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { selfRoot } from "../../lib/core/self-root.ts";
import { surfacesConfigPath } from "../../lib/domain/fork/surfaces.ts";
import { surfacesConfigPath as forkSurfacesConfigPath } from "../../lib/domain/fork/index.ts";
import { tmpDir, rmrf, toolScript } from "./harness/index.ts";
import { REPO_ROOT } from "./harness/run-tool.ts";

let parent = "";
let nested = "";
let ownCheckout = "";

beforeAll(() => {
  parent = realpathSync(tmpDir("root-res-"));
  nested = join(parent, "repos", "clone");
  for (const root of [parent, nested]) {
    mkdirSync(join(root, "tools", "ts"), { recursive: true });
    mkdirSync(join(root, "tools", "lib", "domain"), { recursive: true });
  }
  writeFileSync(join(parent, "devenv.config"), "[testsec]\nkey = PARENT\n[ownsec]\nownkey = PARENT\n");
  writeFileSync(join(nested, "devenv.config"), "[testsec]\nkey = NESTED\n[ownsec]\nownkey = NESTED\n");
  // A full copy of the tool and its library: the tool's own checkout, holding
  // a distinctive config value that neither cwd fixture carries.
  ownCheckout = join(parent, "own-checkout");
  mkdirSync(join(ownCheckout, "tools", "ts"), { recursive: true });
  cpSync(join(REPO_ROOT, "tools", "lib"), join(ownCheckout, "tools", "lib"), { recursive: true });
  copyFileSync(toolScript("config-read"), join(ownCheckout, "tools", "ts", "config-read.ts"));
  writeFileSync(join(ownCheckout, "devenv.config"), "[ownsec]\nownkey = OWN-CHECKOUT\n");
});
afterAll(() => rmrf(parent));

/** Child env with every devenv root export removed. */
function unsetEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["DEVENV_ROOT"];
  delete env["DEVENV_TOOLS"];
  return env;
}

describe("selfRoot", () => {
  it("resolves a module file to its own checkout, parent or nested", () => {
    expect(selfRoot(join(parent, "tools", "ts", "x.ts"))).toBe(parent);
    expect(selfRoot(join(nested, "tools", "ts", "x.ts"))).toBe(nested);
    expect(selfRoot(join(nested, "tools", "lib", "domain", "x.ts"))).toBe(nested);
  });

  it("treats its argument as a file: a checkout directory resolves one level too high", () => {
    expect(selfRoot(nested)).toBe(parent);
  });
});

describe("no tool derives its root from the working directory", () => {
  it("has no selfRoot(process.cwd()) call in tool code", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && /(selfRoot|resolveToolsRoot)\(\s*process\.cwd\(\)/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    for (const d of ["ts", "lib", "internal"]) walk(join(REPO_ROOT, "tools", d));
    expect(hits).toEqual([]);
  });

  it("uses process.cwd() only where a tool picks a target repository", () => {
    // A cwd-derived devenv root adopts whatever checkout the shell happens to
    // sit in. Each entry below uses the cwd to choose the repository (or
    // directory) the tool acts ON, never to locate the devenv checkout itself.
    const ALLOWED: Record<string, string> = {
      "cs-nuget-publish-local.ts": "defaults the project to publish to the cwd when no argv target is given",
      "cs-open-coverage.ts": "scans the cwd for coverage reports (the project under test)",
      "cs-references-update.ts": "defaults the target repository to the cwd",
      "devenv-marker-check.ts": "prints scanned paths relative to the cwd",
      "issue-artifact-upsert.ts": "walks up from the cwd to find the target repository's artifact folder",
      "issue-create.ts": "looks for the target repository's ISSUE_TEMPLATE folder under the cwd",
      "pr-cleanup-review-branches.ts": "defaults the target repository to the cwd",
      "pr-create-for-review.ts": "defaults the target repository to the cwd",
      "pr-create.ts": "defaults the target repository to the cwd",
      "pr-get-merge-link.ts": "defaults the target repository to the cwd",
      "pr-get-review-link.ts": "defaults the target repository to the cwd",
      "pr-merge.ts": "defaults the target repository to the cwd",
      "repo-get-web-url.ts": "defaults the target repository to the cwd",
      "skill-orient.ts": "falls back to the cwd as the scope when git cannot name a repository top level",
    };
    const hits: string[] = [];
    const rootFallbacks: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith(".ts")) continue;
        const text = readFileSync(p, "utf8");
        if (!/process\.cwd\(\)/.test(text)) continue;
        if (/DEVENV_ROOT[^\n]*process\.cwd\(\)|process\.cwd\(\)[^\n]*DEVENV_ROOT/.test(text)) rootFallbacks.push(p);
        if (ALLOWED[e] === undefined) hits.push(p);
      }
    };
    for (const d of ["ts", "lib", "internal"]) walk(join(REPO_ROOT, "tools", d));
    expect(rootFallbacks, "DEVENV_ROOT must fall back to selfRoot(import.meta.url), never the cwd").toEqual([]);
    expect(hits, "process.cwd() in a file that is not an allowed target-repository default").toEqual([]);
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(readdirSync(join(REPO_ROOT, "tools", "ts")), `allow-list entry ${file} no longer exists`).toContain(file);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("surfacesConfigPath falls back to this checkout's tools/config", () => {
    const expected = join(REPO_ROOT, "tools", "config", "fork-surfaces.yml");
    const prev = process.env["FORK_SURFACES_CONFIG"];
    delete process.env["FORK_SURFACES_CONFIG"];
    try {
      expect(surfacesConfigPath()).toBe(expected);
      expect(forkSurfacesConfigPath()).toBe(expected);
    } finally {
      if (prev !== undefined) process.env["FORK_SURFACES_CONFIG"] = prev;
    }
  });

  for (const [label, getCwd] of [["a checkout root", () => parent], ["a nested clone", () => nested]] as const) {
    describe(`with cwd = ${label} and DEVENV_ROOT/DEVENV_TOOLS unset`, () => {
      it("config-read reads its own checkout's devenv.config, not the cwd's", () => {
        const r = spawnSync("node", [join(ownCheckout, "tools", "ts", "config-read.ts"), "ownsec", "ownkey", "FALLBACK"], {
          encoding: "utf8", cwd: getCwd(), env: unsetEnv(),
        });
        expect(r.stderr).not.toContain("cannot derive devenv root");
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("OWN-CHECKOUT");
      });

      it("skill-orient runs without deriving a root from the cwd", () => {
        const r = spawnSync("node", [toolScript("skill-orient")], {
          encoding: "utf8", cwd: getCwd(), env: unsetEnv(),
        });
        expect(r.stderr).not.toContain("cannot derive devenv root");
        expect(r.status).toBe(0);
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      });
    });
  }
});
