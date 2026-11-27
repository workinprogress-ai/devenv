// guard replay corpus: the tool that turns real session transcripts into a scrubbed,
// structure-preserving set of commands, and the runner that replays that set through
// the engine to prove it blocks nothing legitimate. The tool is tested here on
// synthetic data only; the committed corpus is the user's product and is checked
// when present. Every credential-shaped value below is assembled at run time so this
// file carries no secret-shaped literal.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const GUARD_DIR = join(import.meta.dirname, "..", "..", "guard");
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "guard-replay.jsonl");

interface Finding {
  line: number;
  pattern: string;
}
interface Extracted {
  source: string;
  command: string;
}
interface Corpus {
  records: Array<{ id: string; source: string; command: string; expect?: string }>;
  counts: { extracted: number; kept: number; duplicates: number; dropped: Record<string, number> };
}
const tool = require(join(GUARD_DIR, "replay-corpus.cjs")) as {
  extractCommands: (jsonl: string) => Extracted[];
  scrubCommand: (command: string, words?: string[]) => string;
  scanForSecrets: (text: string, words?: string[]) => Finding[];
  buildCorpus: (items: Extracted[]) => Corpus;
  serializeCorpus: (corpus: Corpus, meta?: Record<string, unknown>) => string;
  parseCorpus: (jsonl: string) => { meta: Record<string, unknown> | null; records: Corpus["records"] };
  decide: (command: string) => boolean;
};

// Credential-shaped values, assembled so no literal looks like a real secret.
const ghToken = "ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const patToken = "github" + "_pat_" + "11ABCDEFG0abcdefghij_klmnopqrstuvwxyz0123456789ABCDEFGHIJ";
const slackToken = "xox" + "b-" + "123456789012-abcdefghijklmnop";
const awsKey = "AKIA" + "ABCDEFGHIJKLMNOP";
const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnopqrstuvwxyz012345"].join(".");
const longSecret = "Zx9" + "Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm9Nb8Vc7Xz6";

const claudeLine = (command: string): string =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "tool_use", name: "Bash", input: { command } }] } });
const copilotLine = (command: string, toolName = "bash"): string =>
  JSON.stringify({ type: "tool.execution_start", data: { toolCallId: "c1", toolName, arguments: { command } } });

describe("guard/replay-corpus: extraction", () => {
  it("reads Bash commands from Claude transcripts", () => {
    const text = [claudeLine("git status"), JSON.stringify({ type: "user", message: { content: "hi" } }), claudeLine("ls -la")].join("\n");
    expect(tool.extractCommands(text)).toEqual([
      { source: "claude", command: "git status" },
      { source: "claude", command: "ls -la" },
    ]);
  });

  it("reads terminal tool starts from Copilot event logs", () => {
    const text = [copilotLine("git log"), copilotLine("ls", "run_in_terminal"), copilotLine("cat x", "view")].join("\n");
    expect(tool.extractCommands(text)).toEqual([
      { source: "copilot", command: "git log" },
      { source: "copilot", command: "ls" },
    ]);
  });

  it("ignores other tools, blank lines, malformed lines and non-string commands", () => {
    const text = [
      "",
      "{ not json",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { command: "x" } }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: 5 } }] } }),
      JSON.stringify({ type: "tool.execution_start", data: { toolName: "bash", arguments: {} } }),
      "null",
      "[]",
    ].join("\n");
    expect(tool.extractCommands(text)).toEqual([]);
  });
});

