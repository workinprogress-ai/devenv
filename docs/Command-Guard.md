# Command Guard

The command guard is a hook that looks at each terminal command an AI session is about
to run and refuses the ones that break a workspace rule, such as raw `git` mutations or
direct provider CLI calls. It catches accidents. It is not a security boundary: a
determined session can route around it, and commands hidden inside heredocs or scripts
are not visible to it.

This page is the I/O contract of the guard engine: what it reads from the host, what it
must write back, and how it must fail. The policy it enforces is data and is documented
separately; this contract does not change when the policy does.

## Why one engine must serve several hosts

Three runtimes call the same kind of hook and disagree on the details. The table is
measured, not taken from vendor documentation: the GitHub documentation was wrong for the
shared Copilot runtime, so these results define the contract.

| | Claude Code CLI | Copilot Local harness | Shared Copilot runtime |
|---|---|---|---|
| Payload keys | `session_id`, `tool_name`, `tool_input`, `hook_event_name` | `session_id`, `tool_name`, `tool_input` | `sessionId`, `toolName`, `toolArgs`, no event name |
| Terminal tool | `Bash` | `run_in_terminal` | `bash` |
| JSON deny honored | yes, only the nested `hookSpecificOutput` form | yes | **no**: the JSON is ignored and the command runs |
| Hook crash (exit 1) | **fails open**: the command runs | fails closed | **fails open**: the command runs |
| Exit 2 | denies, stderr is the reason | denies, stderr is hidden behind a generic message | denies, stderr is the reason |
| Subagent calls | `agent_id` and `agent_type` on the payload | no agent fields | `agentId`, `agentType` and `parentAgentId` |

Measured in November 2026 on Claude Code CLI 2.1.330 and the VS Code Copilot runtimes of
that date. Two consequences shape everything below:

- A hook that exits 1 on a bug silently disables the guard on two of the three hosts. The
  engine therefore never exits 1.
- No single output channel works everywhere, so every deny writes all of them at once.

## Input

The engine reads one JSON object from standard input.

- **Dialect detection.** An object with `tool_name` or `tool_input` is the snake_case
  dialect; an object with `toolName` or `toolArgs` is the camelCase dialect. Anything
  else is unrecognized.
- **Tool arguments.** In the camelCase dialect `toolArgs` is accepted both as an object
  and as a JSON-encoded string.
- **Which calls are judged.** Only terminal tools are judged: `Bash`, `run_in_terminal`
  and `bash`. The command is the string in the argument object's `command` field. Every
  other tool is allowed without inspection; file access is out of scope for this guard.
- **Subagents.** The agent fields in the table above are read for attribution only. A
  subagent's terminal calls are judged exactly like the parent's.

## Output

| Outcome | Exit code | Standard output | Standard error |
|---|---|---|---|
| Allow | `0` | empty | empty |
| Deny | `2` | one line of JSON (below) | the reason, as plain text |

