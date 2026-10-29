// 15.12: repo-get's isOrgMember mis-flagged every org repo as foreign
// because raw origin URLs (HTTPS/SSH/credentials forms) went into
// providerRepoSplit, which splits on the first "/". The fix normalizes
// through remoteToSpec first — these tests pin the URL forms the fix
// relies on: the first two rewrite as org members, the garbage form
// stays foreign.
import { describe, it, expect } from "vitest";
import { remoteToSpec } from "../../lib/providers/github/urls.ts";

describe("repo-get origin normalization (15.12)", () => {
  it("HTTPS with .git normalizes to owner/repo", () => {
    expect(remoteToSpec("https://github.com/acme/widgets.git")).toBe("acme/widgets");
  });

  it("SSH form normalizes to owner/repo", () => {
    expect(remoteToSpec("git@github.com:acme/widgets.git")).toBe("acme/widgets");
  });

  it("HTTPS with embedded credentials normalizes to owner/repo", () => {
    expect(remoteToSpec("https://token@github.com/acme/widgets.git")).toBe("acme/widgets");
  });

  it("a genuinely unparseable URL yields null (stays foreign, safety-first)", () => {
    expect(remoteToSpec("/mnt/local/path/not-a-remote")).toBeNull();
  });

  it("the normalized owner survives providerRepoSplit (the isOrgMember chain)", async () => {
    const { providerRepoSplit } = await import("../../lib/providers/provider-core.ts");
    const spec = remoteToSpec("https://github.com/acme/widgets.git") ?? "";
    expect(providerRepoSplit(spec).owner).toBe("acme");
  });
});
