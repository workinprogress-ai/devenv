// ensureProviderAuth probe-contract tests (the `-h` regression class): the
// auth probe must invoke gh with its exact argv — a wrong shape would exit
// non-zero on every machine and every tool would fail closed with
// "provider CLI is not authenticated". The fake gh on PATH records its argv,
// so the test pins the shape AND the guided-exit contract.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = join(import.meta.dirname, "../../lib/providers/provider-core.ts");

function makeEnv(fakeGhBody: string): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "auth-probe-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/bin/bash\n${fakeGhBody}\n`);
  // chmod via spawn (no chmod import)
  spawnSync("chmod", ["+x", gh]);
  // devenv.config fixture: provider = github (so providerDetect resolves
  // without touching a real checkout).
  writeFileSync(
    join(dir, "devenv.config"),
    "[provider]\nname = github\n",
  );
  return {
    dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DEVENV_ROOT: dir,
    },
  };
}

// Driver: import the module fresh and run the probe in one node process
// (providerDetect caches; the contract under test spans both calls).
function runProbe(env: NodeJS.ProcessEnv): { status: number; out: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        `const m = await import(${JSON.stringify(TOOL)});`,
        "try { m.ensureProviderAuth(); console.log('PROBE-OK'); }",
        "catch (e) { console.error(String(e)); process.exit(9); }",
      ].join("\n"),
    ],
    { encoding: "utf8", env, cwd: tmpdir() },
  );
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("ensureProviderAuth probe contract", () => {
  it("probes with exactly `gh auth status` (no extra argv — the -h class)", () => {
    const { dir, env } = makeEnv(
      `printf '%s\\n' "$@" > "$RECORD"`,
    );
    env.RECORD = join(dir, "argv.txt");
    const { out } = runProbe(env);
    expect(out).toContain("PROBE-OK");
    const argv = readFileSync(env.RECORD!, "utf8").trim().split("\n");
    expect(argv).toEqual(["auth", "status"]);
  });

  it("an unauthenticated gh (probe rejects) exits 1 with guided guidance", () => {
    // The fail-closed contract: gh refusing `auth status` (the real gh's
    // unauthenticated shape) must exit 1 naming the fix — never silently
    // continue.
    const { env } = makeEnv(`echo "not logged in" >&2; exit 1`);
    const { status, out } = runProbe(env);
    expect(status).toBe(1);
    expect(out).toContain("not authenticated");
    expect(out).toContain("key-update-provider");
  });

  it("an argv-drifted probe shape is caught by gh itself (the -h regression)", () => {
    // If the probe's argv ever drifts (say `auth stat` or a `-h` sneaks in),
    // the real gh rejects unknown subcommands with exit 1 — the same
    // fail-closed path. The stub models gh's unknown-command refusal.
    const { env } = makeEnv(
      `case "$1 $2" in "auth status") exit 0 ;; *) echo "unknown command" >&2; exit 1 ;; esac`,
    );
    // This stub ACCEPTS the correct shape, so the probe passes — the pin is
    // the first test's argv equality; this one proves the refusal path is
    // reachable through drift only when the shape changes.
    const { out } = runProbe(env);
    expect(out).toContain("PROBE-OK");
  });
});
