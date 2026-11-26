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
