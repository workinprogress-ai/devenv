// Behavioral tests for the text-UI library: non-TTY fallbacks (the contract
// every tool relies on in CI/hooks) and pure string rendering. clack's
// interactive rendering itself is third-party and only exercised in a TTY.
import { describe, expect, it } from "vitest";
import { confirm, isInteractive, multiSelect, select, text } from "../../lib/ui/prompts.ts";
import { taskLog, spinner } from "../../lib/ui/progress.ts";
import { box, heading, kvTable, styles } from "../../lib/ui/panels.ts";

// picocolors colors regardless of TTY under vitest; assertions run against
// stripped output so they test content, not color codes.
const strip = (s: string): string => s.replace(/\u001B\[[0-9;]*m/g, "");

// vitest's stdin is not a TTY — the whole suite therefore exercises the
// non-interactive contract, which is exactly the behavior tools depend on.
describe("isInteractive", () => {
  it("reports false under vitest (no TTY)", () => {
    expect(isInteractive()).toBe(false);
  });
});

describe("non-TTY fallbacks", () => {
  it("confirm resolves the fallback", async () => {
    expect(await confirm({ message: "ok?", fallback: true })).toBe(true);
    expect(await confirm({ message: "ok?", fallback: false })).toBe(false);
  });

  it("select resolves the fallback", async () => {
    const v = await select({
      message: "pick",
      fallback: "b",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
    expect(v).toBe("b");
  });

  it("multiSelect resolves the fallback", async () => {
    const v = await multiSelect({
      message: "pick many",
      fallback: ["x"],
      options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }],
    });
    expect(v).toEqual(["x"]);
  });

  it("text resolves the fallback", async () => {
    expect(await text({ message: "name?", fallback: "default-name" })).toBe("default-name");
  });
});

describe("progress non-TTY passthrough", () => {
  it("taskLog runs bodies directly and returns their messages", async () => {
    const ran: string[] = [];
    const msgs = await taskLog([
      { title: "first", task: () => { ran.push("1"); return "one done"; } },
      { title: "second", task: async () => { ran.push("2"); return "two done"; } },
    ]);
    expect(ran).toEqual(["1", "2"]);
    expect(msgs).toEqual(["one done", "two done"]);
  });

  it("spinner runs the body and returns its value", async () => {
    const v = await spinner("working", () => 42);
    expect(v).toBe(42);
  });
});

describe("panel rendering", () => {
  it("heading underlines the title", () => {
    const h = heading("Setup");
    expect(h).toContain("Setup");
    expect(h).toContain("─".repeat(5));
  });

  it("kvTable pads keys to the widest", () => {
    const t = strip(kvTable([{ key: "a", value: "1" }, { key: "long-key", value: "2" }]));
    expect(t).toContain("a         1");
    expect(t).toContain("long-key  2");
  });

  it("box draws a closed frame", () => {
    const b = strip(box(["hello", "hi"]));
    expect(b).toContain("┌───────┐");
    expect(b).toContain("│ hello │");
    expect(b).toContain("│ hi    │");
    expect(b).toContain("└───────┘");
  });

  it("styles map to picocolors functions", () => {
    expect(typeof styles.success("x")).toBe("string");
    expect(styles.success("x")).toContain("x");
  });
});
