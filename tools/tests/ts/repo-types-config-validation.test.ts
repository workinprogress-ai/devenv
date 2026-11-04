// Port of tools/tests/lib/test_repo_types_config_validation.bats (19 tests) —
// one vitest `it` per source `@test`. Validates the real
// tools/config/repo-types.yaml: structure, property names, value types, and
// allowed values (regression net against invalid config commits).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const CFG = join(TOOLS, "config", "repo-types.yaml");

// source repo-types.bash + call, capturing combined output.
function runCfg(call: string): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    ["-c", `source '${TOOLS}/lib/repo-types.bash'\n${call}`],
    { encoding: "utf8" },
  );
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const TYPES = [
  "planning",
  "documentation",
  "template",
  "service",
  "gateway",
  "app-web",
  "cs-library",
  "ts-package",
  "none",
];

describe("repo-types config validation", () => {
  it("config file exists and is readable", () => {
    expect(CFG.startsWith(ROOT)).toBe(true);
    spawnSync("test", ["-f", CFG]);
    expect(spawnSync("test", ["-f", CFG]).status).toBe(0);
    expect(spawnSync("test", ["-r", CFG]).status).toBe(0);
  });

  it("config YAML is valid and can be parsed", () => {
    const r = spawnSync("yq", [".types | keys | length", CFG], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(parseInt((r.stdout ?? "").trim(), 10)).toBeGreaterThan(0);
  });

  it("config can be loaded by library", () => {
    const r = runCfg(`load_repo_types_config '${CFG}' > /dev/null 2>&1`);
    expect(r.status).toBe(0);
  });

  it("planning repo type has valid properties", () => {
    let r = runCfg(`get_type_description planning '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Planning/);

    r = runCfg(`get_type_naming_pattern planning '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/planning/);

    r = runCfg(`get_type_main_branch planning '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).not.toBe("");
  });

  it("documentation repo type has valid properties", () => {
    let r = runCfg(`get_type_description documentation '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Documentation/);

    r = runCfg(`get_type_naming_pattern documentation '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/docs/);

    r = runCfg(`get_type_has_wiki documentation '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/true|false/);
  });

  it("template repo type has valid properties", () => {
    let r = runCfg(`get_type_description template '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Template/);

    r = runCfg(`get_type_is_template template '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("true");
  });

  it("service repo type has valid properties", () => {
    let r = runCfg(`get_type_description service '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/microservice/);

    r = runCfg(`get_type_naming_pattern service '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/service/);
  });

  it("gateway repo type has valid properties", () => {
    const r = runCfg(`get_type_naming_pattern gateway '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/gateway/);
  });

  it("app-web repo type has valid properties", () => {
    const r = runCfg(`get_type_naming_pattern app-web '${CFG}'`);
    expect(r.status).toBe(0);
    expect(/web|app/.test(r.out)).toBe(true);
  });

  it("cs-library repo type has valid properties", () => {
    const r = runCfg(`get_type_naming_pattern cs-library '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/cs/);
  });

  it("ts-package repo type has valid properties", () => {
    const r = runCfg(`get_type_naming_pattern ts-package '${CFG}'`);
    expect(r.status).toBe(0);
    expect(/ts|npm/.test(r.out)).toBe(true);
  });

  it("none repo type has valid properties", () => {
    const r = runCfg(`get_type_naming_pattern none '${CFG}'`);
    expect(r.status).toBe(0);
    expect(r.out.trim()).not.toBe("");
  });

  it("all repo types have allowedMergeTypes defined", () => {
    for (const type of TYPES) {
      const r = runCfg(`get_type_allowed_merge_types '${type}' '${CFG}'`);
      expect(r.status, `Failed for type: ${type}`).toBe(0);
      expect(r.out.trim(), `Empty output for type: ${type}`).not.toBe("");
    }
  });

  it("squash merge properties are valid values", () => {
    for (const type of ["planning", "documentation", "service"]) {
      let r = runCfg(`get_type_squash_merge_commit_title '${type}' '${CFG}'`);
      expect(r.status).toBe(0);
      expect(r.out, `Invalid title value for ${type}: ${r.out}`).toMatch(
        /PR_TITLE|COMMIT_OR_PR_TITLE/,
      );

      r = runCfg(`get_type_squash_merge_commit_message '${type}' '${CFG}'`);
      expect(r.status).toBe(0);
      expect(r.out, `Invalid message value for ${type}: ${r.out}`).toMatch(
        /PR_BODY|COMMIT_MESSAGES|BLANK/,
      );
    }
  });

  it("boolean properties return valid values", () => {
    const boolProps = [
      "has_wiki",
      "has_issues",
      "has_discussions",
      "has_projects",
      "allow_auto_merge",
      "allow_update_branch",
      "allow_forking",
      "delete_pr_branch_on_merge",
    ];
    for (const prop of boolProps) {
      const r = runCfg(`get_type_${prop} documentation '${CFG}'`);
      expect(r.status, `Failed to get ${prop} for documentation`).toBe(0);
      expect(r.out, `Invalid boolean value for ${prop}: ${r.out}`).toMatch(
        /true|false/,
      );
    }
  });

  it("naming patterns are non-empty for all types", () => {
    for (const type of TYPES) {
      const r = runCfg(`get_type_naming_pattern '${type}' '${CFG}'`);
      expect(r.status).toBe(0);
      expect(r.out.trim(), `Empty naming pattern for type: ${type}`).not.toBe("");
      // Patterns should look like regex.
      expect(
        /\^|\\\./.test(r.out) || r.out.trim() === ".*",
        `Suspicious pattern for ${type}: ${r.out}`,
      ).toBe(true);
    }
  });

  it("template property is valid for all types", () => {
    for (const type of TYPES) {
      const r = runCfg(`get_type_template '${type}' '${CFG}'`);
      // The source asserts only the exit status — the null/template.* shape
      // check ends in `|| echo` (gateway's "template-gateway" violates the
      // shape and the suite tolerates it).
      expect(r.status).toBe(0);
    }
  });

  it("main branch is set to either master or main for all types", () => {
    for (const type of TYPES) {
      const r = runCfg(`get_type_main_branch '${type}' '${CFG}'`);
      expect(r.status).toBe(0);
      expect(r.out, `Unexpected main branch for ${type}: ${r.out}`).toMatch(
        /master|main/,
      );
    }
  });

  it("no repo type has isTemplate set to true except template types", () => {
    for (const type of ["template"]) {
      const r = runCfg(`get_type_is_template '${type}' '${CFG}'`);
      expect(r.status).toBe(0);
      expect(
        r.out.trim(),
        `Expected template type ${type} to have isTemplate=true, got: ${r.out}`,
      ).toBe("true");
    }
    for (const type of TYPES.filter((t) => t !== "template")) {
      const r = runCfg(`get_type_is_template '${type}' '${CFG}'`);
      expect(r.status).toBe(0);
      expect(
        r.out.trim(),
        `Expected non-template type ${type} to have isTemplate=false, got: ${r.out}`,
      ).toBe("false");
    }
  });
});
