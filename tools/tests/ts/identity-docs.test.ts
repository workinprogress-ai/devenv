// Port of tools/tests/devenv/test_identity_docs.bats (5 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function grepLines(args: string[]): string {
  const r = spawnSync("grep", args, { encoding: "utf8" });
  return r.stdout ?? "";
}

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_identity_docs.bats — one vitest `it` per source `@test`.

// ── identity docs (port of test_identity_docs.bats, 5 tests) ─────────────

describe("identity docs", () => {
  it("no doc claims the github_org config key still resolves", () => {
    const hits = grepLines(["-n", "github_org", join(ROOT, "docs")]).split("\n")
      .filter((l) => l !== "" && !/not read|never read|ignored|no longer|is not/i.test(l));
    expect(hits).toEqual([]);
  });

  it("policy docs and contract comment list no GH_ORG leg in the org chain", () => {
    const hits = grepLines([
      "-n", "GH_ORG",
      join(ROOT, "tools/lib/policy/README.md"),
      join(ROOT, "tools/lib/policy/identity-policy.bash"),
    ]).split("\n").filter((l) => l !== "" && !/ignored|not read|no longer/i.test(l));
    expect(hits).toEqual([]);
  });

  it("a config carrying only github_org does not resolve an org", () => {
    const t = mkdtempSync(join(tmpdir(), "identity-"));
    writeFileSync(join(t, "devenv.config"), "[organization]\nname=t\ngithub_org=old-org\n");
    const r = sh(
      `export DEVENV_ROOT='${t}'\n` +
      "unset POLICY_ORG GH_ORG\n" +
      `source '${ROOT}/tools/lib/policy/policy-core.bash'\n` +
      `policy_core_init '${t}/devenv.config'\n` +
      `source '${ROOT}/tools/lib/policy/identity-policy.bash'\n` +
      "policy_org",
    );
    expect(r.status).toBe(1);
    expect(r.out).toBe("");
    rmSync(t, { recursive: true, force: true });
  });

  it("GH_ORG in the environment does not override the configured org", () => {
    const t = mkdtempSync(join(tmpdir(), "identity-"));
    writeFileSync(join(t, "devenv.config"), "[organization]\nname=t\norg=cfg-org\n");
    const r = sh(
      `export DEVENV_ROOT='${t}'\n` +
      "unset POLICY_ORG\n" +
      `source '${ROOT}/tools/lib/policy/policy-core.bash'\n` +
      `policy_core_init '${t}/devenv.config'\n` +
      `source '${ROOT}/tools/lib/policy/identity-policy.bash'\n` +
      "GH_ORG=env-org policy_org",
    );
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("cfg-org");
    rmSync(t, { recursive: true, force: true });
  });

  it("no functional file hard-codes the upstream organization's name (attribution headers and LICENSE aside)", () => {
    const r = sh(
      `cd '${ROOT}' && grep -rniI 'workinprogress' tools/lib tools/scripts tools/config tools/templates .devcontainer .vscode copilot docs README.md package.json 2>/dev/null ` +
      `| grep -viE '# Author:|"author"|work-in-progress|work in progress|workinprogress-ai/devenv.git"' ` +
      `| grep -v 'tools/cache' | grep -v 'copilot/engineering/' | grep -v 'copilot/knowledge/' | grep -v 'github.com/workinprogress-ai/docs\\.'`,
    );
    expect(r.out).toBe("");
  });
});
