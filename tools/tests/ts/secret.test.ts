// secret.test.ts — resolveSecret: environment first, hidden prompt on stderr, null without a terminal.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drivePty } from "./harness/pty.ts";

const SECRET_MODULE = resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/core/secret.ts");

let dir: string;
let harness: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "secret-test-"));
  harness = join(dir, "harness.ts");
  // Prints the resolved value between markers so it is distinguishable from any prompt text.
  writeFileSync(
    harness,
    `import { resolveSecret } from ${JSON.stringify(SECRET_MODULE)};
const v = resolveSecret("SECRET_TEST_VAR", "Enter secret");
process.stdout.write("RESULT[" + (v === null ? "<null>" : v) + "]\\n");
`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runPiped(env: Record<string, string>): { status: number; out: string; err: string } {
  const base = { ...process.env };
  delete base.SECRET_TEST_VAR;
  const r = spawnSync("node", [harness], { encoding: "utf8", env: { ...base, ...env } });
  return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("resolveSecret", () => {
  it("returns the environment value without writing a prompt", () => {
    const r = runPiped({ SECRET_TEST_VAR: "from-env" });
    expect(r.out).toBe("RESULT[from-env]\n");
    expect(r.err).not.toContain("Enter secret");
  });

  it("returns null with nothing prompted when there is no variable and no terminal", () => {
    const r = runPiped({});
    expect(r.out).toBe("RESULT[<null>]\n");
    expect(r.err).not.toContain("Enter secret");
  });

  it("prompts on stderr, not stdout, and returns the typed value under a pseudo-terminal", async () => {
    const errFile = join(dir, "stderr.txt");
    // Only stderr is redirected: stdout must stay on the terminal so the session is interactive.
    const r = await drivePty("node", [harness, `2>${errFile}`], {
      keys: ["W", "typed-value"],
      tailHoldMs: 500,
      timeoutMs: 60_000,
      env: { SECRET_TEST_VAR: "" },
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("RESULT[typed-value]");
    expect(r.out).not.toContain("Enter secret");
    expect(readFileSync(errFile, "utf8")).toContain("Enter secret");
  }, 90_000);
});
