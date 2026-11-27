// guard shell-aware command parser: turns a command string into the ordered list
// of programs it would run (with arguments, env prefixes, the cd in effect and any
// heredoc), seeing through chains, subshells, substitutions, `-c` recursion and
// wrapper programs. The adversarial shapes a regex misses are fixtures here.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

interface Invocation {
  program: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: null | { path: string } | { unresolvable: true };
  wrappers: string[];
  via: string[];
  dynamic: boolean;
  heredoc: null | { delimiter: string; quoted: boolean; body: string };
  redirects: string[];
}
interface Parsed {
  invocations: Invocation[];
  problems: string[];
}
const parser = require(join(import.meta.dirname, "..", "..", "guard", "parse.cjs")) as {
  parseCommand: (text: string, options?: { maxDepth?: number }) => Parsed;
  MAX_DEPTH: number;
};
const parse = parser.parseCommand;
const programs = (cmd: string): Array<string | null> => parse(cmd).invocations.map((i) => i.program);
const first = (cmd: string): Invocation => {
  const i = parse(cmd).invocations[0];
  if (i === undefined) throw new Error(`no invocation for: ${cmd}`);
  return i;
};

describe("guard/parse: simple commands", () => {
  it("returns program and arguments", () => {
    const i = first("git commit -m 'a b' --amend");
    expect(i.program).toBe("git");
    expect(i.args).toEqual(["commit", "-m", "a b", "--amend"]);
    expect(i.dynamic).toBe(false);
    expect(i.cwd).toBeNull();
  });

  it("returns nothing for empty or whitespace input and for comments", () => {
    expect(parse("")).toEqual({ invocations: [], problems: [] });
    expect(parse("   \n  ")).toEqual({ invocations: [], problems: [] });
    expect(parse("# git push")).toEqual({ invocations: [], problems: [] });
  });

  it("strips a trailing comment but not a # inside a word or quotes", () => {
    expect(programs("git status # git push")).toEqual(["git"]);
    expect(first("echo a#b '#c' \"#d\"").args).toEqual(["a#b", "#c", "#d"]);
  });

  it("normalizes the program to its base name", () => {
    expect(first("/usr/bin/git status").program).toBe("git");
    expect(first("./tools/git status").program).toBe("git");
    expect(first("'git' status").program).toBe("git");
    expect(first("\"git\" status").program).toBe("git");
    expect(first("\\git status").program).toBe("git");
    expect(first("g\\it status").program).toBe("git");
  });

  it("keeps quoted text inert: a quoted command name is an argument, not a program", () => {
    expect(programs("echo \"git commit is forbidden\"")).toEqual(["echo"]);
    expect(programs("grep -n 'git push' docs/Workflow.md")).toEqual(["grep"]);
    expect(programs("git log --grep=commit --oneline")).toEqual(["git"]);
    expect(programs("python3 -c \"print('git push')\"")).toEqual(["python3"]);
  });

  it("handles single-quote, double-quote and backslash escapes inside words", () => {
    expect(first("echo 'it'\\''s'").args).toEqual(["it's"]);
    expect(first("echo \"a \\\"b\\\" c\"").args).toEqual(['a "b" c']);
    expect(first("echo a\\ b").args).toEqual(["a b"]);
    expect(first("echo $'a\\tb'").args.length).toBe(1);
  });

  it("joins backslash-newline continuations", () => {
    const i = first("git \\\n  commit \\\n  -m x");
    expect(i.args).toEqual(["commit", "-m", "x"]);
  });

  it("records leading assignments as env, not as the program", () => {
    const i = first("GIT_EDITOR=true FOO='a b' git rebase --continue");
    expect(i.program).toBe("git");
    expect(i.env).toEqual({ GIT_EDITOR: "true", FOO: "a b" });
    expect(parse("FOO=bar").invocations).toEqual([]);
  });

  it("does not treat redirections as arguments", () => {
    const i = first("git log > out.txt 2>&1 < in.txt");
    expect(i.args).toEqual(["log"]);
    expect(i.redirects.length).toBe(3);
  });
});

