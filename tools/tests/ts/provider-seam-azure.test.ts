import { describe, expect, it } from "vitest";
import { azureNpmrcLines, gitAuthHeader, isAzureArtifactsUrl, npmrcFeedPrefixes } from "../../ts/setup-steps/provider-seam.ts";

describe("gitAuthHeader", () => {
  it("github: basic auth with the x-access-token user", () => {
    expect(gitAuthHeader("github", "tok")).toBe(`AUTHORIZATION: basic ${Buffer.from("x-access-token:tok").toString("base64")}`);
  });

  it("azure: basic auth with an empty user and the PAT as the password", () => {
    expect(gitAuthHeader("azure", "pat")).toBe(`AUTHORIZATION: Basic ${Buffer.from(":pat").toString("base64")}`);
  });

  it("an unknown provider still throws", () => {
    expect(() => gitAuthHeader("gitlab", "t")).toThrow(/no scheme implemented/);
  });
});

describe("Azure Artifacts feed helpers", () => {
  it("recognises only Azure Artifacts hosts over https", () => {
    expect(isAzureArtifactsUrl("https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/")).toBe(true);
    expect(isAzureArtifactsUrl("https://o.pkgs.visualstudio.com/_packaging/f/nuget/v3/index.json")).toBe(true);
    expect(isAzureArtifactsUrl("http://pkgs.dev.azure.com/o")).toBe(false);
    expect(isAzureArtifactsUrl("https://pkgs.dev.azure.com.evil.example/o")).toBe(false);
    expect(isAzureArtifactsUrl("https://nuget.pkg.github.com/o/index.json")).toBe(false);
    expect(isAzureArtifactsUrl("")).toBe(false);
  });

  it("a /npm/registry/ feed yields both prefixes; other feeds yield one", () => {
    expect(npmrcFeedPrefixes("https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/")).toEqual([
      "pkgs.dev.azure.com/o/_packaging/f/npm/registry",
      "pkgs.dev.azure.com/o/_packaging/f/npm",
    ]);
    expect(npmrcFeedPrefixes("https://pkgs.dev.azure.com/o/_packaging/f/npm/")).toEqual(["pkgs.dev.azure.com/o/_packaging/f/npm"]);
  });

  it("azureNpmrcLines replaces stale entries for the same prefixes and scope, keeping everything else", () => {
    const prefixes = ["h/p/npm/registry", "h/p/npm"];
    const existing = [
      "registry=https://x/",
      "//h/p/npm/registry/:_password=OLD",
      "@acme:registry=https://old/",
      "@other:registry=https://other/",
    ];
    const out = azureNpmrcLines(existing, prefixes, "NEW", "@acme");
    expect(out).not.toContain("//h/p/npm/registry/:_password=OLD");
    expect(out).toContain("registry=https://x/");
    expect(out).toContain("@other:registry=https://other/");
    expect(out.filter((l) => l.startsWith("@acme:registry="))).toEqual(["@acme:registry=https://h/p/npm/registry/"]);
    expect(out.filter((l) => l.endsWith(":_password=NEW"))).toHaveLength(2);
  });

  it("azureNpmrcLines without a scope leaves scope mappings alone", () => {
    const out = azureNpmrcLines(["@acme:registry=https://old/"], ["h/p"], "B", "");
    expect(out).toContain("@acme:registry=https://old/");
    expect(out.some((l) => l.startsWith("@") && l !== "@acme:registry=https://old/")).toBe(false);
  });
});
