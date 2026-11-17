// Unit tests for the teardown logic the live provider smoke suites share and
// for the pure cleanup helpers of the GitHub suite. They import only those
// modules, never a suite, so no backend can be reached.
import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import {
  createTeardown,
  installSignalHandlers,
  InterruptedError,
  ResourceCapError,
} from "../../lib/providers/smoke-teardown.ts";
import { ProviderError } from "../../lib/providers/provider-core.ts";
import { ignoreNotFound, isNotFound, settleDeleteAttempts } from "../../lib/providers/azure/live-guards.ts";
import { absentOk, lacksDeleteRepo, notFoundOk, parseOAuthScopes, scrubTokens } from "../../lib/providers/github/live-guards.ts";

function harness(cap = 10, inflightWaitMs?: number) {
  const out: string[] = [];
  const err: string[] = [];
  const td = createTeardown({
    cap,
    ...(inflightWaitMs === undefined ? {} : { inflightWaitMs }),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    verbose: true,
    leftoverHints: () => ["hint: find leftovers by prefix"],
  });
  return { td, out, err };
}

/** A promise settled from the outside, to hold a cleanup open. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });
  return { promise, open };
}

describe("shared smoke teardown", () => {
  it("cleans up newest first", async () => {
    const { td } = harness();
    const order: string[] = [];
    td.record("a", "1", "m1", () => void order.push("a"));
    td.record("b", "2", "m2", () => void order.push("b"));
    td.record("c", "3", "m3", () => void order.push("c"));
    await td.teardown();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("continues past a failing cleanup and reports it with its manual command", async () => {
    const { td, err } = harness();
    const order: string[] = [];
    td.record("first", "1", "manual-first", () => void order.push("first"));
    td.record("broken", "2", "manual-broken", () => {
      throw new Error("boom\nsecond line");
    });
    td.record("last", "3", "manual-last", () => void order.push("last"));
    await td.teardown();
    expect(order).toEqual(["last", "first"]);
    expect(td.failedCount()).toBe(1);
    const text = err.join("\n");
    expect(text).toContain("TEARDOWN FAILED: broken 2 — boom");
    expect(text).not.toContain("second line");
    expect(text).toContain("TEARDOWN INCOMPLETE");
    expect(text).toContain("broken 2: manual-broken");
    expect(text).toContain("hint: find leftovers by prefix");
    expect(text).not.toContain("manual-last");
  });

  it("is idempotent: a second call returns the same promise and does not rerun", async () => {
    const { td } = harness();
    let runs = 0;
    const hold = gate();
    td.record("slow", "1", "m", async () => {
      runs++;
      await hold.promise;
    });
    const first = td.teardown();
    const second = td.teardown();
    expect(second).toBe(first);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled, "the second call must wait for the run in progress").toBe(false);
    hold.open();
    await second;
    expect(await td.teardown()).toBeUndefined();
    expect(runs).toBe(1);
  });

  it("cleans a resource recorded after teardown began immediately and waits for it", async () => {
    const { td, err } = harness();
    const hold = gate();
    const ran: string[] = [];
    td.record("early", "1", "m", async () => {
      ran.push("early");
      await hold.promise;
    });
    const done = td.teardown();
    // An operation that was still in flight records its resource now.
    const lateGate = gate();
    td.record("late", "2", "m", async () => {
      ran.push("late");
      await lateGate.promise;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(ran).toContain("late");
    expect(err.join("\n")).toContain("late 2 was created while the run was shutting down");
    hold.open();
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled, "teardown waits for the late cleanup").toBe(false);
    lateGate.open();
    await done;
    expect(settled).toBe(true);
    expect(td.recordedCount()).toBe(2);
  });

  it("reports a failed late cleanup with its manual command", async () => {
    const { td, err } = harness();
    const done = td.teardown();
    td.record("late", "9", "manual-late", () => {
      throw new Error("nope");
    });
    await done;
    expect(td.failedCount()).toBe(1);
    expect(err.join("\n")).toContain("manual-late");
  });

  it("throws on the cap, and still cleans the resource that went over it", async () => {
    const { td } = harness(2);
    const cleaned: string[] = [];
    td.record("a", "1", "m", () => void cleaned.push("a"));
    td.assertCapacity();
    td.record("b", "2", "m", () => void cleaned.push("b"));
    expect(() => td.assertCapacity()).toThrow(ResourceCapError);
    expect(() => td.record("c", "3", "m", () => void cleaned.push("c"))).toThrow(ResourceCapError);
    await td.teardown();
    expect(cleaned).toEqual(["c", "b", "a"]);
  });

  it("flags an interrupt and unwinds callers through throwIfInterrupted", () => {
    const { td } = harness();
    expect(td.isInterrupted()).toBe(false);
    expect(() => td.throwIfInterrupted()).not.toThrow();
    td.markInterrupted();
    expect(td.isInterrupted()).toBe(true);
    expect(() => td.throwIfInterrupted()).toThrow(InterruptedError);
  });
});

describe("shared smoke teardown: in-flight creates and unconfirmed resources", () => {
  it("waits for an in-flight create and then cleans the resource it produced", async () => {
    const { td } = harness();
    let exists = false;
    const hold = gate();
    td.record("repo", "r1", "m", () => {
      // Cleanup of a resource whose create has not landed would find nothing.
      if (!exists) return;
      exists = false;
    });
    const create = td.inflight(
      hold.promise.then(() => {
        exists = true;
        return "created";
      }),
    );
    const done = td.teardown();
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled, "teardown waits for the in-flight create").toBe(false);
    hold.open();
    expect(await create).toBe("created");
    await done;
    expect(exists, "the late create was cleaned").toBe(false);
  });

  it("returns the original promise, so a rejection still reaches the caller", async () => {
    const { td } = harness();
    await expect(td.inflight(Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    await td.teardown();
  });

  it("re-checks for create calls registered while it waits", async () => {
    const { td } = harness();
    const first = gate();
    const second = gate();
    const order: string[] = [];
    td.record("x", "1", "m", () => void order.push("cleanup"));
    void td.inflight(first.promise.then(() => void order.push("first landed")));
    const done = td.teardown();
    await new Promise((r) => setTimeout(r, 5));
    void td.inflight(second.promise.then(() => void order.push("second landed")));
    first.open();
    await new Promise((r) => setTimeout(r, 5));
    second.open();
    await done;
    expect(order).toEqual(["first landed", "second landed", "cleanup"]);
  });

  it("gives up waiting after the bound, says the create may exist and still finishes", async () => {
    const { td, err } = harness(10, 30);
    const never = gate();
    const cleaned: string[] = [];
    td.record("repo", "r1", "m", () => void cleaned.push("repo"));
    void td.inflight(never.promise, "gh repo delete owner/name --yes");
    await td.teardown();
    const text = err.join("\n");
    expect(text).toMatch(/create still in flight after [0-9.]+s; it may exist: gh repo delete owner\/name --yes/);
    expect(cleaned).toEqual(["repo"]);
    never.open();
  });

  it("reports a failed cleanup of an unconfirmed resource as a notice only", async () => {
    const { td, err } = harness();
    td.record(
      "team",
      "t1",
      "manual-team",
      () => {
        throw new Error("HTTP 403: Forbidden");
      },
      false,
    );
    await td.teardown();
    const text = err.join("\n");
    expect(td.failedCount()).toBe(0);
    expect(text).toContain("notice: cleanup attempted for a resource whose create was never confirmed; nothing to remove: team t1");
    expect(text).toContain("HTTP 403: Forbidden");
    expect(text).not.toContain("TEARDOWN INCOMPLETE");
    expect(text).not.toContain("TEARDOWN FAILED");
  });

  it("still fails a confirmed resource whose cleanup fails", async () => {
    const { td, err } = harness();
    const handle = td.record(
      "team",
      "t1",
      "manual-team",
      () => {
        throw new Error("HTTP 403: Forbidden");
      },
      false,
    );
    handle.confirm();
    td.record("project", "p1", "manual-project", () => {
      throw new Error("also broken");
    });
    await td.teardown();
    const text = err.join("\n");
    expect(td.failedCount()).toBe(2);
    expect(text).toContain("TEARDOWN INCOMPLETE");
    expect(text).toContain("team t1: manual-team");
    expect(text).toContain("project p1: manual-project");
  });

  it("lists the manual commands of the recorded items newest first, then the hints", () => {
    const { td } = harness();
    td.record("a", "1", "manual-a", () => undefined);
    td.record("b", "2", "manual-b", () => undefined);
    expect(td.manualCommands()).toEqual(["  b 2: manual-b", "  a 1: manual-a", "hint: find leftovers by prefix"]);
  });
});

describe("shared smoke signal handling", () => {
  function wired() {
    const h = harness();
    const host = new EventEmitter();
    const exits: number[] = [];
    installSignalHandlers(h.td, { host, exit: (c) => void exits.push(c), err: (l) => h.err.push(l) });
    return { ...h, host, exits };
  }

  it("a repeated signal prints a notice, does not exit and waits for teardown", async () => {
    const { td, err, host, exits } = wired();
    const hold = gate();
    let runs = 0;
    td.record("slow", "1", "m", async () => {
      runs++;
      await hold.promise;
    });
    host.emit("SIGINT");
    host.emit("SIGINT");
    host.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([]);
    expect(err.filter((l) => l.includes("teardown in progress"))).toHaveLength(2);
    const text = err.join("\n");
    expect(text).toContain("kill -9");
    expect(text).toContain("SIGQUIT");
    expect(text).toContain("slow 1: m");
    expect(td.isInterrupted()).toBe(true);
    hold.open();
    await td.teardown();
    await new Promise((r) => setTimeout(r, 5));
    expect(exits).toEqual([130]);
    expect(runs).toBe(1);
  });

  it("the normal-path teardown awaits the run a signal started", async () => {
    const { td, host, exits } = wired();
    const hold = gate();
    td.record("slow", "1", "m", () => hold.promise);
    host.emit("SIGTERM");
    let mainDone = false;
    const main = td.teardown().then(() => {
      mainDone = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mainDone).toBe(false);
    expect(exits).toEqual([]);
    hold.open();
    await main;
    await new Promise((r) => setTimeout(r, 5));
    expect(exits).toEqual([130]);
  });

  it("an uncaught error runs teardown and then exits 1", async () => {
    const { td, err, host, exits } = wired();
    let cleaned = false;
    td.record("x", "1", "m", () => {
      cleaned = true;
    });
    host.emit("uncaughtException", new Error("kaboom"));
    await td.teardown();
    await new Promise((r) => setTimeout(r, 5));
    expect(cleaned).toBe(true);
    expect(exits).toEqual([1]);
    expect(err.join("\n")).toContain("kaboom");
  });

  it("an uncaught error marks the run interrupted so scenarios stop creating", async () => {
    const { td, host, exits } = wired();
    expect(td.isInterrupted()).toBe(false);
    host.emit("unhandledRejection", new Error("late failure"));
    expect(td.isInterrupted()).toBe(true);
    expect(() => td.throwIfInterrupted()).toThrow(InterruptedError);
    await td.teardown();
    await new Promise((r) => setTimeout(r, 5));
    expect(exits).toEqual([1]);
  });

  it("an unhandled rejection after an interrupt exits 130, not 1", async () => {
    const { td, host, exits } = wired();
    host.emit("SIGINT");
    host.emit("unhandledRejection", new InterruptedError());
    await td.teardown();
    await new Promise((r) => setTimeout(r, 5));
    expect(exits).toEqual([130, 130]);
  });
});

describe("github cleanup matchers", () => {
  const r = (status: number, stderr = "") => ({ status, stderr });

  it("notFoundOk accepts success, HTTP 404 and Not Found", () => {
    expect(notFoundOk(r(0))).toBe(true);
    expect(notFoundOk(r(1, "gh: Not Found (HTTP 404)"))).toBe(true);
    expect(notFoundOk(r(1, "HTTP 404: Not Found (https://api.github.com/orgs/x/teams/y)"))).toBe(true);
  });

  it("notFoundOk rejects a validation failure and a message that merely says already", () => {
    expect(notFoundOk(r(1, "gh: Validation Failed (HTTP 422)"))).toBe(false);
    expect(notFoundOk(r(1, "the project was already scheduled for removal"))).toBe(false);
    expect(notFoundOk(r(1, "HTTP 403: Forbidden"))).toBe(false);
    expect(notFoundOk(r(1, "HTTP 4040 oddity"))).toBe(false);
  });

  it("absentOk keeps its broader tolerance for items inside the throwaway repository", () => {
    expect(absentOk(r(1, "HTTP 422: already exists"))).toBe(true);
    expect(absentOk(r(1, "does not exist"))).toBe(true);
    expect(absentOk(r(1, "HTTP 500"))).toBe(false);
  });

  it("parses the token scopes from the response header block", () => {
    const withScopes = "HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, read:org, delete_repo\r\nX-Ratelimit-Limit: 5000\r\n\r\n{\"login\":\"x\"}";
    expect(parseOAuthScopes(withScopes)).toEqual(["repo", "read:org", "delete_repo"]);
    expect(parseOAuthScopes("HTTP/2.0 200 OK\nx-oauth-scopes: \n\n{}")).toEqual([]);
    expect(parseOAuthScopes("HTTP/2.0 200 OK\nContent-Type: application/json\n\n{\"x-oauth-scopes\":\"repo\"}")).toBeNull();
  });

  it("refuses only when the scope list is known and lacks delete_repo", () => {
    expect(lacksDeleteRepo(null)).toBe(false);
    expect(lacksDeleteRepo(["repo", "read:org"])).toBe(true);
    expect(lacksDeleteRepo([])).toBe(true);
    expect(lacksDeleteRepo(["repo", "delete_repo"])).toBe(false);
  });
});

describe("azure cleanup helpers", () => {
  it("isNotFound accepts only a provider error carrying HTTP 404", () => {
    expect(isNotFound(new ProviderError("HTTP 404", 404))).toBe(true);
    expect(isNotFound(new ProviderError("bad request", 400))).toBe(false);
    expect(isNotFound(new ProviderError("gave up after 3 attempt(s)"))).toBe(false);
    expect(isNotFound(new Error("404 not found"))).toBe(false);
    expect(isNotFound("404")).toBe(false);
  });

  it("ignoreNotFound swallows a 404 and rethrows everything else", async () => {
    await expect(ignoreNotFound(Promise.resolve("ok"))).resolves.toBeUndefined();
    await expect(ignoreNotFound(Promise.reject(new ProviderError("gone", 404)))).resolves.toBeUndefined();
    await expect(ignoreNotFound(Promise.reject(new ProviderError("forbidden", 403)))).rejects.toThrow("forbidden");
    await expect(ignoreNotFound(Promise.reject(new Error("network")))).rejects.toThrow("network");
  });

  it("settleDeleteAttempts runs every variant and succeeds when one worked", async () => {
    const ran: string[] = [];
    await settleDeleteAttempts([
      async () => {
        ran.push("a");
        throw new ProviderError("destroy refused", 400);
      },
      async () => void ran.push("b"),
      async () => {
        ran.push("c");
        throw new ProviderError("gone", 404);
      },
    ]);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  it("settleDeleteAttempts treats a not-found as already removed", async () => {
    await expect(settleDeleteAttempts([async () => Promise.reject(new ProviderError("gone", 404))])).resolves.toBeUndefined();
  });

  it("settleDeleteAttempts throws the first error when no variant worked", async () => {
    await expect(
      settleDeleteAttempts([
        async () => Promise.reject(new ProviderError("first refusal", 400)),
        async () => Promise.reject(new ProviderError("second refusal", 403)),
      ]),
    ).rejects.toThrow("first refusal");
  });

  it("a surviving repository reported through the shared teardown fails the run", async () => {
    const { td, err } = harness();
    const handle = td.record(
      "repository",
      "smoke-repo-1-2",
      "manual-repo",
      () => settleDeleteAttempts([async () => Promise.reject(new ProviderError("refused", 400))]),
      false,
    );
    handle.confirm();
    await td.teardown();
    expect(td.failedCount()).toBe(1);
    expect(err.join("\n")).toContain("TEARDOWN INCOMPLETE");
  });
});

describe("scrubTokens", () => {
  it("redacts token-shaped text and the literal environment tokens", () => {
    const pat = `ghp_${"a".repeat(30)}`;
    const fine = `github_pat_${"B".repeat(30)}`;
    expect(scrubTokens(`token ${pat} and ${fine}`, {})).toBe("token [redacted] and [redacted]");
    expect(scrubTokens("value s3cr3t-value-123 here", { GH_TOKEN: "s3cr3t-value-123" })).toBe("value [redacted] here");
    expect(scrubTokens("short abc here", { GITHUB_TOKEN: "abc" })).toBe("short abc here");
    expect(scrubTokens("nothing to hide", {})).toBe("nothing to hide");
  });
});
