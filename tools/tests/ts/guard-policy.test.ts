// guard policy data: the committed tools/guard/policy.json must satisfy the
// schema, and the validator must reject each way the data can be wrong. The
// conformance fixture format is validated here too, since every later guard
// suite is written in it.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const GUARD_DIR = join(import.meta.dirname, "..", "..", "guard");
const schema = require(join(GUARD_DIR, "policy-schema.cjs")) as {
  validatePolicy: (p: unknown) => string[];
  validateFixture: (f: unknown) => string[];
  validateFixtureSet: (list: unknown) => string[];
  loadPolicy: (path?: string) => unknown;
  EXPECTATIONS: readonly string[];
  RULES: readonly string[];
  CWD_KINDS: readonly string[];
};

type Policy = {
  schema: number;
  provider: {
    clis: Array<{ name: string; subcommands?: string[] }>;
    apiHosts: Array<{ host: string; pathPrefix?: string }>;
    denyText: string;
  };
  git: {
    globalOptionsWithValue: string[];
    readOnly: Array<{ subcommand: string; requireAnyOf?: string[]; requireFirstArg?: string }>;
    denyText: string;
  };
  parse: { onProblem: string; problemDenyText: string; onDynamicProgram: string; dynamicDenyText: string };
  scope: { workspaceRoot: string; outsideWorkspace: string; unresolvableTarget: string; insideSubpaths: string[] };
  heredoc: { mode: string; interpreters: string[]; dataConsumers: string[] };
};

function committed(): Policy {
  return JSON.parse(readFileSync(join(GUARD_DIR, "policy.json"), "utf8"));
}

/** Mutate a deep copy of the committed policy and return the validator's errors. */
function errorsAfter(mutate: (p: Policy) => void): string[] {
  const p = committed();
  mutate(p);
  return schema.validatePolicy(p);
}

