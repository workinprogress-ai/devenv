// ui/prompts.ts — interactive prompts (confirm/select/multiSelect/text) with
// declared non-TTY fallbacks.
//
// clack requires a TTY; the workspace's tools run in CI, hooks, and nested
// shells where stdin is often not a terminal. Each wrapper therefore checks
// isInteractive() first and resolves with the caller-declared fallback value
// instead of entering the clack renderer. Interactive richness when a TTY
// exists; deterministic behavior everywhere else.

import * as p from "@clack/prompts";
import { MultiSelectPrompt } from "@clack/core";
import pc from "picocolors";

/** Whether an interactive clack session is possible (TTY stdin + stdout). */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export interface PromptOptions<T> {
  /** Message shown above the prompt. */
  message: string;
  /** Value returned when no TTY is available (or the user cancels). */
  fallback: T;
}

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Map our option shape onto clack's (hint only when declared — the repo's
 * exactOptionalPropertyTypes setting forbids explicit undefined). clack's
 * Option<T> is a conditional type TS can't verify from an object literal, so
 * the mapped array is cast at the boundary; values flow through unchanged. */
type ClackSelectOptions<T> = p.SelectOptions<T>;
function toClackOptions<T>(options: SelectOption<T>[]): ClackSelectOptions<T>["options"] {
  return options.map((o) =>
    o.hint !== undefined
      ? { value: o.value, label: o.label, hint: o.hint }
      : { value: o.value, label: o.label }
  ) as ClackSelectOptions<T>["options"];
}

/** Yes/no confirmation. Resolves `fallback` when non-interactive or cancelled. */
export async function confirm(opts: PromptOptions<boolean>): Promise<boolean> {
  if (!isInteractive()) return opts.fallback;
  const v = await p.confirm({ message: opts.message });
  if (p.isCancel(v)) return opts.fallback;
  return v;
}

/** Single choice from a list. Resolves `fallback` when non-interactive/cancelled. */
export async function select<T>(opts: PromptOptions<T> & { options: SelectOption<T>[] }): Promise<T> {
  if (!isInteractive()) return opts.fallback;
  const v = await p.select({
    message: opts.message,
    options: toClackOptions(opts.options),
  });
  if (p.isCancel(v)) return opts.fallback;
  return v;
}

/** Multiple choices. Resolves `fallback` when non-interactive/cancelled.
 *
 * Renders through @clack/core's MultiSelectPrompt with our own frame instead
 * of @clack/prompts' multiselect: clack marks the focused row only with a
 * checkbox COLOR (cyan vs dim on the same glyph), which vanishes entirely in
 * color-less profiles (VS Code pipes, FORCE_COLOR off, some themes) — the
 * reported "no visible indication of which row is focused". Our frame adds a
 * color-independent cursor column (`❯`) and keeps clack's checked/unchecked
 * glyph difference (◼ vs ◻), so focus is always visible. */
/** The multiselect frame: bar + cursor column + checkbox + label per row.
 * Exported for the render test (focus must be visible color-independently). */
export function multiselectFrame<T>(
  message: string,
  enabled: Array<{ value: [T, string]; disabled?: boolean }>,
  selected: Array<[T, string]>,
  focused: number,
  state: "idle" | "submit" | "cancel",
): string {
  // Membership by value (not tuple identity): the frame renders selection
  // for whichever pairs carry the same value, however the caller holds them.
  const chosen = new Set(selected.map(([v]) => v));
  const bar = pc.dim("│");
  if (state === "submit" || state === "cancel") {
    const labels = enabled.filter((o) => chosen.has(o.value[0])).map((o) => o.value[1]);
    const head = state === "cancel"
      ? `${pc.dim("└")}  ${pc.strikethrough(pc.dim(labels.join(", ")))}`
      : `${pc.dim("└")}  ${pc.green(labels.join(", "))}`;
    return `${pc.dim("┌")}  ${message}\n${head}\n`;
  }
  const rows = enabled.map((o, i) => {
    const label = o.value[1];
    const checked = chosen.has(o.value[0]);
    const box = checked ? pc.green("◼") : pc.dim("◻");
    const cursor = i === focused ? pc.cyan("❯") : " ";
    return `${bar}  ${cursor} ${box} ${checked ? pc.bold(label) : label}`;
  });
  const instructions = pc.dim("space to select · enter to submit");
  return [
    `${pc.dim("┌")}  ${message}`,
    ...rows,
    `${pc.dim("└")}  ${instructions}`,
    "",
  ].join("\n");
}

export async function multiSelect<T>(
  opts: PromptOptions<T[]> & { options: SelectOption<T>[], required?: boolean },
): Promise<T[]> {
  if (!isInteractive()) return opts.fallback;
  const required = opts.required ?? false;

  const prompt = new MultiSelectPrompt<{ value: [T, string] }>({
    options: opts.options.map((o) => ({ value: [o.value, o.label] as [T, string], disabled: false })),
    required,
    render(this: MultiSelectPrompt<{ value: [T, string] }>) {
      // The renderer reads state/cursor/options and the private selected
      // set; those internals are reached through a cast (clack's render
      // contract hands `this` as the full prompt instance).
      const self = this as unknown as {
        state: string;
        cursor: number;
        _enabledOptions: Array<{ value: [T, string]; disabled?: boolean }>;
        _value: [T, string][];
      };
      return multiselectFrame(
        opts.message,
        self._enabledOptions,
        self._value ?? [],
        self.cursor,
        self.state === "submit" ? "submit" : self.state === "cancel" ? "cancel" : "idle",
      );
    },
  });
  // Core resolves with the selected option VALUES (the [value, label]
  // tuples) — not the option objects.
  const v = (await prompt.prompt()) as unknown;
  if (v === undefined || typeof v !== "object" || p.isCancel(v)) {
    return opts.fallback;
  }
  return (v as Array<[T, string]>).map((pair) => pair[0]);
}

/** Free-text input. Resolves `fallback` when non-interactive/cancelled/empty. */
export async function text(opts: PromptOptions<string> & { placeholder?: string }): Promise<string> {
  if (!isInteractive()) return opts.fallback;
  const v = await p.text({
    message: opts.message,
    ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
  });
  if (p.isCancel(v) || v.trim() === "") return opts.fallback;
  return v;
}
