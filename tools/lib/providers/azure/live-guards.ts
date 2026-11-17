// live-guards.ts — pure helpers of the Azure live smoke suite (smoke.ts). They
// touch no backend, so unit tests can import them; the suite itself cannot be
// imported without running.
import { ProviderError } from "../provider-core.ts";

/** True for the transport's not-found error: a ProviderError carrying HTTP 404.
 * Nothing else (auth, validation, 5xx, a network failure) counts as absent. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ProviderError && error.status === 404;
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
