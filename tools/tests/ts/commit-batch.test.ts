// Unit tests for the commit-batch domain layer: strict parse and every
// validator refusal row (pure functions, fixture text — no I/O).
import { describe, expect, it } from "vitest";
import {
  batchClaimedPaths,
  isLiteralFilePath,
  parseCommitBatch,
  validateCommitBatch,
} from "../../lib/domain/commit-batch.ts";

type ParseResult = ReturnType<typeof parseCommitBatch>;

function ok(text: string): ParseResult {
  return parseCommitBatch(text);
}

function errs(r: ParseResult): string[] {
  if ("errors" in r) return r.errors.map((e) => e.message);
  return [];
}

const VALID = `# Commit batch: test batch

## group 1 — feat: first
- a.txt
- src/b.ts

## group 2 — fix: second
- c.md

## excluded
- tmp/draft.md
`;

const FULL: { changedPaths: string[]; stagedPaths: string[]; exists: Set<string> } = {
  changedPaths: ["a.txt", "src/b.ts", "c.md", "tmp/draft.md"],
  stagedPaths: [],
  exists: new Set(["a.txt", "src/b.ts", "c.md", "tmp/draft.md"]),
};

describe("parseCommitBatch (strict)", () => {
  it("parses a valid manifest: title, groups, excluded", () => {
    const r = ok(VALID);
    expect("batch" in r).toBe(true);
    if (!("batch" in r)) throw new Error("unreachable");
    expect(r.batch.title).toBe("test batch");
    expect(r.batch.groups).toHaveLength(2);
    expect(r.batch.groups[0]?.subject).toBe("feat: first");
    expect(r.batch.groups[1]?.files).toEqual(["c.md"]);
    expect(r.batch.excluded).toEqual(["tmp/draft.md"]);
  });

  it("accepts comments and blank lines anywhere", () => {
    const r = ok(`# Commit batch: t
<!-- repo-stage batch manifest — ephemeral, never committed -->

## group 1 — s
- a.txt
<!-- mid-section comment -->
`);
    expect("errors" in r).toBe(false);
  });

  it("refuses a missing/ malformed title line", () => {
    const r = ok(`## group 1 — s\n- a.txt\n`);
    expect(errs(r).join("\n")).toContain("expected '# Commit batch:");
  });

  it("refuses non-sequential group numbers", () => {
    const r = ok(`# Commit batch: t\n\n## group 2 — s\n- a.txt\n`);
    expect(errs(r).join("\n")).toContain("sequential");
  });

  it("refuses unknown headings and unrecognized lines", () => {
    const r = ok(`# Commit batch: t\n\n## group 1 — s\n- a.txt\n### weird\nplain text\n`);
    const joined = errs(r).join("\n");
    expect(joined).toContain("unknown heading");
    expect(joined).toContain("unrecognized line");
  });

  it("refuses entries before any group and a group after excluded", () => {
    const r = ok(`# Commit batch: t\n\n- orphan.txt\n\n## group 1 — s\n- a.txt\n\n## excluded\n- e.txt\n\n## group 2 — late\n- b.txt\n`);
    const joined = errs(r).join("\n");
    expect(joined).toContain("before any group");
    expect(joined).toContain("after '## excluded'");
  });

  it("refuses duplicate excluded and a manifest with no groups", () => {
    const dup = ok(`# Commit batch: t\n\n## group 1 — s\n- a.txt\n\n## excluded\n- e.txt\n## excluded\n- f.txt\n`);
    expect(errs(dup).join("\n")).toContain("duplicate '## excluded'");
    const none = ok(`# Commit batch: t\n\n<!-- nothing -->\n`);
    expect(errs(none).join("\n")).toContain("no groups");
  });
});

