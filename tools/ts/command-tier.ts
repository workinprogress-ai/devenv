#!/usr/bin/env node
// command-tier — the universal tier oracle: resolve a command's risk tier
// wherever it is declared — the org layer first (deployment authority),
// then devenv's own commands (builtin descriptors), then the curated
// layer, then the cloned repos' .devenv/manifest.yaml layer
// (subcommand-aware for multi-verb tools such as srs). Precedence mirrors
// the devenvrc PATH rule: a repo tool never shadows a devenv tool of the
// same name. Prints the tier (read-only |
// mutating | destructive) and its provenance; trailing ARGS (after --)
// resolve the effective tier for a concrete invocation (declared ceiling,
// demoted on provider-declared read-only forms, subcommands resolved).
// Unknown names exit 1 — the raw-CLI judgment lane, never a default tier.
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import {
  allCommandDescriptors,
  curatedDescriptors,
  resolveTier,
  manifestCollisions,
} from "../lib/domain/command-descriptors.ts";
import { allRepoManifests } from "../lib/domain/repo-manifests.ts";

assertNodeFloor();

function usage(): void {
  console.log(`Usage: command-tier NAME [-- ARGS...] | --list

Resolve a command's tier wherever it is declared (vocabulary:
read-only | mutating | destructive | restricted | prohibited — one
vocabulary across all layers). Lookup order: the org layer first
(tools/config/org-command-descriptors.yaml — the deployment authority;
full-replacement entries), then devenv's own commands
(tools/config/builtin-command-descriptors.yaml), then the curated
layer (tools/config/curated-command-descriptors.yaml), then the cloned repos'
manifests (repos/*/.devenv/manifest.yaml; a repo tool never shadows a
devenv tool). The declared tier is the ceiling; ARGS after -- resolve
the effective tier — demoted on provider-declared read-only forms
(e.g. --dry-run), and subcommands resolved for multi-verb executables
(srs deploy vs verify). Restricted answers carry the license
(restricted-to: the named skills); prohibited answers may carry the
route (the sanctioned substitute for the job — the substitution
chain). Output: tier + provenance + license/route when present.
Unknown names exit 1 — an unjudged command, never a default tier.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  --list                  Print every declaration from both layers
                          (tier<TAB>command<TAB>source<TAB>note)`);
}

let name = "";
let list = false;
let args: string[] = [];
try {
  const cli = toolCli({
    name: "command-tier",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      list: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) {
    usage();
    process.exit(0);
  }
  list = cli.values.list === true;
  name = cli.positionals[0] ?? "";
  // Invocation args after a bare `--` separator (not the house -- separator
  // semantics — this tool forwards nothing, so -- is free to mean "these are
  // the invocation's args").
  const raw = process.argv.slice(2);
  const sep = raw.indexOf("--");
  if (sep !== -1) {
    args = raw.slice(sep + 1);
    name = name === "" ? (raw[0] ?? "") : name;
  } else {
    // A bare subcommand word without `--` is not silently discarded: it
    // lands in positionals[1], and treating it as the first invocation arg
    // gives subcommand resolution without the separator (a word the caller
    // typed is a word the oracle reads). Only a single extra positional is
    // consumed this way — more than that is usage confusion, surfaced.
    const extra = cli.positionals.slice(1).filter((p) => p !== "");
    if (extra.length === 1) {
      args = [extra[0] as string];
    } else if (extra.length > 1) {
      console.error(
        `command-tier: unexpected arguments ${extra.join(" ")} — pass the invocation as: command-tier NAME -- ARGS...`,
      );
      console.error("Use --help for usage information");
      process.exit(EXIT_MISUSE);
    }
  }
  if (!list && name === "") {
    console.error("command-tier: missing NAME (or use --list)");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

try {
  if (list) {
    for (const c of allCommandDescriptors()) {
      console.log(`${c.tier}\t${c.name}\tbuiltin\t${c.note ?? ""}`);
    }
    for (const c of curatedDescriptors()) {
      console.log(`${c.tier}\t${c.name}\tcurated\t${c.note ?? ""}`);
    }
    const collisions = new Map(
      manifestCollisions().map((c) => [`${c.source}:${c.name}`, c]),
    );
    for (const m of allRepoManifests()) {
      for (const e of m.executables) {
        if (collisions.has(`${m.name}:${e.name}`)) {
          // INERT: a workspace layer (org/builtin/curated) declares this
          // name — the manifest entry never answers a lookup. Skipped
          // here so the listing tells the truth; the repo author renames
          // or drops the entry.
          continue;
        }
        console.log(`${e.tier}\t${e.name}\t${m.name}\t${e.purpose ?? ""}`);
        for (const sc of e.subcommands ?? []) {
          console.log(`${sc.tier}\t${e.name} ${sc.name}\t${m.name}\t(subcommand)`);
        }
      }
    }
    for (const c of collisions.values()) {
      process.stderr.write(
        `repo-manifests: '${c.name}' is declared in ${c.source}'s manifest but shadowed by the ${c.shadowSource} layer (${c.shadowTier}) — inert, never answers a lookup. Rename the tool or drop the manifest entry.\n`,
      );
    }
    process.exit(0);
  }
  const resolution = resolveTier(name, args);
  if (resolution === null) {
    unknown(name);
  }
  const extra =
    resolution.license !== undefined
      ? `\t${resolution.tier} → licensed: ${resolution.license.join(", ")}`
      : resolution.route !== undefined
        ? `\t${resolution.tier} → route: ${resolution.route}`
        : "";
  console.log(`${resolution.tier}\t${resolution.source}\t${resolution.matched}${extra}`);
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}

function unknown(n: string): never {
  console.error(
    `command-tier: '${n}' is not declared anywhere — neither in devenv's ` +
      `tools/config/builtin-command-descriptors.yaml, curated-command-descriptors.yaml, nor in ` +
      `any cloned repo's ` +
      `.devenv/manifest.yaml. If it is a command this repo ships, declare it ` +
      `there (coverage is enforced); if it belongs to a tool repo, that repo ` +
      `needs a manifest (a census-gap signal); if it is a raw CLI, it is ` +
      `judged by pattern, not declared anywhere.`,
  );
  process.exit(EXIT_GENERAL_ERROR);
}
