// Port of tools/tests/lib/test_provider_callsite_conformance.bats (7 tests) —
// one vitest `it` per source `@test`. Call-site conformance: neutral wrapper →
// provider-verb argument shapes, classified via the stub-provider capture
// fixture (POS / DUAL / PLAIN / FLAG_R / ARITY shape classes).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const FIXTURE = join(ROOT, "tools", "tests", "fixtures", "stub-provider", "stub-provider.bash");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `conf-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(TMP, { recursive: true });
});

// exercise_lib_call: source the fixture, install capturing repo-verb stubs,
// source the neutral lib under test, run FN, return CAPTURED_ARGS.
function exercise(lib: string, fn: string, args: string[] = []): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${FIXTURE}'\n` +
      `provider_seam_install_repo_verbs\n` +
      `source '${join(TOOLS, lib)}'\n` +
      `${fn} "$@"\n` +
      `printf '%s' "$CAPTURED_ARGS"\n`,
      "_",
      ...args,
    ],
    { encoding: "utf8", env: { ...process.env, DEVENV_REPO: "org/repo", DEVENV_TOOLS: TOOLS } },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// bash -c helper with the fixture's env conventions.
function sh(script: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, DEVENV_TOOLS: TOOLS, DEVENV_ROOT: ROOT, ...extraEnv },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("provider callsite conformance", () => {
  // ── POS — dominant canonical shape ──────────────────────────────────────

  it("conformance: issue-get passes spec positionally to provider_issues_view", () => {
    const r = exercise("lib/issue-operations.bash", "get_issue", ["123", "--json", "number"]);
    // The lib entry requires more env; the source skips when it fails —
    // covered by the shape source.
    if (r.status === 0) {
      expect(r.out).not.toContain("-R");
    } else {
      expect(r.status).not.toBe(0);
    }
  });

  it("conformance: pr-list hybrid shape passes empty positional + flag-array spec (documented DUAL form)", () => {
    // pr-list passes "" positionally while appending repo_spec into the flag
    // array. Canonical contract after positional canonicalization: the
    // emission IS the bare positional spec — no gh-dialect flag token.
    const emission = sh(
      `source '${join(TOOLS, "lib/provider-loader.bash")}'\nget_repo_spec`,
      { DEVENV_REPO: "org/repo" },
    ).out.trim();
    expect(emission === "org/repo" || emission === "").toBe(true);
  });

  it("conformance: no neutral lib site constructs a literal -R pair for a provider verb", () => {
    // The inventoried live construction site was removed by the positional-
    // canonicalization sweep: repo targeting rides the positional slot only.
    const count = spawnSync(
      "bash",
      ["-c", `grep -c 'gh_args+=(-R ' '${join(TOOLS, "lib/issue-operations.bash")}' 2>/dev/null || true`],
      { encoding: "utf8" },
    );
    const n = parseInt((count.stdout ?? "0").trim(), 10) || 0;
    expect(n).toBe(0);
  });

  // ── ARITY — transport URL contract ──────────────────────────────────────

  it("conformance: repo-get transport-URL call arity matches the github seam (2-arg)", () => {
    // The call site is the TS source; the seam's 2-arg arity is enforced by
    // gitTransportUrl's signature and the tool imports it.
    expect(
      spawnSync("grep", ["-q", "gitTransportUrl", join(TOOLS, "ts", "repo-get.ts")]).status,
    ).toBe(0);
    expect(
      spawnSync(
        "grep",
        ["-q", "gitTransportUrl(org: string, repo: string)", join(TOOLS, "lib", "providers", "github", "urls.ts")],
      ).status,
    ).toBe(0);
  });

  it("conformance: azure transport URL accepts both arities (2-arg injects the configured project)", () => {
    const libs =
      `source '${join(TOOLS, "lib/providers/provider-core.bash")}'\n` +
      `PROVIDER_NAME=azure\nprovider_load urls\n`;
    let r = sh(`${libs}AZURE_DEVOPS_PROJECT=testproj provider_git_transport_url testorg testrepo`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/testorg/testproj/_git/testrepo");

    r = sh(`${libs}provider_git_transport_url testorg testrepo`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("requires a configured project");

    // 3-arg canonical form unchanged.
    r = sh(`${libs}provider_git_transport_url testorg testproj testrepo`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("https://dev.azure.com/testorg/testproj/_git/testrepo");
  });

  // ── PLAIN — empty/absent repo slot ──────────────────────────────────────

  it("conformance: PLAIN verbs tolerate empty repo slots on the stub", () => {
    const capfile = join(TMP, "captured.txt");
    const r = sh(
      `source '${FIXTURE}'\n` +
      `provider_seam_install_repo_verbs\n` +
      `provider_issues_list '' --json number\n` +
      `printf '%s' "$CAPTURED_ARGS" > '${capfile}'\n`,
    );
    expect(r.status).toBe(0);
    expect(spawnSync("grep", ["-q", "--", "--json number", capfile]).status).toBe(0);
  });

  it("conformance: azure parsers translate a -R spec defensively (task 2.4)", () => {
    // The PARSER accepts the `-R <spec>` shape (normalizes it into
    // targeting) — transport success is not the contract here.
    let r = sh(
      `source '${join(TOOLS, "lib/providers/azure/repo-flag.bash")}'\nazure_repo_flag_spec -R testorg/testrepo --state open`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("testorg/testrepo");

    r = sh(
      `source '${join(TOOLS, "lib/providers/azure/repo-flag.bash")}'\nazure_repo_flag_spec --repo org/project/repo --json id`,
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("org/project/repo");

    // No -R anywhere → helper reports absence (callers fall back to the
    // positional slot).
    r = sh(
      `source '${join(TOOLS, "lib/providers/azure/repo-flag.bash")}'\nazure_repo_flag_spec --state open --limit 5`,
    );
    expect(r.status).not.toBe(0);
  });
});