describe("guard/replay-corpus: scrubbing", () => {
  const scrubbed = (c: string): string => tool.scrubCommand(c);

  it("replaces credential-shaped values", () => {
    for (const secret of [ghToken, patToken, slackToken, awsKey, jwt, longSecret]) {
      const out = scrubbed(`curl -s -H "X-Thing: ${secret}" https://api.github.com/user`);
      expect(out, secret.slice(0, 6)).not.toContain(secret);
      expect(out).toContain("__SECRET__");
    }
  });

  it("replaces bearer values, secret-named assignments and secret-named flags", () => {
    expect(scrubbed("curl -H 'Authorization: Bearer abcdefghijklmnop1234' x")).not.toContain("abcdefghijklmnop1234");
    expect(scrubbed("MY_API_TOKEN=hunter22hunter22 ./run")).toBe("MY_API_TOKEN=__SECRET__ ./run");
    expect(scrubbed("GITHUB_PAT=abc def")).toContain("GITHUB_PAT=__SECRET__");
    expect(scrubbed("tool --password hunter2 run")).toBe("tool --password __SECRET__ run");
    expect(scrubbed("tool --token=hunter2 run")).toBe("tool --token=__SECRET__ run");
  });

  it("replaces credentials in URLs and email addresses", () => {
    expect(scrubbed("git clone https://user:pw12345@example.com/o/r.git")).not.toContain("pw12345");
    expect(scrubbed("git clone https://" + ghToken + "@github.com/o/r.git")).not.toContain(ghToken);
    expect(scrubbed("git config user.email someone@corp.example")).toBe("git config user.email __EMAIL__");
  });

  it("keeps a public host but not the organisation, project or query", () => {
    expect(scrubbed("curl https://api.github.com/repos/acme-corp/secret-repo/issues?state=open")).toBe("curl https://api.github.com/repos/__S__/__S__/issues?__Q__");
    expect(scrubbed("curl https://dev.azure.com/AcmeOrg/Proj/_apis/git/repositories")).toBe("curl https://dev.azure.com/__S__/__S__/_apis/git/__S__");
    expect(scrubbed("curl -L https://github.com/o/r/releases/download/v1.2/x.tgz")).toBe("curl -L https://github.com/__S__/__S__/releases/download/__S__/__S__");
  });

  it("replaces an unknown host and an organisation subdomain", () => {
    expect(scrubbed("curl https://git.internal.example.net/api/v4/projects")).toBe("curl https://host.invalid/api/v4/__S__");
    expect(scrubbed("curl https://acmeorg.visualstudio.com/_apis/projects")).toBe("curl https://org.visualstudio.com/_apis/__S__");
    expect(scrubbed("git remote add o git@github.acme-corp.com:team/repo.git")).toBe("git remote add o git@host.invalid:__PATH__");
  });

  it("generalizes home, workspace and repository names but keeps the shape", () => {
    expect(scrubbed("cd /home/jdoe/projects && ls")).toBe("cd /home/user/projects && ls");
    expect(scrubbed("cat /Users/jdoe/x")).toBe("cat /Users/user/x");
    expect(scrubbed("cd /workspaces/acme.dev/repos/billing-service && git status")).toBe("cd /workspaces/ws/repos/__REPO__ && git status");
    expect(scrubbed("git -C repos/billing-service log")).toBe("git -C repos/__REPO__ log");
  });

  it("replaces free-text message flags with a placeholder", () => {
    expect(scrubbed('git commit -m "fix: acme billing rollout for customer X"')).toBe('git commit -m "__TEXT__"');
    expect(scrubbed("gh pr create --title 'Secret plan' --body 'details here'")).toBe('gh pr create --title "__TEXT__" --body "__TEXT__"');
    expect(scrubbed("git commit --message=hello")).toBe('git commit --message="__TEXT__"');
  });

  it("blanks the body of a heredoc read by a program that is not a shell", () => {
    const cmd = 'git commit -m "$(cat <<\'EOF\'\nprivate words about acme\nEOF\n)"';
    const out = scrubbed(cmd);
    expect(out).not.toContain("private words");
    expect(out).toContain("__TEXT__");
  });

  it("keeps the body of a heredoc fed to a shell, because it is code", () => {
    const out = scrubbed("bash <<EOF\ngh pr list\nEOF");
    expect(out).toContain("gh pr list");
    expect(scrubbed("cat <<EOF | bash\ngit push\nEOF")).toContain("git push");
  });

  it("blanks a long quoted string unless a shell is about to run it", () => {
    const long = "word ".repeat(30).trim();
    expect(scrubbed(`echo "${long}"`)).toBe('echo "__TEXT__"');
    expect(scrubbed(`bash -c "echo ${long} && gh pr list"`)).toContain("gh pr list");
    expect(scrubbed("echo 'short'")).toBe("echo 'short'");
  });

  it("replaces a secret value as a whole word and keeps the separator after it", () => {
    expect(scrubbed('AZ_PAT="$(cat ~/.keys/pat)"; az repos list')).toBe("AZ_PAT=__SECRET__; az repos list");
    expect(scrubbed('docker build --build-arg="MY_TOKEN=abc123"; echo ok')).toBe('docker build --build-arg="MY_TOKEN=__SECRET__"; echo ok');
    expect(scrubbed("export TOKEN=abc && echo hi")).toBe("export TOKEN=__SECRET__ && echo hi");
    expect(scrubbed("cd repos/some-repo; git log")).toBe("cd repos/__REPO__; git log");
    expect(scrubbed("cd /home/someone && ls")).toBe("cd /home/user && ls");
  });

  it("pairs quotes by substitution nesting, so a scrubbed command still parses", () => {
    const long = "a".repeat(80);
    const nested = 'echo "count: $(echo "$C" | wc -l)"; echo "' + long + '"';
    const out = scrubbed(nested);
    expect(out).toBe('echo "count: $(echo "$C" | wc -l)"; echo "__TEXT__"');
    expect(scrubbed("echo '" + long + "' | wc -l")).toBe("echo '__TEXT__' | wc -l");
    expect(scrubbed('echo "unterminated ' + long)).toContain("unterminated");
  });

  it("removes transcript folder paths, the repository owner and a provider project", () => {
    expect(scrubbed("cat /tmp/claude-1000/-workspaces-some-ws-repos-x/abc.jsonl")).toBe("cat /tmp/claude-ws/__PATH__");
    expect(scrubbed("export DEVENV_REPO=acme/widgets && pr-get 1")).toBe("export DEVENV_REPO=__S__/__REPO__ && pr-get 1");
    expect(scrubbed("az boards list --project Widgets -o json")).toBe("az boards list --project __S__ -o json");
  });

  it("blanks and flags names passed explicitly", () => {
    expect(tool.scrubCommand("echo Some_Project and some_project", ["some_project"])).toBe("echo __S__ and __S__");
    expect(tool.scrubCommand("cd ../acme.core.widgets && ls", ["\\bacme\\.[\\w.-]+"])).toBe("cd ../__S__ && ls");
    expect(tool.scanForSecrets("echo SOME_PROJECT", ["some_project"])).toEqual([{ line: 1, pattern: "named-word" }]);
    expect(tool.scanForSecrets("echo fine", ["some_project"])).toEqual([]);
  });

  it("does not mistake long paths and long descriptive file names for secrets", () => {
    for (const c of [
      "cat tools/tests/ts/some-quite-long-descriptive-test-name-for-things-v2.test.ts",
      "node /workspaces/ws/repos/__REPO__/tools/ts/lint-skills-and-other-long-names-001.ts",
      "ls tmp/devenv-research-ponytail-assimilation-2026-11-21/results_run_1_final",
      "grep -rn pattern some_really_long_snake_case_identifier_with_numbers_123_456 src",
    ]) {
      expect(scrubbed(c), c).toBe(c);
    }
  });

  it("still replaces a mixed-case token with digits and a long hex token, wherever they sit", () => {
    expect(scrubbed("x " + longSecret + " y")).toBe("x __SECRET__ y");
    expect(scrubbed("x " + "0123456789abcdef0123456789abcdef" + " y")).toBe("x __SECRET__ y");
    expect(scrubbed("path/" + longSecret + "/more")).toBe("path/__SECRET__/more");
  });

  it("replaces full commit hashes", () => {
    expect(scrubbed("git show " + "0123456789abcdef0123456789abcdef01234567")).toBe("git show __SHA__");
    expect(scrubbed("git show abc1234")).toBe("git show abc1234");
  });

  it("uses placeholders the shell parser keeps whole, so a scrubbed command parses like the original", () => {
    const { parseCommand } = require(join(GUARD_DIR, "parse.cjs")) as {
      parseCommand: (c: string) => { invocations: Array<{ program: string | null; args: string[]; redirects: string[]; env: Record<string, string> }> };
    };
    const url = tool.scrubCommand("curl https://api.github.com/repos/acme/secret/issues?state=open");
    const [u] = parseCommand(url).invocations;
    expect(u?.program).toBe("curl");
    expect(u?.args).toEqual(["https://api.github.com/repos/__S__/__S__/issues?__Q__"]);
    expect(u?.redirects).toEqual([]);
    const env = tool.scrubCommand("env GH_TOKEN=" + ghToken + " gh api user");
    const [e] = parseCommand(env).invocations;
    expect(e?.program).toBe("gh");
    expect(e?.redirects).toEqual([]);
    expect(tool.scrubCommand("cd /workspaces/acme.dev/repos/billing && ls")).not.toMatch(/[<>]/);
  });

  it("leaves an ordinary command untouched", () => {
    for (const c of ["git status", "ls -la", "git log --oneline -n 5", "echo hello && pwd", "gh pr list", "az account show"]) expect(scrubbed(c)).toBe(c);
  });

  it("is idempotent", () => {
    const c = `curl -H "Authorization: Bearer abcdefghijklmnop1234" https://dev.azure.com/AcmeOrg/Proj/_apis/x && cd /home/jdoe && git commit -m "private"`;
    expect(scrubbed(scrubbed(c))).toBe(scrubbed(c));
  });

  it("never lets the guard's decision change", () => {
    const commands = [
      "gh pr list",
      "gh auth status --token " + ghToken,
      "cd /workspaces/acme.dev/repos/billing && gh issue view 12",
      `curl -s -H "Authorization: token ${ghToken}" https://api.github.com/repos/acme/x/issues`,
      "curl -L https://github.com/acme/x/releases/download/v1/x.tgz -o x.tgz",
      "curl https://dev.azure.com/AcmeOrg/Proj/_apis/git/repositories",
      "curl https://gitlab.com/api/v4/projects?private_token=" + longSecret,
      "curl https://gitlab.com/acme/x/-/archive/main/x.tar.gz",
      "echo 'gh pr list' | bash",
      'git commit -m "private message" && gh pr create --title "secret"',
      "az devops project list --org https://dev.azure.com/AcmeOrg",
      "az account show",
      "env GH_TOKEN=" + ghToken + " gh api user",
      "bash -c 'cd /home/jdoe/repos/x && gh issue list'",
    ];
    for (const c of commands) expect(tool.decide(tool.scrubCommand(c)), c).toBe(tool.decide(c));
  });
});

