// cs-repo-filter.test.ts — global dependency-update waves select repositories
// by glob: include globs pick the wave, exclude globs carve repositories out.
import { describe, expect, it } from "vitest";
import { repoFilter } from "../../lib/domain/cs/repo-filter.ts";

describe("repoFilter", () => {
  it("no globs selects everything", () => {
    const keep = repoFilter([], []);
    expect(keep("lib.cs.utility.util")).toBe(true);
    expect(keep("monorepo.services-backend")).toBe(true);
  });

  it("an include glob selects only matching repositories", () => {
    const keep = repoFilter(["lib.cs.*"], []);
    expect(keep("lib.cs.utility.util")).toBe(true);
    expect(keep("service.policy.core")).toBe(false);
  });

  it("several include globs select their union", () => {
    const keep = repoFilter(["service.*", "template.service"], []);
    expect(keep("service.policy.core")).toBe(true);
    expect(keep("template.service")).toBe(true);
    expect(keep("lib.cs.utility.util")).toBe(false);
  });

  it("an exclude glob wins over an include", () => {
    const keep = repoFilter(["*"], ["monorepo.*", "devops.tools"]);
    expect(keep("monorepo.services-backend")).toBe(false);
    expect(keep("devops.tools")).toBe(false);
    expect(keep("service.policy.core")).toBe(true);
  });

  it("dots are literal and globs are anchored", () => {
    const keep = repoFilter(["lib.cs.*"], []);
    expect(keep("libXcsYutil")).toBe(false);
    expect(keep("my-lib.cs.util")).toBe(false);
  });

  it("? matches exactly one character", () => {
    const keep = repoFilter(["service.v?"], []);
    expect(keep("service.v1")).toBe(true);
    expect(keep("service.v10")).toBe(false);
  });
});
