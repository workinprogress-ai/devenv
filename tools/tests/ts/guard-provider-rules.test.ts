// guard provider rule: direct use of a git host's CLI, or of its API through
// curl or wget, is refused, because forks use different providers and the only
// supported path is the workspace's provider-neutral wrappers. The rule is judged
// through the real engine so the parser, policy and rule are tested together.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const GUARD_DIR = join(import.meta.dirname, "..", "..", "guard");
const PROVIDERS_DIR = join(import.meta.dirname, "..", "..", "lib", "providers");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
type PolicyData = {
  provider: { clis: Array<{ name: string }>; apiHosts: Array<{ host: string; pathPrefix?: string }>; denyText: string };
} & Record<string, unknown>;

const engine = require(join(GUARD_DIR, "engine.cjs")) as { run: (input: string) => RunResult };
const rule = require(join(GUARD_DIR, "rules-provider.cjs")) as {
  name: string;
  matchApiHost: (policy: PolicyData, host: string, path: string) => boolean;
};
const { loadPolicy } = require(join(GUARD_DIR, "policy-schema.cjs")) as { loadPolicy: () => PolicyData };

const claude = (command: string): string =>
  JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
const verdict = (command: string): { denied: boolean; reason: string } => {
  const r = engine.run(claude(command));
  const reason = r.exitCode === 2 ? (JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string) : "";
  return { denied: r.exitCode === 2, reason };
};

describe("guard/rules-provider: provider CLIs", () => {
  const denied = [
    "gh pr list",
    "gh auth status",
    "gh api repos/o/r/issues",
    "glab mr list",
    "tea issues list",
    "bb pipelines list",
    "az devops project list",
    "az repos pr list",
    "az boards work-item show --id 1",
    "/usr/bin/gh issue view 1",
    "\\gh issue view 1",
    "command gh issue view 1",
    "env GH_TOKEN=x gh pr list",
    "sudo gh pr list",
    "cd repos/x && gh pr list",
    "git status && gh issue list",
    "bash -c 'gh issue list'",
    "sh -c \"glab mr list\"",
    "echo x | xargs gh issue view",
    "echo $(gh issue list)",
    "FOO=$(gh api user) true",
    "timeout 5 gh pr list",
    "diff <(gh pr list) b",
    "cat <<EOF | bash\ngh pr list\nEOF",
  ];
  for (const cmd of denied) {
    it(`denies ${JSON.stringify(cmd)}`, () => {
      expect(verdict(cmd).denied).toBe(true);
    });
  }

  const allowed = [
    "az account show",
    "az login",
    "az group list",
    "az --version",
    "az",
    "ghc --version",
    "gh-ost --help",
    "echo gh pr list",
    "grep -n 'gh issue' docs/Workflow.md",
    "git log --oneline",
    "issue-get 42 --pretty",
    "pr-create 'feat: x' --no-issue",
    "project-add-issue 1 2",
    "python3 -c \"print('gh pr list')\"",
    "echo \"glab is a CLI\"",
    "cat <<'EOF'\ngh pr list\nEOF",
  ];
  for (const cmd of allowed) {
    it(`allows ${JSON.stringify(cmd)}`, () => {
      expect(verdict(cmd).denied).toBe(false);
    });
  }

  it("denies by the first positional argument for az, ignoring leading flags", () => {
    expect(verdict("az --only-show-errors devops project list").denied).toBe(true);
    expect(verdict("az --only-show-errors account show").denied).toBe(false);
  });

  it("does not guess at a program it cannot resolve", () => {
    expect(verdict("$GH pr list").denied).toBe(false);
  });
});