describe("guard/replay-corpus: the secret scan", () => {
  it("finds each kind of leftover, reporting the pattern and line but never the value", () => {
    const text = ["fine", `export T=${ghToken}`, `x ${jwt}`, "mail a@b.example", "cat /home/jdoe/x", "https://user:pw@h.example/x", "-----BEGIN PRIVATE KEY-----"].join("\n");
    const found = tool.scanForSecrets(text);
    expect(found.map((f) => f.line)).toEqual([2, 3, 4, 5, 6, 7]);
    for (const f of found) {
      expect(Object.keys(f).sort()).toEqual(["line", "pattern"]);
      expect(text.includes(f.pattern)).toBe(false);
    }
  });

  it("passes scrubbed output and the placeholders themselves", () => {
    const scrubbed = tool.scrubCommand(`MY_TOKEN=${longSecret} curl https://acmeorg.visualstudio.com/_apis/x -H "Authorization: Bearer abcdefghijklmnop1234" && echo a@b.example /home/jdoe`);
    expect(tool.scanForSecrets(scrubbed)).toEqual([]);
    expect(tool.scanForSecrets("__SECRET__ __EMAIL__ __TEXT__ __SHA__ /home/user/x /workspaces/ws/y host.invalid")).toEqual([]);
  });
});

describe("guard/replay-corpus: building the corpus", () => {
  it("scrubs, deduplicates, numbers records in order, and counts what happened", () => {
    const items: Extracted[] = [
      { source: "claude", command: "git status" },
      { source: "claude", command: "git status" },
      { source: "copilot", command: "ls -la" },
      { source: "claude", command: `echo ${ghToken}` },
    ];
    const corpus = tool.buildCorpus(items);
    expect(corpus.records.map((r) => r.id)).toEqual(["replay-0001", "replay-0002", "replay-0003"]);
    expect(corpus.records.map((r) => r.command)).toEqual(["git status", "ls -la", "echo __SECRET__"]);
    expect(corpus.counts).toMatchObject({ extracted: 4, kept: 3, duplicates: 1 });
  });

  it("drops what it cannot make safe: oversize commands and anything that still fails the scan", () => {
    const corpus = tool.buildCorpus([
      { source: "claude", command: "echo " + "a ".repeat(3000) },
      { source: "claude", command: "echo -----BEGIN PRIVATE KEY-----" },
      { source: "claude", command: "echo ok" },
    ]);
    expect(corpus.records.map((r) => r.command)).toEqual(["echo ok"]);
    expect(corpus.counts.dropped).toEqual({ oversize: 1, residual: 1 });
  });

  it("serializes with an unsigned meta line, and reads it back", () => {
    const corpus = tool.buildCorpus([{ source: "claude", command: "git status" }]);
    const text = tool.serializeCorpus(corpus);
    const first = JSON.parse(text.split("\n")[0] as string) as { meta: { signedOff: boolean; format: number } };
    expect(first.meta.signedOff).toBe(false);
    expect(first.meta.format).toBe(1);
    const back = tool.parseCorpus(text);
    expect(back.meta?.["signedOff"]).toBe(false);
    expect(back.records).toEqual(corpus.records);
    expect(tool.scanForSecrets(text)).toEqual([]);
  });
});

