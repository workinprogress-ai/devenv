# Knowledge & Engineering Patterns

How Devenv skills draw on two external knowledge sources — the **Copilot knowledge** base and the **engineering patterns** repository — and how to configure both.

## The two sources

| Source | What it holds | Location | Configurable via |
|---|---|---|---|
| **Copilot knowledge** | Organization-specific implementation specifics: where things are wired, library idioms, enforced conventions — what this org *does*. Its `candidates/` area holds emerging general knowledge (practices, patterns) not yet ratified | `~/.copilot/knowledge` (symlinked clone) | `[copilot] knowledge_repo` + `knowledge_subpath` in `devenv.config` |
| **Engineering patterns repo** | Org standards, best practices, and the patterns library — officially ratified, what this org *requires*. Slow-evolving; prepared changes arrive via user-approved PRs from `/devenv-design-discussion` (the only skill with this power) | Sibling clone under `repos/<name>/` (docs under `docs/`, e.g. `docs/Standards/`) | `[copilot] engineering_repo` in `devenv.config` |

Knowledge authority flows through a maturity pipeline: **discovered** (knowledge repo `candidates/` — emerging practices and patterns not yet proven, consulted with skepticism) → **exercised in real sessions** → **ratified** (merged into the engineering repo). [`/devenv-design-discussion`](../copilot/skills/devenv-design-discussion/SKILL.md) is the one skill empowered to prepare changes to the engineering repo — new entries and edits, from proposal issues or settled session discoveries — on a branch with the diff shown for approval, surfaced as a PR; the user's merge is the ratification, and no other skill writes there. Nothing gains authority until merged: a PR is invisible to read-side lookups, which see only the clone.

The engineering repo name is **devenv-configurable** so forks are not forced to use a hard-coded name:

```ini
[copilot]
engineering_repo=docs.engineering
```

Skills resolve it at runtime with:

```bash
config-read copilot engineering_repo
```

## Where skills use them

| Skill | Copilot knowledge | Engineering patterns |
|---|---|---|
| `/devenv-create-blueprint` | Consulted during the context survey — component/context specifics ground system-level decisions | Consulted — standards constrain architecture choices |
| `/devenv-grooming` | Consulted — implementation specifics shape the attack plan | Consulted — practices that must apply become explicit grooming details |
| `/devenv-create-plan` | Consulted — plans declare which org patterns a phase applies | Consulted |
| `/devenv-design-discussion` | As needed | Consulted — patterns are forces on option trade-offs |
| `/devenv-pair-programming` | **Applied** — implementation guidance as tasks touch org specifics | As needed |
| `/devenv-delegation` | **Applied** — same as pair, driving autonomous execution | As needed |

## Behavior

- **Background input, not a phase.** Lookups never add interview questions or block progression. If a source is missing (not cloned, key not configured), the skill notes it in one line and continues.
- **Contribution is gated.** Adding to copilot knowledge goes through the knowledge distillation flow (explicit user approval, user commits). Emerging general knowledge — practices and engineering patterns discovered in sessions — goes through the knowledge extraction flow: settled content is prepared by `/devenv-design-discussion` as a PR to the engineering repo (its exclusive write power); undecided content stages in the `candidates/` area.
- **Cited when material.** When a knowledge entry or a standard materially shapes a decision, skills cite it (file + section) so the trail is followable.
- **Conflicts surface.** If a standard conflicts with a design choice, the conflict is surfaced explicitly rather than silently resolved.

## The shared protocol

The governing rules live in [`copilot/skills/common/references/knowledge-lookup-protocol.md`](../copilot/skills/common/references/knowledge-lookup-protocol.md) (read side), mirrored by the knowledge distillation protocol (write side for org-specific specifics) and the knowledge extraction protocol (write side for emerging general knowledge: practices and patterns → `candidates/`) in the same folder. Skill files reference the protocols rather than duplicating their text.

## Related configuration

See [Devenv Customization](./Devenv-Customization.md) for the full `[copilot]` section reference, including `knowledge_repo` and `knowledge_subpath`.
