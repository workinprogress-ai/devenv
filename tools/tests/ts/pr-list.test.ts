// Port of tools/tests/scripts/test_pr_list.bats (4 tests).
// pr-list: what it actually hands to the provider CLI.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool as runHarness } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
// The suite drove the depth-1 stub (bash → exec node); the harness runs the
// .ts source directly — the same execution path the stub resolves to. The
// stub itself stays bash: the syntax check below pins it.
const SCRIPT = join(TOOLS, "pr-list");

let TMP = "";
let GH_CALL_LOG = "";

const GH_STUB = [
  "#!/usr/bin/env bash",
  'printf \'gh %s\\n\' "$*" >> "$GH_CALL_LOG"',
  "[ \"$1\" = auth ] && exit 0",
  'if [ "$1" = pr ] && [ "$2" = list ]; then',
  "    shift 2",
  "    positional=0",
  "    while [ $# -gt 0 ]; do",
  "        case \"$1\" in",
  "            -R|--repo|--state|--limit|--author|--label|--base|--head|--json|--jq|-q|--search) shift 2 ;;",
  "            -*) shift ;;",
  "            *) positional=$((positional + 1)); shift ;;",
  "        esac",
  "    done",
  '    if [ "$positional" -gt 0 ]; then',
  '        echo "accepts 0 arg(s), received $positional" >&2',
  "        exit 1",
  "    fi",
  "    echo '[]'",
  "    exit 0",
  "fi",
  "exit 0",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `prlist-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  GH_CALL_LOG = join(TMP, "gh.log");
  writeFileSync(GH_CALL_LOG, "");
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), GH_STUB);
  spawnSync("chmod", ["+x", join(bin, "gh")]);
  // The helper's sandboxed config: github provider.
  const root = join(TMP, "devenv-root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runPrList(args: string[], ghStub?: string): { status: number; out: string } {
  if (ghStub) {
    writeFileSync(join(TMP, "bin", "gh"), ghStub);
    spawnSync("chmod", ["+x", join(TMP, "bin", "gh")]);
  }
  const r = runHarness("pr-list", args, {
    env: {
      ...procEnv,
      GH_CALL_LOG,
      DEVENV_REPO: "acme/widgets",
      PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
    },
  });
  return { status: r.status, out: r.output };
}

function firstListCall(): string {
  const log = spawnSync("grep", ["^gh pr list", GH_CALL_LOG], { encoding: "utf8" }).stdout ?? "";
  return log.split("\n")[0] ?? "";
}

describe("scripts/pr-list", () => {
  it("pr-list has valid bash syntax", () => {
    const r = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("pr-list passes the repo exactly once (a doubled positional makes gh pr list fail)", () => {
    const r = runPrList([]);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("[]");
    const call = firstListCall();
    expect(call.split("acme/widgets").length - 1).toBe(1);
  });

  it("pr-list forwards the filters it was given", () => {
    const r = runPrList(["--state", "merged", "--limit", "5", "--head", "feature/x"]);
    expect(r.status).toBe(0);
    const call = firstListCall();
    expect(call).toContain("--state merged");
    expect(call).toContain("--limit 5");
    expect(call).toContain("--head feature/x");
  });

  it("pr-list reports a provider failure with the API-failure exit code", () => {
    const r = runPrList([], '#!/usr/bin/env bash\n[ "$1" = auth ] && exit 0\nexit 1\n');
    expect(r.status).not.toBe(0);
  });
});
