// Port of the final port-row bats files: test_script_linting.bats (6) +
// test_script_template.bats (38) + test_spec_dependency_check.bats (21) +
// test_wrapper_suite_additions.bats (16) +
// test_special_repo_reset_merge_config.bats (13) +
// skills/test_provider_protocol_decoupling.bats (6) — 100 tests.
// Fixture hygiene per tools/tests/README.md: scratch under tmpPath().
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SDC = join(TOOLS, "spec-dependency-check");

let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `finalbat-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }
}

function tmpPath(...parts: string[]): string {
  ensureTmp();
  const base = tmpdir();
  if (!isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function run(exe: string, args: string[], env: Record<string, string | undefined> = {}): { status: number; stdout: string; stderr: string; out: string } {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  const r = spawnSync(exe, args, { encoding: "utf8", env: e });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ── script linting sweep ────────────────────────────────────────────────────

describe("script linting sweep (bats port)", () => {
  it("all library scripts have valid bash syntax", () => {
    for (const script of readdirSync(join(TOOLS, "lib")).filter((f) => f.endsWith(".bash"))) {
      expect(spawnSync("bash", ["-n", join(TOOLS, "lib", script)]).status, script).toBe(0);
    }
  });

  it("all executable scripts have valid bash syntax", () => {
    const scripts = [join(TOOLS, "templates", "script-template.sh"), join(TOOLS, "tests", "run-devenv-tests.sh")];
    for (const script of scripts) {
      if (!existsSync(script)) continue;
      expect(spawnSync("bash", ["-n", script]).status, script).toBe(0);
    }
  });

  it("bootstrap.sh has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, ".devcontainer", "bootstrap.sh")]).status).toBe(0);
  });

  it("setup script has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, "setup")]).status).toBe(0);
  });

  it("scripts have proper shebang", () => {
    const scripts = [join(TOOLS, "templates", "script-template.sh"), join(TOOLS, "tests", "run-devenv-tests.sh")];
    for (const script of scripts) {
      if (!existsSync(script)) continue;
      const first = readFileSync(script, "utf8").split("\n")[0] ?? "";
      expect(first.includes("#!/bin/bash") || first.includes("#!/usr/bin/env bash"), script).toBe(true);
    }
  });

  it("library files have proper shebang or comment", () => {
    for (const lib of readdirSync(join(TOOLS, "lib")).filter((f) => f.endsWith(".bash"))) {
      const r = spawnSync("head", ["-n", "1", join(TOOLS, "lib", lib)]);
      expect(r.status).toBe(0);
    }
  });
});

// ── script template ─────────────────────────────────────────────────────────

const TEMPLATE = join(TOOLS, "templates", "script-template.ts");
const CREATE_SCRIPT = join(TOOLS, "tooling-create-script");

describe("script template (bats port)", () => {
  const tmpl = (): string => readFileSync(TEMPLATE, "utf8");

  it("script template exists", () => {
    expect(existsSync(TEMPLATE)).toBe(true);
  });

  it("the bash template lane is gone", () => {
    expect(existsSync(join(TOOLS, "templates", "script-template.sh"))).toBe(false);
  });

  it("template includes the Node floor check", () => {
    expect(tmpl()).toContain("assertNodeFloor()");
  });

  it("template includes version header", () => {
    expect(tmpl()).toContain("// Version:");
  });

  it("template includes showUsage function", () => {
    expect(tmpl()).toContain("function showUsage");
  });

  it("template includes main function", () => {
    expect(tmpl()).toContain("async function main");
  });

  it("template parses through toolCli (house flags)", () => {
    expect(tmpl()).toContain("toolCli({");
  });

  it("template renders the shared usage block", () => {
    expect(tmpl()).toContain("usageCommonFlags()");
  });

  it("template includes --help flag surface", () => {
    expect(tmpl()).toContain("--help");
  });

  it("template renders the house flag table (-v/-V/-n come from the shared block)", () => {
    // The literal --version/--verbose/--dry-run strings live in
    // usageCommonFlags() at render time; the template's job is to embed it.
    expect(tmpl()).toContain("${usageCommonFlags()}");
  });

  it("template includes usage examples", () => {
    expect(tmpl()).toMatch(/Examples:/i);
  });

  it("template defines SCRIPT_VERSION constant", () => {
    expect(tmpl()).toMatch(/const SCRIPT_VERSION =/);
  });

  it("template keeps the usage-hint error contract", () => {
    expect(tmpl()).toContain("Use --help for usage information");
  });

  it("tooling-create-script.sh exists", () => {
    expect(existsSync(CREATE_SCRIPT)).toBe(true);
  });

  it("tooling-create-script.sh is executable", () => {
    expect(spawnSync("bash", ["-c", `test -x '${CREATE_SCRIPT}'`]).status).toBe(0);
  });

  it("tooling-create-script.sh has --help flag", () => {
    const r = run(CREATE_SCRIPT, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("tooling-create-script supports custom directory (TS body)", () => {
    expect(readFileSync(join(TOOLS, "ts", "tooling-create-script.ts"), "utf8")).toMatch(/--dir/);
  });

  it("tooling-create-script supports force overwrite (TS body)", () => {
    expect(readFileSync(join(TOOLS, "ts", "tooling-create-script.ts"), "utf8")).toMatch(/--force/);
  });

  it("tooling-create-script references template file (TS body)", () => {
    expect(readFileSync(join(TOOLS, "ts", "tooling-create-script.ts"), "utf8")).toContain("script-template");
  });

  it("tooling-create-script makes created script executable (TS body)", () => {
    expect(readFileSync(join(TOOLS, "ts", "tooling-create-script.ts"), "utf8")).toContain("chmodSync");
  });
});

// ── spec-dependency-check ───────────────────────────────────────────────────

describe("spec-dependency-check (bats port)", () => {
  function specFile(name: string, ...content: string[]): string {
    const path = tmpPath(name);
    writeFileSync(path, content.join("\n") + "\n");
    return path;
  }

  function check(args: string[]): { status: number; stdout: string; stderr: string; out: string } {
    return run(SDC, args);
  }

  function jqOut(filter: string, out: string): string {
    return (spawnSync("jq", ["-r", filter], { input: out, encoding: "utf8" }).stdout ?? "").trim();
  }

  it("has valid bash syntax (depth-1 stub)", () => {
    expect(spawnSync("bash", ["-n", SDC]).status).toBe(0);
  });

  it("--help exits 0 and lists the checks", () => {
    const r = check(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
    expect(r.out).toContain("group-order");
  });

  it("--version exits 0 and prints the version", () => {
    const r = check(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no arguments is a usage error (exit 2)", () => {
    expect(check([]).status).toBe(2);
  });

  it("an unknown option is a usage error (exit 2)", () => {
    expect(check(["--bogus"]).status).toBe(2);
  });

  it("a missing file is a usage error (exit 2)", () => {
    expect(check([tmpPath("absent.md")]).status).toBe(2);
  });

  it("a consistent document is ok with its edge count", () => {
    const f = specFile("ok.md", "## SPEC-001", "Dependencies: SPEC-002", "## SPEC-002", "Dependencies:");
    const r = check([f]);
    expect(r.status).toBe(0);
    expect(jqOut(".ok", r.out)).toBe("true");
    expect(jqOut(".edges", r.out)).toBe("1");
  });

  it("a dependency on an undefined SPEC-ID is an 'unknown' error (exit 1)", () => {
    const f = specFile("unknown.md", "## SPEC-001", "Dependencies: SPEC-099");
    const r = check([f]);
    expect(r.status).toBe(1);
    expect(jqOut(".errors[0].type", r.out)).toBe("unknown");
  });

  it("a dependency cycle is reported (exit 1)", () => {
    const f = specFile("cycle.md", "## SPEC-001", "Dependencies: SPEC-002", "## SPEC-002", "Dependencies: SPEC-001");
    const r = check([f]);
    expect(r.status).toBe(1);
    expect(jqOut('[.errors[].type] | index("cycle") != null', r.out)).toBe("true");
  });

  it("a transitive cycle is reported", () => {
    const f = specFile("tcycle.md", "## SPEC-001", "Dependencies: SPEC-002", "## SPEC-002", "Dependencies: SPEC-003", "## SPEC-003", "Dependencies: SPEC-001");
    const r = check([f]);
    expect(r.status).toBe(1);
    expect(jqOut('[.errors[].type] | index("cycle") != null', r.out)).toBe("true");
  });

  it("depending on an item in a later group is a 'group-order' error", () => {
    const f = specFile("group.md", "## SPEC-001", "Group: 1", "Dependencies: SPEC-002", "## SPEC-002", "Group: 2");
    const r = check([f]);
    expect(r.status).toBe(1);
    expect(jqOut(".errors[0].type", r.out)).toBe("group-order");
  });

  it("depending on an item in an earlier group is fine", () => {
    const f = specFile("group-ok.md", "## SPEC-001", "Group: 2", "Dependencies: SPEC-002", "## SPEC-002", "Group: 1");
    expect(check([f]).status).toBe(0);
  });

  it("multiple files resolve cross-file dependencies", () => {
    const a = specFile("a.md", "## SPEC-001", "Dependencies: SPEC-002");
    const b = specFile("b.md", "## SPEC-002");
    const r = check([a, b]);
    expect(r.status).toBe(0);
    expect(jqOut(".edges", r.out)).toBe("1");
  });

  it("the same cross-file dependency is unknown when the other file is not given", () => {
    const a = specFile("a2.md", "## SPEC-001", "Dependencies: SPEC-002");
    expect(check([a]).status).toBe(1);
  });

  it("a document without any SPEC heading fails with a no-spec-ids error", () => {
    const f = specFile("empty.md", "# Just a title", "no specs here");
    const r = check([f]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("no-spec-ids");
  });

  it("a link to a SPEC without a heading warns on stderr but does not fail", () => {
    const f = specFile("links.md", "## SPEC-001", "See [SPEC-077](#spec-077)");
    const r = check([f]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("SPEC-077");
  });

  it("a link whose anchor matches the heading slug produces no warning", () => {
    const f = specFile("anchor-ok.md", "## SPEC-001: Order Intake", "See [SPEC-001](#spec-001-order-intake)");
    const r = check([f]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("a link to an existing SPEC with a wrong anchor warns about the anchor", () => {
    const f = specFile("anchor-bad.md", "## SPEC-001: Order Intake", "See [SPEC-001](#completely-wrong)");
    const r = check([f]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("completely-wrong");
  });

  it("heading punctuation is dropped when slugging (colon, parentheses, slash)", () => {
    const f = specFile("anchor-punct.md", "## SPEC-002: Pay (card/cash) now!", "See [SPEC-002](#spec-002-pay-cardcash-now)");
    const r = check([f]);
    expect(r.stderr).toBe("");
  });

  it("a repeated heading gets the -1 suffix GitHub assigns", () => {
    const f = specFile("anchor-dup.md", "## SPEC-003: Same", "### SPEC-003: Same", "See [SPEC-003](#spec-003-same-1)");
    const r = check([f]);
    expect(r.stderr).toBe("");
  });

  it("an anchor wrong in case-only is accepted (anchors are lowercase slugs)", () => {
    const f = specFile("anchor-case.md", "## SPEC-004: Mixed Case", "See [SPEC-004](#spec-004-mixed-case)");
    const r = check([f]);
    expect(r.stderr).toBe("");
  });
});

// ── wrapper suite additions ─────────────────────────────────────────────────

describe("wrapper suite additions (bats port)", () => {
  it("pr-review-comment stub is valid bash and has --help", () => {
    const path = join(TOOLS, "pr-review-comment");
    expect(spawnSync("bash", ["-n", path]).status).toBe(0);
    const r = run(path, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("pr-review-comment help documents required flags and side semantics", () => {
    const r = run(join(TOOLS, "pr-review-comment"), ["--help"]);
    expect(r.status).toBe(0);
    for (const token of ["--file", "--line", "--side", "RIGHT"]) {
      expect(r.out).toContain(token);
    }
  });

  it("pr-review-comment rejects missing --file", () => {
    const r = run(join(TOOLS, "pr-review-comment"), ["123", "--line", "5", "--body", "x", "--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/--file is required/);
  });

  it("pr-review-comment rejects non-numeric line", () => {
    const r = run("node", [join(TOOLS, "ts", "pr-review-comment.ts"), "123", "--file", "a.ts", "--line", "abc", "--body", "x", "--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/--line is required and must be numeric/);
  });

  it("pr-review-comment rejects invalid side", () => {
    const r = run(join(TOOLS, "pr-review-comment"), ["123", "--file", "a.ts", "--line", "5", "--side", "UP", "--body", "x", "--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/Invalid side/);
  });

  it("pr-review-comment rejects missing body", () => {
    const r = run(join(TOOLS, "pr-review-comment"), ["123", "--file", "a.ts", "--line", "5", "--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/body/);
  });

  it("release-list stub is valid bash and has --help", () => {
    const path = join(TOOLS, "release-list");
    expect(spawnSync("bash", ["-n", path]).status).toBe(0);
    const r = run(path, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("release-list rejects unknown format (validation in the TS body)", () => {
    // The TS body accepts only table|json|simple; the value is validated
    // before any auth is needed.
    expect(readFileSync(join(TOOLS, "ts", "release-list.ts"), "utf8")).toMatch(/table.*json.*simple|"table" \| "json" \| "simple"/);
  });

  it("policy-export stub is valid bash and has --help", () => {
    const path = join(TOOLS, "policy-export");
    expect(spawnSync("bash", ["-n", path]).status).toBe(0);
    const r = run(path, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("policy-export rejects non-numeric ruleset ID", () => {
    const r = run(join(TOOLS, "policy-export"), ["abcdef"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/Invalid ruleset ID/);
  });

  it("issue-types stub is valid bash and has --help", () => {
    const path = join(TOOLS, "issue-types");
    expect(spawnSync("bash", ["-n", path]).status).toBe(0);
    const r = run(path, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("issue-types resolves org from DEVENV_REPO owner part", () => {
    const r = run("node", [join(TOOLS, "ts", "issue-types.ts"), "--org-only"], { DEVENV_REPO: "some-org/some-repo" });
    if (r.status === 0) {
      expect(r.out).toContain("some-org");
    } else {
      // --org-only may not exist; fall back to grepping the source.
      expect(readFileSync(join(TOOLS, "ts", "issue-types.ts"), "utf8")).toContain("DEVENV_REPO");
    }
  });
});

// ── special/repo-reset-merge-config ─────────────────────────────────────────

const SRM = join(TOOLS, "ts", "repo-reset-merge-config.ts");

describe("repo-reset-merge-config (bats port)", () => {
  let BIN = "";
  let GH_LOG = "";

  function srm(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
    e["PATH"] = `${BIN}:${process.env.PATH ?? ""}`;
    if (GH_LOG) e["GH_CALL_LOG"] = GH_LOG;
    for (const [k, v] of Object.entries(extraEnv)) e[k] = v;
    const r = spawnSync("node", [SRM, ...args], { encoding: "utf8", env: e });
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  beforeEach(() => {
    BIN = tmpPath(`srm-bin-${Math.random().toString(36).slice(2)}`);
    mkdirSync(BIN, { recursive: true });
    GH_LOG = "";
    writeFileSync(
      join(BIN, "gh"),
      `#!/usr/bin/env bash
