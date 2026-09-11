# Issue-backed artifact edit protocol

Use this protocol whenever a skill must modify an artifact that already lives in a GitHub issue comment (or a legacy issue body artifact being migrated).

## Goal

Keep GitHub issue artifacts editable, reviewable, and stable by treating GitHub as the publication target rather than the live editing surface.

## Required workflow

1. **Pull locally first**
   - Materialize the issue-backed artifact to a local working copy before editing.
   - The working copy lives under `.local-artifacts/` at the target repo root (the [standard local markdown folder](../../_conventions.md#standard-local-markdown-folder-local-artifacts)). A temp folder is acceptable only when the user explicitly asks for one.
   - If the issue may contain more than one artifact of the same type, resolve the canonical one first with `issue-artifact-select` or `issue-artifact-list`, then load it with `issue-artifact-get`.

2. **Edit the local working copy**
   - Do all refinement, iteration, and draft convergence locally.
   - Do not repeatedly edit the issue body/comment directly during the working session.
   - Treat the local working copy as the session source of truth.

3. **Republish to the original location**
   - After the artifact is ready, push the local working copy back to the original issue comment artifact.
   - Use deterministic artifact tooling (`issue-artifact-get`, `issue-artifact-list`, `issue-artifact-select`, `issue-artifact-upsert`) instead of ad-hoc comment matching.
   - Do not use `mcp_gitkraken_*` tools for artifact publication, and do not use generic `issue-comment` as the write path for a persisted artifact.
   - Once the correct `doc_id`, local working copy, and target issue are already established, publish directly with `issue-artifact-upsert`; do not add routine tool-existence checks, ad-hoc `--help`, or a default dry-run unless a real ambiguity or failure appears.

4. **Offer to retire the working copy**
   - After publication the issue-hosted artifact is again the sole source of truth; the local file is disposable.
   - Offer (y/n) to delete the local working copy — during the same session if the session's work on the artifact is done, otherwise at the next wrap-up point (phase completion handback, session handoff). Never auto-delete.

## Revision history

- Record one revision-history entry per user-visible editing effort.
- Do not add a separate revision-history entry for each intermediate draft/iteration while converging locally.
- The revision log should describe the final net effect of the effort, not the path taken through internal drafts.

For semantic clarification or question-resolution edits, include the semantic delta in the revision reason (for example: lane semantics, ownership boundary, failure mode, scope exclusion).

## Decision-package parity (required for semantic updates)

When a semantic decision is resolved or clarified, apply updates as one decision package:

1. Decision source text (for example, confirmed decision row)
2. Matched question state/text (resolved or pending)
3. Revision-history reason for the semantic change

Before reporting completion, verify parity across decision and question text for:

- lifecycle lane coverage
- ownership boundary
- failure mode
- scope exclusions/non-goals

If parity is missing in any dimension, keep the artifact in progress and reconcile before closing.

If the artifact changed concurrently during iteration, run one final section-level reread of the touched decision/question sections and repeat parity verification before publication.

## Source-of-truth rule

- During editing: the local working copy is authoritative.
- After publication: the issue-hosted artifact becomes the published copy again, and the local working copy is disposable.
- If both exist, the skill must make clear which one is currently authoritative for the session, and offer to retire the local copy at the next wrap-up point.

## Typical applications

- Plan stored in a GitHub issue comment artifact (working copy: `.local-artifacts/Plan-issue-<N>-*.md`)
- Grooming/design artifact stored in a GitHub issue comment (working copy: `.local-artifacts/Grooming-*.md`)
- Any other persisted markdown artifact republished into an issue thread
