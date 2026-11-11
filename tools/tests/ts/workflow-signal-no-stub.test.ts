// workflow-signal and issue-triage --triage-complete fire events in-process
// in a clean checkout (no generated depth-1 stubs): the status write reaches
// the provider, and a failure is reported instead of vanishing.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CALLS_LOG_NAME, pathWithStubs, runTool, stubCli, tmpDir } from "./harness/index.ts";
import { fireEvent } from "../../lib/domain/issues/graph.ts";

let stubDir = "";
let repoRoot = "";

function installGh(): void {
  stubCli(
    stubDir,
    "gh",
    [
      "#!/usr/bin/env bash",
      'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${join(stubDir, CALLS_LOG_NAME)}"`,
      `case "$*" in *projectItems*) echo '{"data":{"resource":{"projectItems":{"nodes":[]}}}}' ;; esac`,
      "exit 0",
    ].join("\n"),
  );
  stubCli(
    stubDir,
    "git",
    ["#!/usr/bin/env bash", `if [ "$1" = "rev-parse" ]; then printf '%s\\n' "${repoRoot}"; exit 0; fi`, "exit 0"].join("\n"),
  );
}

function ghLog(): string {
  const f = join(stubDir, CALLS_LOG_NAME);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

const env = (): Record<string, string> => ({ PATH: pathWithStubs(stubDir), DEVENV_REPO: "org/repo" });

beforeEach(() => {
  stubDir = tmpDir("wfsnostub-stub");
  repoRoot = tmpDir("wfsnostub-repo");
  installGh();
});
afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("event firing without generated stubs", () => {
  it("workflow-signal reaches the provider and reports success", () => {
    const r = runTool("workflow-signal", ["begin-grooming", "42"], { cwd: repoRoot, env: env() });
    expect(r.output).toContain("signalled _on_begin_grooming for issue #42");
    expect(r.status).toBe(0);
    expect(ghLog()).toContain("projectItems");
  });

  it("issue-triage --triage-complete writes the status through the same path", () => {
    const r = runTool("issue-triage", ["42", "--triage-complete"], { cwd: repoRoot, env: env() });
    expect(r.status).toBe(0);
    expect(ghLog()).toContain("projectItems");
  });

  it("issue-triage --triage-complete fails visibly when the event cannot be fired", () => {
    const r = runTool("issue-triage", ["42", "--triage-complete"], {
      cwd: repoRoot,
      env: { ...env(), WORKFLOW_CORE_TOOLS: join(repoRoot, "no-such-tools") },
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("triage-complete signal failed");
  });
});

describe("fireEvent", () => {
  it("returns the handler's error message instead of throwing", async () => {
    const result = await fireEvent("no_such_event", 1, {
      onWarning: () => {
        throw new Error("handler exploded");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("handler exploded");
  });

  it("reports an unknown event as not ok without an error", async () => {
    const result = await fireEvent("no_such_event", 1, { onWarning: () => {} });
    expect(result).toEqual({ ok: false });
  });
});
