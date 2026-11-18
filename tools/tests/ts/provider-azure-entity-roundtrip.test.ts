// Entity round trip for Azure work-item comments/bodies: the comment-ref
// grammar and the artifact-marker transform that lets a doc_id survive Azure's
// HTML-comment stripping.
import { describe, expect, it } from "vitest";
import { azureMarkerTransform, splitCommentRef } from "../../lib/providers/azure/entity-roundtrip.ts";

const HEADER = [
  "<!-- DEVENV_ARTIFACT_V1",
  "artifact_type: plan",
  "doc_id: dv1:acme/widgets:1:plan:x",
  "issue_number: 1",
  "-->",
].join("\n");

describe("splitCommentRef", () => {
  it("splits <work item>/<comment id>", () => {
    expect(splitCommentRef("12/5")).toEqual({ workItem: "12", commentId: "5" });
  });

  it.each(["", "12", "12/", "/5", "/", "12/5/6", "a/5", "12/b", "12/ 5", "12//5"])("rejects '%s'", (ref) => {
    expect(() => splitCommentRef(ref)).toThrow(/malformed/);
  });
});

describe("azureMarkerTransform", () => {
  it("hoists the header fields to bare lines and drops the comment block", () => {
    const out = azureMarkerTransform(`${HEADER}\n# Title\nbody`);
    expect(out).toBe(
      ["artifact_type: plan", "doc_id: dv1:acme/widgets:1:plan:x", "issue_number: 1", "# Title", "body"].join("\n"),
    );
  });

  it("keeps the body after a single-line HTML comment", () => {
    const out = azureMarkerTransform(`${HEADER}\nintro\n<!-- note -->\nkept line one\nkept line two`);
    expect(out).toContain("intro");
    expect(out).toContain("kept line one");
    expect(out).toContain("kept line two");
    expect(out).not.toContain("<!-- note -->");
  });

  it("still drops a multi-line HTML comment and its contents", () => {
    const out = azureMarkerTransform(`${HEADER}\nintro\n<!--\nhidden\n-->\nafter`);
    expect(out).not.toContain("hidden");
    expect(out).toContain("after");
  });

  it("reads header fields from the first marker block only", () => {
    const quoted = ["<!-- DEVENV_ARTIFACT_V1", "source_file: quoted-example.md", "-->"].join("\n");
    const out = azureMarkerTransform(`${HEADER}\nbody\n${quoted}\nmore`);
    expect(out).not.toContain("source_file: quoted-example.md");
    expect(out.startsWith("artifact_type: plan\ndoc_id: dv1:acme/widgets:1:plan:x")).toBe(true);
  });

  it("does not hoist prose after a header whose close is not at the line start", () => {
    const loose = ["<!-- DEVENV_ARTIFACT_V1", "doc_id: dv1:acme/widgets:1:plan:x", "issue_number: 7 -->"].join("\n");
    const out = azureMarkerTransform(`${loose}\nsource_file: prose.md\nrest`);
    expect(out).toContain("source_file: prose.md");
    expect(out.split("\n").slice(0, 2)).toEqual(["doc_id: dv1:acme/widgets:1:plan:x", "issue_number: 7"]);
  });

  it("passes a body whose doc_id already survives through unchanged", () => {
    const body = "doc_id: dv1:acme/widgets:1:plan:x\nbody";
    expect(azureMarkerTransform(body)).toBe(body);
  });
});