describe("guard/rules-provider: provider APIs through curl and wget", () => {
  const denied = [
    "curl https://api.github.com/repos/o/r",
    "curl -s -H 'Authorization: token x' https://api.github.com/user",
    "curl -X POST -d '{}' https://api.github.com/repos/o/r/issues",
    "wget https://dev.azure.com/o/p/_apis/git/repositories",
    "curl https://feeds.dev.azure.com/o/_apis/packaging/feeds",
    "curl https://vssps.dev.azure.com/o/_apis/graph/users",
    "curl https://myorg.visualstudio.com/_apis/projects",
    "curl --url https://api.github.com/user",
    "curl --url=https://api.github.com/user",
    "curl -s api.github.com/user",
    "curl https://API.GITHUB.COM/user",
    "curl https://user:secret@api.github.com/user",
    "curl https://api.github.com:443/user",
    "curl https://gitlab.com/api/v4/projects",
    "curl https://api.bitbucket.org/2.0/repositories",
    "curl -s https://api.github.com/user | jq .login",
    "cd x && curl https://api.github.com/user",
    "bash -c 'curl https://api.github.com/user'",
    "echo $(curl -s https://api.github.com/user)",
    "env -i curl https://api.github.com/user",
  ];
  for (const cmd of denied) {
    it(`denies ${JSON.stringify(cmd)}`, () => {
      expect(verdict(cmd).denied).toBe(true);
    });
  }

  const allowed = [
    "curl -L https://github.com/o/r/releases/download/v1/x.tgz -o x.tgz",
    "wget https://github.com/o/r/archive/refs/heads/main.zip",
    "curl https://gitlab.com/o/r/-/archive/main/r.tar.gz",
    "curl https://example.com/api/",
    "curl https://registry.npmjs.org/left-pad",
    "curl https://api.github.com.example.org/x",
    "curl -o api.github.com.txt https://example.com/x",
    "curl -H 'Host: api.github.com' https://example.com/x",
    "curl -d 'see api.github.com' https://example.com/x",
    "wget -O api.github.com https://example.com/x",
    "curl --version",
    "curl $URL",
    "curl \"https://$HOST/user\"",
    "echo curl https://api.github.com/user",
  ];
  for (const cmd of allowed) {
    it(`allows ${JSON.stringify(cmd)}`, () => {
      expect(verdict(cmd).denied, cmd).toBe(false);
    });
  }

  it("matches a host and its subdomains, never a lookalike", () => {
    const policy = loadPolicy();
    expect(rule.matchApiHost(policy, "api.github.com", "/")).toBe(true);
    expect(rule.matchApiHost(policy, "dev.azure.com", "/o")).toBe(true);
    expect(rule.matchApiHost(policy, "feeds.dev.azure.com", "/o")).toBe(true);
    expect(rule.matchApiHost(policy, "notdev.azure.com", "/o")).toBe(false);
    expect(rule.matchApiHost(policy, "github.com", "/o/r/releases")).toBe(false);
    expect(rule.matchApiHost(policy, "api.github.com.evil.example", "/")).toBe(false);
  });

  it("applies a path prefix only to the host that declares one", () => {
    const policy = loadPolicy();
    expect(rule.matchApiHost(policy, "gitlab.com", "/api/v4/projects")).toBe(true);
    expect(rule.matchApiHost(policy, "gitlab.com", "/o/r/-/archive/main.tar.gz")).toBe(false);
    expect(rule.matchApiHost(policy, "gitlab.com", "/")).toBe(false);
  });

  it("covers every host the provider modules call (derived, so a new one cannot be forgotten)", () => {
    // Hosts that appear in the provider modules as web pages, not API endpoints.
    const webOnly = new Set(["github.com"]);
    const hosts = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) {
          for (const m of readFileSync(full, "utf8").matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/g)) hosts.add(m[1] as string);
        }
      }
    };
    walk(PROVIDERS_DIR);
    const policy = loadPolicy();
    expect(hosts.size).toBeGreaterThan(0);
    for (const host of hosts) {
      if (webOnly.has(host)) continue;
      expect(rule.matchApiHost(policy, host, "/_apis/x"), host).toBe(true);
    }
  });
});

describe("guard/rules-provider: the deny text", () => {
  it("is the policy's provider-neutral instruction, plus what was blocked", () => {
    const policy = loadPolicy();
    const v = verdict("gh pr list");
    expect(v.reason.startsWith(policy.provider.denyText)).toBe(true);
    expect(v.reason).toMatch(/blocked: gh/i);
  });

  it("names the host, not the arguments, when a fetch is blocked", () => {
    const v = verdict("curl -H 'Authorization: token SECRET123' https://api.github.com/user");
    expect(v.reason).toMatch(/api\.github\.com/);
    expect(v.reason).not.toContain("SECRET123");
  });

  it("tells the model what to do instead", () => {
    expect(verdict("gh pr list").reason).toMatch(/wrapper/i);
  });

  it("is attributed to the provider rule", () => {
    expect(rule.name).toBe("provider");
  });
});
