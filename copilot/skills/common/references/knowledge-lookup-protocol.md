# Knowledge & Engineering-Pattern Lookup Protocol

Shared protocol for the **read side** of the two external-knowledge sources that inform design and planning work — the mirror of the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md), which is the write side.

Two sources exist:

1. **Copilot knowledge** (`~/.copilot/knowledge`) — organization-specific implementation specifics: where things are wired, library idioms, enforced conventions. What this org *does*. Its `candidates/` area additionally holds emerging general knowledge (practices, patterns) not yet ratified — see below.
2. **Engineering patterns repo** — org standards, best practices, coding standards, and guidelines. What this org *requires*. Skills read the canonical import at `~/.copilot/engineering` (machine-managed; never hard-code or hand-clone). The repo's *name* for GitHub operations (issues, PRs) resolves via `config-read copilot engineering_repo_name` (default `docs.engineering`); modifications happen in the `repos/<that name>/` clone.

**Candidate entries (`candidates/` area of copilot knowledge).** Entries under `candidates/` carry `Status: candidate` — they are emerging general practices/patterns captured from sessions and *not yet ratified* into the engineering repo. Read them **consult-with-skepticism**: they may inform a design the way an experienced colleague's opinion would, but never treat them as org standard, never cite them as a requirement, and weigh them against the engineering repo's ratified content when both touch the same decision. Their write side is the [Knowledge Extraction Protocol](knowledge-extraction-protocol.md); graduation into the engineering repo happens only via the user's issue/PR to that repo.

## Per-skill lookup intensity

| Skill | Copilot knowledge | Engineering patterns | When |
|---|---|---|---|
| `/devenv-create-blueprint` | **Consult** — component/context specifics ground system-level decisions | **Consult** — standards constrain architecture choices | During context survey and architecture phases |
| `/devenv-grooming` | **Consult** — implementation specifics shape the attack plan | **Consult** — practices that must be applied become explicit grooming details | During grooming-document construction and issue attack-plan writing |
| `/devenv-create-plan` | **Consult** — plans should declare which org patterns/practices a phase applies | **Consult** | During phase/task drafting |
| `/devenv-design-discussion` | As needed | **Consult** — patterns weigh on option trade-offs | When weighing options |
| `/devenv-pair-programming` | **Apply** — implementation guidance for the work at hand | **Apply** — implement per org standards, including the [Design-Principles adherence](#design-principles-adherence-executor-behavior) rules | While implementing |
| `/devenv-delegation` | **Apply** — same as pair; the run must implement per org specifics | **Apply** — same as pair | While implementing |

("Apply" means the knowledge directly shapes code being written; "consult" means it informs documents and decisions.)

**Candidates modifier (applies to every consult/apply above).** When a lookup touches the knowledge repo's `candidates/` area, entries there are read **consult-with-skepticism** regardless of the cell's verb — see the candidate-entries paragraph under *Two sources exist* above. A candidate never carries the authority of the main body or the engineering repo.

## Design-Principles adherence (executor behavior)

The engineering repo's `Standards/Design-Principles/` library — index at `~/.copilot/engineering/Standards/Design-Principles/README.md` — carries ratified design principles (SOLID centerpiece plus companions), each with an adherence level. At apply intensity (both execution skills) these are implementation constraints, not optional reading:

- **The index table is the operative reference.** Levels: **REQUIRED** (violation only with explicit user approval *before* the code lands), **PREFERRED** (deviation allowed with stated reasoning, surfaced in the handback), **ADVISORY** (weigh during design; note when deliberately countermanded).
- **REQUIRED violation you believe is the right way forward → permission gate before landing**, in this fixed order: the principle's one-line definition → a navigable link to its page → the violation and your reasoning → the ask. An unapproved REQUIRED violation does not land — same lifecycle as an unapproved workaround ([workaround decision policy](workaround-decision-policy.md)).
- **Navigable-link rule:** any handback, review finding, or permission gate naming a principle links the principle's page (workspace-relative form: `[P05 — Dependency Inversion](repos/docs.engineering/docs/Standards/Design-Principles/P05-dependency-inversion.md)`; canonical read path is `~/.copilot/engineering/...`) and quotes the definition *before* the ask. A user should never have to approve what they cannot click through to understand.
- **Always in force, never redeclared.** Plans and tasks do not copy principle text; a phase may note a deliberate tension when the plan itself sanctions the deviation.
- **Before proposing any deviation, read the principle page's "When it does not apply" section** — most false violations dissolve there.

---

## Procedure

1. **Resolve sources.** Copilot knowledge is linked at `~/.copilot/knowledge`; engineering patterns at `~/.copilot/engineering` — both are machine-managed imports (bootstrap clone + `--ff-only` container-start pull). If either link is absent, surface it in one line with the fix (`devenv.config [copilot] engineering_repo` + bootstrap, or `repo-get <name>` for the repos/ working clone) and proceed — absence is not a blocker, but an engineering-repo lookup that returns no source must not silently pass as "no standards found".
2. **Scope the lookup.** Read the relevant index/section first (`index.md` for knowledge; the standards `Index.md` for engineering patterns); drill into documents only where they intersect the current design or task. Do not bulk-read either source.
3. **Cite what you used.** When a knowledge entry or engineering standard materially shaped a decision, cite it (file + section) in the artifact or conversation — downstream skills and the user should be able to follow the trail.
4. **Contributions flow through the write side.** If a session learns something that belongs in either source, capture it via the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md) (knowledge) or an upstream-impact issue (engineering standards) — never edit these sources as a side effect of a design or execution session.

## Boundaries

- Lookup is a **background input**, not a phase: it never adds interview questions or blocks progression. If a source is missing, note and continue.
- Engineering standards are **constraints, not suggestions**: when one conflicts with a design choice, surface the conflict explicitly rather than silently picking a side.
- Generic engineering wisdom that lives in neither source is out of scope — do not pad lookups with general knowledge.
