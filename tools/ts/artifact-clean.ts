#!/usr/bin/env node
// artifact-clean.ts - Clean up `.local-artifacts/` folders by artifact family
// Version: 1.3.0
// Description: Interactive (default when a TTY is present) or flag-driven
//              cleanup of local artifact folders. Files are grouped into the
//              convention families (ephemeral tmpN.md, session memory,
//              issue-artifact working copies) plus an "other" bucket. A fifth
//              family, deliverables (research-*, bug-hunt-*, TECH_DEBT_AUDIT*),
//              is retained work product: no sweep touches it unless
//              --include-deliverables says so. Deletion confidence matches
//              family: ephemeral needs no confirmation; working/session/other
//              require an explicit -y/--yes or interactive confirmation.
//              Never touches anything outside .local-artifacts/.
// Requirements: Node >= 23.6 (native type-stripping execution)
// Requirements: ui/prompts (clack) replaces the bash tool's fzf picker per
//               the migration's D4 decision: interactive selection is a
//               multiselect prompt; a non-TTY run never prompts (list-only).

import { parseArgs } from "node:util";
import { basename, dirname, join } from "node:path";
import { readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { cwd as getCwd } from "node:process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logInfo, logWarn, logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { confirm, isInteractive, multiSelect } from "../lib/ui/index.ts";

assertNodeFloor();

const FOLDER_NAME = ".local-artifacts";
const SCRIPT_VERSION = "1.3.0";
const SCRIPT_NAME = "artifact-clean";

type Family = "ephemeral" | "session" | "working" | "other" | "deliverable";

/** classify FILENAME -> family name (mirror of the _conventions.md families) */
export function classify(fileName: string): Family {
  if (/^tmp\d+\.md$/.test(fileName)) return "ephemeral";
  // session-state-* is the canonical coordination-registry name; pairing-
  // state-* kept for orphaned files from before the rename — they retire as
  // their plans close.
  if (/^(session_memory|session-state|pairing-state)-.*\.md$/.test(fileName)) return "session";
  if (/^(Plan-issue|Grooming|Specifications|Blueprint|Roadmap)-.*\.md$/.test(fileName)) return "working";
  if (/^(research-.*\.md|bug-hunt-.*\.md|TECH_DEBT_AUDIT.*)$/.test(fileName)) return "deliverable";
  return "other";
}

export function discoverArtifactRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, FOLDER_NAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function collectFamily(folder: string, family: Family): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .map((f) => join(folder, f))
    .filter((f) => statSync(f).isFile() && classify(basename(f)) === family)
    .sort();
}

interface SweepOptions {
  families: Family[];
  listOnly: boolean;
  assumeYes: boolean;
  keepTmp: boolean;
}

async function confirmFiles(label: string, files: string[]): Promise<boolean> {
  console.log(`  ${label}:`);
  for (const f of files) console.log(`    - ${basename(f)}`);
  // Interactive-only (callers gate on isInteractive()/assumeYes first): a
  // real y/n confirm — the always-false stub made interactive flag-mode
  // unable to delete anything.
  return await confirm({ message: `Delete ${files.length} file(s)?`, fallback: false });
}

