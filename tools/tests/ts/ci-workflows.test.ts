// Port of tools/tests/devenv/test_ci_workflows.bats (14 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const PUBLISH = join(ROOT, ".github/workflows/publish-release.yml");
const TESTWF = join(ROOT, ".github/workflows/test.yml");

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function yq(expr: string, file: string): { status: number; out: string } {
  const r = spawnSync("yq", [expr, file], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

function releasePlugins(): string[] {
  const r = spawnSync(
    "node",
    ["--input-type=module", "-e", `const c=(await import('file://${ROOT}/release.config.js')).default; console.log(c.plugins.map(p=>Array.isArray(p)?p[0]:p).join('\\n'))`],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").split("\n").filter((l) => l !== "");
}

function devDep(plugin: string): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return (pkg.devDependencies ?? {})[plugin] ?? "";
}

describe("ci workflows", () => {
  it("every workflow pins the Node version the tools run on (tool-versions.bash NODE_VERSION)", () => {
    const expected = /export NODE_VERSION="([^"]+)"/.exec(readFileSync(join(ROOT, ".devcontainer/tool-versions.bash"), "utf8"))?.[1];
    expect(expected).toBeDefined();
    for (const wf of [PUBLISH, TESTWF]) {
      const pins = [...readFileSync(wf, "utf8").matchAll(/node-version:\s*["']?([^"'\s#]+)["']?/g)].map((m) => m[1]);
      expect(pins.length, wf).toBeGreaterThan(0);
      for (const pin of pins) expect(pin, wf).toBe(expected);
    }
  });

  it("the release workflow explains why its Node pin moves in lockstep", () => {
    expect(readFileSync(PUBLISH, "utf8")).toMatch(/lockstep with NODE_VERSION/);
  });

  it("package.json pins the pnpm major that matches the lockfile", () => {
    const pm = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).packageManager as string;
    const major = pm.match(/^pnpm@(\d+)\./)?.[1];
    const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8")
      .match(/^lockfileVersion: '?([0-9.]+)'?/m)?.[1];
    // pnpm 11 still writes lockfileVersion 9.0: regenerating the lockfile
    // under 11.9.0 leaves it unchanged.
    expect(major).toBe("11");
    expect(lock).toBe("9.0");
  });

  it("publish workflow installs the pinned pnpm, not a different hardcoded major", () => {
    const r = sh(`grep -nE 'pnpm@[0-9]+\\.[0-9]+\\.[0-9]+' '${PUBLISH}'`);
    expect(r.status).not.toBe(0);
    const publish = readFileSync(PUBLISH, "utf8");
    expect(publish).toMatch(/corepack enable|pnpm\/action-setup/);
    expect(publish).toContain("--frozen-lockfile");
  });

  it("publish workflow fetches full history and tags (semantic-release needs them)", () => {
    const r = yq('.jobs.tag.steps[] | select(.uses | test("actions/checkout")) | .with."fetch-depth"', PUBLISH);
    expect(r.status).toBe(0);
    expect(r.out).toBe("0");
  });

  it("publish workflow can push tags and create releases (contents: write)", () => {
    const r = yq(".permissions.contents // .jobs.tag.permissions.contents", PUBLISH);
    expect(r.out).toBe("write");
  });

  it("publish workflow has no dead CURRENT_TAG variable", () => {
    const r = sh(`grep -n 'CURRENT_TAG' '${PUBLISH}'`);
    expect(r.status).not.toBe(0);
  });

  it("every semantic-release plugin in release.config.js is a declared devDependency", () => {
    const plugins = releasePlugins();
    expect(plugins.length).toBeGreaterThan(0);
    for (const p of plugins) {
      expect(devDep(p), `plugin ${p} is not in devDependencies`).not.toBe("");
    }
  });

  it("the release pipeline actually publishes: a plugin that creates the release is configured", () => {
    const plugins = releasePlugins().join("\n");
    expect(plugins).toContain("@semantic-release/github");
    expect(plugins).toContain("@semantic-release/release-notes-generator");
  });

  it("test workflow installs yq (suites invoke it)", () => {
    const r = yq('.jobs.test.steps[] | select(.name == "Install dependencies") | .run', TESTWF);
    expect(r.out).toContain("yq");
  });

  it("test workflow fetches full history for the SK007 git-history check", () => {
    const r = yq('.jobs.test.steps[] | select(.uses | test("actions/checkout")) | .with."fetch-depth"', TESTWF);
    expect(r.out).toBe("0");
  });

  it("both workflows serialize overlapping runs with a concurrency group", () => {
    for (const wf of [PUBLISH, TESTWF]) {
      const r = yq('.concurrency.group // ""', wf);
      expect(r.out, `no concurrency group in ${wf}`).not.toBe("");
      expect(r.out).not.toBe("null");
    }
  });

  it("the release workflow never cancels an in-flight release", () => {
    const r = yq('.concurrency."cancel-in-progress"', PUBLISH);
    expect(r.out).toBe("false");
  });

  it("the test workflow's paths filter covers the files that can break the pipeline", () => {
    const paths = yq(".on.pull_request.paths[]", TESTWF).out;
    for (const want of ["package.json", "commitlint.config.js", "release.config.js", ".github/workflows/**", "pnpm-lock.yaml"]) {
      expect(paths, `paths filter misses ${want}`).toContain(want);
    }
  });

  it("markdown linters come from the lockfile, not a global unpinned install", () => {
    const r = sh(`grep -nE 'npm install -g' '${TESTWF}'`);
    expect(r.status).not.toBe(0);
    for (const tool of ["markdownlint-cli2", "markdown-link-check"]) {
      expect(devDep(tool), `${tool} missing from devDependencies`).not.toBe("");
    }
  });

  it("CI validates the Devenv-Action trailer on pull-request commits", () => {
    expect(readFileSync(TESTWF, "utf8")).toContain("commit-action-check");
  });
});