describe("isLiteralFilePath", () => {
  it("accepts plain repo-root-relative file literals", () => {
    expect(isLiteralFilePath("a.txt")).toBe(true);
    expect(isLiteralFilePath("src/deep/nested/file.ts")).toBe(true);
    expect(isLiteralFilePath("weird name with spaces.ts")).toBe(true);
  });

  it("refuses globs, absolute, dot, traversal, empty, padded", () => {
    expect(isLiteralFilePath("*.ts")).toBe(false);
    expect(isLiteralFilePath("src/**/*.ts")).toBe(false);
    expect(isLiteralFilePath("/abs/path.txt")).toBe(false);
    expect(isLiteralFilePath("./rel.txt")).toBe(false);
    expect(isLiteralFilePath("../escape.txt")).toBe(false);
    expect(isLiteralFilePath("a/../b.txt")).toBe(false);
    expect(isLiteralFilePath("")).toBe(false);
    expect(isLiteralFilePath(" padded.txt ")).toBe(false);
    expect(isLiteralFilePath("flag?.txt")).toBe(false);
  });
});

describe("validateCommitBatch (every refusal row)", () => {
  it("a complete, consistent batch validates clean", () => {
    const parsed = ok(VALID);
    if (!("batch" in parsed)) throw new Error("parse failed");
    expect(validateCommitBatch(parsed.batch, FULL)).toEqual([]);
  });

  it("non-literal entries refuse in groups and excluded", () => {
    const parsed = ok(`# Commit batch: t\n\n## group 1 — s\n- *.ts\n\n## excluded\n- ../x\n`);
    if (!("batch" in parsed)) throw new Error("parse failed");
    const joined = validateCommitBatch(parsed.batch, { changedPaths: [], stagedPaths: [], exists: new Set() }).map((e) => e.message).join("\n");
    expect(joined).toContain("'*.ts' is not a literal");
    expect(joined).toContain("'../x' is not a literal");
  });

  it("duplicate membership names both sections", () => {
    const parsed = ok(`# Commit batch: t\n\n## group 1 — s\n- a.txt\n\n## group 2 — s2\n- a.txt\n`);
    if (!("batch" in parsed)) throw new Error("parse failed");
    const joined = validateCommitBatch(parsed.batch, FULL).map((e) => e.message).join("\n");
    expect(joined).toContain("'a.txt' appears in both group 1 and group 2");
  });

  it("existence is deletion-aware: a changed deleted file passes, a typo refuses", () => {
    const parsed = ok(`# Commit batch: t\n\n## group 1 — s\n- gone.txt\n- typo.txt\n`);
    if (!("batch" in parsed)) throw new Error("parse failed");
    const joined = validateCommitBatch(parsed.batch, {
      changedPaths: ["gone.txt"], // deleted from disk but changed — stageable
      stagedPaths: [],
      exists: new Set(), // nothing on disk
    }).map((e) => e.message).join("\n");
    expect(joined).toContain("'typo.txt' exists neither on disk nor");
    expect(joined).not.toContain("'gone.txt'");
  });

  it("coverage refuses orphans: a changed file claimed by nothing", () => {
    const parsed = ok(VALID);
    if (!("batch" in parsed)) throw new Error("parse failed");
    const joined = validateCommitBatch(parsed.batch, {
      ...FULL,
      changedPaths: [...FULL.changedPaths, "unclaimed.txt"],
    }).map((e) => e.message).join("\n");
    expect(joined).toContain("coverage: 'unclaimed.txt' is changed but claimed by no group");
  });

  it("index purity refuses staged-but-unmanifested content", () => {
    const parsed = ok(VALID);
    if (!("batch" in parsed)) throw new Error("parse failed");
    const joined = validateCommitBatch(parsed.batch, {
      ...FULL,
      stagedPaths: ["stray.txt"],
    }).map((e) => e.message).join("\n");
    expect(joined).toContain("'stray.txt' is staged but not in the batch");
  });

  it("staged-and-manifested content passes (stage-several-then-commit ordering)", () => {
    const parsed = ok(VALID);
    if (!("batch" in parsed)) throw new Error("parse failed");
    expect(validateCommitBatch(parsed.batch, { ...FULL, stagedPaths: ["a.txt", "src/b.ts"] })).toEqual([]);
  });
});

