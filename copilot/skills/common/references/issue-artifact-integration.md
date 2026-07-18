# Issue Artifact Integration

Use this reference when a skill needs to read, select, or republish persisted markdown artifacts stored in GitHub issue comments.

All write commands here require **explicit user confirmation** before execution. The pattern is always: draft -> show -> wait for "yes" -> run.

## Read-only issue context

Use `issue-get` for issue description/context, labels, and general metadata.

```bash
issue-get <N> --pretty
issue-get <N> | jq -r '.body'      # issue description/context
issue-get <N> | jq -r '.title'
issue-get <N> | jq -r '.labels[].name'
```

Use the issue body as source context, not as the storage location for implementation plans or other durable issue-backed artifacts unless a skill explicitly says otherwise.

## Selecting one artifact

When an issue may contain multiple artifacts of the same type, resolve exactly one before editing or reporting.

Preferred toolchain:

```bash
issue-artifact-select --issue <N> --artifact-type <TYPE> --latest --format doc-id
issue-artifact-list --issue <N> --artifact-type <TYPE> --pretty
```

Selection rules:

1. If the user provided `doc_id`, use `issue-artifact-select --issue <N> --doc-id <DOC_ID>`.
2. If exactly one artifact matches, use it.
3. If multiple artifacts match and the skill allows latest-wins behavior, use `--latest`.
4. Otherwise, show candidates and ask the user which `doc_id` to use.

If the active local working copy already carries the intended `doc_id` and the target issue/artifact relationship is already established, do not re-litigate selection with extra tool-existence checks or ad-hoc help reads. Go straight to the publish step unless a real ambiguity or command failure appears.

## Pull/edit/publish workflow

Use issue artifact comments for durable markdown persistence.

```bash
# 1. Resolve one artifact comment
issue-artifact-select --issue <N> --artifact-type <TYPE> --latest --format doc-id

# 2. Pull the current artifact to a local working copy
issue-artifact-get --issue <N> --doc-id <DOC_ID> --full | jq -r '.body' > /tmp/artifact.md

# 3. Edit the local working copy and show diff/summary in chat

# 4. Publish back to the same comment
issue-artifact-upsert --issue <N> --body-file /tmp/artifact.md
```

If the user wants the working copy stored in-repo rather than `/tmp`, write it there first and keep that file as the source of truth during the session.

When the local working copy is already the session source of truth, the minimal correct write path is `issue-artifact-upsert`. The tool automatically extracts `doc_id` from the file header. Use `issue-artifact-list` or `issue-artifact-select` only to resolve real ambiguity, not as a mandatory preflight before every save.

## Creating a new artifact identity

If the artifact file already contains a non-empty `doc_id` in `DEVENV_ARTIFACT_V1`, reuse it and publish directly:

```bash
issue-artifact-upsert --issue <N> --body-file <path-to-file>
```

Only generate a new `doc_id` when the file truly lacks one (add it to the `DEVENV_ARTIFACT_V1` header before publishing).

Publish the artifact to the issue:

```bash
issue-artifact-upsert --issue <N> --body-file <path-to-file>
```

Tool automatically extracts `doc_id` from the file header (first 256 characters). For multi-artifact issue workflows, the `doc_id` in the file header must remain stable for the same artifact so future updates target the same comment.

## Documenting discoveries and follow-up work

Use `issue-comment` for freeform discoveries or status notes that are not persisted artifacts.

```bash
issue-comment <N> --body "Discovered the retry policy already exists in lib.cs.flow.try-chain — reused it instead of building from scratch."
issue-comment <N> --body-file /tmp/discovery.md
issue-comment <N> --body-file /tmp/discovery.md --dry-run
```

Use `issue-create` for adjacent bugs or out-of-scope follow-up work the user wants tracked separately.

```bash
issue-create \
  --title "<short title>" \
  --body-file /tmp/new-issue.md \
  --type Bug \
  --label "discovered-while:#<parent-N>" \
  --parent <parent-N>
```

## Hard rules

- **Never** auto-run any write command (`issue-comment`, `issue-create`, `issue-artifact-upsert`) without explicit user confirmation in the immediately preceding turn.
- **Always** show proposed text first.
- **Use `--dry-run`** when available and there is real uncertainty about the target or payload, not as a default once the workflow is already established.
- **Surface the result** after running (issue number, comment URL, artifact `doc_id`, or conflict payload).
- **Do not rely on manual comment matching** when deterministic artifact tooling exists.
- **If duplicate `doc_id` conflict is reported, stop and ask the user which comment ID is canonical.**
- **Do not run `command -v` or ad-hoc `--help` as a publication preflight** when the wrapper and stable invocation are already documented in [`../_tools-reference.md`](../_tools-reference.md) and the workflow has already been established in the current session.
