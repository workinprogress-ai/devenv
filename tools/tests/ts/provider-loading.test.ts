// Port of tools/tests/lib/test_provider_loading.bats (9 tests): loading
// contract — every lib entry point must provide the provider verbs its
// callers use, through the one canonical loader (provider_load). Clean-shell
// composition tests that catch loader drift instead of runtime failures.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const DEVENV_TOOLS = TOOLS;

// compose SOURCE-CMD FUNCS...: run the source command in a clean subshell and
// assert every named function is defined afterwards (the helper's contract).
function compose(sourceCmd: string, funcs: string[]): { ok: boolean; missing: string[]; out: string } {
  const checks = funcs.map((f) => `declare -F ${f} >/dev/null || echo "MISSING:${f}"`).join("\n");
  const r = spawnSync("bash", ["-c", `${sourceCmd}\n${checks}`], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const missing = out.split("\n").filter((l) => l.startsWith("MISSING:")).map((l) => l.slice("MISSING:".length));
  return { ok: (r.status ?? 1) === 0 && missing.length === 0, missing, out };
}

describe("provider loading contract", () => {
  it("provider_load: core-only call detects and defines seam verbs", () => {
    const c = compose(
      `source ${DEVENV_TOOLS}/lib/providers/provider-core.bash\nprovider_load`,
      ["provider_detect", "provider_secret_get", "provider_load"],
    );
    expect(c.missing, `composition gap: ${c.missing.join(", ")}`).toEqual([]);
  });

  it("provider_load: sources requested modules from the active provider", () => {
    const c = compose(
      `source ${DEVENV_TOOLS}/lib/providers/provider-core.bash\nprovider_load issues prs auth`,
      ["provider_issues_list", "provider_prs_list", "provider_auth_status_impl"],
    );
    expect(c.missing, `composition gap: ${c.missing.join(", ")}`).toEqual([]);
  });

  it("provider_load: absent module is skipped with a warning, not an error", () => {
    const devenvRoot = mkdtempSync(join(tmpdir(), `pload-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    mkdirSync(devenvRoot, { recursive: true });
    const r = spawnSync(
      "bash",
      ["-c", `source ${DEVENV_TOOLS}/lib/providers/provider-core.bash && provider_load issues nonexistent_module`],
      { encoding: "utf8", env: { ...process.env, DEVENV_ROOT: devenvRoot, DEVENV_TOOLS } },
    );
    expect(r.status ?? 1).toBe(0);
    expect(((r.stdout ?? "") + (r.stderr ?? ""))).toMatch(/nonexistent_module[\s\S]*skipped/);
  });

  it("loader: provider-loader provides the full facade incl. auth lifecycle", () => {
    const c = compose(`source ${DEVENV_TOOLS}/lib/provider-loader.bash`, [
      "provider_issues_list",
      "provider_prs_list",
      "provider_repos_view",
      "provider_pipelines_run_list",
      "provider_projects_list",
      "provider_org_releases_list",
      "provider_auth_status_impl",
    ]);
    expect(c.missing, `composition gap: ${c.missing.join(", ")}`).toEqual([]);
  });

  it("loader: key-update-provider sources the auth lifecycle via provider_load", () => {
    const c = compose(
      `source ${DEVENV_TOOLS}/lib/providers/provider-core.bash\nprovider_load auth`,
      ["provider_auth_import_token_impl", "provider_auth_status_impl"],
    );
    expect(c.missing, `composition gap: ${c.missing.join(", ")}`).toEqual([]);
  });

  it("loader: only the canonical idiom remains (no per-lib module sourcing)", () => {
    // The guarded per-lib detect+source blocks are retired; direct module
    // sourcing outside provider-core/provider_load is the drift vector that
    // caused the auth-loading gap. Whitespace-tolerant match.
    const r = spawnSync(
      "bash",
      [
        "-c",
        `grep -rn --include='*.bash' --include='*.sh' -E 'source .*providers/\\$\\{PROVIDER_NAME\\}' '${TOOLS}/lib' '${TOOLS}/scripts' 2>/dev/null | grep -v '/cache/' | grep -v 'providers/provider-core.bash' || true`,
      ],
      { encoding: "utf8" },
    );
    const violations = (r.stdout ?? "").trim();
    expect(violations, `direct module sourcing outside the canonical loader:\n${violations}`).toBe("");
  });

  it("loader: provider missing a module fails defined at call sites (no crash)", () => {
    // A provider directory without the requested module still loads core;
    // the verb is simply undefined — callers get the standard "does not
    // implement" failure instead of a sourcing crash.
    const devenvRoot = mkdtempSync(join(tmpdir(), `pload2-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    mkdirSync(devenvRoot, { recursive: true });
    const r = spawnSync(
      "bash",
      [
        "-c",
        `source '${DEVENV_TOOLS}/lib/providers/provider-core.bash' && provider_load nonexistent_domain && declare -F provider_detect >/dev/null && ! declare -F provider_nonexistentdomain_anything >/dev/null`,
      ],
      { encoding: "utf8", env: { ...process.env, DEVENV_ROOT: devenvRoot, DEVENV_TOOLS } },
    );
    expect(r.status ?? 1).toBe(0);
  });

  it("loader: bootstrap seam shape (core + auth only) provides the lifecycle", () => {
    const c = compose(
      `source ${DEVENV_TOOLS}/lib/providers/provider-core.bash\nprovider_load auth`,
      [
        "provider_auth_status",
        "provider_auth_status_impl",
        "provider_auth_import_token",
        "provider_auth_import_token_impl",
      ],
    );
    expect(c.missing, `composition gap: ${c.missing.join(", ")}`).toEqual([]);
  });

  it("facade arg order: repo-args position is family-consistent (F031 lock)", () => {
    // Canonical order by family: view-style verbs (number-first CLIs) emit
    // repo_args trailing; list/action verbs emit repo_args leading. The
    // lock: no verb mixes both forms, and the view family stays trailing.
    const pattern1 = "gh issue view \"$@\" \"\\${repo_args\\[@\\]}\"\\|gh pr view \"$@\" \"\\${repo_args\\[@\\]}\"";
    const src = spawnSync(
      "bash",
      ["-c", `grep -h '${pattern1}' '${TOOLS}/lib/providers/github/issues.bash' '${TOOLS}/lib/providers/github/prs.bash' | wc -l`],
      { encoding: "utf8" },
    );
    expect(Number.parseInt(src.stdout?.trim() || "0", 10)).toBe(2);
    // run verbs translate their JSON through _gh_json_run MAP gh-args...
    const B = String.fromCharCode(92);
    const D = String.fromCharCode(36);
    const pattern2 =
      "(gh|_gh_json_run '[^']*') (issue|pr|run|workflow|label) [a-z]+ \"" + B + D + "{repo_args" + B + "[@" + B + "]}";
    // pattern2 contains single quotes ('.') — pass grep its argv directly
    // instead of re-quoting through bash -c.
    const files = spawnSync("bash", ["-c", `ls '${TOOLS}/lib/providers/github/'*.bash`], { encoding: "utf8" }).stdout?.trim().split("\n") ?? [];
    const leading = spawnSync("grep", ["-hE", pattern2, ...files], { encoding: "utf8" });
    expect(leading.stdout?.split("\n").filter(Boolean).length ?? 0).toBeGreaterThanOrEqual(8);
  });
});
