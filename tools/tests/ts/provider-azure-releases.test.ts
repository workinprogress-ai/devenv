// Port of tools/tests/lib/test_provider_azure_releases.bats (9 tests): azure
// releases' publishedAt against the REAL response shapes. The Git Refs API
// returns {name, objectId, creator:{displayName,...}} — `creator` is an
// identity with no date. The date lives on the annotated-tag object
// (taggedBy.date) or, for a lightweight tag, on the commit the ref points at
// (committer.date).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";

// URL-dispatching curl stand-in: status line to -D, body to stdout.
const CURL_STUB = `#!/usr/bin/env bash
hdr=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -D) hdr="$2"; shift 2 ;;
        -X|-H|--max-time|-d) shift 2 ;;
        -*) shift ;;
        *) url="$1"; shift ;;
    esac
done
echo "$url" >> "$CURL_LOG"
code=200; body='{}'
case "$url" in
    *"/refs?"*) body="$REFS_JSON" ;;
    *"/annotatedtags/AAA"*) body='{"objectId":"AAA","name":"v1.0.0","taggedBy":{"name":"t","date":"2026-09-01T10:00:00Z"}}' ;;
    *"/annotatedtags/"*) code=404; body='{"message":"not an annotated tag"}' ;;
    *"/commits/BBB"*) body='{"commitId":"BBB","committer":{"name":"c","date":"2026-09-02T11:30:00Z"}}' ;;
esac
printf 'HTTP/1.1 %s X\\r\\n\\r\\n' "$code" > "$hdr"
printf '%s' "$body"
`;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `azrel-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(TMP, "devenv-root"), { recursive: true });
  writeFileSync(join(TMP, "curl.log"), "");
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
});

// releases [flags]: runs provider_org_releases_list against the fakes.
function releases(flags = "", env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source '${TOOLS}/lib/providers/provider-core.bash'\n` +
      `PROVIDER_NAME=azure\n` +
      `provider_load auth repos releases\n` +
      `provider_org_releases_list o1/p1/r1 ${flags}`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_TEMP_DIR: TMP,
        DEVENV_ROOT: join(TMP, "devenv-root"),
        DEVENV_TOOLS: TOOLS,
        AZURE_PAT: "test-pat",
        AZURE_DEVOPS_ORG: "o1",
        AZURE_DEVOPS_PROJECT: "p1",
        AZURE_API_VERSION: "7.1",
        AZURE_HTTP_MAX_RETRIES: "1",
        CURL_LOG: join(TMP, "curl.log"),
        PATH: `${join(TMP, "bin")}:${process.env.PATH ?? ""}`,
        ...env,
      },
    },
  );
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

function jq(json: string, expr: string): string {
  return (spawnSync("jq", ["-r", expr], { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

function jqC(json: string, expr: string): string {
  return (spawnSync("jq", ["-c", expr], { input: json, encoding: "utf8" }).stdout ?? "").trim();
}

// Real ref shapes: identity-only creator, no date on the ref itself.
const REFS_ANNOTATED = '{"value":[{"name":"refs/tags/v1.0.0","objectId":"AAA","creator":{"displayName":"Tagger","id":"u1"}}]}';
const REFS_LIGHTWEIGHT = '{"value":[{"name":"refs/tags/v2.0.0-beta.1","objectId":"BBB","creator":{"displayName":"Tagger","id":"u1"}}]}';

// tag_refs NAME...: a refs response with those tags.
const tagRefs = (...names: string[]): string =>
  `{"value":[${names.map((n) => `{"name":"refs/tags/${n}","objectId":"X${n}"}`).join(",")}]}`;

describe("azure releases publishedAt", () => {
  it("publishedAt for an annotated tag comes from the tag object's taggedBy.date", () => {
    const r = releases("", { REFS_JSON: REFS_ANNOTATED });
    expect(r.status).toBe(0);
    expect(jq(r.out, ".[0].publishedAt")).toBe("2026-09-01T10:00:00Z");
  });

  it("publishedAt for a lightweight tag falls back to the commit's committer date", () => {
    const r = releases("", { REFS_JSON: REFS_LIGHTWEIGHT });
    expect(r.status).toBe(0);
    expect(jq(r.out, ".[0].publishedAt")).toBe("2026-09-02T11:30:00Z");
    expect(jq(r.out, ".[0].isPrerelease")).toBe("true");
  });

  it("publishedAt is empty (field unavailable), not an error, when neither lookup yields a date", () => {
    const r = releases("", { REFS_JSON: '{"value":[{"name":"refs/tags/v3.0.0","objectId":"ZZZ","creator":{"displayName":"T"}}]}' });
    expect(r.status).toBe(0);
    expect(jq(r.out, ".[0].publishedAt")).toBe("");
    expect(jq(r.out, ".[0].tagName")).toBe("v3.0.0");
  });

  it("a mixed list resolves each tag by its own kind", () => {
    const r = releases("", {
      REFS_JSON:
        '{"value":[{"name":"refs/tags/v1.0.0","objectId":"AAA","creator":{"displayName":"T"}},{"name":"refs/tags/v2.0.0-beta.1","objectId":"BBB","creator":{"displayName":"T"}}]}',
    });
    expect(jq(r.out, "[.[].publishedAt] | join(\",\")")).toBe("2026-09-02T11:30:00Z,2026-09-01T10:00:00Z");
  });

  it("no per-tag date lookups are made when publishedAt is not requested", () => {
    const r = releases("--json tagName,name", { REFS_JSON: REFS_ANNOTATED });
    expect(r.status).toBe(0);
    const n = spawnSync("grep", ["-c", "annotatedtags\\|/commits/", join(TMP, "curl.log")], { encoding: "utf8" }).stdout ?? "0";
    expect(n.trim()).toBe("0");
  });

  it("--json still projects exactly the requested fields", () => {
    const r = releases("--json tagName,publishedAt", { REFS_JSON: REFS_ANNOTATED });
    expect(jqC(r.out, ".[0] | keys")).toBe('["publishedAt","tagName"]');
  });
});

describe("azure releases order + prerelease", () => {
  it("releases come newest first by version, not alphabetically, and a release is above its own prereleases", () => {
    const r = releases("--json tagName", {
      REFS_JSON: tagRefs("v1.9.0", "v1.10.0", "v1.10.0-rc.1", "v0.5.0", "v2.0.0"),
    });
    expect(r.status).toBe(0);
    expect(jq(r.out, "[.[].tagName] | join(\",\")")).toBe("v2.0.0,v1.10.0,v1.10.0-rc.1,v1.9.0,v0.5.0");
  });

  it("--limit keeps the newest tags, not the alphabetically first", () => {
    const r = releases("--limit 2 --json tagName", {
      REFS_JSON: tagRefs("v1.0.0", "v1.1.0", "v1.2.0", "v1.3.0"),
    });
    expect(r.status).toBe(0);
    expect(jq(r.out, "[.[].tagName] | join(\",\")")).toBe("v1.3.0,v1.2.0");
  });

  it("only a semver prerelease suffix marks a prerelease; other hyphenated tags are not", () => {
    const r = releases("--json tagName,isPrerelease", {
      REFS_JSON: tagRefs("v1.0.0-rc.1", "release-2026-09", "v1.0.0"),
    });
    expect(r.status).toBe(0);
    expect(jqC(r.out, "map({(.tagName): .isPrerelease}) | add")).toBe(
      '{"v1.0.0":false,"v1.0.0-rc.1":true,"release-2026-09":false}',
    );
  });
});
