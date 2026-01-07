# Documentation Index

Complete documentation for the Devenv project organized by topic and use case.

## 🚀 Quick Start

**New to Devenv?** Start here:
1. [Dev Container Environment](./Dev-container-environment.md) - Set up and run the dev container
2. [Contributing](./Contributing.md) - Development workflow and code standards
3. [Additional Tooling](./Additional-Tooling.md) - Overview of available scripts

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

## 📚 Development Standards

Coding practices, naming conventions, and quality guidelines:

- **[Contributing](./Contributing.md)** (25 KB)
  - Development workflow
  - Code quality standards
  - Review process and protocols
  - Merging and conflict resolution
  - Feature flags and dark deployments
  - Issue tracking and task management

- **[Coding Standards](./Coding-standards.md)** (15 KB)
  - Code style and formatting
  - Best practices
  - Error handling
  - Testing requirements
  - Documentation standards

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

## 🤝 Team & Culture

- **[Culture](./Culture.md)** (1.3 KB)
  - Team values and practices

## 📊 Documentation Statistics

| Document | Size | Purpose |
|----------|------|---------|
| GitHub Issues Management | 16 KB | Issue workflow & hierarchy |
| GitHub Issues Quick Reference | 6 KB | Command lookup & examples |
| Contributing | 25 KB | Development process |
| Additional Tooling | 20 KB | Script reference |
| Coding Standards | 15 KB | Code quality |
| Tailscale VPN Setup | 13 KB | VPN infrastructure |
| Dev Container | 11 KB | Environment setup |
| Function Naming | 5.7 KB | Naming conventions |
| Logging Framework | 6.6 KB | Logging standards |
| Port Forwarding | 6.2 KB | Network access |
| Culture | 1.3 KB | Team values |

**Total: ~115 KB of comprehensive documentation**

## 🔍 Find Documentation By Topic

### I want to...

**...understand how to track work**
→ [GitHub Issues Management](./GitHub-Issues-Management.md)

**...quickly look up a command**
→ [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) or [Additional Tooling](./Additional-Tooling.md)

**...set up my development environment**
→ [Dev Container Environment](./Dev-container-environment.md)

**...contribute code**
→ [Contributing](./Contributing.md)

**...follow code standards**
→ [Coding Standards](./Coding-standards.md)

**...create or publish a library**
→ See repository-specific documentation

**...set up logging in my script**
→ [Logging Framework](./Logging-Framework.md)

**...name bash functions correctly**
→ [Function Naming Conventions](./Function-Naming-Conventions.md)

**...access remote services**
→ [Port Forwarding](./Port-forwarding.md)

**...understand the team's culture**
→ [Culture](./Culture.md)

## 📝 How Documentation is Organized

### For New Developers
1. Start with [Dev Container Environment](./Dev-container-environment.md) to understand the setup
2. Read [Contributing](./Contributing.md) to understand the workflow
3. Bookmark [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) for daily use
4. Reference [Additional Tooling](./Additional-Tooling.md) as needed

### For Code Authors
1. [Coding Standards](./Coding-standards.md) - What to write
2. [Contributing](./Contributing.md) - How to contribute
3. [Function Naming Conventions](./Function-Naming-Conventions.md) - Function naming rules
4. [Logging Framework](./Logging-Framework.md) - Logging approach

### For Project Managers
1. [GitHub Issues Management](./GitHub-Issues-Management.md) - Full workflow guide
2. [GitHub Issues Quick Reference](./GitHub-Issues-Quick-Reference.md) - Command lookup
3. [Contributing](./Contributing.md) - Review process

### For DevOps/Infrastructure
1. [Dev Container Environment](./Dev-container-environment.md) - Container setup
2. [Port Forwarding](./Port-forwarding.md) - Network access
3. [Tailscale VPN Setup](./Tailscale-Setup.md) - VPN infrastructure

## 🔗 Related Resources

- **GitHub CLI Documentation**: https://cli.github.com/manual/
- **VS Code Remote Containers**: https://code.visualstudio.com/docs/remote/containers
- **Docker Documentation**: https://docs.docker.com/
- **Podman Documentation**: https://docs.podman.io/
- **Git Documentation**: https://git-scm.com/doc

## 📞 Getting Help

- Check the relevant documentation section above
- Use script `--help` flags: `issue-create --help`
- Ask in team chat or create a GitHub issue
- Refer to [Contributing.md](./Contributing.md) for review and collaboration guidelines

## 📄 Documentation Standards

All documentation in Devenv follows these principles:

- **Clarity**: Clear, concise language with examples
- **Completeness**: Covers normal use and edge cases
- **Organization**: Logical structure with clear sections
- **Examples**: Real-world examples for every major feature
- **Links**: Cross-references to related documents
- **Maintenance**: Updated alongside code changes

---

Last updated: January 3, 2026
