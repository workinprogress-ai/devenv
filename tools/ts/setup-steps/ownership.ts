// ownership.ts — foreign-ownership probe for global npm module directories.
// A directory tree can be user-owned at the top while nested subtrees stay
// root-owned (extracted by a root-context install at container creation);
// npm reify then fails EACCES renaming the root-owned part. The probe walks
// the whole tree, not just the top level.
import { execFileSync } from "node:child_process";

/** True when anything under `dir` is owned by a user other than `owner`. */
export function hasForeignOwnership(dir: string, owner: string): boolean {
  try {
    const out = execFileSync(
      "find",
      [dir, "-not", "-user", owner, "-print", "-quit"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.trim() !== "";
  } catch {
    // find fails when the directory does not exist — nothing to reclaim.
    return false;
  }
}
