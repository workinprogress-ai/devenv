// download-verify.ts — pure checks that gate a downloaded key or script before
// it is installed. A pin list that is empty means "no pin configured": the
// result is "unpinned" and the caller must say so; a configured pin that does
// not match always throws.

import { createHash } from "node:crypto";

export type Verification = "verified" | "unpinned";

function normalize(fp: string): string {
  return fp.replace(/\s+/g, "").toUpperCase();
}

/** Primary-key fingerprints from `gpg --show-keys --with-colons` output: the
 * `fpr` record that follows each `pub` record (subkey `fpr` records skipped). */
export function primaryFingerprints(colonOutput: string): string[] {
  const fps: string[] = [];
  let expectPrimary = false;
  for (const line of colonOutput.split("\n")) {
    const fields = line.split(":");
    if (fields[0] === "pub") {
      expectPrimary = true;
    } else if (fields[0] === "sub") {
      expectPrimary = false;
    } else if (fields[0] === "fpr" && expectPrimary) {
      fps.push(normalize(fields[9] ?? ""));
      expectPrimary = false;
    }
  }
  return fps;
}

/** Every key in the download must carry a pinned fingerprint. */
export function assertKeyFingerprints(label: string, actual: string[], pinned: readonly string[]): Verification {
  if (actual.length === 0) throw new Error(`${label}: no key found in the download`);
  if (pinned.length === 0) return "unpinned";
  const allowed = new Set(pinned.map(normalize));
  for (const fp of actual) {
    if (!allowed.has(normalize(fp))) {
      throw new Error(`${label}: key fingerprint ${fp} is not in the pinned set`);
    }
  }
  return "verified";
}

export function assertSha256(label: string, data: Buffer | string, pinned: string): Verification {
  if (pinned === "") return "unpinned";
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== pinned.toLowerCase()) {
    throw new Error(`${label}: sha256 ${actual} does not match the pinned digest`);
  }
  return "verified";
}