describe("guard/replay-corpus: the command line", () => {
  const CLI = join(GUARD_DIR, "replay-corpus.cjs");
  const cli = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  function withTranscripts(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "replay-cli-"));
    try {
      const lines = [
        claudeLine("git status"),
        claudeLine(`curl -s -H "Authorization: token ${ghToken}" https://api.github.com/repos/acme/x/issues`),
        claudeLine("gh pr list"),
        claudeLine("ls -la"),
        copilotLine("curl -L https://github.com/acme/x/releases/download/v1/x.tgz -o x.tgz"),
        claudeLine("git status"),
      ];
      writeFileSync(join(dir, "session.jsonl"), `${lines.join("\n")}\n`);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("shows usage", () => {
    const r = cli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(cli([]).status).toBe(0);
  });

  it("rejects an unknown command", () => {
    expect(cli(["frobnicate"]).status).toBe(2);
  });

  it("extracts a scrubbed, unsigned corpus from a transcript folder and reports what it did", () => {
    withTranscripts((dir) => {
      const r = cli(["extract", dir]);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/extracted 6, kept 5, duplicates 1/);
      expect(r.stdout).not.toContain(ghToken);
      const parsed = tool.parseCorpus(r.stdout);
      expect(parsed.meta?.["signedOff"]).toBe(false);
      expect(parsed.records.map((x) => x.command)).toContain("git status");
      expect(tool.scanForSecrets(r.stdout)).toEqual([]);
    });
  });

  it("writes to a file with --out", () => {
    withTranscripts((dir) => {
      const out = join(dir, "corpus.jsonl");
      expect(cli(["extract", "--out", out, join(dir, "session.jsonl")]).status).toBe(0);
      expect(tool.parseCorpus(readFileSync(out, "utf8")).records.length).toBe(5);
    });
  });

  it("scan exits 0 on clean text and 1, naming the pattern and line only, on a leak", () => {
    withTranscripts((dir) => {
      const clean = join(dir, "clean.txt");
      writeFileSync(clean, "git status\nls\n");
      expect(cli(["scan", clean]).status).toBe(0);
      const dirty = join(dir, "dirty.txt");
      writeFileSync(dirty, `ok\nexport T=${ghToken}\n`);
      const r = cli(["scan", dirty]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("line 2: provider-token");
      expect(r.stdout).not.toContain(ghToken);
    });
  });

  it("compare reports denials and decision differences without printing raw text", () => {
    withTranscripts((dir) => {
      const r = cli(["compare", dir]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/decisions that differ: 0/);
      expect(r.stdout).toMatch(/DENIED: gh pr list/);
      expect(r.stdout).toMatch(/DENIED: curl .*api\.github\.com/);
      expect(r.stdout).not.toContain(ghToken);
      expect(r.stdout).not.toMatch(/DENIED: .*releases\/download/);
    });
  });
});

