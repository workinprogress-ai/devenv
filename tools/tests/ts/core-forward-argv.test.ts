// The argv splitters used by tools that forward the rest of their argv to a
// child command: the split is fixed by position, so the child's own flags are
// never read as the tool's.
import { describe, expect, it } from "vitest";
import { splitAfterPodWord, splitAtCommandWord, splitLeadingHouseFlags } from "../../lib/core/forward-argv.ts";

const NS = ["-n", "--namespace"];

describe("splitAtCommandWord", () => {
  it("keeps the command word in head and forwards everything after it", () => {
    expect(splitAtCommandWord(["-V", "ls", "-la"], NS)).toEqual({ head: ["-V", "ls"], rest: ["-la"] });
  });

  it("a value flag consumes the next token even when it looks like a flag (`-n -f`)", () => {
    expect(splitAtCommandWord(["-n", "-f"], NS)).toEqual({ head: ["-n", "-f"], rest: [] });
    expect(splitAtCommandWord(["-n", "-f", "cmd", "x"], NS)).toEqual({ head: ["-n", "-f", "cmd"], rest: ["x"] });
  });

  it("a value flag consumes an empty value (`-n ''`)", () => {
    expect(splitAtCommandWord(["-n", "", "cmd", "x"], NS)).toEqual({ head: ["-n", "", "cmd"], rest: ["x"] });
  });

  it("an attached short form is an ordinary flag here, not a command word (`-nginx`)", () => {
    expect(splitAtCommandWord(["-nginx", "cmd", "x"], NS)).toEqual({ head: ["-nginx", "cmd"], rest: ["x"] });
  });

  it("a lone '-' is a command word, not a flag", () => {
    expect(splitAtCommandWord(["-", "x"], NS)).toEqual({ head: ["-"], rest: ["x"] });
  });

  it("`--` makes the next token the command word and forwards the rest verbatim", () => {
    expect(splitAtCommandWord(["--", "cmd", "--help"], NS)).toEqual({ head: ["--", "cmd"], rest: ["--help"] });
  });

  it("a leading `--` followed by nothing yields an empty rest", () => {
    expect(splitAtCommandWord(["--"], NS)).toEqual({ head: ["--"], rest: [] });
  });

  it("an empty argv splits into two empty parts", () => {
    expect(splitAtCommandWord([], NS)).toEqual({ head: [], rest: [] });
  });
});

describe("splitAfterPodWord", () => {
  it("takes the namespace option after the pod in every form and forwards the command", () => {
    expect(splitAfterPodWord(["pod", "-n", "ns", "ls", "-n"], NS)).toEqual({ head: ["pod", "-n", "ns"], rest: ["ls", "-n"] });
    expect(splitAfterPodWord(["pod", "--namespace", "ns", "ls"], NS)).toEqual({ head: ["pod", "--namespace", "ns"], rest: ["ls"] });
    expect(splitAfterPodWord(["pod", "--namespace=ns", "ls"], NS)).toEqual({ head: ["pod", "--namespace=ns"], rest: ["ls"] });
  });

  it("an attached short form is consumed as the namespace: `-nginx` is namespace 'ginx'", () => {
    expect(splitAfterPodWord(["pod", "-nginx", "ls"], NS)).toEqual({ head: ["pod", "-nginx"], rest: ["ls"] });
  });

  it("`-n=x` is the attached short form with namespace '=x'", () => {
    expect(splitAfterPodWord(["pod", "-n=x", "ls"], NS)).toEqual({ head: ["pod", "-n=x"], rest: ["ls"] });
  });

  it("`-n -f` takes '-f' as the namespace value", () => {
    expect(splitAfterPodWord(["pod", "-n", "-f", "ls"], NS)).toEqual({ head: ["pod", "-n", "-f"], rest: ["ls"] });
  });

  it("`-n ''` takes the empty string as the namespace value", () => {
    expect(splitAfterPodWord(["pod", "-n", "", "ls"], NS)).toEqual({ head: ["pod", "-n", ""], rest: ["ls"] });
  });

  it("a namespace flag with no value stays in head alone", () => {
    expect(splitAfterPodWord(["pod", "-n"], NS)).toEqual({ head: ["pod", "-n"], rest: [] });
  });

  it("duplicate namespace options are all kept in head, for the strict parser to judge", () => {
    expect(splitAfterPodWord(["pod", "-n", "a", "-n", "b", "ls"], NS)).toEqual({
      head: ["pod", "-n", "a", "-n", "b"],
      rest: ["ls"],
    });
  });

  it("a lone '-' is the pod word", () => {
    expect(splitAfterPodWord(["-", "ls"], NS)).toEqual({ head: ["-"], rest: ["ls"] });
  });

  it("the child's own flags after the command are never read (`-h`, `-f`)", () => {
    expect(splitAfterPodWord(["pod", "ls", "-n", "x", "-h"], NS)).toEqual({ head: ["pod"], rest: ["ls", "-n", "x", "-h"] });
  });

  it("a `--` right after the pod ends scanning and is consumed", () => {
    expect(splitAfterPodWord(["pod", "--", "-n", "x"], NS)).toEqual({ head: ["pod"], rest: ["-n", "x"] });
  });

  it("a leading `--` followed by nothing is returned unsplit", () => {
    expect(splitAfterPodWord(["--"], NS)).toEqual({ head: ["--"], rest: [] });
  });

  it("no pod word at all returns the flags as head", () => {
    expect(splitAfterPodWord(["-V"], NS)).toEqual({ head: ["-V"], rest: [] });
  });
});

describe("splitLeadingHouseFlags", () => {
  it("splits after the leading run of house flags", () => {
    expect(splitLeadingHouseFlags(["-V", "--verbose", "cmd", "--help"])).toEqual({ head: ["-V", "--verbose"], rest: ["cmd", "--help"] });
  });

  it("a leading `--` ends the house flags (kept in head) so a forwarded argument may look like one", () => {
    expect(splitLeadingHouseFlags(["--", "--help"])).toEqual({ head: ["--"], rest: ["--help"] });
    expect(splitLeadingHouseFlags(["-v", "--", "-h"])).toEqual({ head: ["-v", "--"], rest: ["-h"] });
  });

  it("a leading `--` followed by nothing leaves it in head and forwards nothing", () => {
    expect(splitLeadingHouseFlags(["--"])).toEqual({ head: ["--"], rest: [] });
  });

  it("a house flag after the first forwarded token is forwarded, not read", () => {
    expect(splitLeadingHouseFlags(["cmd", "-h"])).toEqual({ head: [], rest: ["cmd", "-h"] });
  });
});
