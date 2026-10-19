// ui/prompts.ts — interactive prompts (confirm/select/multiSelect/text) with
// declared non-TTY fallbacks.
//
// clack requires a TTY; the workspace's tools run in CI, hooks, and nested
// shells where stdin is often not a terminal. Each wrapper therefore checks
// isInteractive() first and resolves with the caller-declared fallback value
// instead of entering the clack renderer. Interactive richness when a TTY
// exists; deterministic behavior everywhere else.

import * as p from "@clack/prompts";

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

/** Multiple choices. Resolves `fallback` when non-interactive/cancelled. */
export async function multiSelect<T>(
  opts: PromptOptions<T[]> & { options: SelectOption<T>[], required?: boolean },
): Promise<T[]> {
  if (!isInteractive()) return opts.fallback;
  const v = await p.multiselect({
    message: opts.message,
    options: toClackOptions(opts.options),
    required: opts.required ?? false,
  });
  if (p.isCancel(v)) return opts.fallback;
  return v;
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
