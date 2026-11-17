// secret.ts — obtain a credential from the environment or a hidden terminal prompt.
//
// A credential is never a literal in a tool and never an argument: it comes
// from the named environment variable, or is typed at a terminal with echo off.
// A non-interactive session without the variable has no way to ask, so the
// caller gets null and decides how to refuse.
import { spawnSync } from "node:child_process";
import { isInteractive } from "../ui/prompts.ts";

// Restores the terminal settings captured before the hidden read. The trap covers
// normal completion (EXIT) and termination signals; INT/TERM exit explicitly so a
// signalled read never continues past the handler.
const HIDDEN_READ = [
  'saved=$(stty -g < /dev/tty 2>/dev/null)',
  'restore() { [ -n "$saved" ] && stty "$saved" < /dev/tty 2>/dev/null; }',
  "trap restore EXIT",
  "trap 'restore; exit 130' INT TERM",
  "read -r -s answer < /dev/tty",
  "printf '%s' \"$answer\"",
].join("; ");

/** Returns the secret from `envName`, else a hidden /dev/tty prompt, else null. */
export function resolveSecret(envName: string, promptLabel: string): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (!isInteractive()) return null;
  // The prompt goes to stderr so a caller capturing stdout never receives it.
  process.stderr.write(`${promptLabel}: `);
  // Capture the terminal state here as well: if the bash child is killed without
  // running its trap, echo is still restored once the child has returned.
  const before = spawnSync("bash", ["-c", "stty -g < /dev/tty"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] });
  const r = spawnSync("bash", ["-c", HIDDEN_READ], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  const saved = before.status === 0 ? (before.stdout ?? "").trim() : "";
  if (saved !== "") spawnSync("bash", ["-c", 'stty "$1" < /dev/tty', "bash", saved], { stdio: "ignore" });
  process.stderr.write("\n");
  const typed = r.status === 0 ? (r.stdout ?? "") : "";
  return typed === "" ? null : typed;
}