The deny JSON is the nested form, written for the `PreToolUse` event in both dialects:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}
```

The reason is the same text in both channels, so whichever one the host reads, the model
sees the same message. The reason is written as an instruction that names the allowed
route first ("use `/devenv-commit`"), because hosts show it to the model verbatim and the
model follows it. It never contains a stack trace.

## Failure behavior

- **No path exits 1.** A top-level handler turns every failure into a deny with exit
  code `2` and an explanation on standard error. That covers an exception, an unhandled
  promise rejection, input that is not valid JSON, an unrecognized payload, a terminal
  call without a string `command`, and a failure while writing the output.
- **A guard defect blocks tool calls.** Denying on failure is deliberate: the alternative
  is a guard that looks installed and does nothing. The price is that a bug stops the
  session it protects, which is why installation is canary-checked and removal needs no
  AI help.
- **A missing script is a different failure.** If the host cannot start the engine at all,
  the outcome is the host's own crash behavior from the table. A canary, a command that
  must be denied, is the only way to tell a working guard from an absent one.

## Packaging

The hook script is a CommonJS file with a `.cjs` extension: the workspace `package.json`
declares `"type": "module"`, and hosts run the script directly. A single script serves
every host; there is no per-host copy.

## Policy data

Everything the guard decides on lives in one data file, `tools/guard/policy.json`, and
is validated when it loads (`tools/guard/policy-schema.cjs`). The engine and the rule
modules hold no lists of their own. The sections are:

- **provider**: the provider CLIs and API hosts to refuse, and the deny text.
- **git**: the read-only git allowlist (subcommand plus any required flags) and the git
  options that take a value, and the deny text.
- **parse**: what to do with a command the parser cannot read (`onProblem`, `deny` by
  default) and with a program name built at run time (`onDynamicProgram`, `allow` by
  default, so ordinary shell loops keep working).
- **scope** and **heredoc**: where the git rules apply and how heredocs are classified.
  These are read by the later git rules.

A malformed policy file is a deny, not a silent default (see Failure behavior).

## The command parser

Rules judge what `tools/guard/parse.cjs` resolves, not the raw text. The parser has no
dependencies and understands enough shell to see through the usual wrappers: chains,
subshells, command substitutions, `bash -c` and `eval`, wrappers such as `env`, `sudo`,
`xargs` and `find -exec`, literal scripts piped into a shell, and heredoc bodies. It
tracks `cd` so a rule can tell which directory a command runs in. Nesting is limited to
eight levels; deeper than that is a parse problem and follows `onProblem`.

## The provider rule

Forks of this workspace use different git hosts, so a session may not talk to any host
directly. The workspace wrappers (`issue-*`, `pr-*`, `project-*`, `pipelines-*`,
`release-list`) are the supported path, and they keep repo targeting and authentication
in one place.

- A program named in the policy's CLI list is refused, or refused only for the
  subcommands the entry names. There is no carve-out for sign-in: that goes through the
  workspace's provider facade.
- `curl` and `wget` are refused only when a URL's host is one of the policy's API hosts.
  A host entry covers its subdomains, and an entry with a path prefix covers only that
  path. Release downloads and web pages on a vendor's other hosts pass.
- The deny text is the policy's instruction plus what was blocked: the program name, or
  for a fetch the host. It never repeats the arguments.

## What the guard is, and is not

The guard prevents accidents: a session that reaches for a raw mutation or a provider CLI
out of habit gets a message that names the allowed route. It is not containment. A
session that is trying to get around it can, and the guard does not pretend otherwise.
Known limits:

- **Run-time construction.** A program name or URL built from a variable, a glob or a
  command substitution cannot be resolved. Dynamic program names are allowed by default
  (`onDynamicProgram`).
- **Downloaded code.** `curl ... | bash` and scripts written to disk and then run are not
  seen; only a literal script in the command text is.
- **Self-hosted and unlisted hosts.** The provider rule only knows the hosts in the
  policy. A self-hosted provider is invisible until its host is added.
- **Wrapper list.** The parser unwraps the wrappers it knows. A wrapper it does not know
  runs its payload unseen.
- **Observations are not logged yet.** Heredoc handling is in observe mode, and the
  observation sink arrives with the git rules.
- **Host coverage.** Only terminal tool calls are judged. File edits, and anything a host
  exposes through another tool, are out of scope.

## Layering policy data (design note, not built)

Today there is a single policy file. When policy data gains layers (the shipped defaults,
then organization-specific data, then data from cloned repositories), two rules are
intended and should hold when that is built:

- **Later layers override earlier ones**, in the order built-in, curated, organization,
  repository.
- **A cloned repository may only add restrictions.** Its data is outside input, so it
  must not be able to remove or loosen a deny from an earlier layer.

An organization layer is where organization-specific entries (provider CLIs, hosts) will
live. Nothing organization-specific belongs in the upstream defaults.

## The replay corpus

`tools/tests/fixtures/guard-replay.jsonl` is a scrubbed set of real commands that the
engine is run against, to confirm that ordinary work is never blocked. Every unlabelled
command must be allowed; a command labelled `"expect":"deny"` must be denied.

- **The scrub** (`tools/guard/replay-corpus.cjs`) replaces credentials, URLs, names in
  paths and long free text with shell-safe placeholders such as `__SECRET__`, and keeps
  the command's shape. The raw commands never enter the repository.
- **Names no rule can infer** (an organization, its repository naming, a person) are
  passed at extract time with `--word REGEX`; nothing organization-specific is stored in
  the tool.
- **`compare`** judges each command raw and scrubbed and lists any difference, which
  would mean the scrub changed what the guard sees.
- **Sign-off.** The corpus header carries `signedOff`, set to true only by the person
  who reviewed the extract. The conformance test fails until it is.
