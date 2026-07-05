# Issue-backed artifact edit protocol

Use this protocol whenever a skill must modify an artifact that already lives in a GitHub issue body or issue comment.

## Goal

Keep GitHub issue artifacts editable, reviewable, and stable by treating GitHub as the publication target rather than the live editing surface.

## Required workflow

1. **Pull locally first**
   - Materialize the issue-backed artifact to a local working copy before editing.
   - The working copy may live:
     - in the target repo, when that artifact naturally belongs there, or
     - in a temp folder, when no repo-local file should be created.
   - If the location is not already implied by the skill, ask the user which they want.

2. **Edit the local working copy**
   - Do all refinement, iteration, and draft convergence locally.
   - Do not repeatedly edit the issue body/comment directly during the working session.
   - Treat the local working copy as the session source of truth.

3. **Republish to the original location**
   - After the artifact is ready, push the local working copy back to the original issue body or issue comment.
   - Use the repo wrappers / artifact tooling when available (`issue-update`, `issue-artifact-upsert`, etc.).

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
- After publication: the issue-hosted artifact becomes the published copy again.
- If both exist, the skill should make clear which one is currently authoritative for the session.

## Typical applications

- Implementation plan stored in a GitHub issue body
- Grooming/design artifact stored in a GitHub issue comment
- Any other persisted markdown artifact republished into an issue thread
