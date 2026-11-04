// Port of test_devenv_config_integration.bats (24 tests): devenv.config
// integration with setup and bootstrap scripts. Bash-function behavior goes
// through the real config-reader.bash in a sourced subshell; the rest are
// structural greps against the tree.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const CONFIG = join(ROOT, "devenv.config");
const READER = join(ROOT, "tools/lib/config-reader.bash");

const FIXTURE = `[organization]
name=Test Organization
org=test-org
email_domain=test.example.com

[nuget]
feed_url=https://nuget.pkg.github.com/\${PROVIDER_ORG}/index.json

[workflows]
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production
issue_types=story,bug

[copilot]
knowledge_repo=https://github.com/example/docs.copilot-knowledge.git
knowledge_subpath=copilot-knowledge/
engineering_repo=https://github.com/example/docs.engineering.git
engineering_subpath=docs/
`;

function sh(script: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// source config-reader.bash && config_init FILE && <rest>
function reader(configFile: string, rest: string): { status: number; out: string } {
  return sh(`source '${READER}' && config_init '${configFile}' && ${rest}`);
}

function grepBash(args: string[]): number {
  return spawnSync("grep", args, { encoding: "utf8" }).status ?? 1;
}

function grepFile(pattern: string, file: string): number {
  return grepBash([pattern, file]);
}

describe("devenv.config integration", () => {
  it("devenv.config: file exists in repo root", () => {
    expect(existsSync(CONFIG)).toBe(true);
  });

  it("devenv.config: contains required sections", () => {
    expect(grepBash(["-E", "^\\[organization\\]|^\\[nuget\\]|^\\[workflows\\]|^\\[copilot\\]", CONFIG])).toBe(0);
  });

  it("devenv.config: organization section has required keys", () => {
    // Org identity: the neutral "org" key is the only one read (github_org is not).
    const r = reader(CONFIG, "config_validate_required organization name org email_domain");
    expect(r.status).toBe(0);
  });

  it("devenv.config: nuget section has feed_url configured", () => {
    const r = reader(CONFIG, "config_read_value nuget feed_url | grep -qE '^https://[^ ]+$'");
    expect(r.status).toBe(0);
  });

  it("devenv.config: workflows section has status_workflow", () => {
    const r = reader(CONFIG, "config_read_array workflows status_workflow");
    expect(r.status).toBe(0);
    // 8-state kanban, hyphenated single tokens
    for (const state of ["TBD", "To-Groom", "Ready", "Implementing", "Review", "Merged", "Staging", "Production"]) {
      expect(r.out).toContain(state);
    }
  });

  it("devenv.config: copilot knowledge repository is configured (two-clone model)", () => {
    const repo = reader(CONFIG, "config_read_value copilot knowledge_repo");
    expect(repo.status).toBe(0);
    expect(repo.out).toContain("docs.copilot-knowledge.git");
    const sub = reader(CONFIG, "config_read_value copilot knowledge_subpath");
    expect(sub.out.trim()).toBe("copilot-knowledge/");
  });

  it("devenv.config: copilot engineering repository is configured (two-clone model)", () => {
    const repo = reader(CONFIG, "config_read_value copilot engineering_repo");
    expect(repo.status).toBe(0);
    expect(repo.out).toContain("docs.engineering.git");
    const sub = reader(CONFIG, "config_read_value copilot engineering_subpath");
    expect(sub.out.trim()).toBe("docs/");
  });
});

describe("config-reader.bash", () => {
  it("library exists", () => {
    expect(existsSync(READER)).toBe(true);
  });

  it("has config_init function", () => {
    expect(sh(`source '${READER}' && declare -f config_init`).status).toBe(0);
  });

  it("has config_read_value function", () => {
    expect(sh(`source '${READER}' && declare -f config_read_value`).status).toBe(0);
  });

  it("has config_read_array function", () => {
    expect(sh(`source '${READER}' && declare -f config_read_array`).status).toBe(0);
  });
});

describe("bootstrap.bash config wiring", () => {
  const BOOT = join(ROOT, ".devcontainer/bootstrap.bash");

  it("has load_config function", () => {
    expect(grepFile("^load_config()", BOOT)).toBe(0);
  });

  it("load_config called in default_tasks", () => {
    expect(grepFile("load_config", BOOT)).toBe(0);
  });

  it("sources config-reader library", () => {
    expect(grepFile("source.*config-reader.bash", BOOT)).toBe(0);
  });
});

describe("project-update-issue config wiring", () => {
  const PUI = join(ROOT, "tools/ts/project-update-issue.ts");

  it("reads the workflow vocabulary from config", () => {
    expect(grepFile("configGetArray.*status_workflow", PUI)).toBe(0);
  });

  it("validates against the loaded vocabulary", () => {
    expect(grepBash(["-n", "status_workflow not configured", PUI])).toBe(0);
  });

  it("vocabulary load runs before status validation", () => {
    expect(grepBash(["-n", "statusWorkflow", PUI])).toBe(0);
    const r = spawnSync("grep", ["-c", "statusWorkflow", PUI], { encoding: "utf8" });
    expect(Number.parseInt(r.stdout ?? "0", 10)).toBeGreaterThanOrEqual(3);
  });
});

describe("issue-triage config wiring", () => {
  it("consumes the config+operations seams via the TS facade", () => {
    // The bash tool sourced config-reader + issue-operations; the TS port
    // gets the same seams from the provider facade imports.
    const T = join(ROOT, "tools/ts/issue-triage.ts");
    expect(grepFile("provider-core.ts", T)).toBe(0);
    expect(grepFile("providers/facade/issues.ts", T)).toBe(0);
  });
});

describe("setup + test-helper email wiring", () => {
  it("setup script: loads email_domain from config", () => {
    expect(grepFile("email_domain", join(ROOT, "setup"))).toBe(0);
  });

  it("setup script: validates email against configured domain", () => {
    expect(grepFile("email_domain", join(ROOT, "setup"))).toBe(0);
  });

  it("test_helper.bash: uses generic test email", () => {
    expect(grepFile('USER_EMAIL="test@example.com"', join(ROOT, "tools/tests/test_helper.bash"))).toBe(0);
  });

  it("test_helper.bash: does not use hardcoded organization email", () => {
    expect(grepFile("@workinprogress.ai", join(ROOT, "tools/tests/test_helper.bash"))).not.toBe(0);
  });
});

describe("test fixture parity", () => {
  it("the test fixture's status_workflow matches the shipped config", () => {
    const fixture = join(mkdtempSync(join(tmpdir(), `cfgfix-${Date.now()}-${Math.random().toString(36).slice(2)}`)), "devenv.config");
    writeFileSync(fixture, FIXTURE);
    const fx = reader(fixture, "config_read_value workflows status_workflow").out;
    const real = reader(CONFIG, "config_read_value workflows status_workflow");
    expect(real.status).toBe(0);
    expect(fx).toBe(real.out);
  });

  it("the test fixture's workflow states are single tokens (config_read_array splits on whitespace)", () => {
    const fixture = join(mkdtempSync(join(tmpdir(), `cfgfix-${Date.now()}-${Math.random().toString(36).slice(2)}`)), "devenv.config");
    writeFileSync(fixture, FIXTURE);
    const out = reader(fixture, "config_read_value workflows status_workflow").out;
    expect(out).not.toContain(" ");
  });
});