describe("guard/parse: sequencing", () => {
  it("splits on ; && || | |& & and newlines, in document order", () => {
    expect(programs("a; b && c || d | e |& f & g\nh")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("does not split inside quotes", () => {
    expect(programs("echo 'a;b && c' && git push")).toEqual(["echo", "git"]);
  });

  it("sees commands in subshells and groups", () => {
    expect(programs("(cd x; git add -A)")).toEqual(["cd", "git"]);
    expect(programs("{ git push; }")).toEqual(["git"]);
    expect(programs("git status && (git commit -m x)")).toEqual(["git", "git"]);
  });

  it("sees commands after shell keywords", () => {
    expect(programs("if git commit -m x; then echo ok; fi")).toEqual(["git", "echo"]);
    expect(programs("for f in a b; do git add $f; done")).toEqual(["git"]);
    expect(programs("while true; do git push; done")).toEqual(["true", "git"]);
    expect(programs("! git diff --quiet")).toEqual(["git"]);
  });

  it("sees a command inside a case branch and a function body", () => {
    expect(programs("case $x in a) git push ;; esac")).toContain("git");
    expect(programs("foo() { git push; }; foo")).toContain("git");
  });

  it("handles a very long chain quickly", () => {
    const cmd = Array.from({ length: 5000 }, (_, i) => `echo ${i}`).join(" && ");
    const start = Date.now();
    expect(parse(cmd).invocations.length).toBe(5000);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("guard/parse: expansion and substitution", () => {
  it("parses a command substitution inside an argument or inside double quotes", () => {
    expect(programs("echo $(git commit -m x)")).toEqual(["echo", "git"]);
    expect(programs("echo \"$(git push)\"")).toEqual(["echo", "git"]);
    expect(programs("echo `git push`")).toEqual(["echo", "git"]);
    expect(parse("echo $(git push)").invocations[1]?.via).toEqual(["substitution"]);
  });

  it("parses nested substitutions and substitutions in assignments", () => {
    expect(programs("echo $(echo $(git push))")).toEqual(["echo", "echo", "git"]);
    expect(programs("X=$(git commit) true")).toEqual(["git", "true"]);
  });

  it("does not treat single-quoted substitution text as a command", () => {
    expect(programs("echo '$(git push)' '`git push`'")).toEqual(["echo"]);
  });

  it("does not treat arithmetic expansion as a command", () => {
    expect(programs("echo $((1 + 2))")).toEqual(["echo"]);
  });

  it("parses process substitution", () => {
    expect(programs("diff <(git show a) <(git show b)")).toEqual(["diff", "git", "git"]);
    expect(parse("diff <(git show a) b").invocations[1]?.via).toEqual(["process-substitution"]);
  });

  it("flags a program built from an expansion as dynamic and does not guess it", () => {
    for (const cmd of ["$GIT push", "${GIT} push", "\"$(which git)\" push", "`which git` push", "/usr/bin/g* push"]) {
      const i = parse(cmd).invocations.find((x) => x.dynamic);
      expect(i, cmd).toBeDefined();
      expect(i?.program, cmd).toBeNull();
    }
    expect(programs("g=git; $g push")).toEqual([null]);
  });

  it("keeps expansions in arguments as literal text", () => {
    expect(first("git commit -m $MSG").args).toEqual(["commit", "-m", "$MSG"]);
  });
});

describe("guard/parse: wrappers and indirection", () => {
  const cases: Array<[string, string, string[]]> = [
    ["command git push", "git", ["command"]],
    ["builtin exec git push", "git", ["builtin", "exec"]],
    ["env git push", "git", ["env"]],
    ["env -i FOO=1 git push", "git", ["env"]],
    ["env -u HOME git push", "git", ["env"]],
    ["sudo git push", "git", ["sudo"]],
    ["sudo -u bob -E git push", "git", ["sudo"]],
    ["nohup git push", "git", ["nohup"]],
    ["time git commit", "git", ["time"]],
    ["nice -n 10 git push", "git", ["nice"]],
    ["timeout 5 git push", "git", ["timeout"]],
    ["timeout -s KILL 5 git push", "git", ["timeout"]],
    ["xargs git rm", "git", ["xargs"]],
    ["xargs -I{} git rm {}", "git", ["xargs"]],
    ["xargs -n 1 -P 4 git rm", "git", ["xargs"]],
    ["setsid git push", "git", ["setsid"]],
    ["stdbuf -oL git push", "git", ["stdbuf"]],
  ];
  for (const [cmd, program, wrappers] of cases) {
    it(`resolves "${cmd}" to ${program}`, () => {
      const inv = parse(cmd).invocations.find((i) => i.program === program);
      expect(inv, cmd).toBeDefined();
      expect(inv?.wrappers, cmd).toEqual(wrappers);
    });
  }

  it("sees through env -S, which runs its string as a command line", () => {
    expect(programs("env -S 'git push origin HEAD'")).toEqual(["git"]);
    expect(programs("env -S'git push'")).toEqual(["git"]);
    expect(programs("env --split-string='gh pr list'")).toEqual(["gh"]);
    expect(parse("env -S 'git push'").invocations[0]?.via).toEqual(["env-S"]);
  });

  it("skips the option arguments of exec and the assignments given to sudo", () => {
    expect(first("exec -a name git push").program).toBe("git");
    expect(first("exec -c -l git push").program).toBe("git");
    const s = first("sudo -u bob FOO=1 BAR=2 git push");
    expect(s.program).toBe("git");
    expect(s.env).toEqual({ FOO: "1", BAR: "2" });
    expect(first("command -p git push").program).toBe("git");
  });

  it("puts env prefixes before a wrapper on the invocation", () => {
    expect(first("GIT_DIR=/x env FOO=1 git push").env).toEqual({ GIT_DIR: "/x", FOO: "1" });
  });

  it("treats command -v and command -V as a lookup, not an execution", () => {
    expect(programs("command -v git")).toEqual([]);
    expect(programs("command -V gh")).toEqual([]);
  });

  it("sees through find -exec and -execdir", () => {
    expect(programs("find . -name '*.c' -exec git rm {} \\;")).toContain("git");
    expect(programs("find . -execdir git add {} +")).toContain("git");
  });

  it("recurses into bash -c, sh -c, combined flags and eval", () => {
    expect(programs("bash -c 'git push origin HEAD'")).toEqual(["bash", "git"]);
    expect(programs("sh -c \"gh issue list\"")).toEqual(["sh", "gh"]);
    expect(programs("bash -lc 'git add -A'")).toEqual(["bash", "git"]);
    expect(programs("zsh -ec 'git commit -m x'")).toEqual(["zsh", "git"]);
    expect(programs("eval 'git push'")).toEqual(["eval", "git"]);
    expect(programs("eval git push")).toContain("git");
    expect(parse("bash -c 'git push'").invocations[1]?.via).toEqual(["shell-c"]);
  });

  it("recurses through several levels and stops at the depth limit with a problem", () => {
    const nest = (n: number): string => (n === 0 ? "git push" : `bash -c ${JSON.stringify(nest(n - 1))}`);
    expect(programs(nest(3))).toContain("git");
    const deep = parse(nest(parser.MAX_DEPTH + 3));
    expect(deep.problems.join(" ")).toMatch(/depth/);
  });

  it("respects a smaller depth limit passed as an option", () => {
    expect(parse("bash -c 'bash -c \"git push\"'", { maxDepth: 1 }).problems.join(" ")).toMatch(/depth/);
  });

  it("does not recurse into a shell run on a script file", () => {
    expect(programs("bash run.sh")).toEqual(["bash"]);
  });

  it("resolves a pipeline through xargs", () => {
    expect(programs("git ls-files | xargs git rm")).toEqual(["git", "git"]);
  });
});

describe("guard/parse: a literal script piped into a shell", () => {
  it("reads echo, printf and a cat heredoc piped into bash or sh", () => {
    expect(programs("echo 'git push' | bash")).toEqual(["echo", "bash", "git"]);
    expect(programs("printf 'git push\\n' | sh")).toContain("git");
    expect(programs("cat <<EOF | bash\ngh pr list\nEOF")).toEqual(["cat", "bash", "gh"]);
    expect(programs("echo git push | sudo bash")).toContain("git");
    expect(parse("echo 'git push' | bash").invocations[2]?.via).toEqual(["pipe-script"]);
  });

  it("reads through a pipeline of more than two commands only from the command directly before the shell", () => {
    expect(programs("echo 'git push' | cat | bash")).toEqual(["echo", "cat", "bash"]);
  });

  it("does not invent a script when the shell is not fed by a pipe, or runs a file or -c", () => {
    expect(programs("echo 'git push' | grep x")).toEqual(["echo", "grep"]);
    expect(programs("echo 'git push'; bash")).toEqual(["echo", "bash"]);
    expect(programs("echo 'git push' | bash run.sh")).toEqual(["echo", "bash"]);
    expect(programs("echo 'git push' | bash -c 'ls'")).toEqual(["echo", "bash", "ls"]);
  });
});

describe("guard/parse: cd tracking", () => {
  const cwdOf = (cmd: string, program: string): Invocation["cwd"] | undefined =>
    parse(cmd).invocations.find((i) => i.program === program && i.args[0] !== undefined && i.program !== "cd")?.cwd;

  it("tracks a cd earlier in a chain", () => {
    expect(cwdOf("cd repos/x && git add -A", "git")).toEqual({ path: "repos/x" });
    expect(cwdOf("cd /tmp; git status", "git")).toEqual({ path: "/tmp" });
  });

  it("composes relative cds and normalizes dot segments", () => {
    expect(cwdOf("cd a && cd b && git status", "git")).toEqual({ path: "a/b" });
    expect(cwdOf("cd a/b && cd .. && git status", "git")).toEqual({ path: "a" });
    expect(cwdOf("cd a && cd /abs && git status", "git")).toEqual({ path: "/abs" });
  });

  it("scopes a cd inside a subshell to that subshell", () => {
    const inv = parse("(cd x; git add) ; git status").invocations.filter((i) => i.program === "git");
    expect(inv[0]?.cwd).toEqual({ path: "x" });
    expect(inv[1]?.cwd).toBeNull();
  });

  it("marks a cd it cannot resolve", () => {
    for (const cmd of ["cd $DIR && git status", "cd - && git status", "cd && git status", "cd \"$(pwd)/x\" && git status", "pushd x && git status", "cd ~ && git status"]) {
      expect(cwdOf(cmd, "git"), cmd).toEqual({ unresolvable: true });
    }
  });

  it("applies the cd to commands inside a later bash -c", () => {
    const inv = parse("cd x && bash -c 'git add'").invocations.find((i) => i.program === "git");
    expect(inv?.cwd).toEqual({ path: "x" });
  });
});

describe("guard/parse: heredocs", () => {
  it("attaches a heredoc body to the command that reads it, and does not run the body", () => {
    const r = parse("cat <<EOF\ngit push\nEOF\necho done");
    expect(r.invocations.map((i) => i.program)).toEqual(["cat", "echo"]);
    expect(r.invocations[0]?.heredoc).toEqual({ delimiter: "EOF", quoted: false, body: "git push\n" });
    expect(r.problems).toEqual([]);
  });

  it("records a quoted delimiter and a dash form", () => {
    expect(first("cat <<'EOF'\nx\nEOF").heredoc).toEqual({ delimiter: "EOF", quoted: true, body: "x\n" });
    expect(first("cat <<-EOF\n\tx\n\tEOF").heredoc).toEqual({ delimiter: "EOF", quoted: false, body: "x\n" });
    expect(first("cat <<\"EOF\"\nx\nEOF").heredoc?.quoted).toBe(true);
  });

  it("keeps an interpreter's heredoc body without running it as shell", () => {
    const r = parse("python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['git','push'])\nEOF");
    expect(r.invocations.map((i) => i.program)).toEqual(["python3"]);
    expect(r.invocations[0]?.heredoc?.body).toContain("subprocess.run");
  });

  it("parses the body of a heredoc fed to a shell", () => {
    const r = parse("bash <<EOF\ngit push\nEOF");
    expect(r.invocations.map((i) => i.program)).toEqual(["bash", "git"]);
    expect(r.invocations[1]?.via).toEqual(["heredoc-script"]);
    expect(programs("sh -s <<'EOF'\ngh pr list\nEOF")).toContain("gh");
  });

  it("handles several heredocs on one line and text after the heredoc line", () => {
    const r = parse("cat <<A <<B\none\nA\ntwo\nB\ngit status");
    expect(r.invocations.map((i) => i.program)).toEqual(["cat", "git"]);
  });

  it("handles a heredoc inside a pipeline and a chain", () => {
    const r = parse("cat <<EOF | grep x && git push\nline\nEOF");
    expect(r.invocations.map((i) => i.program)).toEqual(["cat", "grep", "git"]);
  });

  it("is not fooled by a here-string or a << inside quotes", () => {
    expect(programs("cat <<< 'git push'")).toEqual(["cat"]);
    expect(programs("echo '<<EOF' && git status")).toEqual(["echo", "git"]);
  });

  it("runs substitutions inside an unquoted heredoc body, as the shell does, but not inside a quoted one", () => {
    expect(programs("cat <<EOF\n$(git push)\nEOF")).toEqual(["cat", "git"]);
    expect(programs("cat <<EOF\n`git push`\nEOF")).toEqual(["cat", "git"]);
    expect(programs("cat <<'EOF'\n$(git push)\nEOF")).toEqual(["cat"]);
    expect(programs("cat <<EOF\n\\$(git push)\nEOF")).toEqual(["cat"]);
  });

  it("reports a heredoc that never closes, keeping what it read", () => {
    const r = parse("cat <<EOF\nstill going");
    expect(r.problems.join(" ")).toMatch(/heredoc/);
    expect(r.invocations[0]?.heredoc?.body).toBe("still going");
  });
});

describe("guard/parse: malformed input", () => {
  it("reports an unterminated quote or substitution without throwing", () => {
    expect(parse("echo 'abc").problems.join(" ")).toMatch(/quote/);
    expect(parse("echo \"abc").problems.join(" ")).toMatch(/quote/);
    expect(parse("echo $(git push").problems.join(" ")).toMatch(/substitution/);
    expect(parse("echo `git push").problems.join(" ")).toMatch(/substitution/);
  });

  it("still finds a command after an unbalanced parenthesis", () => {
    expect(programs("a) git push")).toContain("git");
    expect(programs("echo ) ; git push")).toContain("git");
  });

  it("never throws, whatever the input, and always returns arrays", () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = ["git", " ", "push", "'", "\"", "`", "$(", ")", "(", ";", "&&", "|", "<<", "EOF", "\n", "\\", "-c", "bash", "#", "$", "{", "}", "<(", ">", "2>&1", "=", "x"];
    for (let n = 0; n < 3000; n++) {
      let s = "";
      for (let k = rand(25); k > 0; k--) s += alphabet[rand(alphabet.length)];
      const r = parse(s);
      expect(Array.isArray(r.invocations), s).toBe(true);
      expect(Array.isArray(r.problems), s).toBe(true);
    }
  });

  it("stays fast on pathological input: every shape finishes well inside a hook's budget", () => {
    const shapes: Record<string, string> = {
      "unclosed substitutions": "$(".repeat(50000),
      "unclosed backticks": "`".repeat(50001),
      "unclosed quotes": "'".repeat(100001),
      "quoted substitutions": '"$('.repeat(30000),
      "heredoc operators": "<<".repeat(30000),
      "many heredocs": "cat <<A\n".repeat(2000) + "x\n",
      "open parens": "(".repeat(50000),
      "open braces": "${".repeat(30000),
      "backslashes": "\\".repeat(50000),
      "wrapper chain": "env ".repeat(5000) + "git push",
      "wide nesting": Array.from({ length: 2000 }, () => "bash -c 'echo $(echo x)'").join("; "),
    };
    for (const [name, s] of Object.entries(shapes)) {
      const start = Date.now();
      parse(s);
      expect(Date.now() - start, name).toBeLessThan(1500);
    }
  });

  it("finds the command behind a long wrapper chain", () => {
    expect(programs("env ".repeat(1000) + "git push")).toEqual(["git"]);
  });

  it("accepts non-string input without throwing", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(parse(bad as unknown as string)).toEqual({ invocations: [], problems: [] });
    }
  });
});
