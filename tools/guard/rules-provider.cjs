// rules-provider.cjs — the provider rule of the command guard.
//
// Forks of this workspace use different git hosts, so a session may not talk to any
// host directly: not through its CLI, and not through its API with curl or wget.
// The workspace's provider-neutral wrappers (issue-*, pr-*, project-*, pipelines-*)
// are the only supported path, which also keeps repo targeting and auth in one place.
//
//   - A program in the policy's CLI union is refused outright, or by subcommand where
//     the policy names subcommands (`az devops ...` is refused, `az account show` is not).
//     There is no carve-out for auth: sign-in goes through the provider facade.
//   - curl and wget are refused only when a URL's host is one of the policy's API
//     hosts (a host entry covers its subdomains; an entry with a path prefix covers
//     only that path). Release downloads and web pages on the same vendor's other
//     hosts pass.
//
// The rule judges what the parser resolved; it cannot see a program or URL built at
// run time. The deny text is the policy's provider-neutral instruction plus what was
// blocked: the program name, and for a fetch the host, never the arguments.
//
// CommonJS with no dependencies.
"use strict";

const NAME = "provider";
const FETCHERS = new Set(["curl", "wget"]);

// Options whose next word is a value, not a URL.
const VALUE_OPTIONS = {
  curl: new Set([
    "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--data-ascii", "-o", "--output",
    "-u", "--user", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie", "-c", "--cookie-jar", "-F", "--form",
    "-T", "--upload-file", "-X", "--request", "-w", "--write-out", "-x", "--proxy", "-m", "--max-time", "--connect-timeout",
    "-K", "--config", "-r", "--range", "--retry", "-E", "--cert", "--cacert", "--resolve", "--connect-to",
  ]),
  wget: new Set([
    "-O", "--output-document", "-o", "--output-file", "-U", "--user-agent", "--header", "--post-data", "--post-file",
    "-e", "--execute", "-P", "--directory-prefix", "-t", "--tries", "-T", "--timeout", "--user", "--password",
    "-i", "--input-file", "-B", "--base", "--referer", "--load-cookies", "--save-cookies",
  ]),
};
const SHORT_VALUE_LETTERS = {
  curl: new Set(["H", "d", "o", "u", "A", "e", "b", "c", "F", "T", "X", "w", "x", "m", "K", "r", "E"]),
  wget: new Set(["O", "o", "U", "e", "P", "t", "T", "i", "B"]),
};

/** True when host (and path) belong to one of the policy's API hosts. */
function matchApiHost(policy, host, pathname) {
  const h = String(host).toLowerCase();
  return policy.provider.apiHosts.some((entry) => {
    if (h !== entry.host && !h.endsWith(`.${entry.host}`)) return false;
    return entry.pathPrefix === undefined || String(pathname).startsWith(entry.pathPrefix);
  });
}

/** Read an argument as a URL or a bare host; null when it is neither or cannot be known. */
function hostAndPath(arg) {
  if (/[$`]/.test(arg)) return null; // built at run time
  let candidate = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) candidate = arg;
  else if (/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(arg)) candidate = `http://${arg}`;
  if (candidate === null) return null;
  try {
    const u = new URL(candidate);
    return { host: u.hostname, pathname: u.pathname || "/" };
  } catch {
    return null;
  }
}

/** The URL-like words of a curl or wget command, skipping the values of options. */
function urlCandidates(program, args) {
  const values = VALUE_OPTIONS[program];
  const letters = SHORT_VALUE_LETTERS[program];
  const found = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--url") {
      if (args[i + 1] !== undefined) found.push(args[i + 1]);
      i++;
    } else if (a.startsWith("--url=")) found.push(a.slice("--url=".length));
    else if (a.startsWith("--")) {
      if (!a.includes("=") && values.has(a)) i++;
    } else if (a.startsWith("-") && a.length > 1) {
      if (values.has(a)) i++;
      else if (a.length > 2 && letters.has(a[a.length - 1])) i++;
    } else found.push(a);
  }
  return found;
}

function evaluate(invocations, ctx) {
  const policy = ctx.policy;
  for (const inv of invocations) {
    if (inv.program === null) continue;
    const cli = policy.provider.clis.find((c) => c.name === inv.program);
    if (cli !== undefined) {
      const blocked =
        cli.subcommands === undefined ||
        inv.args
          .filter((a) => !a.startsWith("-"))
          .slice(0, 2)
          .some((a) => cli.subcommands.includes(a));
      if (blocked) return { reason: `${policy.provider.denyText} Blocked: ${inv.program}.` };
      continue;
    }
    if (FETCHERS.has(inv.program)) {
      for (const word of urlCandidates(inv.program, inv.args)) {
        const target = hostAndPath(word);
        if (target !== null && matchApiHost(policy, target.host, target.pathname)) {
          return { reason: `${policy.provider.denyText} Blocked: ${inv.program} to ${target.host.toLowerCase()}.` };
        }
      }
    }
  }
  return null;
}

module.exports = { name: NAME, evaluate, matchApiHost };
