// pr-thread-reply must hand the provider the FULL repository spec. An Azure spec
// is `org/project/repo`; shortening it to first/last (`org/repo`) makes the
// provider read the project as `org` and route the reply to the wrong place.
// The child process' fetch guard records the request URL it rejects, which is
// the observable route.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drainCanary } from "./harness/canary.ts";
import { rmrf, runTool, tmpDir } from "./harness/index.ts";

let root = "";

beforeEach(() => {
  root = tmpDir("reply-route");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "devenv.config"),
    ["[provider]", "name=azure", "azure_org=acme", "azure_project=proj", "", "[organization]", "org=acme", ""].join("\n"),
  );
});

afterEach(() => {
  rmrf(root);
});

describe("pr-thread-reply on Azure", () => {
  it("routes the reply to the project and repository of the full spec", () => {
    const r = runTool("pr-thread-reply", ["12", "--comment-id", "34/7", "--body", "ok"], {
      env: { DEVENV_ROOT: root, DEVENV_REPO: "acme/proj/widgets", AZURE_PAT: "fake-pat" },
    });
    expect(r.status).not.toBe(0);
    const urls = drainCanary().filter((l) => l.startsWith("fetch "));
    expect(urls.length).toBeGreaterThan(0);
    const reply = urls.find((u) => u.includes("/threads/")) ?? urls[0] ?? "";
    expect(reply).toContain("/proj/");
    expect(reply).toContain("repositories/widgets");
    expect(reply).not.toContain("/widgets/_apis");
  });
});