describe("batchClaimedPaths", () => {
  it("unions group files and excluded in order", () => {
    const parsed = ok(VALID);
    if (!("batch" in parsed)) throw new Error("parse failed");
    expect(batchClaimedPaths(parsed.batch)).toEqual(["a.txt", "src/b.ts", "c.md", "tmp/draft.md"]);
  });
});

// ---------------------------------------------------------------------------
// batch-draft expansion + readiness (3.1/3.2)
// ---------------------------------------------------------------------------
import { draftFromClaims, groupReadiness, renderDraft, type TaskClaim } from "../../lib/domain/commit-batch.ts";

function claim(id: string, files: string[], extra: Partial<TaskClaim> = {}): TaskClaim {
  return { id, done: false, title: `title ${id}`, files, ...extra };
}

describe("draftFromClaims (expansion)", () => {
  it("assigns each changed file to its single claiming task", () => {
    const d = draftFromClaims(["a.txt", "src/b.ts"], [claim("1.1", ["a.txt"]), claim("1.2", ["src/b.ts"])]);
    expect(d.groups).toHaveLength(2);
    expect(d.groups[0]?.files).toEqual(["a.txt"]);
    expect(d.groups[1]?.files).toEqual(["src/b.ts"]);
    expect(d.unassigned).toEqual([]);
    expect(d.conflicts).toEqual([]);
  });

  it("directory claims expand to every changed file beneath them", () => {
    const d = draftFromClaims(["src/a.ts", "src/sub/b.ts", "other.txt"], [claim("2.1", ["src/"])]);
    expect(d.groups[0]?.files).toEqual(["src/a.ts", "src/sub/b.ts"]);
    expect(d.unassigned.map((u) => u.path)).toEqual(["other.txt"]);
  });

  it("a file claimed by two tasks parks in conflicts with both named", () => {
    const d = draftFromClaims(["shared.ts"], [claim("1.1", ["shared.ts"]), claim("2.2", ["shared.ts"])]);
    expect(d.conflicts).toEqual([{ path: "shared.ts", tasks: ["1.1", "2.2"] }]);
    expect(d.groups).toHaveLength(0);
  });

  it("unclaimed files park in unassigned, never silently excluded", () => {
    const d = draftFromClaims(["x.ts", "y.ts"], [claim("1.1", ["x.ts"])]);
    expect(d.unassigned.map((u) => u.path)).toEqual(["y.ts"]);
  });

  it("subjects prefill from commitSubject when present, else the title", () => {
    const d = draftFromClaims(["a.txt", "b.txt"], [
      claim("1.1", ["a.txt"], { commitSubject: "feat: declared unit" }),
      claim("1.2", ["b.txt"]),
    ]);
    expect(d.groups[0]?.subject).toBe("1.1 — feat: declared unit");
    expect(d.groups[1]?.subject).toBe("1.2 — title 1.2");
  });

  it("empty changed set yields an empty draft (groups 0)", () => {
    const d = draftFromClaims([], [claim("1.1", ["a.txt"])]);
    expect(d.groups).toEqual([]);
    expect(d.unassigned).toEqual([]);
  });
});

