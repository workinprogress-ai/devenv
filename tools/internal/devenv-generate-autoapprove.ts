#!/usr/bin/env node
// devenv-generate-autoapprove — regenerate the terminal autoApprove
// tooling entries in devcontainer.json from the caution-vocabulary
// descriptor layers, replacing the hand-maintained list. INTERNAL
// machinery (tools/internal/ contract): no depth-1 stub, not on PATH,
// invoked by explicit path — the generator ≡ carrier sync test is repo
// contract enforcement, not a fork-replaceable preference. Generation rules
// (the design proposal's adopted shape):
//   - builtin read-only commands auto-allow (provider self-description).
//   - curated read-only commands auto-allow UNLESS egress-marked (the
//     curl problem: read-only state-wise, network egress — judgment lane).
//   - everything else (mutating/destructive/restricted/prohibited/unknown)
//     never auto-allows — prompt or route.
//   - the git read-grammar regex, the coreutils list, and dotnet/pnpm/node
//     info forms are curated AT THE CARRIER (regex and flag-suffixed shapes
//     the descriptor schema cannot express — the proposal's open seam,
//     resolved as: flat parts generated, grammar parts curated here).
// The sync test (devcontainer-json.test.ts) asserts generator ≡ carrier:
// the generated tooling set must equal the non-grammar entries in
// devcontainer.json, and the grammar/curated-at-carrier entries must stay
// reviewed by that same test's banned-list.
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import {
  CURATED_AT_CARRIER,
  expectedCarrierKeys,
  generatedAutoApprove,
} from "../lib/domain/autoapprove.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

assertNodeFloor();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DC_PATH = join(ROOT, ".devcontainer", "devcontainer.json");

function usage(): never {
  console.log(`Usage: tools/internal/devenv-generate-autoapprove.ts [--check|--write]

Stage B-lite: regenerate the chat.tools.terminal.autoApprove tooling
entries in .devcontainer/devcontainer.json from the caution-vocabulary
descriptor layers (builtin read-only auto-allow; curated read-only
auto-allow unless egress-marked; everything else prompts). The git grammar,
coreutils, and toolchain info forms stay curated at the carrier (shapes the
descriptor schema cannot express). --check compares without writing (the
sync test's mode); --write regenerates the block in place.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  --check                Compare generated vs carrier; exit 1 on drift
  --write                Write the generated entries into devcontainer.json`);
  process.exit(0);
}

/** Parse the current autoApprove keys from the devcontainer.json (JSONC). */
function currentAutoApproveKeys(): string[] {
  const raw = readFileSync(DC_PATH, "utf8");
  const json = JSON.parse(
    raw.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"),
  );
  const approve = json["customizations"]["vscode"]["settings"]["chat.tools.terminal.autoApprove"];
  return Object.keys(approve).filter((k: string) => approve[k]);
}

let mode = "";
try {
  const cli = toolCli({
    name: "devenv-generate-autoapprove",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      check: { type: "boolean", default: false },
      write: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  if (cli.values.check === true) mode = "check";
  if (cli.values.write === true) mode = "write";
  if (mode === "") {
    console.error("devenv-generate-autoapprove: pass --check or --write");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const expected = expectedCarrierKeys();
const current = currentAutoApproveKeys().sort();
const missing = expected.filter((k) => !current.includes(k));
const extra = current.filter((k) => !expected.includes(k));

if (mode === "check") {
  if (missing.length > 0 || extra.length > 0) {
    console.error("devenv-generate-autoapprove: drift between descriptors and carrier —");
    if (missing.length > 0) console.error(`  missing from carrier: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`  not derivable from descriptors: ${extra.join(", ")}`);
    console.error("Run: node tools/internal/devenv-generate-autoapprove.ts --write (then review the diff — the carrier is a reviewed surface).");
    process.exit(EXIT_GENERAL_ERROR);
  }
  console.log(`devenv-generate-autoapprove: in sync (${expected.length} entries: ${generatedAutoApprove().length} generated + ${CURATED_AT_CARRIER.length} curated-at-carrier)`);
  process.exit(0);
}

// --write: regenerate the autoApprove block in place, preserving the JSONC
// structure around it. The block is delimited by the settings key; entries
// are emitted sorted (generated first, then curated-at-carrier — one sorted
// list; JSON object key order is cosmetic).
const raw = readFileSync(DC_PATH, "utf8");
const lines = raw.split("\n");
const keyLine = lines.findIndex((l) => l.includes('"chat.tools.terminal.autoApprove"'));
if (keyLine === -1) {
  console.error("devenv-generate-autoapprove: autoApprove key not found in devcontainer.json");
  process.exit(EXIT_GENERAL_ERROR);
}
// Find the block: from the key line to the closing brace line (the line
// whose trimmed form starts with '}' at the same or lower indentation).
const indent = (lines[keyLine] ?? "").match(/^\s*/)?.[0] ?? "";
const endLine = (() => {
  for (let i = keyLine + 1; i < lines.length; i += 1) {
    const t = (lines[i] ?? "").trim();
    if (t.startsWith("}")) return i;
  }
  return -1;
})();
if (endLine === -1) {
  console.error("devenv-generate-autoapprove: autoApprove block end not found");
  process.exit(EXIT_GENERAL_ERROR);
}
// Emit the regenerated block. The autoApprove object is the LAST property
// of its parent settings object: the block closes with a plain '}' (no
// comma) and the last entry carries no trailing comma — the file is
// JSONC-parsed with plain JSON after comment-stripping, so commas must be
// exact. The write asserts the expected structure before replacing: the
// line after the block's closing brace must be the parent's own close (a
// line starting with '}' at LOWER indentation) — if the layout ever
// changes, the generator refuses rather than corrupting.
const closer = lines[endLine] ?? "";
const afterCloser = lines[endLine + 1] ?? "";
const closerIndent = closer.match(/^\s*/)?.[0] ?? "";
const afterIndent = afterCloser.match(/^\s*/)?.[0] ?? "";
const blockIsLastProperty =
  closer.trim().startsWith("}") &&
  !closer.trim().endsWith(",") &&
  afterIndent.length < closerIndent.length;
if (!blockIsLastProperty) {
  console.error(
    "devenv-generate-autoapprove: autoApprove is no longer the last property of its parent " +
      "(or the closing structure changed) — the write path assumes the plain-close " +
      "layout. Inspect the file and extend the generator for the new shape.",
  );
  process.exit(EXIT_GENERAL_ERROR);
}
const entryLines = expected.map((k) => `${indent}    ${JSON.stringify(k)}: true`);
const newBlock = [
  `${indent}"chat.tools.terminal.autoApprove": {`,
  ...entryLines.join(",\n").split("\n"),
  `${indent}}`,
];
lines.splice(keyLine, endLine - keyLine + 1, ...newBlock);
writeFileSync(DC_PATH, lines.join("\n"));
console.log(`devenv-generate-autoapprove: wrote ${expected.length} entries (${generatedAutoApprove().length} generated + ${CURATED_AT_CARRIER.length} curated-at-carrier)`);
