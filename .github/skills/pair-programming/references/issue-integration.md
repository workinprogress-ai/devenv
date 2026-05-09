# Issue Integration — CLI Cheatsheet

All commands here require **explicit user confirmation** before execution. The pattern is always: draft → show → wait for "yes" → run.

## `issue-get` — load an issue

Read-only. Safe to run without confirmation when the user has already told us the issue number.

```bash
issue-get <N> --pretty
```

Output is JSON with: `number`, `title`, `body`, `state`, `labels`, `assignees`, `milestone`, `author`, `createdAt`, `updatedAt`, `closedAt`, `url`, `comments`.

Common follow-ups:
```bash
issue-get <N> | jq -r '.body'              # just the description (where the plan usually lives)
issue-get <N> | jq -r '.title'
issue-get <N> | jq -r '.labels[].name'
```

For unfamiliar flags, run `issue-get --help`.

## `issue-comment` — document discoveries

**Confirmation required** every time.

```bash
# Inline (short comments)
issue-comment <N> --body "Discovered the retry policy already exists in lib.cs.flow.try-chain — reused it instead of building from scratch."

# From a file (longer / multi-paragraph)
issue-comment <N> --body-file /tmp/discovery.md

# Dry-run first if unsure
issue-comment <N> --body-file /tmp/discovery.md --dry-run
```

For unfamiliar flags, run `issue-comment --help`.

### When to offer a comment

- A non-obvious design decision was made (record the *why*).
- A plan assumption turned out wrong.
- A new follow-up / out-of-scope finding emerged.
- A bug was discovered in adjacent code.

### Confirmation flow

1. Draft the comment text. For anything beyond ~3 lines, write to a temp file and reference it.
2. Show the full text in chat.
3. Ask: *"Post this as a comment on issue #N?"*
4. Wait for explicit "yes".
5. Run the command.

## `issue-create` — file a follow-up issue

Use for **adjacent bugs** discovered during pair work, or out-of-scope features the user wants tracked.

The flag set is rich; **run `issue-create --help` to compose the exact command** for the situation. Common shape:

```bash
issue-create \
  --title "<short title>" \
  --body-file /tmp/new-issue.md \
  --type Bug \
  --label "discovered-while:#<parent-N>" \
  --parent <parent-N>           # if linking under an epic/story
```

### Confirmation flow

1. Draft title + body.
2. Show in chat.
3. Ask: *"File this as a new issue? (will run `issue-create ...`)"*
4. Wait for "yes".
5. Run.
6. Report back the new issue number.

## `issue-update` — push plan progress to the issue

Only when the user **asks** for a progress update on a plan that lives in the issue body.

```bash
# 1. Pull the current body
issue-get <N> | jq -r '.body' > /tmp/issue-body.md

# 2. Edit checkboxes (`- [ ]` → `- [x]`) for approved tasks
#    (use replace_string_in_file or similar)

# 3. Show the diff in chat, get approval

# 4. Push it back
issue-update <N> --body-file /tmp/issue-body.md
```

For unfamiliar flags, run `issue-update --help`.

## Hard rules

- **Never** auto-run any of the write commands (`issue-comment`, `issue-create`, `issue-update`) without explicit user confirmation in the immediately preceding turn.
- **Always** show the proposed text first.
- **Use `--dry-run`** when available and there's any uncertainty.
- **Surface the result** after running (new issue number, comment URL if available, etc.).
