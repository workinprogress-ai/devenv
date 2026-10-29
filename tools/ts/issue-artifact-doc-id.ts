#!/usr/bin/env node
// issue-artifact-doc-id.ts - Generate deterministic artifact doc_id values
// Version: 1.1.0
// Description: Builds stable doc_id strings for issue artifact comments.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// doc_id identity is byte-format-critical: `dv1:<owner>/<repo>:issue-<N>:
// <artifact_type>:<slug>` — the normalizers here are exact ports of
// issue-operations.bash's (normalize_doc_id_slug/repo, generate_artifact_
// doc_id), including the implementation-plan → plan canonicalization.

import { parseArgs } from "node:util";
import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-artifact-doc-id.ts");

const ARTIFACT_TYPES = [
  "spike", "research", "redesign", "design", "blueprint", "requirements",
  "specifications", "grooming", "roadmap", "plan", "implementation-plan",
  "solution-proposal",
] as const;

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

Generate a deterministic doc_id in this format:
  dv1:<owner>/<repo>:issue-<number>:<artifact_type>:<slug>

Required Inputs:
  --issue N                    Issue number
  --artifact-type TYPE         One of: ${ARTIFACT_TYPES.join(", ")}

Slug Source (exactly one required):
  --slug TEXT                  Slug source text (normalized to kebab-case)
  --source-file FILE           Use basename of file (without extension)

Optional:
  --repo OWNER/REPO            Override repository (default: DEVENV_REPO or current git repo)
  -V, --verbose                Enable verbose logging
  -h, --help                   Show help
  -v, --version                Show version

Examples:
  ${SCRIPT_NAME} --issue 123 --artifact-type spike --slug "retry strategy"
  ${SCRIPT_NAME} --issue 123 --artifact-type redesign --source-file Redesign--001.md
  ${SCRIPT_NAME} --issue 123 --artifact-type plan --slug "Plan-issue-123-001" --repo <org>/<repo>
`);
  process.exit(0);
}

/** Kebab-case normalization, faithful to normalize_doc_id_slug: lowercase,
 * non-alphanumerics collapse to single dashes, edge dashes stripped. */
export function normalizeDocIdSlug(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-+/g, "-");
  if (slug === "") {
    logError("Slug cannot be empty after normalization");
    return null;
  }
  return slug;
}

/** owner/repo shape validation, faithful to normalize_doc_id_repo: the
 * slash is part of the enforced doc_id format and is preserved. */
export function normalizeDocIdRepo(repo: string): string | null {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    logError(`Invalid repository format: ${repo} (expected owner/repo, or project/repo on Azure)`);
    return null;
  }
  return repo;
}

/** The doc_id builder, faithful to generate_artifact_doc_id: type whitelist,
 * slug/repo normalization, and the implementation-plan → plan canonicalization
 * (accepted as input, never emitted). */
export function generateArtifactDocId(
  issueNumber: string,
  artifactType: string,
  slug: string,
  ownerRepo: string,
): string | null {
  if (!/^[0-9]+$/.test(issueNumber) || issueNumber === "") {
    logError(`Invalid issue number: '${issueNumber}'`);
    return null;
  }
  if (!(ARTIFACT_TYPES as readonly string[]).includes(artifactType)) {
    logError(`Invalid artifact type: ${artifactType}`);
    logError(`Allowed values: ${ARTIFACT_TYPES.join(", ")}`);
    return null;
  }
  const normalizedSlug = normalizeDocIdSlug(slug);
  if (normalizedSlug === null) return null;
  const normalizedRepo = normalizeDocIdRepo(ownerRepo);
  if (normalizedRepo === null) return null;
  const type = artifactType === "implementation-plan" ? "plan" : artifactType;
  return `dv1:${normalizedRepo}:issue-${issueNumber}:${type}:${normalizedSlug}`;
}

interface Parsed {
  help: boolean;
  version: boolean;
  verbose: boolean;
  issue: string;
  artifactType: string;
  slug: string;
  sourceFile: string;
  repo: string;
}

function parseCliArgs(argv: string[]): Parsed {
  let parsed: Parsed;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        issue: { type: "string" },
        "issue-number": { type: "string" },
        "issue_number": { type: "string" },
        "artifact-type": { type: "string" },
        "artifact_type": { type: "string" },
        slug: { type: "string" },
        "source-file": { type: "string" },
        "source_file": { type: "string" },
        repo: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    parsed = {
      help: Boolean(values["help"]),
      version: Boolean(values["version"]),
      verbose: Boolean(values["verbose"]),
      issue: values["issue"] ?? values["issue-number"] ?? values["issue_number"] ?? "",
      artifactType: values["artifact-type"] ?? values["artifact_type"] ?? "",
      slug: values["slug"] ?? "",
      sourceFile: values["source-file"] ?? values["source_file"] ?? "",
      repo: values["repo"] ?? "",
    };
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_MISUSE);
  }
  return parsed;
}

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.help) showUsage();
  if (args.version) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (args.issue === "") {
    logError("issue number is required (--issue)");
    return EXIT_MISUSE;
  }
  if (args.artifactType === "") {
    logError("artifact type is required (--artifact-type)");
    return EXIT_MISUSE;
  }
  if (args.slug === "" && args.sourceFile === "") {
    logError("One slug source is required: --slug or --source-file");
    return EXIT_MISUSE;
  }
  if (args.slug !== "" && args.sourceFile !== "") {
    logError("Only one of --slug or --source-file may be specified");
    return EXIT_MISUSE;
  }

  let slug = args.slug;
  if (args.sourceFile !== "") {
    slug = basename(args.sourceFile).replace(/\.[^.]*$/, "");
  }

  const ownerRepo = requireRepoTarget(providerRepoTarget(args.repo === undefined ? "" : args.repo), "issue-artifact-doc-id", "issues");
  if (ownerRepo === "") {
    logError("Repository is required: pass --repo or set DEVENV_REPO");
    return EXIT_MISUSE;
  }

  const docId = generateArtifactDocId(args.issue, args.artifactType, slug, ownerRepo);
  if (docId === null) return EXIT_MISUSE;
  console.log(docId);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
