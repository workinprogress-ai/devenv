// Org ownership of a git remote is each provider's call: GitHub owns by
// account, Azure by organization AND project. Unparseable remotes are foreign.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteIsOrgOwned as ghOwned } from "../../lib/providers/github/urls.ts";
import { remoteIsOrgOwned as azOwned } from "../../lib/providers/azure/urls.ts";

describe("github remoteIsOrgOwned", () => {
  it.each([
    "https://github.com/acme/widgets.git",
    "git@github.com:acme/widgets.git",
    "https://token@github.com/acme/widgets.git",
  ])("owned: %s", (url) => expect(ghOwned(url, "acme")).toBe(true));

  it.each([
    ["https://github.com/other/widgets.git", "acme"],
    ["/mnt/local/path/not-a-remote", "acme"],
    ["https://github.com/acme/widgets.git", ""],
  ])("foreign: %s (org '%s')", (url, org) => expect(ghOwned(url, org)).toBe(false));
});

describe("azure remoteIsOrgOwned", () => {
  beforeEach(() => vi.stubEnv("AZURE_DEVOPS_PROJECT", "Apps_Services"));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "https://dev.azure.com/OMS-FORT/Apps_Services/_git/test-repo",
    "https://OMS-FORT@dev.azure.com/OMS-FORT/Apps_Services/_git/test-repo",
    "git@ssh.dev.azure.com:v3/OMS-FORT/Apps_Services/test-repo",
    "https://dev.azure.com/oms-fort/apps_services/_git/test-repo",
  ])("owned: %s", (url) => expect(azOwned(url, "OMS-FORT")).toBe(true));

  it.each([
    "https://dev.azure.com/OMS-FORT/OtherProject/_git/test-repo",
    "https://dev.azure.com/OTHER/Apps_Services/_git/test-repo",
    "https://github.com/OMS-FORT/test-repo.git",
    "/mnt/local/path/not-a-remote",
  ])("foreign: %s", (url) => expect(azOwned(url, "OMS-FORT")).toBe(false));

  it("an unconfigured project reads as foreign", () => {
    vi.stubEnv("AZURE_DEVOPS_PROJECT", "");
    expect(azOwned("https://dev.azure.com/OMS-FORT/Apps_Services/_git/test-repo", "OMS-FORT")).toBe(false);
  });
});
