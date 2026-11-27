// autoapprove.ts — domain logic for deriving the terminal autoApprove
// tooling entries from the caution-vocabulary descriptor layers (stage
// B-lite). Pure derivation, no CLI side effects — the generator
// (tools/internal/devenv-generate-autoapprove.ts) is a thin entrypoint over
// this.
//
// Generation rules:
//   - builtin read-only commands auto-allow (provider self-description).
//   - curated read-only commands auto-allow UNLESS egress-marked (the
//     curl problem: read-only state-wise, network egress — judgment lane).
//   - everything else (mutating/destructive/restricted/prohibited/unknown)
//     never auto-allows — prompt or route.
//   - the git read-grammar regex, the coreutils list, and dotnet/pnpm/node
//     info forms are curated AT THE CARRIER (regex and flag-suffixed shapes
//     the descriptor schema cannot express — the flat parts generated, the
//     grammar parts curated here).
//
// The sync test (devcontainer-json.test.ts) asserts generator ≡ carrier:
// the generated tooling set must equal the non-grammar entries in
// devcontainer.json, and the grammar/curated-at-carrier entries stay
// reviewed by that same test's banned-list.
import {
  allCommandDescriptors,
  curatedDescriptors,
} from "./command-descriptors.ts";

/**
 * Curated-at-carrier entries: shapes the descriptor schema cannot express.
 * Every entry here is reviewed by the banned-list test — this list is the
 * relocated review bar for exactly these forms (regex grammar, flag-
 * suffixed info commands, bare coreutils).
 */
export const CURATED_AT_CARRIER: readonly string[] = [
  // the git read grammar as one anchored regex (admits only fixed read
  // forms; quoting, continuations, and output flags cannot get through)
  "/^git (diff|show|log|diff-tree|diff-index)( (--|--stat|--name-only|--name-status|--oneline|--graph|--no-color|--patch|-p|--shortstat|--numstat|--summary|--cached|--staged|-r|--no-commit-id|--root|--decorate|--abbrev-commit|-[0-9]+|-U[0-9]+|-n|--max-count=[0-9]+|--unified=[0-9]+|(?!(?:[^ /]*/)*\\.\\.(?:/| |$))[A-Za-z0-9_./^~@{}:][A-Za-z0-9_./^~@{}:-]*))*$/",
  // git read verbs the regex does not cover (non-diff family)
  "git cat-file", "git describe", "git for-each-ref", "git ls-files",
  "git merge-base", "git name-rev", "git rev-list", "git rev-parse",
  "git shortlog", "git status",
  // coreutils / inspection (bare-word shapes; reviewed by the banned-list test)
  "cat", "command -v", "cut", "date", "diff", "file", "grep", "head", "id",
  "jq", "ls", "lsof", "rg", "ss", "stat", "tail", "tree", "uname", "uniq",
  "wc", "which", "whoami",
  // toolchain info forms (flag-suffixed — not expressible as flat entries)
  "dotnet --info", "dotnet --version", "dotnet list package",
  "pnpm list", "pnpm outdated", "node --version",
  // docker read forms (curated at carrier — docker is judgment-lane as a
  // whole; only these fixed read shapes auto-allow)
  "docker images", "docker ps", "docker version",
];

/** The auto-allow set derived from the descriptor layers. */
export function generatedAutoApprove(): string[] {
  const entries: string[] = [];
  for (const c of allCommandDescriptors()) {
    if (c.tier === "read-only") entries.push(c.name);
  }
  for (const c of curatedDescriptors()) {
    if (c.tier === "read-only" && c.egress !== true) entries.push(c.name);
  }
  return [...new Set(entries)].sort();
}

/** The full expected carrier set: generated + curated-at-carrier. */
export function expectedCarrierKeys(): string[] {
  return [...new Set([...generatedAutoApprove(), ...CURATED_AT_CARRIER])].sort();
}
