// github/transport.ts — the gh CLI transport (REST/GraphQL, sync + async +
// paginated). Split out of provider-core per the provider-core split plan:
// provider-core keeps detection, repo targeting, capability gates, and
// provider-neutral errors; this module is the GitHub-only wire (the
// `provider_api` analogue, explicitly not part of the cross-provider
// contract). gh's token handling is the credential store here: nothing in
// this module reads GH_TOKEN itself (auth seam preserved — gh resolves its
// own auth, exactly as every bash verb does today).
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

import { execFileSync } from "node:child_process";
import { ProviderError } from "../provider-core.ts";

export interface GhResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface GhOptions {
  /** Stdin fed to gh (the `-` body-file convention). */
  input?: string;
  /** Extra env (e.g. GH_REPO for set-type). */
  env?: Record<string, string>;
  /** Working directory for the gh invocation (cwd-inferred repo views). */
  cwd?: string;
  /** Tolerated failure: return the result instead of throwing on non-zero. */
  tolerateFailure?: boolean;
}

function ghArgs(args: string[]): string[] {
  return ["gh", ...args];
}

/** gh REST/GraphQL transport. Throws ProviderError naming gh's stderr on
 * failure. */
export async function ghApi(args: string[], opts: GhOptions = {}): Promise<GhResult> {
  const { run } = await import("../../core/spawn.ts");
  const result = await run(ghArgs(args), {
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  if (result.status !== 0 && !opts.tolerateFailure) {
    // Name the gh subcommand ("issue list", "api graphql"), not just the
    // command family, so the failure points at the verb that failed.
    const sub = args.slice(0, 2).join(" ");
    throw new ProviderError(
      `gh ${sub} failed (exit ${result.status})` +
        (result.stderr.trim() ? `: ${result.stderr.trim().split("\n")[0]}` : ""),
    );
  }
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 };
}

/** Synchronous gh transport for the shared internal helpers (node-id
 * resolution etc.) — same failure contract as ghApi. */
export function ghApiSync(args: string[], opts: GhOptions = {}): GhResult {
  try {
    const stdout = execFileSync("gh", args, {
      encoding: "utf8",
      input: opts.input,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (opts.tolerateFailure) {
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
    }
    const sub = args.slice(0, 2).join(" ");
    throw new ProviderError(
      `gh ${sub} failed (exit ${e.status ?? "spawn"})` +
        (e.stderr && e.stderr.trim() ? `: ${e.stderr.trim().split("\n")[0]}` : ""),
    );
  }
}

/** Paginated GET for REST surfaces that page (comments lists etc.). */
export async function ghApiPaginate(args: string[]): Promise<GhResult> {
  return ghApi([...args, "--paginate"]);
}
