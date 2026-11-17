// editorIsNoninteractive: the one deny-list behind repo-commit's editor gate
// and prepare-commit-msg's no-op-editor warning.
import { describe, expect, it } from "vitest";
import { editorIsNoninteractive } from "../../lib/core/editor.ts";

describe("core/editor editorIsNoninteractive", () => {
  it("refuses the no-op sentinels", () => {
    for (const e of [":", "true", ".", "/bin/true", "exit", "echo", "cat", "tee", "touch", "rm", "sleep"]) {
      expect(editorIsNoninteractive(e), e).toBe(true);
    }
  });

  it("refuses shells used as the editor", () => {
    for (const e of ["sh -c x", "bash", "/bin/dash", "zsh", "ksh", "ash"]) {
      expect(editorIsNoninteractive(e), e).toBe(true);
    }
  });

  it("looks through wrappers and leading assignments to the real command", () => {
    expect(editorIsNoninteractive("env true")).toBe(true);
    expect(editorIsNoninteractive("nice -n 5 true")).toBe(true);
    expect(editorIsNoninteractive("FOO=1 BAR=2 :")).toBe(true);
    expect(editorIsNoninteractive("env FOO=1 nano")).toBe(false);
    expect(editorIsNoninteractive("timeout 30 vim")).toBe(false);
  });

  it("looks through value-taking wrapper options", () => {
    for (const e of [
      "env -u FOO true",
      "env -C /tmp true",
      "env -S true",
      "env --unset FOO true",
      "stdbuf -o L true",
      "stdbuf -i0 -o L -e 0 true",
      "timeout -s KILL 5 true",
      "timeout -k 1 5 true",
      "timeout 5 true",
      "timeout --signal KILL 5 true",
      "nice -n 5 true",
      "ionice -c 3 true",
      "ionice -c 2 -n 7 true",
      "nohup true",
      "setsid true",
      "time -p true",
      "command true",
      "exec -a x true",
      "/usr/bin/env FOO=1 -u BAR true",
    ]) {
      expect(editorIsNoninteractive(e), e).toBe(true);
    }
  });

  it("does not mistake a wrapper's option operand for the command word", () => {
    expect(editorIsNoninteractive("env -u FOO nano")).toBe(false);
    expect(editorIsNoninteractive("timeout -s KILL 30 vim")).toBe(false);
    expect(editorIsNoninteractive("stdbuf -o L vim")).toBe(false);
    expect(editorIsNoninteractive("nice -n 5 vim")).toBe(false);
  });

  it("treats any shell metacharacter in the editor string as non-interactive", () => {
    for (const e of ["true;", "(true)", '"true"', "'true'", "vim; true", "vim | cat", "vim && true", "vim &", "$EDITOR", "`true`", "vim > /dev/null", "vim < /dev/null", "vim # x", "vim\ntrue", "\\true"]) {
      expect(editorIsNoninteractive(e), e).toBe(true);
    }
  });

  it("refuses interpreters and stream editors running a scripted action", () => {
    for (const e of [
      "python3 -c pass",
      "python -c pass",
      "perl -e 1",
      "perl -E 1",
      "node -e 0",
      "node --eval 0",
      "sed -i s/a/b/",
      "sed s/a/b/",
      "ex -s",
      "vim -es",
      "vim -Es",
      "nvim -es",
      "printf x",
      "xargs true",
      "xargs",
      "busybox true",
      "sudo true",
      "sudo -u root true",
    ]) {
      expect(editorIsNoninteractive(e), e).toBe(true);
    }
  });

  it("still accepts real editors behind wrappers and interpreter-named paths", () => {
    for (const e of ["sudo -u root vim", "busybox vi", "xargs -o vim", "vim -u NONE", "nvim", "emacs -nw", "env -u FOO code --wait"]) {
      expect(editorIsNoninteractive(e), e).toBe(false);
    }
  });

  it("treats an empty command as nothing to run", () => {
    expect(editorIsNoninteractive("")).toBe(true);
    expect(editorIsNoninteractive("   ")).toBe(true);
    expect(editorIsNoninteractive("env")).toBe(true);
  });

  it("accepts real editors", () => {
    for (const e of ["nano", "vim", "code --wait", "/usr/bin/emacs -nw", "subl -w", "vim +10", "vim -c startinsert", "vim -u NONE"]) {
      expect(editorIsNoninteractive(e), e).toBe(false);
    }
  });

  it("looks up wrappers by own property: prototype-key names are plain commands, never a crash", () => {
    for (const e of ["constructor", "toString -x", "__proto__", "hasOwnProperty foo", "valueOf"]) {
      expect(() => editorIsNoninteractive(e), e).not.toThrow();
      expect(editorIsNoninteractive(e), e).toBe(false);
    }
  });

  it("refuses the vi family when an ex command saves and quits at once", () => {
    for (const e of ["vim +wq", "vim -c wq", "vim -u NONE -c x", "vi +x", "nvim -c qa!", "vim +q!"]) {
      expect(editorIsNoninteractive(e), e).toBe(true);
    }
  });
});
