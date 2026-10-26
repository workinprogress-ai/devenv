// Tests for issue-create-batch.ts — characterization of how an issue entry
// becomes an `issue-create` command, in both input modes (fast --issue
// entries and --file manifests). Preview prints the assembled command per
// issue; with --create a stand-in `issue-create` records its arguments and
// the body file's content.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/issue-create-batch.ts");

let stubDir = "";
let workDir = "";
let createLog = "";

function installStubs(): void {
  // issue-create stand-in: log argv (one per line) and the body file content.
  const stub = [
    "#!/usr/bin/env bash",
    '{ echo "CALL"; printf \'ARG:%s\\n\' "$@"; } >> "__LOG__"',
    'prev=""',
    'for a in "$@"; do',
    '  [ "$prev" = "--body-file" ] && { echo "BODY<<"; cat "$a"; echo ">>BODY"; } >> "__LOG__"',
    '  prev="$a"',
    "done",
    'if [ -n "${FAKE_CREATE_OUT:-}" ]; then printf \'%b\\n\' "$FAKE_CREATE_OUT"; else echo "https://example.invalid/test/repo/issues/7"; fi',
    "",
  ].join("\n").replaceAll("__LOG__", createLog);
  writeFileSync(join(stubDir, "issue-create"), stub, { mode: 0o755 });
  writeFileSync(join(stubDir, "gh"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
}

interface RunOpts {
  args: string[];
  createOut?: string;
}

function runTool(opts: RunOpts): { status: number; stdout: string; stderr: string; output: string } {
  const r = spawnSync("node", [TOOL, ...opts.args], {
    encoding: "utf8",
    cwd: workDir,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      DEVENV_REPO: "org/repo",
      ...(opts.createOut !== undefined ? { FAKE_CREATE_OUT: opts.createOut } : {}),
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status ?? 1, stdout, stderr, output: stdout + stderr };
}

/** Second preview row (index 0), temp path normalized. */
function previewRow(r: { output: string }, n = 2): string {
  return r.output
    .split("\n")
    .filter((l) => l.includes("|fast|") || l.includes("|manifest|"))[n - 2]!
    .replace(/[^ |]*\/issue-create-batch\.[A-Za-z0-9]+\//g, "<TMP>/");
}

function createLogLines(): string[] {
  if (!existsSync(createLog)) return [];
  return readFileSync(createLog, "utf8").split("\n").filter((l) => l !== "");
}

function bodyBlocks(): string[] {
  const text = readFileSync(createLog, "utf8");
  const blocks: string[] = [];
  const re = /BODY<<\n([\s\S]*?)>>BODY/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]!);
  return blocks;
}

const MANIFEST = [
  "defaults:",
  "  type: Task",
  "  milestone: M9",
  "  labels: [x, y]",
  '  body: "Default body"',
  "issues:",
  "  - title: One",
  "    parent: 3",
  "  - title: Two",
  "    type: Bug",
  "    assignees: [al]",
    '    body: "Own body"',
  "",
].join("\n");

describe("issue-create-batch", () => {
  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "icb-stub-"));
    workDir = mkdtempSync(join(tmpdir(), "icb-work-"));
    createLog = join(workDir, "create.log");
    writeFileSync(createLog, "");
    installStubs();
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("fast: every field becomes the right option, in order", () => {
    const r = runTool({ args: ["--issue", "First thing|type=Bug|parent=12|labels=a,b|assignees=u1|blocked_by=7,9|milestone=M1|project=P1|size=M|target=2026-Q1"] });
    expect(r.status).toBe(0);
    expect(previewRow(r)).toBe(
      "0|fast|First thing|issue-create --title First thing --type Bug --body-file <TMP>/issue-0-body.md --no-template --parent 12 --milestone M1 --project P1 --label a --label b --assignee u1 --blocked-by 7 --blocked-by 9",
    );
  });

  it("fast: command-line defaults fill what an entry leaves out, and entries override them", () => {
    const r = runTool({
      args: [
        "--type", "Task", "--parent", "5", "--milestone", "MD", "--project", "PD",
        "--label", "dl", "--assignee", "da", "--blocked-by", "1",
        "--issue", "Plain", "--issue", "Own|type=Bug|parent=6|milestone=MO|project=PO|labels=ol|assignees=oa|blocked_by=2",
      ],
    });
    expect(r.status).toBe(0);
    expect(previewRow(r, 2)).toBe("0|fast|Plain|issue-create --title Plain --type Task --body-file <TMP>/issue-0-body.md --no-template --parent 5 --milestone MD --project PD --label dl --assignee da --blocked-by 1");
    expect(previewRow(r, 3)).toBe("1|fast|Own|issue-create --title Own --type Bug --body-file <TMP>/issue-1-body.md --no-template --parent 6 --milestone MO --project PO --label ol --assignee oa --blocked-by 2");
  });

  it("fast: an inline body is written to the body file", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "With body|body=Hello there"] });
    expect(r.status).toBe(0);
    expect(bodyBlocks().some((b) => b.trim() === "Hello there")).toBe(true);
  });

  it("fast: with no body a generated body is written, carrying the title", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "No body given|size=L|target=2026-Q2"] });
    expect(r.status).toBe(0);
    expect(bodyBlocks().some((b) => b.includes("No body given"))).toBe(true);
  });

  it("fast: an existing body_file is used as it is", () => {
    const mine = join(workDir, "mine.md");
    writeFileSync(mine, "from a file\n");
    const r = runTool({ args: ["--type", "Task", "--issue", `Filed|body_file=${mine}`] });
    expect(r.status).toBe(0);
    expect(r.output).toContain(`--body-file ${mine} --no-template`);
  });

  it("fast: a missing body_file is refused naming the issue and the file", () => {
    const r = runTool({ args: ["--type", "Task", "--issue", `Filed|body_file=${workDir}/nope.md`] });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain(`Issue[0] body_file not found: ${workDir}/nope.md`);
  });

  it("fast: missing type, unsupported key and missing title are each refused", () => {
    const noType = runTool({ args: ["--issue", "No type"] });
    expect(noType.status).not.toBe(0);
    expect(noType.output).toContain("Issue[0] missing type");
    const odd = runTool({ args: ["--type", "Task", "--issue", "Odd|colour=red"] });
    expect(odd.status).not.toBe(0);
    expect(odd.output).toContain("Unsupported key in --issue entry: colour");
    const noTitle = runTool({ args: ["--type", "Task", "--issue", "|labels=x"] });
    expect(noTitle.status).not.toBe(0);
    expect(noTitle.output).toContain("--issue entry must include a title");
  });

  it("fast: a missing type is reported before a missing body_file", () => {
    const r = runTool({ args: ["--issue", `Both wrong|body_file=${workDir}/nope.md`] });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("missing type");
    expect(r.output).not.toContain("body_file not found");
  });

  it("manifest: item beats manifest defaults beats command-line defaults", () => {
    const m = join(workDir, "m.yaml");
    writeFileSync(m, MANIFEST);
    const r = runTool({ args: ["--file", m, "--type", "Epic", "--milestone", "CLI", "--project", "PCLI"] });
    expect(r.status).toBe(0);
    expect(previewRow(r, 2)).toBe("0|manifest|One|issue-create --title One --type Task --body-file <TMP>/issue-0-body.md --no-template --parent 3 --milestone M9 --project PCLI --label x --label y");
    expect(previewRow(r, 3)).toBe("1|manifest|Two|issue-create --title Two --type Bug --body-file <TMP>/issue-1-body.md --no-template --milestone M9 --project PCLI --label x --label y --assignee al");
  });

  it("manifest: item body beats the manifest default body, and both reach the body file", () => {
    const m = join(workDir, "m.yaml");
    writeFileSync(m, MANIFEST);
    const r = runTool({ args: ["--create", "--continue-on-error", "--file", m] });
    expect(r.status).toBe(0);
    const bodies = bodyBlocks().map((b) => b.trim());
    expect(bodies).toContain("Default body");
    expect(bodies).toContain("Own body");
  });

  it("manifest: a body_file from the manifest defaults is used", () => {
    const wide = join(workDir, "wide.md");
    writeFileSync(wide, "manifest-wide\n");
    const m = join(workDir, "m2.yaml");
    writeFileSync(m, `defaults:\n  type: Task\n  body_file: ${wide}\nissues:\n  - title: One\n`);
    const r = runTool({ args: ["--file", m] });
    expect(r.status).toBe(0);
    expect(r.output).toContain(`--body-file ${wide} --no-template`);
  });

  it("manifest: a missing body_file is refused naming the issue and the file", () => {
    const m = join(workDir, "m3.yaml");
    writeFileSync(m, `defaults:\n  type: Task\nissues:\n  - title: One\n    body_file: ${workDir}/nope.md\n`);
    const r = runTool({ args: ["--file", m] });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain(`Issue[0] body_file not found: ${workDir}/nope.md`);
  });

  it("manifest: a missing type is reported before a missing body_file", () => {
    const m = join(workDir, "m4.yaml");
    writeFileSync(m, `issues:\n  - title: One\n    body_file: ${workDir}/nope.md\n`);
    const r = runTool({ args: ["--file", m] });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("missing type");
    expect(r.output).not.toContain("body_file not found");
  });

  it("manifest: a missing title is reported before a missing body_file", () => {
    const m = join(workDir, "m5.yaml");
    writeFileSync(m, `defaults:\n  type: Task\nissues:\n  - labels: [a]\n    body_file: ${workDir}/nope.md\n`);
    const r = runTool({ args: ["--file", m] });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("missing title");
    expect(r.output).not.toContain("body_file not found");
  });

  it("--continue-on-error skips a bad entry and still creates the rest", () => {
    const r = runTool({ args: ["--create", "--continue-on-error", "--type", "Task", "--issue", "|labels=x", "--issue", "Good one"] });
    expect(r.status).not.toBe(0);
    expect(createLogLines().filter((l) => l === "CALL")).toHaveLength(1);
    expect(createLogLines()).toContain("ARG:Good one");
  });

  it("create: a GitHub issue URL result is a success with the number parsed", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "One"], createOut: "https://github.com/acme/widgets/issues/321" });
    expect(r.status).toBe(0);
    expect(r.output).toContain("0|321|One|https://github.com/acme/widgets/issues/321");
    expect(r.output).not.toContain("could not parse");
  });

  it("create: an Azure bare work-item id result is a success", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "One"], createOut: "4821" });
    expect(r.status).toBe(0);
    expect(r.output).toContain("0|4821|One|");
  });

  it("create: an Azure work-item URL result is a success with the id parsed", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "One"], createOut: "https://dev.azure.com/acme/proj/_workitems/edit/4821" });
    expect(r.status).toBe(0);
    expect(r.output).toContain("0|4821|One|");
  });

  it("create: log lines (even ones containing URLs) before the result do not masquerade as it", () => {
    const r = runTool({
      args: ["--create", "--type", "Task", "--issue", "One"],
      createOut: "[t] INFO: Created issue: https://github.com/acme/widgets/issues/9\\n[t] WARN: see https://github.com/acme/widgets/issues/10\\nhttps://github.com/acme/widgets/issues/42",
    });
    expect(r.status).toBe(0);
    expect(r.output).toContain("0|42|One|");
  });

  it("create: output with no result line is still reported as a parse failure", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "One"], createOut: "[t] INFO: nothing useful here" });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("could not parse");
  });

  it("create: a batch of successes exits 0 and reports each created issue once", () => {
    const r = runTool({ args: ["--create", "--type", "Task", "--issue", "A", "--issue", "B"], createOut: "https://github.com/acme/widgets/issues/7" });
    expect(r.status).toBe(0);
    expect(r.output).toContain("created=2 failed=0");
    expect(createLogLines().filter((l) => l === "CALL")).toHaveLength(2);
  });

  it("create: preview needs no provider seam (nothing is looked up)", () => {
    const r = runTool({ args: ["--type", "Task", "--issue", "One"] });
    expect(r.status).toBe(0);
    expect(r.output).not.toContain("command not found");
  });
});
