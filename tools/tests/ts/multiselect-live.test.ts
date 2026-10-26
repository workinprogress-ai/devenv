// Live MultiSelectPrompt render contract: the frame must show ALL toggled
// rows as checked (13.10 finding C — the renderer once read clack's
// focused-only _value, so exactly the cursor row ever rendered checked).
// Drives the real prompt through pipes and inspects the rendered frame.
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { MultiSelectPrompt } from "@clack/core";
import { multiselectFrame } from "../../lib/ui/prompts.ts";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");

describe("multiselect live render", () => {
  it("shows every toggled row checked while navigating (public value, not _value)", async () => {
    const inp = new PassThrough();
    const out = new PassThrough();
    let lastFrame = "";
    const prompt = new MultiSelectPrompt<{ value: [string, string] }>({
      options: ["a", "b", "c"].map((l) => ({ value: [l, l] as [string, string], disabled: false })),
      required: false,
      input: inp,
      output: out,
      render(this: MultiSelectPrompt<{ value: [string, string] }>) {
        const self = this as unknown as {
          state: string;
          cursor: number;
          value: [string, string][];
          _enabledOptions: Array<{ value: [string, string]; disabled?: boolean }>;
        };
        lastFrame = multiselectFrame(
          "pick",
          self._enabledOptions,
          self.value ?? [],
          self.cursor,
          "idle",
        );
        return lastFrame;
      },
    });
    const done = prompt.prompt();
    const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
    inp.write(" "); await settle(80);   // check a
    inp.write("\x1b[B"); await settle(80);
    inp.write(" "); await settle(80);   // check b
    await settle(80);
    const plain = stripAnsi(lastFrame);
    expect(plain).toContain("◼ a");
    expect(plain).toContain("◼ b");
    expect(plain).toContain("◻ c");
    expect(plain).toContain("❯ ◼ b"); // focus moved with the cursor
    inp.write("\r"); await settle(50);
    await done;
  }, 10_000);
});