describe("guard/replay-corpus: the committed corpus", () => {
  const present = existsSync(FIXTURE);

  it.skipIf(present)("is not generated yet: run `node tools/guard/replay-corpus.cjs extract` (a task for the user), review it, set signedOff, commit it", () => {
    expect(present).toBe(false);
  });

  describe.runIf(present)("when present", () => {
    const parsed = present ? tool.parseCorpus(readFileSync(FIXTURE, "utf8")) : { meta: null, records: [] };

    it("carries the user's sign-off", () => {
      expect(parsed.meta?.["signedOff"]).toBe(true);
    });

    it("passes the secret scan", () => {
      expect(tool.scanForSecrets(readFileSync(FIXTURE, "utf8"))).toEqual([]);
    });

    it("has unique ids and non-empty commands", () => {
      expect(new Set(parsed.records.map((r) => r.id)).size).toBe(parsed.records.length);
      for (const r of parsed.records) expect(r.command.trim(), r.id).not.toBe("");
    });

    it("is judged exactly as labelled: every unlabelled command is allowed, every labelled deny is denied", () => {
      const wrong: string[] = [];
      for (const r of parsed.records) {
        const expected = r.expect === "deny";
        if (tool.decide(r.command) !== expected) wrong.push(`${r.id} expected ${expected ? "deny" : "allow"}`);
      }
      expect(wrong).toEqual([]);
    });
  });
});
