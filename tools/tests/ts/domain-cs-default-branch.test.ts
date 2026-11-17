// repoDefaultBranch reads the facade's Repository record (defaultBranchRef {name}).

import { beforeEach, describe, expect, it, vi } from "vitest";

const reposView = vi.fn<(spec: string | undefined, opts?: { json?: string }) => Promise<string>>();
vi.mock("../../lib/providers/facade/repos.ts", () => ({ reposView }));

const { repoDefaultBranch } = await import("../../lib/domain/cs/default-branch.ts");

beforeEach(() => {
  reposView.mockReset();
});

describe("repoDefaultBranch", () => {
  it("asks the facade for defaultBranchRef and returns its name", async () => {
    reposView.mockResolvedValue(JSON.stringify({ defaultBranchRef: { name: "main" } }));
    await expect(repoDefaultBranch("org/repo")).resolves.toBe("main");
    expect(reposView).toHaveBeenCalledWith("org/repo", { json: "defaultBranchRef" });
  });

  it("strips a refs/heads/ prefix", async () => {
    reposView.mockResolvedValue(JSON.stringify({ defaultBranchRef: { name: "refs/heads/trunk" } }));
    await expect(repoDefaultBranch("org/repo")).resolves.toBe("trunk");
  });

  it("throws instead of guessing when there is no default branch", async () => {
    reposView.mockResolvedValue(JSON.stringify({ defaultBranchRef: null }));
    await expect(repoDefaultBranch("org/empty")).rejects.toThrow(/no default branch/);
  });

  it("propagates a provider failure", async () => {
    reposView.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(repoDefaultBranch("org/repo")).rejects.toThrow("boom");
  });
});
