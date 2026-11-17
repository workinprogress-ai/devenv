// secret.ts — obtain a credential from the environment or a hidden terminal prompt.
//
// A credential is never a literal in a tool and never an argument: it comes
// from the named environment variable, or is typed at a terminal with echo off.
// A non-interactive session without the variable has no way to ask, so the
// caller gets null and decides how to refuse.
import { spawnSync } from "node:child_process";
import { isInteractive } from "../ui/prompts.ts";

/** Returns the secret from `envName`, else a hidden /dev/tty prompt, else null. */
export function resolveSecret(envName: string, promptLabel: string): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (!isInteractive()) return null;
  process.stdout.write(`${promptLabel}: `);
  const r = spawnSync("bash", ["-c", "read -r -s answer < /dev/tty; printf '%s' \"$answer\""], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  process.stdout.write("\n");
  const typed = r.stdout ?? "";
  return typed === "" ? null : typed;
}