async function sweepRoot(root: string, opts: SweepOptions): Promise<number> {
  const folder = join(root, FOLDER_NAME);
  logInfo(`Scanning ${folder}`);

  let deleted = 0;
  let ephemeralDeleted = 0;

  const kept = collectFamily(folder, "deliverable");
  if (!opts.families.includes("deliverable") && kept.length > 0) {
    logInfo(`[deliverable] kept ${kept.length} protected file(s) (retained work product, never swept; pass --include-deliverables to include them)`);
  }

  if (opts.families.includes("interactive" as Family)) {
    // Interactive mode: ephemeral auto-cleaned (unless keepTmp), then one
    // multiselect over every remaining candidate (D4: clack, not fzf).
    const sweepFamilies: Family[] = ["ephemeral", "session", "working", "other"];
    if (opts.families.includes("deliverable")) sweepFamilies.push("deliverable");

    let deletable: string[] = [];
    for (const family of sweepFamilies) deletable = deletable.concat(collectFamily(folder, family));

    if (deletable.length === 0) {
      logInfo(`Nothing to clean in ${folder}`);
      return 0;
    }

    const offerable: string[] = [];
    for (const f of deletable) {
      if (classify(basename(f)) === "ephemeral" && !opts.keepTmp) {
        rmSync(f);
        deleted += 1;
        ephemeralDeleted += 1;
      } else {
        offerable.push(f);
      }
    }
    if (offerable.length === 0) {
      logInfo("Only ephemeral files present — cleaned");
      return deleted;
    }
    if (ephemeralDeleted > 0) {
      logInfo(`[ephemeral] auto-cleaned ${ephemeralDeleted} scratch file(s) (tmpN.md — no confirmation needed by convention)`);
    }
    if (opts.keepTmp) {
      logInfo("--keep-tmp: ephemeral tmpN.md files included in the selection (nothing auto-deleted)");
    }

    const chosen = await multiSelect<string>({
      message: "Select artifacts to delete (space toggles, enter confirms)",
      options: offerable.map((f) => ({ value: f, label: `[${classify(basename(f))}] ${basename(f)}` })),
      fallback: [],
      required: false,
    });
    if (chosen.length > 0) {
      for (const f of chosen) rmSync(f);
      deleted += chosen.length;
      logInfo(`Deleted ${chosen.length} selected file(s)`);
    } else {
      logInfo("No files selected — nothing deleted");
    }
    return deleted;
  }

  for (const family of opts.families) {
    const files = collectFamily(folder, family);
    if (files.length === 0) continue;

    if (opts.listOnly) {
      console.log(`[${family}] would clean ${files.length} file(s):`);
      for (const f of files) console.log(`  - ${basename(f)}`);
      continue;
    }

    if (family === "ephemeral" && !opts.keepTmp) {
      for (const f of files) rmSync(f);
      deleted += files.length;
      logInfo(`[${family}] deleted ${files.length} file(s) (no confirmation needed)`);
      continue;
    }

    if (family === "ephemeral" && opts.keepTmp) {
      if (opts.assumeYes) {
        for (const f of files) rmSync(f);
        deleted += files.length;
        logInfo(`[${family}] deleted ${files.length} file(s) (-y)`);
      } else if (isInteractive()) {
        if (await confirmFiles(`[${family}] (--keep-tmp)`, files)) {
          for (const f of files) rmSync(f);
          deleted += files.length;
          logInfo(`[${family}] deleted ${files.length} file(s) (--keep-tmp)`);
        } else {
          logInfo(`[${family}] skipped`);
        }
      } else {
        logWarn(`[${family}] --keep-tmp set but no TTY/-y: skipped (nothing auto-deleted)`);
      }
      continue;
    }

    if (opts.assumeYes) {
      for (const f of files) rmSync(f);
      deleted += files.length;
      logInfo(`[${family}] deleted ${files.length} file(s) (-y)`);
    } else if (isInteractive()) {
      if (await confirmFiles(`[${family}]`, files)) {
        for (const f of files) rmSync(f);
        deleted += files.length;
        logInfo(`[${family}] deleted ${files.length} file(s)`);
      } else {
        logInfo(`[${family}] skipped`);
      }
    } else {
      logWarn(`[${family}] ${files.length} file(s) need confirmation; rerun with a TTY or -y`);
    }
  }
  return deleted;
}

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [PATH...] [OPTIONS]

Clean up ${FOLDER_NAME}/ folders by artifact family. With no PATH, operates on
the nearest directory (walking up from cwd) that contains a ${FOLDER_NAME}.

Families (per the .local-artifacts convention):
    ephemeral   tmpN.md scratch files (always cleaned automatically, even in
                interactive mode — the convention needs no confirmation)
    session     session_memory-*.md planning-skill memory (confirm or -y)
    working     Plan-issue-*.md / Grooming-*.md / Specifications-*.md /
                Blueprint-*.md / Roadmap-*.md — local working copies of
                issue-published artifacts (confirm or -y)
    other       anything else in the folder (confirm or -y; never silently
                deleted)
    deliverable research-*.md / bug-hunt-*.md / TECH_DEBT_AUDIT* — retained
                work product, not cleanup fodder. NEVER swept (not by --all,
                not by -y, not offered in interactive selection) unless
                --include-deliverables is passed; reported as "kept" instead

