# Customization Guide

If you've forked this repository for your organization, this guide explains what needs to be customized.

## Quick Start

When you fork this repository, you only need to customize **one file**:

**`devenv.config`** - All organization-specific settings in one place

That's it! No code changes needed.

## What Needs Customization

Edit `devenv.config` in the root directory and update the following sections:

### [organization]

```ini
[organization]
name=YourOrg
github_org=your-org
email_domain=yourorg.com
```

- **name**: Your organization name (used in documentation and branding)
- **github_org**: Your GitHub organization (used for repository cloning and NuGet feeds)
- **email_domain**: Email domain for commit validation (or leave empty to accept any valid email)

### [container]

```ini
[container]
name=YourOrg Dev Environment
```

- **name**: The name displayed in VS Code for the dev container

### [workflows]

```ini
[workflows]
status_workflow=Backlog,Ready,In Progress,In review,Done
issue_types=story,bug
```

- **status_workflow**: Your team's issue workflow (comma-separated, in order)
- **issue_types**: Issue types your team uses (comma-separated)

### [bootstrap]

```ini
[bootstrap]
validate_config=true
```

- **validate_config**: Whether to validate the config on startup (recommended: true)

## Customization Examples

### Example 1: Small Startup

```ini
[organization]
name=Acme Corp
github_org=acme-corp
email_domain=acme.com

[container]
name=Acme Dev Environment

[workflows]
status_workflow=Backlog,In Progress,Done
issue_types=story,bug
```

### Example 2: Enterprise Organization

```ini
[organization]
name=Mega Corp
github_org=mega-corp-dev
email_domain=megacorp.com

[container]
name=Mega Corp Development Environment

[workflows]
status_workflow=Backlog,Ready,In Progress,In review,Testing,Done
issue_types=story,bug
```

---

## What You Should NOT Change

- ✅ Test infrastructure (unless you want to enhance it)
- ✅ Error handling libraries
- ✅ Git configuration helpers
- ✅ Version comparison logic
- ✅ Core script templates
- ✅ Bootstrap script itself

These are generic and should work for any organization.

---

## Contributing Improvements Back

If you make improvements that would benefit other organizations, consider contributing them back:

1. Fork the main devenv repository
2. Create a feature branch
3. Make your improvements
4. Ensure all tests pass
5. Submit a pull request

See [Contributing](./docs/Contributing.md) for more details.

---

## Getting Help

- Check `docs/` folder for feature-specific documentation
- Review test files in `tools/tests/` for usage examples
