// forward-argv.ts — split an argv into the part a tool parses itself and the
// part it forwards verbatim to a child command.
//
// A forwarding tool cannot hand its whole argv to a strict parser: the child's
// own flags (`ls -la`, `echo -n`, `git log --since=...`) are not the tool's to
// judge. The split point is fixed by position, never by scanning the forwarded
// part, so a child flag can never be mistaken for one of the tool's own.
//
// Strip-only compatible: no parameter properties, enums, or namespaces.

const HOUSE_FLAGS = new Set(["-h", "--help", "-v", "--version", "-V", "--verbose"]);

export interface SplitArgv {
  /** Tokens the tool parses (strictly) itself. */
  head: string[];
  /** Tokens forwarded verbatim; never inspected. */
  rest: string[];
}

/** Split after the first command word: the tool's own options (those in
 * `valueFlags` consume the next token as their value) may precede it, the word
 * itself stays in `head`, and everything after it is forwarded. A `--` ends
 * option scanning; the token following it is the command word. */
export function splitAtCommandWord(argv: string[], valueFlags: readonly string[]): SplitArgv {
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") {
      const end = Math.min(i + 2, argv.length);
      return { head: argv.slice(0, end), rest: argv.slice(end) };
    }
    if (a.startsWith("-") && a !== "-") {
      i += valueFlags.includes(a) ? 2 : 1;
      continue;
    }
    return { head: argv.slice(0, i + 1), rest: argv.slice(i + 1) };
  }
  return { head: argv.slice(), rest: [] };
}

/** Split for the pod-addressed forwarders (`tool <pod> [-n NS] <command>...`).
 * The pod word is found as in `splitAtCommandWord`; then the tool's own
 * namespace option is accepted in any of its forms (`-n NS`, `--namespace NS`,
 * `-nNS`, `--namespace=NS`) directly after the pod, repeatedly. The attached
 * short form is any token that starts with a short flag and is longer than it,
 * so `-nginx` is namespace `ginx` and `-n=x` is namespace `=x`; a space-separated
 * value is taken whatever it looks like (`-n -f` is namespace `-f`). Scanning stops
 * at the first token that is not a namespace form: that token and everything
 * after it is forwarded, so the child's own `-n`/`-h`/`-f` are never read. A
 * `--` right after the pod ends scanning and is consumed. A namespace flag
 * with no value is left in `head` alone so the strict parser reports it. */
export function splitAfterPodWord(argv: string[], valueFlags: readonly string[]): SplitArgv {
  const first = splitAtCommandWord(argv, valueFlags);
  const head = first.head.slice();
  const rest = first.rest;
  const last = head[head.length - 1];
  // No pod word was found (or `--` ended scanning with no word after it).
  if (rest.length === 0 && (last === undefined || last.startsWith("-"))) return first;
  const long = valueFlags.filter((f) => f.startsWith("--"));
  const short = valueFlags.filter((f) => !f.startsWith("--"));
  let i = 0;
  while (i < rest.length) {
    const a = rest[i] as string;
    if (a === "--") {
      i++;
      break;
    }
    if (valueFlags.includes(a)) {
      head.push(a);
      i++;
      if (i < rest.length) head.push(rest[i++] as string);
      continue;
    }
    const attached =
      long.some((f) => a.startsWith(`${f}=`)) ||
      short.some((f) => a.length > f.length && a.startsWith(f) && !a.startsWith("--"));
    if (attached) {
      head.push(a);
      i++;
      continue;
    }
    break;
  }
  return { head, rest: rest.slice(i) };
}

/** Split after the leading run of house flags (-h/-v/-V and long forms): they
 * are the tool's; the first other token and everything after it is forwarded.
 * A leading `--` is consumed so a forwarded argument can look like a house
 * flag (`tool -- --help`). */
export function splitLeadingHouseFlags(argv: string[]): SplitArgv {
  let i = 0;
  while (i < argv.length && HOUSE_FLAGS.has(argv[i] as string)) i++;
  if (argv[i] === "--") i++;
  return { head: argv.slice(0, i), rest: argv.slice(i) };
}
