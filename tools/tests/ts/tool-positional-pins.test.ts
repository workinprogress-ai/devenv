// Tool-level stray-positional pins: every tool that parsed strictly before
// the toolCli adoption (explicit allowPositionals:false in the old
// parseArgs call, or parseArgs' implicit default) must still reject a stray
// positional with a non-zero exit. The toolCli unit suite cannot see this
// class — it passes while an individual tool regresses.
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool } from "./harness/run-tool.ts";

const REPO_ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const EXPLICIT_STRICT = [
  "issue-create",
  "issue-create-batch",
  "issue-list",
  "issue-update",
  "pr-list",
  "issue-artifact-doc-id",
  "issue-artifact-get",
  "issue-artifact-list",
  "issue-artifact-select",
  "issue-artifact-upsert",
] as const;

const IMPLICIT_STRICT = ["issue-types", "issue-label-list", "issue-select"] as const;

describe.each([...EXPLICIT_STRICT])("%s rejects a stray positional", (tool) => {
  it("exits non-zero on an unexpected argument", () => {
    // issue-create needs a title flag before any other validation can pass;
    // a stray positional must fail at parse, before network or TTY paths.
    const args = tool === "issue-create" ? ["--title", "t", "stray-arg"] : ["stray-arg"];
    const r = runTool(tool, args, { cwd: REPO_ROOT });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/Unexpected argument|positional|Unknown option|Issue number is required|usage/i);
  }, 30_000);
});

describe.each([...IMPLICIT_STRICT])("%s rejects a stray positional (implicit-strict set)", (tool) => {
  it("exits non-zero on an unexpected argument", () => {
    const r = runTool(tool, ["stray-arg"], { cwd: REPO_ROOT });
    // issue-select hits the TTY check (exit 2) — still a rejection, not
    // silent acceptance; issue-types/issue-label-list fail at parse.
    expect(r.status).not.toBe(0);
  }, 30_000);
});
