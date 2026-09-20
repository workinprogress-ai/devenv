# Documentation Index

Complete documentation for the Devenv project organized by topic and use case.

## 🤖 Copilot Skills

A suite of skills covering the full development lifecycle — from thinking and specification through planning, execution, review, and PR handoff. The suite grows; the catalog below is the living reference.

- **[Skills Catalog](./Skills.md)** — full reference:
  - [Decision tree](./Skills.md#decision-tree) — fastest way to pick a skill
  - [Principle skills](./Skills.md#principle-skills) — detailed write-ups of the backbone skills
  - [All skills — quick reference](./Skills.md#all-skills--quick-reference) — every skill in compact tables
  - Each skill's `SKILL.md` frontmatter (`copilot/skills/<name>/`) is authoritative; the catalog summarizes
- **[Workflow Guide](./Workflow.md)** — end-to-end methodology guide with ASCII flowcharts and skill mapping notes
- **[Progress Reporting](./Progress-Reporting.md)** — how progress is derived from plans/issues/git, the `Progress:` snapshot line, and `/devenv-query-progress`
- **[Knowledge & Engineering Patterns](./Knowledge-and-Engineering-Patterns.md)** — how skills consult copilot knowledge and the configurable engineering-standards repo

**Not sure which to use?** Say `/devenv-skill-guru` and answer 1–3 questions.

## 🚀 Quick Start

**New to Devenv?** Start here:

1. [Dev Container Environment](./Dev-container-environment.md) - Set up and run the dev container
2. [Additional Tooling](./Additional-Tooling.md) - Overview of available scripts
3. [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) - Common issue/PR commands

## 📋 GitHub Issues & Project Management

Complete workflow for managing GitHub Issues, Projects, and Sprints:

- **[GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md)** — canonical command lookup
  - Fast lookup for common commands
  - Filtering and status cheatsheet
  - Workflow examples
  - Common issues and solutions
- **[GitHub Issues Management](./GitHub-Issues-Management.md)** — workflow & concepts
  - Issue types and hierarchy (Epic, Feature, Bug, Task)
  - Status workflow (TBD → Production)
  - Sprint planning and grooming
  - Development workflow examples
  - Best practices and conventions

**Key Scripts:**

- `issue-create` - Create new issues
- `issue-list` - List/filter issues
- `issue-update` - Update issue fields
- `issue-select` - Interactive issue picker
- `issue-triage` - Backlog grooming wizard
- `pr-get` / `pr-list` - Fetch PR data as JSON
- `pr-comment` - Add comment to a PR
- `pr-diff` - Get unified diff for PR or local refs
- `project-add-issue` - Add issues to projects
- `project-update-issue` - Update project fields

## 🛠️ Tools & Scripts

- **[Additional Tooling](./Additional-Tooling.md)** — comprehensive command reference
  - Repository management (clone, update, web URLs)
  - Git extensions (graph, wip, prune, etc.)
  - Pull request management
  - Container and database tools
  - Build and development tools
  - Networking and utilities
  - Complete command reference

**Devenv-specific conventions (still in this repo):**

- **[Tooling Standards](./Tooling-Standards.md)**
  - How to write tools for the `tools/` suite
  - Required skeleton, library catalog, exit-code contract
  - Argument parsing, stdin/body handling, repo targeting
  - Testing requirements and common pitfalls

- **[Function Naming Conventions](./Function-Naming-Conventions.md)**
  - Bash function naming rules
  - Verb prefixes and patterns
  - Migration guidelines
  - Good vs bad examples

- **[Tooling Standards — Logging & error handling](./Tooling-Standards.md#logging--error-handling)**
  - Logging levels (DEBUG, INFO, WARN, ERROR, FATAL)
  - Log function usage
  - Output formatting
  - Best practices

## 🏗️ Infrastructure & Setup

- **[Dev Container Environment](./Dev-container-environment.md)**
  - Container architecture
  - Bootstrap process
  - Environment variables
  - SSH agent forwarding
  - VS Code configuration
- **[Developing Devenv Itself](./Nested-Devenv-Development.md)**
  - Nested-clone workflow (repos/devenv)
  - Self-locating scripts and test resolution
  - Targeting devenv with issue/PR tools
  - Troubleshooting

- **[Tailscale VPN Setup](./Tailscale-Setup.md)**
  - DigitalOcean infrastructure setup
  - Gateway droplet configuration
  - Tailscale admin console setup
  - Dev container installation
  - SOCKS5 proxy configuration
  - Verification and troubleshooting

- **[Port Forwarding](./Port-forwarding.md)**
  - SSH tunnel examples
  - Docker port forwarding
  - VS Code remote debugging
  - Database access patterns

## 🔍 Find Documentation By Topic

### I want to

**...understand how to track work**
→ [GitHub Issues Management](./GitHub-Issues-Management.md)

**...understand how the Copilot skills fit together**
→ [Workflow Guide](./Workflow.md) or [Skills Catalog](./Skills.md)

**...configure the knowledge and engineering-standards sources skills use**
→ [Knowledge & Engineering Patterns](./Knowledge-and-Engineering-Patterns.md) — including [how devenv relates to the sub-repos](./Knowledge-and-Engineering-Patterns.md#how-devenv-relates-to-the-sub-repos) — and [Devenv Customization](./Devenv-Customization.md)

**...quickly look up a command**
→ [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) or [Additional Tooling](./Additional-Tooling.md)

**...set up my development environment**
→ [Dev Container Environment](./Dev-container-environment.md)

**...create or publish a library**
→ See repository-specific documentation

**...set up logging in my script**
→ [Tooling Standards — Logging & error handling](./Tooling-Standards.md#logging--error-handling)

**...name bash functions correctly**
→ [Function Naming Conventions](./Function-Naming-Conventions.md)

**...write a new tool for the tools/ suite**
→ [Tooling Standards](./Tooling-Standards.md)

**...save unfinished work safely (WIP commits)**
→ [WIP-commit convention](./Additional-Tooling.md#the-wip-commit-convention)

**...access remote services**
→ [Port Forwarding](./Port-forwarding.md)

## 📝 How Documentation is Organized

1. Start with [Dev Container Environment](./Dev-container-environment.md) to understand the setup
2. Read the [Workflow Guide](./Workflow.md) to understand the delivery methodology
3. Bookmark [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) for daily use
4. Reference [Additional Tooling](./Additional-Tooling.md) as needed

## 🔗 Related Resources

- **GitHub CLI Documentation**: <https://cli.github.com/manual/>
- **VS Code Remote Containers**: <https://code.visualstudio.com/docs/remote/containers>
- **Docker Documentation**: <https://docs.docker.com/>
- **Podman Documentation**: <https://docs.podman.io/>
- **Git Documentation**: <https://git-scm.com/doc>

## 📞 Getting Help

- Check the relevant documentation section above
- Use script `--help` flags: `issue-create --help`
- Ask in team chat or create a GitHub issue

## 📄 Documentation Standards

All documentation in Devenv follows these principles:

- **Clarity**: Clear, concise language with examples
- **Completeness**: Covers normal use and edge cases
- **Organization**: Logical structure with clear sections
- **Examples**: Real-world examples for every major feature
- **Links**: Cross-references to related documents — verified, never stale (CI link-checks changed markdown)
- **Maintenance**: Updated in the same PR as the behavior change; no manually-synced counts, sizes, or timestamps in these pages

### Maintenance contract

- **Same-PR rule**: a change to tools, skills, or configuration that invalidates a doc statement updates that doc in the same PR.
- **No rot-prone facts**: pages don't carry hand-synced counts, byte sizes, or "last updated" stamps — git history answers those. Point at living references (the skills catalog, `--help` output) instead of restating them.
- **Links are CI-gated**: the `lint-markdown` job runs `markdown-link-check` on changed markdown; broken links fail the check (and were the single largest source of docs debt before it existed).
- **The index stays structural**: this page organizes and links; it does not summarize contents in ways that go stale when a target page changes.