describe("groupReadiness (holds)", () => {
  it("no overlapping open task = ready", () => {
    const r = groupReadiness(["a.txt"], [claim("9.9", ["zzz.txt"])]);
    expect(r).toEqual({ ready: true });
  });

  it("an overlapping OPEN task holds, naming the task", () => {
    const r = groupReadiness(["src/a.ts"], [claim("3.1", ["src/"])]);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.blockers[0]?.task).toBe("3.1");
  });

  it("a DONE overlapping task does not hold (done tasks no longer hold)", () => {
    const r = groupReadiness(["src/a.ts"], [claim("3.1", ["src/"], { done: true })]);
    expect(r).toEqual({ ready: true });
  });

  it("readiness flows through draftFromClaims per group", () => {
    // Reachable hold scenario: group 1.2's file is claimed by done 1.2
    // ONLY — but open 3.3 claims a DIFFERENT file in the same tree, so no
    // conflict parking fires. 1.2's group stays ready; a hold would only
    // appear if an open claim overlapped 1.2's files — which (exact-prefix
    // matching) always co-claims and therefore parks in conflicts first.
    // The readiness annotation on groups thus reads "ready" whenever the
    // group survived conflict parking; holds surface via the conflicts
    // bucket instead.
    const d = draftFromClaims(["src/free.txt", "src/inflight.txt", "other.txt"], [
      claim("1.2", ["src/free.txt"], { done: true }),
      claim("3.3", ["src/inflight.txt"]),
      claim("1.1", ["other.txt"], { done: true }),
    ]);
    expect(d.groups[0]?.readiness.ready).toBe(true); // done 1.2, no open overlap
    expect(d.groups[1]?.readiness.ready).toBe(false); // 3.3's own task is open: its group is held by itself
    expect(d.groups[2]?.readiness.ready).toBe(true); // done 1.1, no open overlap
    expect(d.conflicts).toEqual([]);
    // and the direct check: an open exact claim on a done group's file
    // parks as a conflict, it does not silently hold the group
    const d2 = draftFromClaims(["src/shared.txt"], [
      claim("1.2", ["src/shared.txt"], { done: true }),
      claim("3.3", ["src/shared.txt"]),
    ]);
    expect(d2.conflicts).toEqual([{ path: "src/shared.txt", tasks: ["1.2", "3.3"] }]);
    expect(d2.groups).toEqual([]);
  });
});

describe("renderDraft", () => {
  it("renders parseable manifest text for the happy path (round-trip)", () => {
    const d = draftFromClaims(["a.txt", "b.ts"], [claim("1.1", ["a.txt", "b.ts"], { done: true })]);
    const text = renderDraft(d, "round trip");
    const parsed = parseCommitBatch(text);
    expect("errors" in parsed).toBe(false);
    if ("batch" in parsed) {
      expect(parsed.batch.groups).toHaveLength(1);
      expect(parsed.batch.groups[0]?.files).toEqual(["a.txt", "b.ts"]);
    }
  });

  it("parking sections are comments, invisible to the parser", () => {
    const d = draftFromClaims(["x.txt"], []);
    const text = renderDraft(d, "parked");
    // unassigned x.txt renders as a comment — the parser sees one empty-
    // group... no: zero groups; parse refuses (needs >=1 group) — the tool
    // layer must say so. Here we assert the parking is comment-only.
    expect(text).toContain("<!-- unassigned: x.txt -->");
  });
});

describe("validateCommitBatch consumedGroups exemption", () => {
  // 15.23: a batch manifest re-validated across --group runs judges its own
  // committed groups against the live tree. A fully consumed group's paths
  // may have been renamed or deleted by LATER commits — the stale entries
  // must not fail validation (consumption evidence, not a typo).
  const MANIFEST = `# Commit batch: consumed-group sweep

## group 1 — already committed, later renamed away
- old/path/thing.txt

## group 2 — pending work
- live.txt

## excluded
- scratch.md
`;

  function opts(over: Partial<Parameters<typeof validateCommitBatch>[1]> = {}) {
    return {
      changedPaths: ["live.txt"],
      stagedPaths: [],
      exists: new Set(["live.txt", "scratch.md"]),
      ...over,
    };
  }

  const batch = (() => {
    const r = ok(MANIFEST);
    if ("errors" in r) throw new Error(`fixture must parse: ${errs(r).join("; ")}`);
    return r.batch;
  })();

  it("without the exemption, a renamed consumed path is a validation error (the 15.23 hit)", () => {
    const messages = validateCommitBatch(batch, opts()).map((e) => e.message);
    expect(messages.some((m) => m.includes("old/path/thing.txt"))).toBe(true);
  });

  it("consumedGroups exempts the group's files from existence validation", () => {
    const messages = validateCommitBatch(batch, opts({ consumedGroups: new Set([1]) })).map((e) => e.message);
    expect(messages.some((m) => m.includes("old/path/thing.txt"))).toBe(false);
    expect(messages).toEqual([]);
  });

  it("the exemption is per-group: a non-consumed group's missing path still errors", () => {
    const messages = validateCommitBatch(batch, opts({ consumedGroups: new Set([1]), changedPaths: [], exists: new Set(["scratch.md"]) })).map((e) => e.message);
    expect(messages.some((m) => m.startsWith("group 2:") && m.includes("live.txt"))).toBe(true);
  });
});

