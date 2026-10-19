// ui/progress.ts — task progress rendering (spinners, step lists).
//
// Thin over clack's task log / spinner. Non-TTY contexts render nothing and
// invoke the task body directly, so progress calls are safe in CI and hooks.

import * as p from "@clack/prompts";
import { isInteractive } from "./prompts.ts";

export interface Task {
  /** Short title shown while the task runs. */
  title: string;
  /** Body; return a one-line completed message. */
  task: () => string | Promise<string>;
}

/**
 * Run tasks in sequence, showing clack's task list when interactive. Returns
 * each task's completion message in order (empty array when non-interactive).
 */
export async function taskLog(tasks: Task[]): Promise<string[]> {
  if (!isInteractive()) {
    const results: string[] = [];
    for (const t of tasks) results.push(await t.task());
    return results;
  }
  const messages: string[] = [];
  await p.tasks(tasks.map((t) => ({
    title: t.title,
    task: async () => {
      const msg = await t.task();
      messages.push(msg);
      return msg;
    },
  })));
  return messages;
}

/**
 * Indeterminate spinner around a single body. Shows clack's spinner while the
 * body runs, stops it with `message` on success. Returns the body's value.
 * Non-interactive runs just call the body.
 */
export async function spinner<T>(message: string, body: () => T | Promise<T>): Promise<T> {
  if (!isInteractive()) return await body();
  const s = p.spinner();
  s.start(message);
  try {
    return await body();
  } finally {
    s.stop(message);
  }
}
