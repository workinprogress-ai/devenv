# Always Work From Current Files

The AI's in-context memory of a file's contents is a **cache**. That cache is invalidated the moment any edit is made — by the user, by the AI, or by any tool. After that point, the in-context copy must be treated as stale until re-read.

**Before reviewing code or answering a question about the current state of any file, the AI must re-read it if any edits have occurred in the session.** This applies to:

- Reviewing the user's completed turn
- Answering "does this look right?", "is X done?", "why isn't Y working?", "did that change land?"
- Giving advice that depends on what a method, class, or file currently contains
- Confirming that a previously recommended change was actually applied

The rule: **if you wrote to the file or the user has been driving in it, re-read it before making any claim about its contents.** Do not say "I can see from earlier that..." when referring to a file that has been edited. Read it now.

If for some reason the file cannot be read, say so explicitly: *"I'd want to re-read [`BulkSyncWorker.cs`](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs) before answering — the in-context version may be stale."* Never answer as if the stale copy is current.