describe("parseCommitBatch hunk-selector entries", () => {
  it("parses '- path @ spec' into the group's hunkClaims", () => {
    const r = ok(`# Commit batch: t

## group 1 — feat: first
- src/b.ts @ 1-2,4
- whole.txt
`);
    expect("batch" in r).toBe(true);
    if (!("batch" in r)) throw new Error("unreachable");
    const g = r.batch.groups[0]!;
    expect(g.files).toEqual(["whole.txt"]);
    expect([...g.hunkClaims.entries()]).toEqual([["src/b.ts", [1, 2, 4]]]);
  });

  it("expands ranges and dedupes: '4,2,2-3' → [2,3,4]", () => {
    const r = ok(`# Commit batch: t

## group 1 — s
- f.ts @ 4,2,2-3
`);
    if (!("batch" in r)) throw new Error("unreachable");
    expect(r.batch.groups[0]!.hunkClaims.get("f.ts")).toEqual([2, 3, 4]);
  });

  it("two groups may claim different hunks of the SAME file", () => {
    const r = ok(`# Commit batch: t

## group 1 — feat: a
- shared.ts @ 1

## group 2 — fix: b
- shared.ts @ 2
`);
    if (!("batch" in r)) throw new Error("unreachable");
    expect(r.batch.groups[0]!.hunkClaims.get("shared.ts")).toEqual([1]);
    expect(r.batch.groups[1]!.hunkClaims.get("shared.ts")).toEqual([2]);
    expect(batchClaimedPaths(r.batch)).toContain("shared.ts");
  });

  it("refuses selectors in the excluded section", () => {
    const r = ok(`# Commit batch: t

## group 1 — s
- a.txt

## excluded
- b.ts @ 1
`);
    expect(errs(r).some((m) => m.includes("hunk selectors are not valid in '## excluded'"))).toBe(true);
  });

  it("refuses malformed specs with the line number: spaces, zero, reversed", () => {
    for (const bad of ["- f.ts @ 1, 2", "- f.ts @ 0", "- f.ts @ 5-2", "- f.ts @ 1;", "- f.ts @"]) {
      const r = ok(`# Commit batch: t

## group 1 — s
${bad}
`);
      expect(errs(r), bad).toContainEqual(
        expect.stringMatching(/malformed hunk selector on 'f\.ts'/),
      );
    }
  });
});

