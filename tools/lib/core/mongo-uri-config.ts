// mongo-uri-config.ts — keep a MongoDB connection string off the command line.
//
// A URI passed as `--uri=...` is visible to every local user in `ps`. The
// MongoDB database tools read the same value from a `--config` YAML file, so
// the URI is written to a private (0600) temp file for the duration of one run.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Writes `uri` to a private config file and returns its path plus a cleanup function. */
export function writeMongoUriConfig(uri: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "mongo-uri-"));
  const path = join(dir, "config.yaml");
  // A JSON string is a valid YAML double-quoted scalar, so any URI is escaped safely.
  writeFileSync(path, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
