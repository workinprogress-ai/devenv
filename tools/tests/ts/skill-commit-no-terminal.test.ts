// /devenv-commit must route no-TTY AI sessions through the structured
// approval broker, keep the native VS Code path truthful, and never treat chat
// acknowledgement or an environment-supplied editor as human approval.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "copilot", "skills", "devenv-commit", "SKILL.md"),
  "utf8",
);

describe("devenv-commit skill: no-terminal handling", () => {
  it("documents the broker request, structured prompt, and exact resume", () => {
    expect(SKILL).toMatch(/No-TTY AI broker flow/);
    expect(SKILL).toMatch(/--approval-session <token>/);
    expect(SKILL).toMatch(/--approval-request <request-path>/);
    expect(SKILL).toMatch(/--approval-response <response-path>/);
    expect(SKILL).toMatch(/approval-request=<path>/);
    expect(SKILL).toMatch(/structured host prompt/);
  });

  it("requires an explicit typed decision and rejects plain chat acknowledgement", () => {
    expect(SKILL).toMatch(/approve as shown/);
    expect(SKILL).toMatch(/edit and approve/);
    expect(SKILL).toMatch(/cancel/);
    expect(SKILL).toMatch(/plain "yes"/);
    expect(SKILL).toMatch(/looks good/);
    expect(SKILL).toMatch(/ordinary chat acknowledgement is not approval/i);
  });

  it("keeps terminal handoff as an explicit unsupported-host fallback", () => {
    expect(SKILL).toMatch(/No-terminal broker refusal/);
    expect(SKILL).toMatch(/host cannot collect structured user input/);
    expect(SKILL).toMatch(/repo-commit --file <message-file>/);
    expect(SKILL).toMatch(/interactive terminal/);
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

  it("treats a tracked timeout during the editor wait as still in progress", () => {
    expect(SKILL).toMatch(/without an arbitrary caller deadline/i);
    expect(SKILL).toMatch(/tracked.*still in progress|still tracked\/backgrounded/i);
    expect(SKILL).toMatch(/tracked completion notification/);
    expect(SKILL).toMatch(/do not ask the editor-abort interview/i);
  });

  it("requires repository-specific message contracts before the hook run", () => {
    expect(SKILL).toMatch(/Repository-specific commit contracts/);
    expect(SKILL).toMatch(/Devenv-Action/);
    expect(SKILL).toMatch(/commit-action-check --message-file <message-file>/);
    expect(SKILL).toMatch(/before opening the editor/i);
  });
});
