// Facade loader unit tests: manifest dispatch, caching, and the same-family
// module boundary (a family's facade can reach only its manifest modules).
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loaderUrl = new URL("../../lib/providers/facade/provider-loader.ts", import.meta.url).href;

// DEVENV_ROOT points provider detection at a temp config: provider: github.
// providerDetect caches per process, so the temp root must be set before
// the first load call in the process — these tests run their own subprocess
// when needed; here the repo's own config is github by default.
function withTempRoot(configBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), "facade-loader-"));
  writeFileSync(join(dir, "devenv.config"), configBody);
  return dir;
}

describe("provider-loader", () => {
  it("familyManifestModules unions per-provider module lists", async () => {
    const mod = await import(loaderUrl);
    expect(mod.familyManifestModules("issues")).toEqual(
      expect.arrayContaining(["issues.ts", "urls.ts"]),
    );
    expect(mod.familyManifestModules("nope")).toEqual([]);
  });

  it("rejects a module outside the family manifest with a named error", async () => {
    const mod = await import(loaderUrl);
    const root = withTempRoot('[provider]\nname=github\n');
    process.env.DEVENV_ROOT = root;
    try {
      const loaded = await mod.loadProviderModules("issues");
      expect(loaded.provider).toBe("github");
      expect(() => loaded.get("prs.ts")).toThrow(/no module 'prs\.ts'/);
      // The manifest module resolves.
      const issues = loaded.get("issues.ts");
      expect(typeof (issues as Record<string, unknown>).issuesList).toBe("function");
    } finally {
      delete process.env.DEVENV_ROOT;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unmanifested family with a named error", async () => {
    const mod = await import(loaderUrl);
    const root = withTempRoot('[provider]\nname=github\n');
    process.env.DEVENV_ROOT = root;
    try {
      await expect(mod.loadProviderModules("nope")).rejects.toThrow(/no module manifest for family 'nope'/);
    } finally {
      delete process.env.DEVENV_ROOT;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
