# Knowledge & Engineering Patterns

How Devenv skills draw on two external knowledge sources — the **Copilot knowledge** base and the **engineering patterns** repository — and how to configure both.

## The two sources

| Source | What it holds | Location | Configurable via |
|---|---|---|---|
| **Copilot knowledge** | Organization-specific implementation specifics: where things are wired, library idioms, enforced conventions — what this org *does*. Its `candidates/` area holds emerging general knowledge (practices, patterns) not yet ratified | `~/.copilot/knowledge` (symlinked clone) | `[copilot] knowledge_repo` + `knowledge_subpath` in `devenv.config` |
| **Engineering patterns repo** | Org standards, best practices, and the patterns library — officially ratified, what this org *requires*. Slow-evolving; prepared changes arrive via user-approved PRs from `/devenv-design-discussion` (the only skill with this power) | `~/.copilot/engineering` (symlinked clone; canonical checkout at `copilot/engineering/`) | `[copilot] engineering_repo` + `engineering_subpath` in `devenv.config` |

Knowledge authority flows through a maturity pipeline: **discovered** (knowledge repo `candidates/` — emerging practices and patterns not yet proven, consulted with skepticism) → **exercised in real sessions** → **ratified** (merged into the engineering repo). [`/devenv-design-discussion`](../copilot/skills/devenv-design-discussion/SKILL.md) is the one skill empowered to prepare changes to the engineering repo — new entries and edits, from proposal issues or settled session discoveries — on a branch with the diff shown for approval, surfaced as a PR; the user's merge is the ratification, and no other skill writes there. Nothing gains authority until merged: a PR is invisible to read-side lookups, which see only the clone.

The engineering repo is imported with the same machinery as knowledge, so the standards are guaranteed present and fresh:

```ini
[copilot]
engineering_repo=https://github.com/workinprogress-ai/docs.engineering.git
engineering_subpath=docs/
# Legacy key retained for fork compatibility (the repos/ clone used for modifications):
engineering_repo_name=docs.engineering
```

Skills read the standards at runtime from `~/.copilot/engineering/...`; the repo's name for GitHub operations (issues, PRs) resolves with `config-read copilot engineering_repo_name`.

## Where skills use them

| Skill | Copilot knowledge | Engineering patterns |
|---|---|---|
| `/devenv-create-blueprint` | Consulted during the context survey — component/context specifics ground system-level decisions | Consulted — standards constrain architecture choices |
| `/devenv-grooming` | Consulted — implementation specifics shape the attack plan | Consulted — practices that must apply become explicit grooming details |
| `/devenv-create-plan` | Consulted — plans declare which org patterns a phase applies | Consulted |
| `/devenv-design-discussion` | As needed | Consulted — patterns are forces on option trade-offs |
| `/devenv-pair-programming` | **Applied** — implementation guidance as tasks touch org specifics | **Applied** — implement per org standards, including the Design-Principles library with its REQUIRED/PREFERRED/ADVISORY adherence levels |
| `/devenv-delegation` | **Applied** — same as pair, driving autonomous execution | **Applied** — same as pair |

## Behavior

- **Background input, not a phase.** Lookups never add interview questions or block progression. If a source is missing (not cloned, key not configured), the skill notes it in one line and continues.
- **Contribution is gated.** Adding to copilot knowledge goes through the knowledge distillation flow (explicit user approval, user commits). Emerging general knowledge — practices and engineering patterns discovered in sessions — goes through the knowledge extraction flow: settled content is prepared by `/devenv-design-discussion` as a PR to the engineering repo (its exclusive write power); undecided content stages in the `candidates/` area.
- **Cited when material.** When a knowledge entry or a standard materially shapes a decision, skills cite it (file + section) so the trail is followable.
- **Conflicts surface.** If a standard conflicts with a design choice, the conflict is surfaced explicitly rather than silently resolved.

## The shared protocol

The governing rules live in [`copilot/skills/common/references/knowledge-lookup-protocol.md`](../copilot/skills/common/references/knowledge-lookup-protocol.md) (read side), mirrored by the knowledge distillation protocol (write side for org-specific specifics) and the knowledge extraction protocol (write side for emerging general knowledge: practices and patterns → `candidates/`) in the same folder. Skill files reference the protocols rather than duplicating their text.

## The two knowledge-repo clones

Both external sources now follow the **two-clone model** — this is deliberate, not duplication:

