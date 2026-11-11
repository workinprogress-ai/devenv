// Tests for artifacts-list.ts: the tool lists packages through the artifacts
// domain module — paginated, one alias table, and listing failures exit with
// the API-failure code instead of reading as an empty list. gh is a PATH stub
// that records each call.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathWithStubs, rmrf, runTool, stubCli, tmpDir } from "./harness/index.ts";
import { EXIT_API_FAILURE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

let stubDir = "";

function page(from: number, to: number): string {
  return JSON.stringify(
    Array.from({ length: to - from + 1 }, (_, i) => ({
      name: `pkg-${from + i}`,
      package_type: "npm",
      html_url: `https://x/${from + i}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    })),
  );
}

/** gh stub modelling real pagination: only `--paginate --slurp` yields one
 * parseable document of all pages; a lone `--paginate` concatenates arrays. */
function installPagedGh(): void {
  stubCli(
    stubDir,
    "gh",
    [
      "#!/usr/bin/env bash",
      '[ "$1" = "auth" ] && exit 0',
      `printf '%s\\n' "$*" >> "${join(stubDir, "calls.log")}"`,
      'all="$*"',
      'if [[ "$all" == *"--paginate"* && "$all" == *"--slurp"* ]]; then',
      `  printf '[%s,%s]\\n' '${page(1, 30)}' '${page(31, 45)}'`,
      'elif [[ "$all" == *"--paginate"* ]]; then',
      `  printf '%s\\n%s\\n' '${page(1, 30)}' '${page(31, 45)}'`,
      "else",
      `  printf '%s\\n' '${page(1, 30)}'`,
      "fi",
      "",
    ].join("\n"),
  );
}

function calls(): string[] {
  const log = join(stubDir, "calls.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : [];
}

function run(args: string[]): ReturnType<typeof runTool> {
  return runTool("artifacts-list", ["--owner", "acme", ...args], { cwd: stubDir, env: { PATH: pathWithStubs(stubDir) } });
}

describe("artifacts-list", () => {
  beforeEach(() => {
    stubDir = tmpDir("artifacts-list-");
  });
  afterEach(() => rmrf(stubDir));

  it("lists every page of packages, not just the first 30", () => {
    installPagedGh();
    const r = run(["--type", "npm", "--format", "json"]);
    expect(r.status, r.output).toBe(EXIT_SUCCESS);
    expect((JSON.parse(r.stdout) as unknown[]).length).toBe(45);
  });

  it("lists every page of versions, not just the first 30", () => {
    installPagedGh();
    const r = run(["--type", "npm", "--name", "pkg", "--versions", "--format", "json"]);
    expect(r.status, r.output).toBe(EXIT_SUCCESS);
    expect((JSON.parse(r.stdout) as unknown[]).length).toBe(45);
  });

  it("normalises the type through the domain alias table", () => {
    installPagedGh();
    run(["--type", "rust", "--format", "json"]);
    expect(calls().some((c) => c.includes("package_type=cargo"))).toBe(true);
  });

  it("a failed listing exits with the API-failure code", () => {
    stubCli(stubDir, "gh", '#!/usr/bin/env bash\n[ "$1" = "auth" ] && exit 0\necho "boom" >&2\nexit 1\n');
    const r = run(["--type", "npm", "--format", "json"]);
    expect(r.status, r.output).toBe(EXIT_API_FAILURE);
    expect(r.stdout).not.toContain("[]");
  });

  it("an unparseable listing response exits with the API-failure code", () => {
    stubCli(stubDir, "gh", '#!/usr/bin/env bash\n[ "$1" = "auth" ] && exit 0\necho "not json"\n');
    const r = run(["--type", "npm", "--format", "json"]);
    expect(r.status, r.output).toBe(EXIT_API_FAILURE);
  });

  it("--versions without a name is still a misuse failure", () => {
    installPagedGh();
    expect(run(["--type", "npm", "--versions"]).status).toBe(2);
  });
});
