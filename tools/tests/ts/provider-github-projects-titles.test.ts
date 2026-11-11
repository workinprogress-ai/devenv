// github/projects: project titles and owner/repo names are data. They reach
// gh as -f variables and are compared in code; they never enter a jq program,
// so a backslash or `\(` in a title cannot alter what is selected. The gh
// stub evaluates any --jq program it is given with the real jq, so a title
// interpolated into a program would change the result.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALLS_LOG_NAME, pathWithStubs, rmrf, stubGh, tmpDir } from "./harness/index.ts";

let root = "";
let stubDir = "";
const savedPath = process.env.PATH;

const TITLES = ['plain', 'back\\slash', 'inter\\(1+1)polated', 'dq"title'];

function installGh(): void {
  const projects = {
    data: {
      organization: {
        projectsV2: {
          pageInfo: { hasNextPage: false, endCursor: "" },
          nodes: TITLES.map((title, i) => ({ id: `PVT_${i}`, number: 10 + i, title })),
        },
      },
    },
  };
  const items = {
    data: {
      node: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: "" },
          nodes: [
            { id: "PVTI_a", content: { number: 7, repository: { nameWithOwner: 'org/re\\po' } } },
            { id: "PVTI_b", content: { number: 7, repository: { nameWithOwner: "org/other" } } },
          ],
        },
      },
    },
  };
  writeFileSync(join(stubDir, "projects.json"), JSON.stringify(projects));
  writeFileSync(join(stubDir, "items.json"), JSON.stringify(items));
  stubGh(
    stubDir,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
      `printf '%s\\n' "gh $*" >> "${join(stubDir, CALLS_LOG_NAME)}"`,
      'prog=""; prev=""',
      'for a in "$@"; do if [ "$prev" = "--jq" ]; then prog="$a"; fi; prev="$a"; done',
      'case "$*" in',
      `  *"items(first"*) file="${join(stubDir, "items.json")}" ;;`,
      `  *"projectsV2(first"*) file="${join(stubDir, "projects.json")}" ;;`,
      '  *) exit 0 ;;',
      "esac",
      'if [ -n "$prog" ]; then jq -r "$prog" < "$file"; else cat "$file"; fi',
    ].join("\n"),
  );
}

beforeEach(() => {
  root = tmpDir("ghproj-root");
  stubDir = tmpDir("ghproj-stubs");
  writeFileSync(join(root, "devenv.config"), "[provider]\nname=github\n\n[organization]\norg=org\n");
  process.env.DEVENV_ROOT = root;
  process.env.PATH = pathWithStubs(stubDir);
  installGh();
});

afterEach(() => {
  process.env.PATH = savedPath;
  delete process.env.DEVENV_ROOT;
  rmrf(root);
  rmrf(stubDir);
});

function ghCalls(): string {
  const f = join(stubDir, CALLS_LOG_NAME);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

describe("github projects: titles are data", () => {
  it.each([
    ["plain", "PVT_0", "10"],
    ["back\\slash", "PVT_1", "11"],
    ["inter\\(1+1)polated", "PVT_2", "12"],
    ['dq"title', "PVT_3", "13"],
  ])("title %j resolves to its own project", async (title, id, number) => {
    const gh = await import("../../lib/providers/github/projects.ts");
    expect(gh.projectsIdByName("org", title)).toBe(id);
    expect(gh.projectsNumberByName("org", title)).toBe(number);
    expect(ghCalls()).not.toContain("--jq");
  });

  it("an unknown title still reports a named error", async () => {
    const gh = await import("../../lib/providers/github/projects.ts");
    expect(() => gh.projectsIdByName("org", "nope")).toThrow(/no project titled 'nope'/);
  });

  it("a backslash in owner/repo matches exactly that repository's card", async () => {
    const gh = await import("../../lib/providers/github/projects.ts");
    expect(gh.projectsItemIdForIssue("PVT_x", "7", "org", "re\\po")).toBe("PVTI_a");
  });
});
