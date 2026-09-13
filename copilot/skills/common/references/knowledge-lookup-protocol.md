# Knowledge & Engineering-Pattern Lookup Protocol

Shared protocol for the **read side** of the two external-knowledge sources that inform design and planning work — the mirror of the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md), which is the write side.

Two sources exist:

1. **Copilot knowledge** (`~/.copilot/knowledge`) — organization-specific implementation specifics: where things are wired, library idioms, enforced conventions. What this org *does*.
2. **Engineering patterns repo** (`repos/<engineering_repo>`) — org standards, best practices, coding standards, and guidelines. What this org *requires*. The repo name is devenv-configurable — read it with `config-read copilot engineering_repo` (default `docs.engineering`); never hard-code the name.

## Per-skill lookup intensity

| Skill | Copilot knowledge | Engineering patterns | When |
|---|---|---|---|
| `/devenv-create-blueprint` | **Consult** — component/context specifics ground system-level decisions | **Consult** — standards constrain architecture choices | During context survey and architecture phases |
| `/devenv-grooming` | **Consult** — implementation specifics shape the attack plan | **Consult** — practices that must be applied become explicit grooming details | During grooming-document construction and issue attack-plan writing |
| `/devenv-create-plan` | **Consult** — plans should declare which org patterns/practices a phase applies | **Consult** | During phase/task drafting |
| `/devenv-design-discussion` | As needed | **Consult** — patterns weigh on option trade-offs | When weighing options |
| `/devenv-pair-programming` | **Apply** — implementation guidance for the work at hand | As needed | While implementing |
| `/devenv-delegation` | **Apply** — same as pair; the run must implement per org specifics | As needed | While implementing |

("Apply" means the knowledge directly shapes code being written; "consult" means it informs documents and decisions.)

## Procedure

1. **Resolve sources.** Copilot knowledge is linked at `~/.copilot/knowledge` (see the distillation protocol's placement rules for its layout). Engineering patterns: `config-read copilot engineering_repo` → sibling clone at `repos/<name>/` (docs under `docs/` — e.g. `docs/Standards/`). If either source is absent, note it in one line and proceed — absence is not a blocker.
2. **Scope the lookup.** Read the relevant index/section first (`index.md` for knowledge; the standards `Index.md` for engineering patterns); drill into documents only where they intersect the current design or task. Do not bulk-read either source.
3. **Cite what you used.** When a knowledge entry or engineering standard materially shaped a decision, cite it (file + section) in the artifact or conversation — downstream skills and the user should be able to follow the trail.
4. **Contributions flow through the write side.** If a session learns something that belongs in either source, capture it via the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md) (knowledge) or an upstream-impact issue (engineering standards) — never edit these sources as a side effect of a design or execution session.

## Boundaries

- Lookup is a **background input**, not a phase: it never adds interview questions or blocks progression. If a source is missing, note and continue.
- Engineering standards are **constraints, not suggestions**: when one conflicts with a design choice, surface the conflict explicitly rather than silently picking a side.
- Generic engineering wisdom that lives in neither source is out of scope — do not pad lookups with general knowledge.