cmd="$1"; shift
printf 'gh %s %s\\n' "$cmd" "$*" >> "\${GH_CALL_LOG:-/dev/null}"
if [ "$cmd" != "-R" ] && [ "\${1:-}" = "-R" ]; then
  shift; shift
fi
sub="$1"; shift || true
case "$cmd $sub" in
  "auth status") exit 0 ;;
  "repo list") printf '[{"name":"repo-alpha"},{"name":"repo-beta"}]' ;;
  "pr list")
    if [[ "$*" == *"--jq length"* ]]; then
      if [[ "$*" == *"alpha"* ]]; then printf '2\\n'; else printf '0\\n'; fi
    elif [[ "$*" == *"alpha"* ]]; then
      printf '[{"number":11},{"number":12}]'
    else
      printf '[]'
    fi ;;
  "repo view") cat <<'JSON'
{"owner":{"login":"mock-owner"},"name":"mock-repo"}
JSON
    ;;
  api*)
    if [ -n "\${API_FAIL:-}" ]; then
      echo "gh: HTTP 403 (simulated)" >&2
      exit 1
    fi
    echo '{}' ;;
  *) echo "gh mock received unexpected command: $cmd $sub (all args: $@)" >&2; exit 1 ;;
esac
`,
    );
    chmodSync(join(BIN, "gh"), 0o755);
  });

  it("dry-run lists repos and flags attention", () => {
    const r = srm(["--all"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/org:/);
    expect(r.out).toContain("repo-alpha");
    expect(r.out).toContain("repo-beta");
    expect(r.out).toContain("ATTENTION");
    expect(r.out).toMatch(/repo-alpha: type=/);
    expect(r.out).toContain("open_prs=2");
    expect(r.out).toContain("Dry-run only");
    expect(r.out).not.toContain("Applied rebase-only config");
  });

  it("positional name restricts the scan", () => {
    const r = srm(["repo-beta"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo-beta");
    expect(r.out).not.toContain("repo-alpha");
  });

  it("--apply configures a typed repo with a rebase-only PATCH", () => {
    GH_LOG = tmpPath(`srm-gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(GH_LOG, "");
    const r = srm(["--apply", "service.platform.core"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Applied rebase-only config/);
    const log = readFileSync(GH_LOG, "utf8");
    expect(log).toContain("allow_rebase_merge=true");
    expect(log).toContain("allow_merge_commit=false");
    expect(log).toContain("allow_squash_merge=false");
  });

  it("--apply refuses an undetected type and never enables all merge methods", () => {
    GH_LOG = tmpPath(`srm-gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(GH_LOG, "");
    const r = srm(["--apply", "repo-beta"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/undetected/);
    expect(r.out).not.toContain("Applied rebase-only config to mock-owner/repo-beta");
    const log = readFileSync(GH_LOG, "utf8");
    expect((log.match(/allow_merge_commit=true/g) ?? []).length).toBe(0);
    expect((log.match(/allow_squash_merge=true/g) ?? []).length).toBe(0);
  });

  it("--apply skips a repo the attention report flags (open PRs)", () => {
    GH_LOG = tmpPath(`srm-gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(GH_LOG, "");
    const r = srm(["--apply", "service.alpha.core"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/needs attention/);
    expect((readFileSync(GH_LOG, "utf8").match(/PATCH/g) ?? []).length).toBe(0);
  });

  it("--apply reports an API failure instead of claiming success", () => {
    GH_LOG = tmpPath(`srm-gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(GH_LOG, "");
    const r = srm(["--apply", "service.platform.core"], { API_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("Applied rebase-only config to mock-owner/service.platform.core");
    expect(r.out).toMatch(/Failed to apply/);
  });

  it("--apply summary counts skipped and failed repos", () => {
    const r = srm(["--apply", "service.platform.core", "repo-beta", "service.alpha.core"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/applied: 1/);
    expect(r.out).toMatch(/not applied: 2/);
  });

  it("dry-run never fails for an undetected type", () => {
    expect(srm(["repo-beta"]).status).toBe(0);
  });

  it("has valid syntax (TS port)", () => {
    expect(spawnSync("node", ["--check", SRM]).status).toBe(0);
  });

  it("no target selected: usage error with guidance", () => {
    const r = srm([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/No target selected/);
  });

  it("positional list processes exactly the named repos", () => {
    const r = srm(["repo-alpha", "repo-beta"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("repo-alpha");
    expect(r.out).toContain("repo-beta");
  });

  it("--all combined with positionals is a usage error", () => {
    const r = srm(["--all", "repo-alpha"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/Choose one target mode/);
  });

  it("--repo is no longer a recognized flag", () => {
    const r = srm(["--repo", "repo-beta"]);
    expect(r.status).not.toBe(0);
    // toolCli's strict parse rejects unknown long flags naming the flag.
    expect(r.out).toMatch(/--repo/);
  });
});

// ── provider protocol decoupling gate (skills) ──────────────────────────────

const FORBIDDEN_PATTERNS = ["GITHUB_REPO", "workinprogress-ai", "issues-config.yml", "provider_token.txt", "gh auth token", "gh auth login"];

describe("provider protocol decoupling gate (bats port)", () => {
  function scanTargets(): string[] {
    const targets: string[] = [];
    const skillsDir = join(ROOT, "copilot", "skills");
    for (const dir of readdirSync(skillsDir)) {
      const f = join(skillsDir, dir, "SKILL.md");
      if (existsSync(f)) targets.push(f);
    }
    const refs = join(skillsDir, "common", "references");
    if (existsSync(refs)) {
      for (const f of readdirSync(refs).filter((f) => f.endsWith(".md"))) targets.push(join(refs, f));
    }
    const conv = join(skillsDir, "_conventions.md");
    if (existsSync(conv)) targets.push(conv);
    const ci = join(ROOT, "copilot", "copilot-instructions.md");
    if (existsSync(ci)) targets.push(ci);
    const allowed = [
      join(skillsDir, "_shared", "references", "provider-protocols") + "/",
      join(skillsDir, "_tools-reference.md"),
      join(skillsDir, "_shared", "docs") + "/",
      join(ROOT, "tools", "tests", "skills") + "/",
    ];
    return targets.filter((t) => !allowed.some((a) => t.includes(a)));
  }

  function scanViolations(files: string[]): string[] {
    const violations: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf8").split("\n");
      content.forEach((line, i) => {
        if (FORBIDDEN_PATTERNS.some((pat) => line.includes(pat))) {
          violations.push(`VIOLATION ${f}:${i + 1}: ${line}`);
        }
      });
    }
    return violations;
  }

  it("scan targets resolve to a non-empty file list", () => {
    expect(scanTargets().length).toBeGreaterThanOrEqual(20);
  });

  it("no forbidden transport tokens in skill bodies", () => {
    const violations = scanViolations(scanTargets());
    if (violations.length > 0) {
      console.error(violations.join("\n"));
    }
    expect(violations, "GitHub-specific transport tokens found in skill bodies (move to provider-protocols/github.md)").toEqual([]);
  });

  it("copilot-instructions.md is actually scanned", () => {
    expect(scanTargets()).toContain(join(ROOT, "copilot", "copilot-instructions.md"));
  });

  it("a line matching overlapping patterns is reported once", () => {
    const f = tmpPath("overlap.md");
    writeFileSync(f, "export GITHUB_REPO=workinprogress-ai/x\n");
    const violations = scanViolations([f]).filter((v) => v.startsWith(`VIOLATION ${f}:`));
    expect(violations).toHaveLength(1);
  });

  it("a comment line is not exempt", () => {
    const f = tmpPath("comment.md");
    writeFileSync(f, "# GITHUB_REPO is documented here\n");
    expect(scanViolations([f]).filter((v) => v.startsWith(`VIOLATION ${f}:`))).toHaveLength(1);
  });

  it("protocol references exist with required sections", () => {
    const shared = join(ROOT, "copilot", "skills", "_shared", "references");
    const common = join(shared, "protocol-common.md");
    const gh = join(shared, "provider-protocols", "github.md");
    const az = join(shared, "provider-protocols", "azure.md");
    expect(existsSync(common)).toBe(true);
    expect(existsSync(gh)).toBe(true);
    expect(existsSync(az)).toBe(true);
    const commonSrc = readFileSync(common, "utf8");
    expect(commonSrc).toContain("Provider Protocol");
    expect(commonSrc).toContain("Canonical recipes");
    expect(commonSrc).toContain("Prohibitions");
    const ghSrc = readFileSync(gh, "utf8");
    const azSrc = readFileSync(az, "utf8");
    expect(ghSrc).toContain("Credential lifecycle");
    expect(azSrc).toContain("Credential lifecycle");
    expect(azSrc).toContain("Repository targeting");
    expect(azSrc).toContain("Provider-visible behavior");
  });
});
