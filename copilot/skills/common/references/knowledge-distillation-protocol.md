# Knowledge Distillation Protocol

Shared protocol for capturing organization-specific implementation lessons into the copilot knowledge repo — any skill may follow it on explicit request; `/devenv-pair-programming` and `/devenv-delegation` carry its explicit closeout wiring: capture when the user explicitly asks to distill the session or calls out a point to add. Never offer distillation unprompted — proactive offers are deferred to the offer-gating design tracked in the devenv repo.

## The knowledge bar

Copilot knowledge holds **organization-specific implementation specifics** — how this organization's code, libraries, and conventions work. Two shapes dominate:

- **Placement/wiring specifics** — "dependency injection registrations go in `Program.cs`", "repository factories are registered in the dependency builder wiring", "API operation implementations live flat under `src/Service/`".
- **Library idioms and gotchas** — "multi-result queries return `ICursor<T>` from the cursor builder's `Create()`; the caller materializes", "pin index-backed queries with `WithHint` using a named const shared with the index-creating bootstrap".

**In scope:**

- Where things go and how things are wired in this organization's repos.
- Idioms, invariants, and failure modes of this organization's libraries (`repos/lib.cs.*`, `repos/pkg-*`).
- Naming, namespace, and layout conventions this organization enforces.
- Testing conventions specific to the organization's framework.

**Out of scope:**

- Procedural workflow rules ("always run tests when a phase ends") — those live in skills and plans.
- Generic software-engineering wisdom any engineer or model already knows.
- One-off facts about a single task with no recurrence value.

Rule of thumb: *would a competent engineer new to this organization benefit, and is it specific to this organization's practices or libraries?* Both, or it doesn't go in.

## Where knowledge lives

The knowledge repo is configured in `devenv.config` under `[copilot]` (`knowledge_repo`, `knowledge_subpath`); in this workspace that resolves to `repos/docs.copilot-knowledge`, content under `copilot-knowledge/` (e.g. `component-context/`). If the repo is not present under `repos/`, do not guess at another location — surface the gap and ask the user to clone it.

Placement within the knowledge files:

- Match an existing file and section first (service wiring → the service implementation reference's wiring/lessons sections; cross-cutting C# → the general C# file; plugin usage → the plugins file).
- Follow the target file's existing bullet style and granularity.
- Create a new file/section only when nothing fits, and update that folder's `index.md` in the same change so the load policy stays accurate.

## Detection pattern (session mining — runs on explicit request only)

Scan the session for moments where organization-specific truth was learned:

- The user corrected an AI assumption about org practice ("no, that registration goes in `Program.cs`").
- A framework/library behavior was discovered by reading `repos/lib.cs.*` / `repos/pkg-*` sources or by debugging.
- A convention was applied that is not written anywhere the session read.
- The user affirmed a pattern as "that's how we do it here".

Each candidate must pass the knowledge bar above. Expect few — most sessions yield zero or one.

## Procedure (both modes)

1. **Collect candidates.**
   - *Session-mining mode (explicit request only):* the user asks to distill this session; mine the session per the detection pattern.
   - *Explicit-callout mode:* the user names the point (mid-session or at wrap-up); use it as the sole candidate — do not mine the conversation for more.
2. **Present a summary in chat:** each candidate as a one-line bullet plus its proposed target file/section. State that the user reviews and approves before anything is written, and that the user commits the knowledge repo.
3. **On approval (subset or edited):** apply the additions to the knowledge files, matching existing style.
4. **Hand back for review/commit:** show what changed (file links) and state the commit is the user's. Never commit the knowledge repo.

Nothing is written to the knowledge repo without explicit approval of the specific additions; silence is not approval.
