// Port of tools/tests/lib/test_azure_smoke_capture.bats (17 tests) — one
// vitest `it` per source `@test`. The Azure smoke harness can record live
// responses as committed fixtures: a recorded response must never carry a
// credential, a real identity, or a real GUID, and it must stay valid JSON so
// the fixture-driven provider tests can parse it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const LIB = join(ROOT, "tools", "lib", "providers", "azure", "smoke-capture.bash");

const GUID_A = "3f2a9c1e-7b44-4d0a-9a51-0c8e5d2b7f10";
const GUID_B = "a1b2c3d4-0000-4abc-8def-1234567890ab";

let TMP = "";
let TMPDIR_SUB = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `smokecap-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  TMPDIR_SUB = join(TMP, "tmpdir");
  mkdirSync(TMPDIR_SUB, { recursive: true });
});

const ENV = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...process.env,
  TMPDIR: TMPDIR_SUB,
  AZURE_PAT: "s3cr3t-pat-value-1234567890",
  AZURE_DEVOPS_ORG: "Real-Org",
  AZURE_SMOKE_TEST_PROJECT: "Real-Project",
  AZURE_SMOKE_CAPTURE_DIR: "",
  SMOKE_REDACT_MAP: "",
  ...extra,
});

// bash -c with the library sourced (the source suite's setup as a spawn).
function sh(script: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}'\n${script}`], {
    encoding: "utf8",
    env: ENV(extraEnv),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// pipe input through smoke_redact (stdout trimmed — smoke_redact's stdout is
// the redacted text with echo's trailing newline).
function redact(input: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}'\nsmoke_redact`], {
    input,
    encoding: "utf8",
    env: ENV(extraEnv),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() + (r.stderr ?? "") };
}

// The bats source ran every call in one shell, so smoke_redact_map_init's
// map persisted across calls. Per-spawn children need the path passed along.
function mapPath(extraEnv: Record<string, string> = {}): string {
  const r = spawnSync("bash", ["-c", `source '${LIB}'\nsmoke_redact_map_init >/dev/null\nprintf '%s' "$SMOKE_REDACT_MAP"`], {
    encoding: "utf8",
    env: ENV(extraEnv),
  });
  return (r.stdout ?? "").trim();
}