Options:
    -i, --interactive   Interactive selection (default when no family flags
                        are given and stdin is a TTY): one multi-select list
                        of every deletable file. Without a TTY: falls back to
                        list-only across all families.
    --tmp               Ephemeral family only
    --session           Session-memory family only
    --working           Issue working-copy family only
    --all               Every family, including other (deliverables only
                        with --include-deliverables)
    --include-deliverables
                        Explicit override: with --all or interactive
                        selection, also sweep the deliverable family. The
                        usual rules still apply (-y or a confirmation).
    --keep-tmp          Override: do NOT auto-delete ephemeral tmpN.md files.
    -y, --yes           Assume yes for all confirmations
    -l, --list          List what would be cleaned per family; delete nothing
    -h, --help          Show this help message
    -v, --version       Show version and exit

Exit codes:
    0 cleanup completed (or nothing to do)
    1 general error
    2 invalid arguments or no artifact folder found

Examples:
    ${SCRIPT_NAME}                      # interactive selection
    ${SCRIPT_NAME} --tmp                # drop scratch files, no prompts
    ${SCRIPT_NAME} --working -y         # clear working copies, no prompts
    ${SCRIPT_NAME} repos/foo -l         # list-only for a specific repo
    ${SCRIPT_NAME} --all -y             # full sweep, no prompts (deliverables kept)
    ${SCRIPT_NAME} --all -y --include-deliverables   # ...deliverables too
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let mode = "";
  let assumeYes = false;
  let listOnly = false;
  let keepTmp = false;
  let includeDeliverables = false;
  const userPaths: string[] = [];

  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        interactive: { type: "boolean", short: "i", default: false },
        tmp: { type: "boolean", default: false },
        session: { type: "boolean", default: false },
        working: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        "include-deliverables": { type: "boolean", default: false },
        "keep-tmp": { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        list: { type: "boolean", short: "l", default: false },
      },
      strict: true,
    });

    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    if (values["interactive"]) mode = "interactive";
    if (values["tmp"]) mode += "tmp";
    if (values["session"]) mode += "session";
    if (values["working"]) mode += "working";
    if (values["all"]) mode = "tmp session working other";
    if (values["include-deliverables"]) includeDeliverables = true;
    if (values["keep-tmp"]) keepTmp = true;
    if (values["yes"]) assumeYes = true;
    if (values["list"]) listOnly = true;
    userPaths.push(...positionals);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    return EXIT_MISUSE;
  }

  const roots: string[] = [];
  if (userPaths.length > 0) {
    for (const p of userPaths) {
      if (!existsSync(p)) {
        logError(`Path not found: ${p}`);
        return EXIT_MISUSE;
      }
      if (existsSync(join(p, FOLDER_NAME))) {
        roots.push(p);
      } else if (basename(p) === FOLDER_NAME) {
        roots.push(dirname(p));
      } else {
        logWarn(`No ${FOLDER_NAME} under ${p} — skipping`);
      }
    }
    if (roots.length === 0) return 2;
  } else {
    const root = discoverArtifactRoot(getCwd());
    if (root === null) {
      logError(`No ${FOLDER_NAME} found between ${getCwd()} and /`);
      return 2;
    }
    roots.push(root);
  }

  // Default mode: interactive when no family flags and a TTY is present;
  // otherwise degrade to list-only across ALL families so non-interactive
  // callers get a full inventory and never prompt.
  // Non-TTY never prompts and never auto-deletes: explicit --interactive or
  // default-mode runs degrade to list-only when no terminal is available.
  if (!isInteractive()) {
    if (mode === "" || mode === "interactive") {
      mode = "tmp session working other";
      listOnly = true;
      logWarn("No family flags given and stdin is not a TTY — defaulting to list-only");
    }
  } else if (mode === "") {
    mode = "interactive";
  }

  let totalDeleted = 0;
  for (const root of roots) {
    let families: Family[] = [];
    if (mode === "interactive") {
      families = ["interactive" as Family];
      if (includeDeliverables) families.push("deliverable");
    } else {
      if (mode.includes("tmp")) families.push("ephemeral");
      if (mode.includes("session")) families.push("session");
      if (mode.includes("working")) families.push("working");
      if (mode.includes("other")) families.push("other");
      // Deliverables join only when explicitly asked for, and only in a
      // full (--all) sweep; no other flag combination reaches them.
      if (includeDeliverables && mode.includes("other")) families.push("deliverable");
    }
    const deleted = await sweepRoot(root, {
      families,
      listOnly,
      assumeYes,
      keepTmp,
    });
    totalDeleted += deleted;
  }

  if (listOnly) {
    logInfo("List-only mode — nothing deleted");
  } else {
    logInfo(`Done. ${totalDeleted} file(s) deleted.`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
