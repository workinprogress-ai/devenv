// /devenv-commit must say what to do when repo-commit still refuses for lack of
// a terminal: stop, never fake a terminal, and hand the user the exact command
// for their own terminal. It must also tell the user, before the VS Code tab
// opens, how to commit and how to cancel — the person watching the tab does not
// see the tool's terminal output.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "copilot", "skills", "devenv-commit", "SKILL.md"),
  "utf8",
);

describe("devenv-commit skill: no-terminal handling", () => {
  it("documents the no-terminal refusal as a stop that hands the command to the user's terminal", () => {
    expect(SKILL).toMatch(/No-terminal refusal/);
    expect(SKILL).toMatch(/without a terminal/);
    expect(SKILL).toMatch(/repo-commit --file <message-file>/);
    expect(SKILL).toMatch(/own terminal/);
  });

  it("forbids faking a terminal or supplying an editor to get past the refusal", () => {
    expect(SKILL).toMatch(/never fake a terminal/i);
    expect(SKILL).toMatch(/pty/);
    expect(SKILL).toMatch(/GIT_EDITOR/);
  });

  it("tells the user in chat how the VS Code tab commits and cancels before invoking", () => {
    expect(SKILL).toMatch(/VS Code tab/);
    expect(SKILL).toMatch(/empty the message and save/i);
    expect(SKILL).toMatch(/closing an unchanged tab commits/i);
  });
});