// pipe input through smoke_capture NAME.
function capture(input: string, name: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `source '${LIB}'\nsmoke_capture "$1"`, "_", name], {
    input,
    encoding: "utf8",
    env: ENV(extraEnv),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// lowercase contains check on a string.
const lcHas = (s: string, sub: string): boolean => s.toLowerCase().includes(sub.toLowerCase());

describe("azure smoke capture", () => {
  it("redact: a GUID is replaced by a stable placeholder of GUID shape", () => {
    const out = redact(`{"id":"${GUID_A}"}`).out;
    expect(out).not.toContain(GUID_A);
    expect(out).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("redact: the same GUID maps to the same placeholder across calls, different GUIDs differ", () => {
    const map = mapPath();
    const first = redact(GUID_A, { SMOKE_REDACT_MAP: map }).out;
    const again = redact(`x ${GUID_A} y`, { SMOKE_REDACT_MAP: map }).out;
    const other = redact(GUID_B, { SMOKE_REDACT_MAP: map }).out;
    expect(again).toBe(`x ${first} y`);
    expect(first).not.toBe(other);
  });

  it("redact: GUID matching is case-insensitive and maps upper and lower case to one placeholder", () => {
    const map = mapPath();
    const lower = redact(GUID_A, { SMOKE_REDACT_MAP: map }).out;
    const upper = redact(GUID_A.toUpperCase(), { SMOKE_REDACT_MAP: map }).out;
    expect(lower).toBe(upper);
  });

  it("redact: org and project names are replaced everywhere, including the visualstudio.com host", () => {
    const org = "Real-Org";
    const proj = "Real-Project";
    const input = `https://dev.azure.com/${org}/${proj}/_git/r https://${org.toLowerCase()}.visualstudio.com/${proj.toLowerCase()}/_apis`;
    const out = redact(input).out;
    expect(lcHas(out, "real-org")).toBe(false);
    expect(lcHas(out, "real-project")).toBe(false);
    expect(out).toContain("example-org");
    expect(out).toContain("Example-Project");
  });

  it("redact: email addresses are replaced", () => {
    const out = redact("by jane.doe@contoso.com and bob@example.org").out;
    expect(out).not.toContain("jane.doe");
    expect(out).not.toContain("contoso");
    expect(out).toContain("user@example.test");
  });

  it("redact: the PAT and its Basic-auth base64 form are replaced", () => {
    const pat = "s3cr3t-pat-value-1234567890";
    const b64 = spawnSync("bash", ["-c", `printf ':%s' "$AZURE_PAT" | base64 -w0`], {
      encoding: "utf8",
      env: ENV(),
    }).stdout?.trim() ?? "";
    const out = redact(`tok=${pat} hdr=Basic ${b64}`).out;
    expect(out).not.toContain(pat);
    expect(out).not.toContain(b64);
  });

  it("redact: identity fields in JSON are scrubbed at any depth", () => {
    const json =
      '{"createdBy":{"displayName":"Jane Doe","uniqueName":"jane@contoso.com","descriptor":"aad.ABCDEF","imageUrl":"https://x/avatar/1","directoryAlias":"jane"},"reviewers":[{"displayName":"Bob","principalName":"[Real-Project]\\\\Team","mailAddress":"bob@contoso.com"}]}';
    const out = redact(json).out;
    expect(out).not.toContain("Jane");
    expect(out).not.toContain("Bob");
    expect(out).not.toContain("contoso");
    expect(out).not.toContain("ABCDEF");
    expect(out).not.toContain("avatar/1");
    const ok = spawnSync("jq", ["-e", ".createdBy.displayName and (.reviewers | length == 1)"], {
      input: out,
      stdio: ["pipe", "ignore", "ignore"],
    });
    expect(ok.status).toBe(0);
  });

  it("redact: identity tokens embedded in URLs (aad., msa., vssgp. descriptors) are replaced", () => {
    const out = redact(
      "https://x/_apis/GraphProfile/MemberAvatars/aad.NWRlOWU4NjctMDcwZi03ZGMw and msa.abcdef123456 and vssgp.Uy0xLTktMTU1MTM3",
    ).out;
    expect(out).not.toContain("NWRlOWU4");
    expect(out).not.toContain("abcdef123456");
    expect(out).not.toContain("Uy0xLTktMTU1");
    expect(out).toContain("aad.EXAMPLE");
  });

  it("redact: valid JSON stays valid JSON and non-identity values are untouched", () => {
    const out = redact('{"status":"active","count":3,"name":"x"}').out;
    const ok = spawnSync(
      "jq",
      ["-e", '.status == "active" and .count == 3 and .name == "x"'],
      { input: out, stdio: ["pipe", "ignore", "ignore"] },
    );
    expect(ok.status).toBe(0);
  });

  it("redact: non-JSON text is still redacted by substitution", () => {
    const out = redact(`plain text for Real-Org with ${GUID_A}`).out;
    expect(out).not.toContain("Real-Org");
    expect(out).not.toContain(GUID_A);
  });

  it("redact: the redaction map is created outside any capture directory and holds real GUIDs only there", () => {
    const captureDir = join(TMP, "captures");
    mkdirSync(captureDir, { recursive: true });
    const map = mapPath({ AZURE_SMOKE_CAPTURE_DIR: captureDir });
    expect(spawnSync("test", ["-f", map]).status).toBe(0);
    expect(map.startsWith(captureDir)).toBe(false);
    redact(GUID_A, { AZURE_SMOKE_CAPTURE_DIR: captureDir, SMOKE_REDACT_MAP: map });
    expect(spawnSync("grep", ["-qi", GUID_A, map]).status).toBe(0);
  });

  it("capture: with no capture directory set nothing is written", () => {
    capture('{"a":1}', "pr.list");
    const find = spawnSync("find", [TMPDIR_SUB, "-type", "f"], { encoding: "utf8" });
    expect((find.stdout ?? "").trim()).toBe("");
  });

  it("capture: JSON is written redacted and pretty-printed as NAME.json", () => {
    const captureDir = join(TMP, "captures");
    capture(`{"id":"${GUID_A}","org":"Real-Org"}`, "pr.list", { AZURE_SMOKE_CAPTURE_DIR: captureDir });
    const f = join(captureDir, "pr.list.json");
    expect(spawnSync("test", ["-f", f]).status).toBe(0);
    expect(spawnSync("jq", ["-e", ".", f], { stdio: ["pipe", "ignore", "ignore"] }).status).toBe(0);
    expect(spawnSync("grep", ["-qi", "-e", GUID_A, "-e", "Real-Org", f]).status).not.toBe(0);
    const lines = spawnSync("wc", ["-l", f], { encoding: "utf8" }).stdout ?? "0";
    expect(parseInt(lines.trim(), 10)).toBeGreaterThan(1);
  });

  it("capture: non-JSON output is written as NAME.txt", () => {
    const captureDir = join(TMP, "captures");
    capture("<html>sign in Real-Org</html>", "auth.html", { AZURE_SMOKE_CAPTURE_DIR: captureDir });
    const f = join(captureDir, "auth.html.txt");
    expect(spawnSync("test", ["-f", f]).status).toBe(0);
    expect(spawnSync("grep", ["-qi", "Real-Org", f]).status).not.toBe(0);
  });

  it("capture: a name with path separators or odd characters cannot escape the capture directory", () => {
    const captureDir = join(TMP, "captures");
    capture('{"a":1}', "../../evil/name with spaces", { AZURE_SMOKE_CAPTURE_DIR: captureDir });
    expect(spawnSync("test", ["-e", join(TMP, "evil")]).status).not.toBe(0);
    const find = spawnSync("find", [captureDir, "-type", "f"], { encoding: "utf8" }).stdout ?? "";
    expect(find.trim().split("\n").filter(Boolean).length).toBe(1);
    expect(find.trim().startsWith(captureDir)).toBe(true);
  });

  it("capture: no map file or real value is ever written into the capture directory", () => {
    const captureDir = join(TMP, "captures");
    capture(`{"id":"${GUID_A}"}`, "a", { AZURE_SMOKE_CAPTURE_DIR: captureDir });
    capture(`{"id":"${GUID_B}"}`, "b", { AZURE_SMOKE_CAPTURE_DIR: captureDir });
    const find = spawnSync("find", [captureDir, "-type", "f"], { encoding: "utf8" }).stdout ?? "";
    expect(find.trim().split("\n").filter(Boolean).length).toBe(2);
    expect(spawnSync("grep", ["-rqiE", `${GUID_A}|${GUID_B}`, captureDir]).status).not.toBe(0);
  });

  it("jq_ok: true filter returns 0, false filter returns 1, invalid JSON returns 1", () => {
    expect(sh(`smoke_jq_ok '{"status":"completed"}' '.status == "completed"'`).status).toBe(0);
    expect(sh(`smoke_jq_ok '{"status":"active"}' '.status == "completed"'`).status).toBe(1);
    expect(sh(`smoke_jq_ok 'not json' '.status == "completed"'`).status).toBe(1);
  });
});
