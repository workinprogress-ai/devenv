// prsView flag rendering for a single record: `--json` projects fields, `--jq`
// evaluates a program against the one record (not a list), and the record's
// own text (a title containing brackets) is never altered by the renderer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { prsView } from "../../lib/providers/azure/prs.ts";

const GIT = "https://dev.azure.com/test-org/test-project/_apis/git";
const URL_11912 = `${GIT}/pullrequests/11912?api-version=7.1`;

interface PrFixture {
  title: string;
  lastMergeSourceCommit: { commitId: string };
  createdBy: { displayName: string };
}

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

function stubPr(overrides: Partial<PrFixture> = {}): PrFixture {
  const pr = { ...azureFixture<PrFixture>("pullrequest.completed.json"), ...overrides };
  stubAzureFetch([{ method: "GET", url: URL_11912, respond: azureJson(pr) }]);
  return pr;
}

const FIELDS = "title,body,isDraft,state,author,headRefOid";

describe("prsView json/jq rendering", () => {
  it("projects --json fields into one object", async () => {
    const pr = stubPr();
    const out = await prsView("", 11912, { json: FIELDS });
    expect(JSON.parse(out as string)).toEqual({
      title: pr.title,
      body: "smoke",
      isDraft: false,
      state: "MERGED",
      author: { login: pr.createdBy.displayName },
      headRefOid: pr.lastMergeSourceCommit.commitId,
    });
  });

  it("evaluates jq '.' against the single projected record", async () => {
    const pr = stubPr();
    const out = await prsView("", 11912, { json: FIELDS, jq: "." });
    expect(JSON.parse(out as string)).toMatchObject({ title: pr.title, state: "MERGED" });
  });

  it("evaluates a field jq program to the bare value", async () => {
    const pr = stubPr();
    expect(await prsView("", 11912, { json: FIELDS, jq: ".headRefOid" })).toBe(pr.lastMergeSourceCommit.commitId);
    stubPr();
    expect(await prsView("", 11912, { json: FIELDS, jq: ".author" })).toBe(
      JSON.stringify({ login: pr.createdBy.displayName }),
    );
  });

  it("keeps the .[0].field form working", async () => {
    const pr = stubPr();
    expect(await prsView("", 11912, { json: FIELDS, jq: ".[0].title" })).toBe(pr.title);
  });

  it("round-trips a title that starts and ends with brackets", async () => {
    stubPr({ title: "[WIP] x [y]" });
    expect(await prsView("", 11912, { json: "title", jq: ".title" })).toBe("[WIP] x [y]");
    stubPr({ title: "[WIP] x [y]" });
    expect(JSON.parse((await prsView("", 11912, { json: "title" })) as string)).toEqual({ title: "[WIP] x [y]" });
  });

  it("rejects an unsupported jq program with a clear message", async () => {
    stubPr();
    await expect(prsView("", 11912, { json: "title", jq: ".a | length" })).rejects.toThrow(/unsupported jq program/);
  });
});