describe("guard/policy.json", () => {
  it("satisfies the schema", () => {
    expect(schema.validatePolicy(committed())).toEqual([]);
  });

  it("loads through loadPolicy", () => {
    expect(schema.validatePolicy(schema.loadPolicy())).toEqual([]);
  });

  it("encodes the frozen provider union", () => {
    const names = committed().provider.clis.map((c) => c.name);
    expect(names).toEqual(["gh", "glab", "az", "tea", "bb"]);
    const az = committed().provider.clis.find((c) => c.name === "az");
    expect(az?.subcommands).toEqual(["devops", "repos", "boards"]);
  });

  it("encodes the frozen read-only git allowlist, with read-only forms of the mutating subcommands", () => {
    const subs = committed().git.readOnly.map((r) => r.subcommand);
    expect(subs).toEqual(["status", "log", "diff", "show", "rev-parse", "merge-base", "blame", "ls-files", "config", "worktree", "clean", "apply"]);
    for (const mutating of ["commit", "add", "push", "reset", "checkout", "rebase", "merge", "stash", "tag", "branch"]) {
      expect(subs, mutating).not.toContain(mutating);
    }
  });

  it("encodes the frozen scope rulings", () => {
    expect(committed().scope).toEqual({
      workspaceRoot: "derived",
      outsideWorkspace: "allow",
      unresolvableTarget: "inside",
      insideSubpaths: ["tmp"],
    });
  });

  it("denies what it cannot parse and allows, while observing, a program it cannot resolve", () => {
    expect(committed().parse.onProblem).toBe("deny");
    expect(committed().parse.onDynamicProgram).toBe("allow");
    expect(committed().parse.problemDenyText).toMatch(/simplify|split/i);
    expect(committed().parse.dynamicDenyText).toMatch(/program name/i);
  });

  it("starts the heredoc rule in observe mode", () => {
    expect(committed().heredoc.mode).toBe("observe");
  });

  it("has provider-neutral deny text", () => {
    const text: string = committed().provider.denyText;
    for (const c of committed().provider.clis) expect(text, c.name).not.toMatch(new RegExp(`\\b${c.name}\\b`, "i"));
    expect(text).toMatch(/wrapper/i);
  });

  describe("rejects bad data", () => {
    const cases: Array<[string, (p: Policy) => void, RegExp]> = [
      ["wrong schema version", (p) => (p.schema = 2), /schema/],
      ["missing provider section", (p) => delete (p as Partial<Policy>).provider, /provider/],
      ["empty provider CLI list", (p) => (p.provider.clis = []), /provider\.clis/],
      ["a CLI name with a space", (p) => (p.provider.clis[0]!.name = "g h"), /name/],
      ["duplicate CLI names", (p) => p.provider.clis.push({ name: "gh" }), /duplicate/],
      ["an empty subcommand list", (p) => (p.provider.clis[2]!.subcommands = []), /subcommands/],
      ["an API host with a scheme", (p) => (p.provider.apiHosts[0] = { host: "https://api.example.com" }), /host/],
      ["an API path prefix without a leading slash", (p) => (p.provider.apiHosts[1] = { host: "gitlab.com", pathPrefix: "api" }), /pathPrefix/],
      ["blank provider deny text", (p) => (p.provider.denyText = "  "), /denyText/],
      ["provider deny text that names a CLI", (p) => (p.provider.denyText = "Do not run gh here; use a wrapper."), /neutral/],
      ["provider deny text that names an API host", (p) => (p.provider.denyText = "Do not call api.github.com; use a wrapper."), /neutral/],
      ["a git option that is not a flag", (p) => (p.git.globalOptionsWithValue[0] = "C"), /globalOptionsWithValue/],
      ["an empty read-only list", (p) => (p.git.readOnly = []), /readOnly/],
      ["duplicate read-only subcommands", (p) => p.git.readOnly.push({ subcommand: "status" }), /duplicate/],
      ["a requireAnyOf entry that is not a flag", (p) => (p.git.readOnly[8]!.requireAnyOf = ["get"]), /requireAnyOf/],
      ["an empty requireFirstArg", (p) => (p.git.readOnly[9]!.requireFirstArg = ""), /requireFirstArg/],
      ["blank git deny text", (p) => (p.git.denyText = ""), /git\.denyText/],
      ["a missing parse section", (p) => delete (p as Partial<Policy>).parse, /parse/],
      ["an unknown parse stance for problems", (p) => (p.parse.onProblem = "ignore"), /parse\.onProblem/],
      ["an unknown parse stance for dynamic programs", (p) => (p.parse.onDynamicProgram = "log"), /parse\.onDynamicProgram/],
      ["blank parse deny texts", (p) => ((p.parse.problemDenyText = ""), (p.parse.dynamicDenyText = " ")), /parse\.problemDenyText/],
      ["a hardcoded workspace root", (p) => (p.scope.workspaceRoot = "/workspaces/devenv"), /workspaceRoot/],
      ["an unknown outside-workspace value", (p) => (p.scope.outsideWorkspace = "maybe"), /outsideWorkspace/],
      ["an unknown unresolvable-target value", (p) => (p.scope.unresolvableTarget = "ignore"), /unresolvableTarget/],
      ["an absolute inside subpath", (p) => (p.scope.insideSubpaths = ["/tmp"]), /insideSubpaths/],
      ["an inside subpath that climbs out", (p) => (p.scope.insideSubpaths = ["../x"]), /insideSubpaths/],
      ["an unknown heredoc mode", (p) => (p.heredoc.mode = "log"), /heredoc\.mode/],
      ["an empty interpreter list", (p) => (p.heredoc.interpreters = []), /interpreters/],
      ["a program that is both interpreter and data consumer", (p) => p.heredoc.dataConsumers.push("python3"), /both/],
    ];
    for (const [name, mutate, re] of cases) {
      it(name, () => {
        const errors = errorsAfter(mutate);
        expect(errors.length, name).toBeGreaterThan(0);
        expect(errors.join("\n"), name).toMatch(re);
      });
    }

    it("reports a non-object policy", () => {
      for (const bad of [null, [], "x", 3]) expect(schema.validatePolicy(bad).length).toBeGreaterThan(0);
    });

    it("reports every problem, not just the first", () => {
      const errors = errorsAfter((p) => {
        p.schema = 9;
        p.heredoc.mode = "log";
        p.git.denyText = "";
      });
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("guard conformance fixture format", () => {
  const good = { id: "provider-gh-pr-list", command: "gh pr list", expect: "deny", rule: "provider" };

  it("exposes the allowed values", () => {
    expect([...schema.EXPECTATIONS]).toEqual(["allow", "deny"]);
    expect([...schema.RULES]).toEqual(["provider", "git", "heredoc", "parse"]);
    expect([...schema.CWD_KINDS]).toEqual(["workspace", "outside", "unresolvable"]);
  });

  it("accepts a minimal fixture and a fully specified one", () => {
    expect(schema.validateFixture(good)).toEqual([]);
    expect(
      schema.validateFixture({ ...good, cwd: "outside", tags: ["adversarial", "replay"], note: "why this case exists" }),
    ).toEqual([]);
    expect(schema.validateFixture({ id: "plain-ls", command: "ls -la", expect: "allow" })).toEqual([]);
  });

  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    ["a missing id", { command: "ls", expect: "allow" }, /id/],
    ["an id with spaces or capitals", { ...good, id: "Not Kebab" }, /id/],
    ["a missing command", { id: "x", expect: "allow" }, /command/],
    ["an empty command", { ...good, command: "" }, /command/],
    ["a missing expectation", { id: "x", command: "ls" }, /expect/],
    ["an unknown expectation", { ...good, expect: "maybe" }, /expect/],
    ["an unknown rule", { ...good, rule: "network" }, /rule/],
    ["an unknown cwd kind", { ...good, cwd: "nowhere" }, /cwd/],
    ["tags that are not strings", { ...good, tags: [1] }, /tags/],
    ["an unknown field", { ...good, extra: true }, /unknown field/],
    ["a deny fixture with no rule", { id: "x", command: "gh pr list", expect: "deny" }, /rule/],
  ];
  for (const [name, fixture, re] of bad) {
    it(`rejects ${name}`, () => {
      const errors = schema.validateFixture(fixture);
      expect(errors.length, name).toBeGreaterThan(0);
      expect(errors.join("\n"), name).toMatch(re);
    });
  }

  it("rejects a non-object fixture", () => {
    for (const x of [null, [], "x", 1]) expect(schema.validateFixture(x).length).toBeGreaterThan(0);
  });

  describe("validateFixtureSet", () => {
    it("accepts a list of valid, uniquely identified fixtures", () => {
      expect(schema.validateFixtureSet([good, { id: "plain-ls", command: "ls", expect: "allow" }])).toEqual([]);
    });

    it("rejects duplicate ids and names the index of each bad entry", () => {
      const errors = schema.validateFixtureSet([good, good, { id: "x", command: "", expect: "allow" }]);
      expect(errors.join("\n")).toMatch(/duplicate id/);
      expect(errors.join("\n")).toMatch(/\[2\]/);
    });

    it("rejects a non-array", () => {
      expect(schema.validateFixtureSet({}).length).toBeGreaterThan(0);
    });
  });
});
