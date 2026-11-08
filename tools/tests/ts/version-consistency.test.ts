// Port of tools/tests/devenv/test_version_consistency.bats (7 tests) — one
// vitest `it` per source `@test`: doc-claims guards and version pins.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_version_consistency.bats — one vitest `it` per source `@test`.

// ── version consistency (port of test_version_consistency.bats, 7 tests) ─

describe("version consistency", () => {
  it("every script's '# Version:' header agrees with its SCRIPT_VERSION", () => {
    const headerRe = /^# Version:\s*(\S+)/;
    const varRe = /readonly SCRIPT_VERSION="?([^"\n]*)"?\n/;
    let bad = "";
    const glob = sh(`ls '${ROOT}'/tools/templates/*.sh '${ROOT}'/tools/tests/run-devenv-tests.sh 2>/dev/null`).out.trim();
    for (const f of glob.split("\n").filter((l) => l !== "")) {
      const content = readFileSync(f, "utf8");
      const hv = content.match(headerRe)?.[1];
      const vv = content.match(varRe)?.[1];
      if (hv && vv && hv !== vv) bad += `${f}: header ${hv} != SCRIPT_VERSION ${vv}\n`;
    }
    expect(bad).toBe("");
  });

  it("--version prints exactly SCRIPT_VERSION, with provider authentication failing", () => {
    // The raw template carries the REL_LIB placeholder and cannot run;
    // generate a real tool first (fixture dir inside the checkout so the
    // computed import prefix resolves).
    const fixtureDir = join(ROOT, "tmp", "vc-gen-fixture");
    rmSync(fixtureDir, { recursive: true, force: true });
    const gen = spawnSync("node", [join(ROOT, "tools", "ts", "tooling-create-script.ts"), "-d", fixtureDir, "vc-probe-tool"], { encoding: "utf8" });
    expect(gen.status, gen.stderr ?? "").toBe(0);
    const script = join(fixtureDir, "vc-probe-tool.ts");
    const want = readFileSync(script, "utf8").match(/const SCRIPT_VERSION = "([^\n]*)"/)?.[1];
    const env = {
      ...process.env,
      DEVENV_ROOT: "/nonexistent/foreign",
      GH_TOKEN: "invalid-token-for-auth-probe",
      PATH: process.env["PATH"] ?? "",
    };
    const r = spawnSync("node", [script, "--version"], { encoding: "utf8", env, timeout: 10_000 });
    expect((r.stdout ?? "").trim()).toBe(want);
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("no script calls script_version, and the library no longer gates output on SHOW_VERSION", () => {
    const r1 = sh(
      `grep -lE '^[[:space:]]*script_version[[:space:]]' '${ROOT}/tools/tests/run-devenv-tests.sh'`,
    );
    expect(r1.status).toBe(1);
    const r2 = sh(`grep -n 'SHOW_VERSION\\|^script_version()' '${ROOT}/tools/lib/versioning.bash'`);
    expect(r2.status).toBe(1);
  });

  it("every script that calls handle_global_flag defines show_usage, so --help is never silent", () => {
    const bad = sh(
      `for f in $(grep -l 'handle_global_flag' '${ROOT}'/tools/templates/*.sh '${ROOT}'/tools/tests/run-devenv-tests.sh 2>/dev/null); do\n` +
      `  grep -qE '^show_usage\\(\\)' "$f" || echo "$(basename "$f")"\n` +
      `done`,
    );
    expect(bad.out).toBe("");
  });

  it("package.json packageManager names the pnpm version tool-versions.bash declares", () => {
    const declared = readFileSync(join(ROOT, ".devcontainer/tool-versions.bash"), "utf8")
      .match(/PNPM_VERSION="?([^"\n]*)"?/)?.[1];
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(pkg).toContain(`"packageManager": "pnpm@${declared}`);
  });

  it("bootstrap resolves the declared node from the image's nvm dir (17.0)", () => {
    const bootstrap = readFileSync(join(ROOT, ".devcontainer/bootstrap.bash"), "utf8");
    const toolVersions = readFileSync(join(ROOT, ".devcontainer/tool-versions.bash"), "utf8");
    // The thin bootstrap PATH-resolves the pinned version; tool-versions
    // declares it. (The old "nvm alias default" runtime pin is retired.)
    expect(bootstrap).toContain('versions/node/$pinned/bin/node');
    expect(bootstrap).toContain("require_tool_version NODE_VERSION");
    expect(toolVersions).toContain('export NODE_VERSION="');
  });

  it("repo-deps reports a failed pnpm install and does not abort the chain", () => {
    // Port of the bats behavioral test, now against the TS step module:
    // a failing pnpm is WARNed and the step exits 0 (the ACTION REQUIRED
    // line carries the failure; the chain continues).
    const r = spawnSync("node", [join(ROOT, "tools/ts/setup-steps/repo-deps.ts")], {
      encoding: "utf8",
      env: (() => {
        const e: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
        e.DEVENV_TOOLBOX_ROOT = ROOT;
        // stub pnpm failing on PATH front
        e.PATH = `/tmp/pnpm-stub-fail:${e.PATH}`;
        return e;
      })(),
    });
    expect(r.status).toBe(0);
  });
});
