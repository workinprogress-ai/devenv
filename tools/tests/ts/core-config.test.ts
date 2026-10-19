// Behavioral tests for the core config INI reader. The assertions mirror the
// contract the bats suite pins for the bash original (test_config_read.bats):
// exact section/key matching, trimming rules, value-contains-equals,
// last-occurrence-wins, empty-reads-as-default, comment/blank skipping, CRLF
// tolerance, and template expansion with re-expansion neutralization.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configGet,
  configGetRaw,
  configGetArray,
  configListSection,
  configDumpSection,
  expandTokens,
} from "../../lib/core/config.ts";

let dir: string;
let conf: string;

function setup(content: string): void {
  dir = mkdtempSync(join(tmpdir(), "config-test-"));
  conf = join(dir, "devenv.config");
  writeFileSync(conf, content);
}

function teardown(): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("config basic reads", () => {
  it("reads a value by section and key", () => {
    setup("[copilot]\nengineering_repo=my-standards\n");
    expect(configGet(conf, "copilot", "engineering_repo")).toBe("my-standards");
    teardown();
  });

  it("returns undefined for a missing file, a missing key, and an empty key", () => {
    setup("[copilot]\nempty=\n");
    expect(configGet(conf, "nope", "key")).toBeUndefined();
    expect(configGet(conf, "copilot", "missing")).toBeUndefined();
    expect(configGet(conf, "copilot", "empty")).toBe("");
    teardown();
  });

  it("treats a value containing '=' as one value (split on first =)", () => {
    setup("[s]\nurl=https://x.example/a=b\n");
    expect(configGet(conf, "s", "url")).toBe("https://x.example/a=b");
    teardown();
  });

  it("last occurrence of a duplicated key wins; raw read stays silent", () => {
    const errs: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: (s: string) => boolean }).write = (s: string) => {
      errs.push(s);
      return true;
    };
    setup("[s]\nkey=first\nkey=second\n");
    try {
      // raw read: last-wins silently (the provider identity path must not warn)
      expect(configGetRaw(conf, "s", "key")).toBe("second");
      expect(errs).toHaveLength(0);
    } finally {
      (process.stderr as { write: (s: string) => boolean }).write = orig;
    }
    teardown();
  });

  it("warns on duplicate keys for the expanding read", () => {
    const errs: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: (s: string) => boolean }).write = (s: string) => {
      errs.push(s);
      return true;
    };
    setup("[s]\nkey=first\nkey=second\n");
    try {
      expect(configGet(conf, "s", "key")).toBe("second");
      expect(errs[0]).toMatch(/duplicate key s\.key/);
    } finally {
      (process.stderr as { write: (s: string) => boolean }).write = orig;
    }
    teardown();
  });

  it("skips comments, blank lines, and trims whitespace; tolerates CRLF", () => {
    setup(
      "# leading comment\n[s]  ; trailing comment\n\n  key1 = value1  \r\n;another\n\tkey2\t=\tvalue2\t\r\n",
    );
    expect(configGet(conf, "s", "key1")).toBe("value1");
    expect(configGet(conf, "s", "key2")).toBe("value2");
    teardown();
  });

  it("matches section and key exactly, never as a prefix", () => {
    setup("[section]\nkey=v\n[sectionExtra]\nkey=other\n[section]\nkeys=also\n");
    expect(configGet(conf, "section", "key")).toBe("v");
    expect(configGet(conf, "sectionExtra", "key")).toBe("other");
    expect(configGet(conf, "section", "keys")).toBe("also");
    teardown();
  });
});

describe("config template expansion", () => {
  it("expands PROVIDER_ORG/PROVIDER_USER via the resolvers", () => {
    setup("[copilot]\nknowledge_subpath=${PROVIDER_ORG}/k/${PROVIDER_USER}/\n");
    const v = configGet(conf, "copilot", "knowledge_subpath", {
      org: () => "acme",
      user: () => "toochevere",
    });
    expect(v).toBe("acme/k/toochevere/");
    teardown();
  });

  it("never re-expands tokens inside resolved values (sentinel neutralization)", () => {
    setup("[s]\nvalue=${PROVIDER_ORG}\n");
    const v = configGet(conf, "s", "value", {
      org: () => "${PROVIDER_USER}", // attacker-ish resolver output
      user: () => "evil",
    });
    expect(v).toBe("${PROVIDER_USER}");
    teardown();
  });

  it("expandTokens is exported and single-pass", () => {
    expect(expandTokens("o=${PROVIDER_ORG} u=${PROVIDER_USER}", { org: () => "O", user: () => "U" })).toBe("o=O u=U");
  });
});

describe("config arrays, sections", () => {
  it("splits comma-separated values into a trimmed array", () => {
    setup("[workflows]\nstatus_workflow=A, B ,C\n");
    expect(configGetArray(conf, "workflows", "status_workflow")).toEqual(["A", "B", "C"]);
    teardown();
  });

  it("yields an empty array for empty/missing keys", () => {
    setup("[workflows]\nempty=\n");
    expect(configGetArray(conf, "workflows", "empty")).toEqual([]);
    expect(configGetArray(conf, "workflows", "missing")).toEqual([]);
    teardown();
  });

  it("lists section keys in file order and dumps key/value pairs", () => {
    setup("[s]\nalpha=1\nbeta=2\n[other]\ngamma=3\n");
    expect(configListSection(conf, "s")).toEqual(["alpha", "beta"]);
    expect(configDumpSection(conf, "s")).toEqual([
      { key: "alpha", value: "1" },
      { key: "beta", value: "2" },
    ]);
    teardown();
  });
});

describe("configGetRaw", () => {
  it("returns the literal value without expansion", () => {
    setup("[copilot]\nknowledge_subpath=${PROVIDER_ORG}/k/\n");
    expect(configGetRaw(conf, "copilot", "knowledge_subpath")).toBe("${PROVIDER_ORG}/k/");
    teardown();
  });
});