| Clone | Role | Managed how |
|---|---|---|
| `copilot/knowledge/` | **Canonical accepted knowledge** — the only copy skills read (via the `~/.copilot/knowledge` symlink) | Machine-managed: cloned/pulled by bootstrap and container start using `--ff-only`. **Never edit it directly and never open branches there** — a local edit can be silently discarded on the next pull. |
| `repos/docs.copilot-knowledge/` | **Modification workspace** — branches and PRs happen here | Human/AI-managed: propose changes, open branches, and submit PRs. Changes here don't affect what skills see until merged upstream and the canonical clone refreshes. |
| `copilot/engineering/` | **Canonical ratified standards** — the copy skills read (via the `~/.copilot/engineering` symlink) | Machine-managed: same bootstrap/container-start machinery as knowledge. **Never edit it directly and never open branches there.** |
| `repos/docs.engineering/` | **Modification workspace** for standards — branches and PRs happen here | Human/AI-managed; on the AI side only `/devenv-design-discussion` prepares changes. Changes go live for skills after merge + canonical refresh. |

This mirrors the devenv repo's own two-clone arrangement (`repos/devenv/` for changes, the running environment for consumption). Note two practical consequences: **mid-session freshness** — the canonical clone refreshes only at bootstrap/container start, not mid-session — and **candidates/ index links** — links from knowledge files into `copilot/skills/` references resolve only inside the devenv workspace, not from the knowledge repo standalone.

## How devenv relates to the sub-repos

The devenv workspace is the hub of a small constellation of repositories. Each has a distinct role, a distinct manager, and a distinct edit route:

```text
devenv workspace (the running environment — this repo, checked out at the workspace root)
│
├─ copilot/knowledge/             canonical accepted knowledge  ← machine-managed
│    ↕ ~/.copilot/knowledge symlink (how skills read it)
├─ copilot/engineering/           canonical ratified standards   ← machine-managed
│    ↕ ~/.copilot/engineering symlink (how skills read it)
│
├─ repos/
│   ├─ docs.copilot-knowledge/    knowledge modification workspace  ← PRs here
│   ├─ docs.engineering/          standards modification workspace  ← PRs here
│   ├─ devenv/                    devenv's own modification workspace ← PRs here
│   └─ <org repos>/               working clones used by tasks and skills
```

| Path | What it is | Managed by | Refreshes when | Edits go |
|---|---|---|---|---|
| `copilot/knowledge/` | Canonical knowledge skills read via the symlink | **Machine** — bootstrap clones it; container start pulls `--ff-only` ([`copilot-knowledge.bash`](../tools/lib/copilot-knowledge.bash)) | Container start / bootstrap | **Never directly** — PRs via `repos/docs.copilot-knowledge/` |
| `copilot/engineering/` | Canonical standards skills read via the symlink | **Machine** — same sync machinery as knowledge | Container start / bootstrap | **Never directly** — PRs via `repos/docs.engineering/` |
| `repos/docs.copilot-knowledge/` | Knowledge modification workspace | Human/AI (branches, PRs) | Manual pull | Directly — branches + PRs to `docs.copilot-knowledge` |
| `repos/docs.engineering/` | Standards modification workspace | Human/AI (branches, PRs) | Manual pull | Directly — PRs; on the AI side only `/devenv-design-discussion` prepares changes |
| `repos/devenv/` | Devenv's own modification workspace | Human/AI | Manual pull | Directly — PRs to devenv |
| `repos/<name>/` | Working clones of org repos used during tasks | Human/AI | `repo-get` / `repo-update-all` / repo-cache tools | Per that repo's own workflow |

The key asymmetry to internalize: **the machine writes what the skills read; people write what the machine pulls.** The `copilot/knowledge/` and `copilot/engineering/` clones are machine-managed so skills always see ratified, stable content; everything under `repos/` is human/AI-managed because that is where proposals, branches, and reviews happen. A change becomes *live* for skills only after it merges upstream and the consuming copy refreshes — at container start or bootstrap for both machine-managed imports. Forks re-point the whole constellation through `devenv.config` keys (`knowledge_repo`, `knowledge_subpath`, `engineering_repo`, `engineering_subpath`) without touching any skill.

## Related configuration

See [Devenv Customization](./Devenv-Customization.md) for the full `[copilot]` section reference, including `knowledge_repo`, `knowledge_subpath`, `engineering_repo`, and `engineering_subpath`.
