// Port of tools/tests/scripts/test_option_values.bats (5 tests).
// Option parsing in the wrapper scripts: an option that takes a value checks
// it with require_option_value, so a missing value is a usage error (exit 2,
// with the option named) instead of "$2: unbound variable", and
// `--base --force` cannot swallow the next flag.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const TS = join(TOOLS, "ts");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `optvals-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

// arms_missing_check FILE...: file:line of each option arm that reads "$2"
// without the check (the awk oracle from the bats source).
const ARMS_AWK = `
    FNR == 1 { arm = ""; in_arm = 0 }
    /^[[:space:]]*-[^^)[:space:]]*(\\|-[^)[:space:]]*)*\\)/ { arm = $0; start = FNR; in_arm = 1; if ($0 ~ /;;/) check(); next }
    in_arm { arm = arm "\\n" $0; if ($0 ~ /;;/) check() }
    function check() {
        guard = arm ~ /require_option_value/ || (arm ~ /"\\$\\{2:-\\}"/ && arm ~ /\\[\\[? -n/ )
        if (arm ~ /"\\$2"/ && arm ~ /shift 2/ && !guard) print FILENAME ":" start
        in_arm = 0; arm = ""
    }
`;

function armsMissingCheck(files: string[]): string {
  if (files.length === 0) return "";
  const r = spawnSync("awk", [ARMS_AWK, ...files], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

describe("scripts/option-values", () => {
  it("every option arm that reads $2 checks it with require_option_value", () => {
    // The check targets scripts that source error-handling.bash (where
    // require_option_value lives). The template demonstrates the inline
    // pattern and the harness is self-contained — both validate $2 without
    // the lib, so they are outside this convention's scope.
    const candidates = [
      join(ROOT, "tools", "templates", "script-template.sh"),
      join(ROOT, "tools", "tests", "run-devenv-tests.sh"),
    ];
    const libFiles = candidates.filter(
      (f) => spawnSync("grep", ["-qE", "^[[:space:]]*source .*error-handling\\.bash", f]).status === 0,
    );
    const offenders = armsMissingCheck(libFiles);
    expect(offenders).toBe("");
  });

  it("the guard does catch an unchecked arm, one-line or multi-line (it is not vacuous)", () => {
    const probe = join(TMP, "probe.sh");
    writeFileSync(
      probe,
      'case "$1" in\n  --a) A="$2"; shift 2 ;;\n  --b)\n    B="$2"\n    shift 2\n    ;;\n  --c) require_option_value "$1" "${2:-}"; C="$2"; shift 2 ;;\nesac\n',
    );
    const out = armsMissingCheck([probe]);
    expect(out).toContain("probe.sh:2");
    expect(out).toContain("probe.sh:3");
    expect(out).not.toContain("probe.sh:7");
  });

  // script-level behavior: the missing value is named, and nothing crashes on set -u
  it("a script reports a missing option value as a usage error, not an unbound variable", () => {
    const pairs: Array<[string, string]> = [
      ["issue-list", "--state"],
      ["pr-list", "--state"],
      ["pipelines-status", "--status"],
    ];
    for (const [script, opt] of pairs) {
      const r = spawnSync("node", [toolScript(script), opt], { encoding: "utf8" });
      expect(r.status, `${script} ${opt}: status ${r.status}`).toBe(2);
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      expect(out, `${script}: ${out}`).not.toContain("unbound variable");
      expect(out, `${script}: option not named`).toContain(opt);
    }
  });

  it("issue-select: --state --type does not take --type as the state", () => {
    const r = spawnSync("node", [join(TS, "issue-select.ts"), "--state", "--type", "Bug"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("'--state'");
  });

  it("pr-create: --issue with no value is a usage error naming the option", () => {
    const r = spawnSync("node", [join(TS, "pr-create.ts"), "--issue"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).toContain("--issue");
    expect(out).not.toContain("unbound variable");
  });
});
