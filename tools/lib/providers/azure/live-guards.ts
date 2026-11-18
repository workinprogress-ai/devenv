// live-guards.ts — pure helpers of the Azure live smoke suite (smoke.ts). They
// touch no backend, so unit tests can import them; the suite itself cannot be
// imported without running.
import { ProviderError } from "../provider-core.ts";

/** True for the transport's not-found error: a ProviderError carrying HTTP 404
 * for the item itself. A 404 that says the project or organization does not
 * exist (a wrong project in the URL) is not "already gone", and neither is
 * anything else (auth, validation, 5xx, a network failure). */
export function isNotFound(error: unknown): boolean {
  if (!(error instanceof ProviderError) || error.status !== 404) return false;
  // Anchored on the project-level messages: a work item's own not-found text
  // also says "or it is in a project that does not exist".
  return !/TF200016|The following project does not exist/i.test(error.message);
}

/** Await a delete call; a not-found response means the item is already gone,
 * every other error propagates so teardown reports it. */
export async function ignoreNotFound(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** Run every delete attempt in order (a repository delete has several
 * variants and Azure rejects some of them depending on its state). The cleanup
 * succeeded when at least one attempt succeeded or found the item already
 * gone; when none did, the first error is thrown. */
export async function settleDeleteAttempts(attempts: Array<() => Promise<unknown>>): Promise<void> {
  let succeeded = false;
  let firstError: unknown;
  for (const attempt of attempts) {
    try {
      await attempt();
      succeeded = true;
    } catch (e) {
      if (isNotFound(e)) succeeded = true;
      else if (firstError === undefined) firstError = e;
    }
  }
  if (!succeeded) throw firstError ?? new Error("no delete attempt was made");
}
