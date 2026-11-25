// Azure comment edit replaces a work-item comment's text through the comments
// API: a PATCH with `format=markdown` as a QUERY parameter (a body field is
// ignored by the API), the same body rules and artifact marker transform as the
// add path, and a named error for a bad ref or body before any request is sent.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { issuesCommentEdit } from "../../lib/providers/azure/issues.ts";

const WIT = "https://dev.azure.com/test-org/test-project/_apis/wit";
const EDIT_URL = `${WIT}/workitems/5/comments/3?format=markdown&api-version=7.2-preview.4`;

let restoreEnv: () => void = () => {};
let scratch = "";

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
  scratch = mkdtempSync(join(tmpdir(), "azure-comment-edit-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  restoreEnv();
  rmSync(scratch, { recursive: true, force: true });
});

function patchRoute() {
  return { method: "PATCH", url: EDIT_URL, respond: azureJson({ id: 3 }) };
}

describe("azure issuesCommentEdit request", () => {
  it("patches the comment through the comments API with format=markdown in the query", async () => {
    const stub = stubAzureFetch([patchRoute()]);
    await issuesCommentEdit("", "5/3", { body: "edited" });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({ method: "PATCH", url: EDIT_URL, body: { text: "edited" } });
    expect(stub.unmatched()).toEqual([]);
  });

  it.each(["x", "x\n", "x\n\n"])("sends the text with its trailing newlines intact (%j)", async (text) => {
    const stub = stubAzureFetch([patchRoute()]);
    await issuesCommentEdit("", "5/3", { body: text });
    expect((stub.requests[0]?.body as { text: string }).text).toBe(text);
  });

  it("applies the artifact marker transform, so the doc_id survives Azure's comment stripping", async () => {
    const stub = stubAzureFetch([patchRoute()]);
    const body = "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-5:plan:one\nartifact_type: plan\n-->\n\n# Plan\n";
    await issuesCommentEdit("", "5/3", { body });
    const sent = (stub.requests[0]?.body as { text: string }).text;
    expect(sent).not.toContain("<!--");
    expect(sent).toMatch(/^doc_id: dv1:org\/repo:issue-5:plan:one$/m);
    expect(sent).toContain("# Plan");
  });

  it("reads the body from a file", async () => {
    const stub = stubAzureFetch([patchRoute()]);
    const file = join(scratch, "body.md");
    writeFileSync(file, "from a file");
    await issuesCommentEdit("", "5/3", { bodyFile: file });
    expect((stub.requests[0]?.body as { text: string }).text).toBe("from a file");
  });

  it("surfaces an API failure instead of reporting success", async () => {
    stubAzureFetch([{ method: "PATCH", url: EDIT_URL, respond: azureJson({ message: "gone" }, 404) }]);
    await expect(issuesCommentEdit("", "5/3", { body: "edited" })).rejects.toThrow();
  });
});

describe("azure issuesCommentEdit rejects bad input before any request", () => {
  it.each([
    ["no body source", {}, /requires --body/],
    ["both body sources", { body: "a", bodyFile: "/dev/null" }, /mutually exclusive/],
    ["an empty body", { body: "" }, /empty/],
    ["a whitespace-only body", { body: " \n\t" }, /empty/],
  ])("%s", async (_name, opts, message) => {
    const stub = stubAzureFetch([patchRoute()]);
    await expect(issuesCommentEdit("", "5/3", opts)).rejects.toThrow(message);
    expect(stub.requests).toEqual([]);
  });

  it.each(["3", "5/", "/3", "5/abc", "5/3/1", ""])("a malformed comment ref (%j)", async (ref) => {
    const stub = stubAzureFetch([patchRoute()]);
    await expect(issuesCommentEdit("", ref, { body: "edited" })).rejects.toThrow(/malformed/);
    expect(stub.requests).toEqual([]);
  });
});

describe("facade issuesCommentEdit on azure", () => {
  async function azureFacade() {
    writeFileSync(join(scratch, "devenv.config"), "[provider]\nname=azure\nazure_org=test-org\nazure_project=test-project\n");
    vi.stubEnv("DEVENV_ROOT", scratch);
    vi.resetModules();
    return import("../../lib/providers/facade/issues.ts");
  }

  it("patches the comment, then returns the read-back record in the seam shape", async () => {
    const stub = stubAzureFetch([
      patchRoute(),
      {
        method: "GET",
        url: `${WIT}/workitems/5/comments/3?api-version=7.2-preview.4`,
        respond: azureJson({
          id: 3,
          text: "edited",
          createdBy: { displayName: "A" },
          createdDate: "2026-11-25T10:00:00Z",
          modifiedDate: "2026-11-25T11:00:00Z",
        }),
      },
    ]);
    const facade = await azureFacade();
    const record = JSON.parse(await facade.issuesCommentEdit("", "5/3", { body: "edited" })) as Record<string, unknown>;
    expect(stub.requests.map((r) => r.method)).toEqual(["PATCH", "GET"]);
    expect(Object.keys(record).sort()).toEqual(["body", "created_at", "id", "updated_at", "url", "user"]);
    expect(record).toMatchObject({
      id: "5/3",
      body: "edited",
      created_at: "2026-11-25T10:00:00Z",
      updated_at: "2026-11-25T11:00:00Z",
    });
  });

  it("makes no request when the edit is rejected", async () => {
    const stub = stubAzureFetch([patchRoute()]);
    const facade = await azureFacade();
    await expect(facade.issuesCommentEdit("", "5/3", { body: "" })).rejects.toThrow(/empty/);
    expect(stub.requests).toEqual([]);
  });
});