describe("validateCommitBatch hunk-grain validators", () => {
  const HUNK_MANIFEST = `# Commit batch: hunk batch

## group 1 — feat: first half
- shared.ts @ 1

## group 2 — fix: second half
- shared.ts @ 2
- solo.md
`;

  function validateCommitBatch_raw(b: Parameters<typeof validateCommitBatch>[0], o: Parameters<typeof validateCommitBatch>[1]): string[] {
    return validateCommitBatch(b, o).map((e) => e.message);
  }

  function hunkBatch() {
    const r = ok(HUNK_MANIFEST);
    if ("errors" in r) throw new Error(`fixture must parse: ${errs(r).join("; ")}`);
    return r.batch;
  }

  function facts(over: Partial<NonNullable<Parameters<typeof validateCommitBatch>[1]["hunkFacts"]>> = {}) {
    return {
      liveCounts: new Map([["shared.ts", 2]]),
      refusalClasses: new Map(),
      stagedPayloads: new Map(),
      payloadByNumber: new Map([["shared.ts", ["-a\n+A", "-b\n+B"]]]),
      ...over,
    };
  }

  it("a valid hunk batch passes every validator", () => {
    const messages = validateCommitBatch_raw(hunkBatch(), {
      changedPaths: ["shared.ts", "solo.md"],
      stagedPaths: [],
      exists: new Set(["shared.ts", "solo.md"]),
      hunkFacts: facts(),
    });
    expect(messages).toEqual([]);
  });

  it("refuses partial claims on binary / rename / new-file paths", () => {
    for (const klass of ["binary", "rename", "new-file"] as const) {
      const messages = validateCommitBatch_raw(hunkBatch(), {
        changedPaths: ["shared.ts", "solo.md"],
        stagedPaths: [],
        exists: new Set(["shared.ts", "solo.md"]),
        hunkFacts: facts({ refusalClasses: new Map([["shared.ts", klass]]) }),
      });
      expect(messages.some((m) => m.includes(`is a ${klass} diff`) && m.includes("refused in v1")), klass).toBe(true);
    }
  });

  it("selector drift: claimed hunk beyond the live count refuses with remediation", () => {
    const messages = validateCommitBatch_raw(hunkBatch(), {
      changedPaths: ["shared.ts", "solo.md"],
      stagedPaths: [],
      exists: new Set(["shared.ts", "solo.md"]),
      hunkFacts: facts({ liveCounts: new Map([["shared.ts", 1]]) }),
    });
    expect(messages.some((m) => m.includes("selector drift") && m.includes("now has 1 hunk"))).toBe(true);
  });

  it("hunk duplicate membership: same hunk in two groups refuses naming both", () => {
    const dup = `# Commit batch: t

## group 1 — a
- s.ts @ 1

## group 2 — b
- s.ts @ 1-2
`;
    const r = ok(dup);
    if ("errors" in r) throw new Error("fixture must parse");
    const messages = validateCommitBatch_raw(r.batch, {
      changedPaths: ["s.ts"],
      stagedPaths: [],
      exists: new Set(["s.ts"]),
      hunkFacts: facts({ liveCounts: new Map([["s.ts", 2]]), payloadByNumber: new Map([["s.ts", ["-a\n+A", "-b\n+B"]]]) }),
    });
    expect(messages.some((m) => m.includes("hunk 1 is claimed by both group 1 and group 2"))).toBe(true);
  });

  it("hunk coverage: an unclaimed hunk of a partially-claimed file refuses", () => {
    const three = `# Commit batch: t

## group 1 — a
- s.ts @ 1
`;
    const r = ok(three);
    if ("errors" in r) throw new Error("fixture must parse");
    const messages = validateCommitBatch_raw(r.batch, {
      changedPaths: ["s.ts"],
      stagedPaths: [],
      exists: new Set(["s.ts"]),
      hunkFacts: facts({
        liveCounts: new Map([["s.ts", 3]]),
        payloadByNumber: new Map([["s.ts", ["-a\n+A", "-b\n+B", "-c\n+C"]]]),
      }),
    });
    expect(messages.filter((m) => m.includes("hunk") && m.includes("claimed by no group"))).toHaveLength(2);
  });

  it("hunk purity: staged content no group claimed refuses (set-membership)", () => {
    const messages = validateCommitBatch_raw(hunkBatch(), {
      changedPaths: ["shared.ts", "solo.md"],
      stagedPaths: ["shared.ts"],
      exists: new Set(["shared.ts", "solo.md"]),
      hunkFacts: facts({ stagedPayloads: new Map([["shared.ts", ["-smuggled\n+content"]]]) }),
    });
    expect(messages.some((m) => m.includes("staged hunk content no group claimed"))).toBe(true);
  });

  it("hunk purity: staged content a group DID claim passes", () => {
    const messages = validateCommitBatch_raw(hunkBatch(), {
      changedPaths: ["shared.ts", "solo.md"],
      stagedPaths: ["shared.ts"],
      exists: new Set(["shared.ts", "solo.md"]),
      hunkFacts: facts({ stagedPayloads: new Map([["shared.ts", ["-a\n+A"]]]) }),
    });
    expect(messages).toEqual([]);
  });
});
