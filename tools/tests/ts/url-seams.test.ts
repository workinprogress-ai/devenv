// url-seams.test.ts — TS-twin coverage for the provider URL seams that the
// retired bash suites (provider-remote-seams, the urls half of
// provider-ceiling-hooks-urls) used to pin over the bash twins: spec
// extraction from every remote form both providers accept, and PR web URL
// shapes. The bash twins deleted with the layer; these assertions target
// the TS twins directly.
import { describe, expect, it } from "vitest";
import { remoteToSpec, prWebUrl } from "../../lib/providers/github/urls.ts";
import { remoteToSpec as azRemoteToSpec, prWebUrl as azPrWebUrl } from "../../lib/providers/azure/urls.ts";

describe("github url seams (TS twin)", () => {
  it("remoteToSpec: https, ssh, and token-embedded remotes → owner/repo", () => {
    expect(remoteToSpec("https://github.com/acme/widgets.git")).toBe("acme/widgets");
    expect(remoteToSpec("git@github.com:acme/widgets.git")).toBe("acme/widgets");
    expect(remoteToSpec("https://token@github.com/acme/widgets.git")).toBe("acme/widgets");
  });

  it("remoteToSpec: non-remote forms are null (never a guess)", () => {
    expect(remoteToSpec("/mnt/local/path/not-a-remote")).toBeNull();
    expect(remoteToSpec("https://example.com/acme/widgets.git")).toBeNull();
  });

  it("prWebUrl: the PR page under the spec's owner/repo", () => {
    expect(prWebUrl("acme/widgets", 42)).toBe("https://github.com/acme/widgets/pull/42");
  });
});

describe("azure url seams (TS twin)", () => {
  it("remoteToSpec: https and ssh dev.azure.com remotes → project/repo", () => {
    expect(azRemoteToSpec("https://dev.azure.com/org/proj/_git/widgets")).toBe("proj/widgets");
    expect(azRemoteToSpec("git@ssh.dev.azure.com:v3/org/proj/widgets")).toBe("proj/widgets");
  });

  it("remoteToSpec: non-remote forms are null", () => {
    expect(azRemoteToSpec("/mnt/local/path/not-a-remote")).toBeNull();
  });

  it("prWebUrl: the work-item-shaped PR page", () => {
    expect(azPrWebUrl("org/proj/widgets", 12)).toContain("dev.azure.com");
    expect(azPrWebUrl("org/proj/widgets", 12)).toContain("pullrequest");
  });
});
