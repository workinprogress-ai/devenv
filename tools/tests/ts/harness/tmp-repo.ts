// harness/tmp-repo.ts — throwaway-directory factories (the audit's F004:
// 159 per-suite mkdtemp fixture blocks unified into named intents).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A scratch directory (registers nothing — the suite's afterEach owns
 * cleanup via the returned path). Prefix derives from the suite name. */
export function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** A stub-bin directory: where stubCli writes land. */
export function tmpStubBin(prefix: string): string {
  const dir = tmpDir(prefix);
  mkdirSync(join(dir), { recursive: true });
  return dir;
}

/** A minimal devenv sandbox root: devenv.config pinned to github provider
 * + the given org — the config the tooling resolves under test. */
export function tmpToolboxRoot(prefix: string, org = "test-org"): string {
  const root = tmpDir(prefix);
  writeFileSync(
    join(root, "devenv.config"),
    [
      "[provider]",
      "name=github",
      "",
      "[organization]",
      `name=Test Organization`,
      `org=${org}`,
      "email_domain=test.example.com",
      "",
      "[workflows]",
      "status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production",
      "",
    ].join("\n"),
  );
  return root;
}

/** Cleanup helper: recursive, force, never throws. */
export function rmrf(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
