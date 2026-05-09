# Documentation Index

Complete documentation for the Devenv project organized by topic and use case.

## 🤖 Copilot Skills

A suite of 15 slash-command skills covering the full development lifecycle — from issue triage through PR review:

- **[Skills Catalog](./Skills.md)** — full reference with decision tree, workflow examples, and per-skill docs

**Top skills:**

- `/create-implementation-plan` — turn an issue or idea into a phased plan
- `/pair-programming` — human + AI collaborate, human stays in control
- `/delegation` — AI drives mechanical work, human reviews
- `/spike` — investigate feasibility before planning
- `/code-review` — AI reviews code you wrote

**Not sure which to use?** Say `/skill-guru` and answer 1–3 questions.

## 🚀 Quick Start

**New to Devenv?** Start here:

1. [Dev Container Environment](./Dev-container-environment.md) - Set up and run the dev container
2. [Additional Tooling](./Additional-Tooling.md) - Overview of available scripts
3. [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) - Common issue/PR commands

## 📋 GitHub Issues & Project Management

Complete workflow for managing GitHub Issues, Projects, and Sprints:

- **[GitHub Issues Management](./GitHub-Issues-Management.md)** (16 KB)
  - Issue types and hierarchy (Epic, Story, Bug, Tasks)
  - Status workflow (TBD → Production)
  - Sprint planning and grooming
  - Development workflow examples
  - Best practices and conventions

- **[GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md)** (6 KB)
  - Fast lookup for common commands
  - Filtering and status cheatsheet
  - Workflow examples
  - Common issues and solutions

**Key Scripts:**

- `issue-create` - Create new issues
- `issue-list` - List/filter issues
- `issue-update` - Update issue fields
- `issue-select` - Interactive issue picker
- `issue-groom` - Backlog grooming wizard
- `pr-get` / `pr-list` - Fetch PR data as JSON
- `pr-comment` - Add comment to a PR
- `pr-diff` - Get unified diff for PR or local refs
- `project-add` - Add issues to projects
- `project-update` - Update project fields

## 🛠️ Tools & Scripts

- **[Additional Tooling](./Additional-Tooling.md)** (20 KB)
  - Repository management (clone, update, web URLs)
  - Git extensions (graph, wip, prune, etc.)
  - Pull request management
  - Container and database tools
  - Build and development tools
  - Networking and utilities
  - Complete command reference

**Devenv-specific conventions (still in this repo):**

- **[Function Naming Conventions](./Function-Naming-Conventions.md)** (5.7 KB)
  - Bash function naming rules
  - Verb prefixes and patterns
  - Migration guidelines
  - Good vs bad examples

- **[Logging Framework](./Logging-Framework.md)** (6.6 KB)
  - Logging levels (DEBUG, INFO, WARN, ERROR, FATAL)
  - Log function usage
  - Output formatting
  - Best practices

## 🏗️ Infrastructure & Setup

- **[Dev Container Environment](./Dev-container-environment.md)** (11 KB)
  - Container architecture
  - Bootstrap process
  - Environment variables
  - SSH agent forwarding
  - VS Code configuration
  - Troubleshooting

- **[Tailscale VPN Setup](./Tailscale-Setup.md)** (13 KB)
  - DigitalOcean infrastructure setup
  - Gateway droplet configuration
  - Tailscale admin console setup
  - Dev container installation
  - SOCKS5 proxy configuration
  - Verification and troubleshooting

- **[Port Forwarding](./Port-forwarding.md)** (6.2 KB)
  - SSH tunnel examples
  - Docker port forwarding
  - VS Code remote debugging
  - Database access patterns

Total: ~115 KB of comprehensive documentation

## 🔍 Find Documentation By Topic

### I want to

**...understand how to track work**
→ [GitHub Issues Management](./GitHub-Issues-Management.md)

**...quickly look up a command**
→ [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) or [Additional Tooling](./Additional-Tooling.md)

**...set up my development environment**
→ [Dev Container Environment](./Dev-container-environment.md)

**...create or publish a library**
→ See repository-specific documentation

**...set up logging in my script**
→ [Logging Framework](./Logging-Framework.md)

**...name bash functions correctly**
→ [Function Naming Conventions](./Function-Naming-Conventions.md)

**...access remote services**
→ [Port Forwarding](./Port-forwarding.md)

## 📝 How Documentation is Organized

1. Start with [Dev Container Environment](./Dev-container-environment.md) to understand the setup
2. Read the Contributing documentation for your organization to understand the workflow
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
- **Links**: Cross-references to related documents
- **Maintenance**: Updated alongside code changes

---

Last updated: January 11, 2026
