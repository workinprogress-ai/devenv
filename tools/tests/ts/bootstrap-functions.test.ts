// Port of tools/tests/devenv/test_bootstrap_functions.bats (140 tests) — the
// bootstrap family port, kept as ONE suite per the settled 16.5 approach.
//
// The subject is the bash bootstrap pair (.devcontainer/bootstrap.sh +
// bootstrap.bash) plus its stay-bash provisioning libraries (tools/lib/
// provision.bash, copilot-knowledge.bash, tool-versions.bash): per doctrine
// these stay bash — the tests move to vitest, the source does not. The bats
// assertions are the oracle; the port keeps every contract line:
//   - structural/source greps (syntax, key functions, wiring, doc locks)
//   - executed contracts (task runners, entry path, lock, download_verified,
//     install_yq pins, nvm activation, provider feeds, seed-token flow)
//   - function-extraction runs (sed-extract a function body, source, run)
// with the bats harness idioms mapped: TEST_TEMP_DIR → tmp root, `run bash -c`
// → spawnSync("bash", ["-c", …]), `lines[-1]` → last stdout line, stubbed
// PATH dirs → tmp bin dirs written per test.
//
// Scratch-dir guard: every fixture path goes through tmpPath(), which refuses
// to hand out a path unless TMP is an absolute directory under os.tmpdir().
// (An earlier intermediate state of this suite lost its beforeEach, TMP fell
// back to "" and fixtures landed in the repo root — this guard makes that
// failure mode impossible instead of silent.)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const BOOTSTRAP_SH = join(ROOT, ".devcontainer", "bootstrap.sh");
const BOOTSTRAP_BASH = join(ROOT, ".devcontainer", "bootstrap.bash");
const TOOL_VERSIONS = join(ROOT, ".devcontainer", "tool-versions.bash");
const CONTAINER_START = join(ROOT, ".devcontainer", "container-start.sh");
const STARTUP_SH = join(ROOT, ".devcontainer", "startup.sh");
const POST_UPDATE = join(ROOT, ".devcontainer", "post-update.bash");
const PROVISION = join(ROOT, "tools", "lib", "provision.bash");
const COPILOT_KNOWLEDGE = join(ROOT, "tools", "lib", "copilot-knowledge.bash");
const CONFIG_READER = join(ROOT, "tools", "lib", "config-reader.bash");
const SETUP_FIRST_RUN = join(ROOT, "tools", "ts", "setup.ts");
const CUSTOMIZATION_DOC = join(ROOT, "docs", "Bootstrap-Customization.md");

let TMP = "";

// The single doorway to the suite's scratch space: throws unless TMP is an
// absolute path under the OS temp dir. All fixture paths are built through
// this, so a broken hook can never redirect writes into the repo (or anywhere
// else outside tmp).
function tmpPath(...parts: string[]): string {
  const base = tmpdir();
  if (!TMP || !isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(
      `scratch-dir guard: TMP=${JSON.stringify(TMP)} is not an absolute path under ${base} — refusing to write test artifacts outside the OS temp dir`,
    );
  }
  return join(TMP, ...parts);
}

const src = (p: string): string => readFileSync(p, "utf8");

function sh(script: string): { status: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: process.env as Record<string, string> });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Execute a bash snippet that may contain arbitrary quotes (extracted function
// bodies): write it to a temp file and run `bash <file>` with the environment
// composed from the given vars. Immune to the quote-nesting the bats suite
// sidestepped by double-quoting through `run bash -c`.
function runSnippet(script: string, env: Record<string, string> = {}): { status: number; stdout: string; stderr: string; out: string } {
  const f = tmpPath(`snippet-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, script);
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  for (const [k, v] of Object.entries(env)) e[k] = v;
  const r = spawnSync("bash", [f], { encoding: "utf8", env: e });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// sed-extract a function body from a bash file (the bats helper idiom).
function extractFn(file: string, fn: string): string {
  return sh(`sed -n '/^${fn}()/,/^}/p' '${file}'`).stdout;
}

// Task names of one runner array in bootstrap.bash, one per line (bats helper).
// Escape shape matters: the fn-match lines carry \\( to awk (matching the bats
// bytes); the terminator carries \) — a doubled \\) would never match the
// array's closing paren and the extraction would run to EOF.
function runnerTasks(fn: string, arr: string): string[] {
  return sh(
    `awk -v fn=${fn} -v arr=${arr} ` +
      `'$0 ~ "^" fn "\\\\(\\\\) \\\\{" { in_fn=1 } ` +
      `in_fn && $0 ~ "(local )?" arr "=\\\\(" { in_arr=1; next } ` +
      `in_arr && /^[[:space:]]*\\)/ { exit } ` +
      `in_arr { gsub(/[[:space:]]/, ""); if ($0 != "") print }' '${BOOTSTRAP_BASH}'`,
  )
    .stdout.split("\n")
    .filter((l) => l.trim() !== "");
}

// default_tasks/update_tasks line numbers within the extracted list — used for
// the ordering assertions the bats suite made with grep -n arithmetic.
function taskIndex(tasks: string[], name: string): number {
  const i = tasks.indexOf(name);
  expect(i, `task ${name} not in list`).toBeGreaterThanOrEqual(0);
  return i;
}

// The tasks only the full bootstrap runs: they reset or remove state, which a
// convergent update must never do.
const DESTRUCTIVE_TASKS = ["finish_message", "init_bootstrap_run_time", "reset_bashrc_to_original"];

// ── fixture helpers mirroring the bats setup helpers ────────────────────────

function setupBootstrapEntryFixture(): { entryToolbox: string; entryLog: string } {
  const entryToolbox = tmpPath(`entry-toolbox-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(entryToolbox, ".devcontainer"), { recursive: true });
  const lib = src(BOOTSTRAP_BASH) + "\n" + ['stub_ok_task() { echo "STUB_OK_MARKER"; }', 'stub_fail_task() { echo "STUB_FAIL_MARKER"; return 1; }', ""].join("\n");
  writeFileSync(join(entryToolbox, ".devcontainer", "bootstrap.bash"), lib);
  spawnSync("cp", [BOOTSTRAP_SH, join(entryToolbox, ".devcontainer", "bootstrap.sh")]);
  return { entryToolbox, entryLog: join(entryToolbox, ".runtime", "bootstrap.log") };
}

function runBootstrapEntry(entryToolbox: string, task: string, env: Record<string, string> = {}): { status: number; out: string } {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  e["DEVENV_ROOT"] = "";
  for (const [k, v] of Object.entries(env)) e[k] = v;
  const r = spawnSync("bash", [join(entryToolbox, ".devcontainer", "bootstrap.sh"), task], { encoding: "utf8", env: e });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function setupClaudeFixture(): { toolbox: string; homeDir: string } {
  const toolbox = tmpPath(`claude-toolbox-${Math.random().toString(36).slice(2)}`);
  const homeDir = tmpPath(`claude-home-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(toolbox, "copilot", "skills", "devenv-fixture"), { recursive: true });
  mkdirSync(join(toolbox, "copilot", "skills", "common"), { recursive: true });
  writeFileSync(join(toolbox, "copilot", "copilot-instructions.md"), "# Instructions\n");
  writeFileSync(join(toolbox, "copilot", "skills", "devenv-fixture", "SKILL.md"), "---\nname: devenv-fixture\ndescription: Synthetic test skill\n---\n# Fixture\n");
  writeFileSync(join(toolbox, "copilot", "skills", "common", "reference.md"), "# Shared reference\n");
  writeFileSync(join(toolbox, "copilot", "skills", "_tools-reference.md"), "# Tools reference\n");
  return { toolbox, homeDir };
}

// Extract the installer functions and run install_claude_code_integration in
// a scratch HOME (bats run_claude_installer).
function runClaudeInstaller(toolbox: string, homeDir: string): { status: number; out: string } {
  const funcs = extractFn(PROVISION, "link_replacing_symlink_only") + "\n" + extractFn(PROVISION, "install_claude_code_integration");
  return runSnippet(`${funcs}\ninstall_claude_code_integration\n`, {
    toolbox_root: toolbox,
    HOME: homeDir,
  });
}

function makeSetupDir(tag: string): string {
  const dir = tmpPath(`.setup-${tag}`);
  mkdirSync(dir, { recursive: true });
  for (const f of ["name.txt", "email.txt", "provider_org.txt", "provider_user.txt"]) {
    writeFileSync(join(dir, f), "value\n");
  }
  return dir;
}

function requireSetupFilesRun(setupDir: string): { status: number; out: string } {
  const fn = extractFn(BOOTSTRAP_BASH, "require_setup_files");
  return runSnippet(`${fn}\nrequire_setup_files\n`, { setup_dir: setupDir });
}

// Runs bootstrap's configure_* functions against a provider's real hooks with
// the credential/identity/dotnet seams stubbed. Returns the dotnet call log.
// preSeed runs after the scratch HOME exists and before the function runs
// (the bats fixtures pre-seeded ~/.npmrc there).
function runFeedConfig(
  provider: string,
  fn: string,
  extraEnv: Record<string, string> = {},
  preSeed?: (homeDir: string) => void,
): { status: number; out: string; dotnetLog: string; homeDir: string } {
  const homeDir = tmpPath(`feed-home-${provider}-${fn}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(homeDir, { recursive: true });
  if (preSeed) preSeed(homeDir);
  mkdirSync(tmpPath("dotnet-bin"), { recursive: true });
  const dotnetLog = tmpPath(`dotnet-${provider}-${fn}-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(dotnetLog, "");
  writeFileSync(
    join(tmpPath("dotnet-bin"), "dotnet"),
    ['#!/usr/bin/env bash', 'if [ "$1 $2 $3" = "nuget list source" ]; then printf \'%s\\n\' "${DOTNET_LIST:-}"; exit 0; fi', 'printf \'%s\\n\' "$*" >> "$DOTNET_LOG"', "exit 0", ""].join("\n"),
  );
  chmodSync(join(tmpPath("dotnet-bin"), "dotnet"), 0o755);
  const funcs = extractFn(PROVISION, "add_nuget_source_if_not_exists") + "\n" + extractFn(PROVISION, "configure_nuget_sources") + "\n" + extractFn(PROVISION, "configure_user_npmrc");
  const script =
    `source '${join(ROOT, "tools", "lib", "providers", "provider-core.bash")}'\n` +
    `PROVIDER_NAME=${provider}\n` +
    `provider_load bootstrap\n` +
    `ensure_provider_seam() { :; }\n` +
    `provider_secret_get() { echo feed-token-123; }\n` +
    `provider_org_get() { echo the-org; }\n` +
    `provider_user_get() { echo the-user; }\n` +
    `config_read_value() { echo 'https://nuget.pkg.github.com/the-org/index.json'; }\n` +
    `${funcs}\n` +
    `${fn}\n`;
  const f = tmpPath(`feed-${provider}-${fn}-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, script);
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  e["HOME"] = homeDir;
  e["DOTNET_LOG"] = dotnetLog;
  e["DOTNET_LIST"] = extraEnv.DOTNET_LIST ?? "";
  e["toolbox_root"] = TMP;
  e["dotnet_cmd"] = join(tmpPath("dotnet-bin"), "dotnet");
  e["DEVENV_TOOLS"] = join(ROOT, "tools");
  for (const [k, v] of Object.entries(extraEnv)) e[k] = v;
  const r = spawnSync("bash", [f], { encoding: "utf8", env: e });
  return {
    status: r.status ?? 1,
    out: (r.stdout ?? "") + (r.stderr ?? ""),
    dotnetLog: existsSync(dotnetLog) ? readFileSync(dotnetLog, "utf8") : "",
    homeDir,
  };
}

// Runs bootstrap's require_provider_token (no terminal) with a seed token and
// a stubbed validator. validateRc: 0 accept / 1 reject / 2 unreachable.
function runSeedFlow(opts: { validateRc?: number; importRc?: number } = {}): { status: number; out: string; importLog: string; setupDir: string } {
  const setupDir = tmpPath(`seed-setup-${Math.random().toString(36).slice(2)}`);
  mkdirSync(setupDir, { recursive: true });
  writeFileSync(join(setupDir, "provider_token.txt"), "seed-token-abc");
  writeFileSync(join(setupDir, "provider_user.txt"), "the-user");
  writeFileSync(join(setupDir, "provider_org.txt"), "the-org");
  const importLog = tmpPath(`import-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(importLog, "");
  const funcs = extractFn(BOOTSTRAP_BASH, "_bootstrap_is_interactive") + "\n" + extractFn(BOOTSTRAP_BASH, "require_provider_token");
  const hook = opts.validateRc !== undefined ? `provider_bootstrap_validate_token() { cat >/dev/null; return ${opts.validateRc}; }\n` : "";
  const script =
    `source '${join(ROOT, "tools", "lib", "providers", "provider-core.bash")}'\n` +
    `ensure_provider_seam() { :; }\n` +
    `provider_auth_status() { return 1; }\n` +
    `provider_auth_import_token() { cat > "$IMPORT_LOG"; return ${opts.importRc ?? 0}; }\n` +
    `${hook}${funcs}\n` +
    `require_provider_token </dev/null\n` +
    `echo "RC=$?"\n`;
  const f = tmpPath(`seed-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, script);
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  e["DEVENV_TOOLS"] = join(ROOT, "tools");
  e["setup_dir"] = setupDir;
  e["IMPORT_LOG"] = importLog;
  e["email_file"] = "/nonexistent";
  e["name_file"] = "/nonexistent";
  const r = spawnSync("bash", [f], { encoding: "utf8", env: e });
  return {
    status: r.status ?? 1,
    out: (r.stdout ?? "") + (r.stderr ?? ""),
    importLog: existsSync(importLog) ? readFileSync(importLog, "utf8") : "",
    setupDir,
  };
}

// stub_runner: sources bootstrap.bash, replaces every task with a recorder
// (optionally one that fails), runs the runner in a throwaway HOME.
function stubRunner(runner: string, failing = ""): { status: number; out: string; calls: string } {
  const home = tmpPath(`runner-home-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  const calls = tmpPath(`calls-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(calls, "");
  const tasks = runnerTasks("run_bootstrap_tasks", "default_tasks").join(" ");
  const script = [
    `source '${BOOTSTRAP_BASH}'`,
    `for t in ${tasks}; do`,
    `  eval "$t() { echo $t >> '${calls}'; return $([ '${failing}' = "$t" ] && echo 1 || echo 0); }"`,
    "done",
    runner,
    "",
  ].join("\n");
  const f = tmpPath(`stub-runner-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(f, script);
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  e["HOME"] = home;
  const r = spawnSync("bash", [f], { encoding: "utf8", env: e });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), calls: readFileSync(calls, "utf8").trimEnd() };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `bootfn-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── structural: syntax, source-of-truth wiring, key functions ───────────────

describe("bootstrap: structural contracts", () => {
  it("bootstrap.sh has valid bash syntax", () => {
    expect(sh(`bash -n '${BOOTSTRAP_SH}'`).status).toBe(0);
  });

  it("bootstrap.bash has valid bash syntax", () => {
    expect(sh(`bash -n '${BOOTSTRAP_BASH}'`).status).toBe(0);
  });

  it("bootstrap.sh sources bootstrap.bash library", () => {
    expect(src(BOOTSTRAP_SH)).toMatch(/source.*bootstrap\.bash/);
  });

  it("bootstrap.bash declares key functions", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/^(initialize_paths|detect_architecture|ensure_home_is_set|ensure_bash_is_default_shell|install_yq|load_version_info|run_bootstrap_tasks)\(\)/m);
  });

  it("bootstrap.bash defines on_error function", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/^on_error\(\)/m);
  });

  it("call_npm returns npm exit status from pipeline", () => {
    expect(src(BOOTSTRAP_BASH)).toContain('return "${PIPESTATUS[0]}"');
  });

  it("bootstrap.sh sources error handling library if available", () => {
    const r = sh(`
      script_path='${BOOTSTRAP_SH}'
      script_folder=$(dirname "$script_path")
      toolbox_root=$(dirname "$script_folder")
      if [ -f "$toolbox_root/tools/lib/error-handling.bash" ]; then
        echo 'library_exists'
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("library_exists");
    expect(existsSync(join(ROOT, "tools", "lib", "error-handling.bash"))).toBe(true);
  });

  it("bootstrap.sh ARM architecture detection logic", () => {
    // The detection idiom the bootstrap relies on: aarch64 → ARM.
    expect(sh(`arch="x86_64"; [ "$arch" == "aarch64" ] && echo 1 || echo 0`).stdout.trim()).toBe("0");
    expect(sh(`arch="aarch64"; [ "$arch" == "aarch64" ] && echo 1 || echo 0`).stdout.trim()).toBe("1");
  });

  it("bootstrap.sh uses || true to prevent grep failures from stopping script", () => {
    // Tolerated skip in the bats suite: grep calls live in conditionals/pipes
    // where `|| true` is not needed. Keep the skip honest: the file must not
    // grow a bare top-level grep that could trip `set -e`.
    const r = sh(`grep "grep.*|| true" '${BOOTSTRAP_SH}'`);
    expect([0, 1]).toContain(r.status);
  });

  it("bootstrap.bash uses rm -f to safely remove files", () => {
    expect(sh(`grep "rm -f" '${BOOTSTRAP_BASH}'`).status).toBe(0);
  });

  it("bootstrap.bash defines devenv-related directories", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("devenv=");
    expect(src(BOOTSTRAP_BASH)).toContain("setup_dir=");
  });

  it("bootstrap.bash creates .installs directory", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/mkdir -p.*\.installs/);
  });

  it("bootstrap.bash backs up .bashrc file", () => {
    expect(src(BOOTSTRAP_BASH)).toContain(".bashrc.original");
  });

  it("provisioning step bodies never prompt (unattended bootstrap contract)", () => {
    const r = sh(
      `awk '/^[a-z_]+\\(\\) \\{/ { fn=$0; body=1; next } ` +
        `body && /^\\}/ { body=0 } ` +
        `body && /read -(p|s|s -p|sp|e -p) / { print fn": "$0; found=1 } ` +
        `END { exit found ? 1 : 0 }' '${PROVISION}'`,
    );
    expect(r.status).toBe(0);
  });

  it("reset_bashrc_to_original preserves user bashrc unless forced", () => {
    const s = src(BOOTSTRAP_BASH);
    expect(s).toContain("PRESERVE_BASHRC:-0");
    expect(s).toContain("cp ~/.bashrc.original ~/.bashrc");
    expect(src(PROVISION)).not.toMatch(/^reset_bashrc_to_original\(\)/m);
  });

  it("bootstrap.bash version parsing logic handles semantic versions", () => {
    const r = runSnippet(
      [
        "#!/usr/bin/env bash",
        'VERSION="v1.5.2"',
        "if [[ $VERSION =~ ([0-9]+)\\.([0-9]+)\\.([0-9]+) ]]; then",
        '  echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"',
        "fi",
        "",
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("1.5.2");
  });
});

// ── entry-path execution: task dispatch through the real bootstrap.sh ───────

describe("bootstrap: entry path", () => {
  it("run_tasks executes only requested safe task", () => {
    const fx = setupBootstrapEntryFixture();
    const r = runBootstrapEntry(fx.entryToolbox, "initialize_paths");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Running task: initialize_paths");
    expect(r.out).not.toContain("install_os_packages_round1");
  });

  it("run_tasks fails fast on unknown task", () => {
    const fx = setupBootstrapEntryFixture();
    const r = runBootstrapEntry(fx.entryToolbox, "this_task_does_not_exist");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Unknown task");
  });

  it("run_tasks reports failed task and exits", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("Task failed: $task");
  });

  it("run_tasks default task list is ordered", () => {
    const s = src(BOOTSTRAP_BASH);
    const m = s.match(/local default_tasks[\s\S]{0,2000}/);
    expect(m, "default_tasks array not found").not.toBeNull();
    const block = m![0];
    for (const t of ["initialize_paths", "install_yq", "finish_message", "run_setup_first_run"]) {
      expect(block).toContain(t);
    }
  });

  it("bootstrap.bash installs gh (GitHub CLI)", () => {
    expect(src(BOOTSTRAP_BASH).toLowerCase()).toContain("gh");
  });

  it("bootstrap.bash installs fzf", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("fzf");
  });

  it("bootstrap.bash installs bats for testing", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("bats");
  });
});

// ── task ordering inside the runners ────────────────────────────────────────

describe("bootstrap: task lists and ordering", () => {
  it("ensure_bash_is_default_shell is included in default task list", () => {
    expect(runnerTasks("run_bootstrap_tasks", "default_tasks")).toContain("ensure_bash_is_default_shell");
  });

  it("ensure_bash_is_default_shell runs after ensure_home_is_set", () => {
    const tasks = runnerTasks("run_bootstrap_tasks", "default_tasks");
    expect(taskIndex(tasks, "ensure_bash_is_default_shell")).toBeGreaterThan(taskIndex(tasks, "ensure_home_is_set"));
  });

  it("bootstrap.bash defines install_yq function", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/^install_yq\(\)/m);
  });

  it("install_yq function downloads from mikefarah repository", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("mikefarah/yq");
  });

  it("install_yq is included in default task list", () => {
    expect(runnerTasks("run_bootstrap_tasks", "default_tasks")).toContain("install_yq");
  });

  it("run_setup_first_run is included in default task list", () => {
    expect(runnerTasks("run_bootstrap_tasks", "default_tasks")).toContain("run_setup_first_run");
  });

  it("bootstrap.bash defines ensure_bash_is_default_shell function", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/^ensure_bash_is_default_shell\(\)/m);
  });

  it("ensure_bash_is_default_shell uses chsh to set bash as default", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/chsh -s.*bash/);
  });

  it("bootstrap.sh tees task output to a private .runtime/bootstrap.log", () => {
    const fx = setupBootstrapEntryFixture();
    const r = runBootstrapEntry(fx.entryToolbox, "stub_ok_task");
    expect(r.status).toBe(0);
    expect(r.out).toContain("STUB_OK_MARKER");
    expect(existsSync(fx.entryLog)).toBe(true);
    expect(readFileSync(fx.entryLog, "utf8")).toContain("STUB_OK_MARKER");
    expect(sh(`stat -c '%a' '${fx.entryLog}'`).stdout.trim()).toBe("600");
  });

  it("bootstrap.sh failing task leaves a log line, exits non-zero, and a re-run converges", () => {
    const fx = setupBootstrapEntryFixture();
    const r = runBootstrapEntry(fx.entryToolbox, "stub_fail_task");
    expect(r.status).not.toBe(0);
    expect(readFileSync(fx.entryLog, "utf8")).toContain("STUB_FAIL_MARKER");
    expect(readFileSync(fx.entryLog, "utf8")).toContain("Task failed: stub_fail_task");
    expect(r.out).toContain("An error occurred (exit status 1)");
    const r2 = runBootstrapEntry(fx.entryToolbox, "stub_ok_task");
    expect(r2.status).toBe(0);
    const log = readFileSync(fx.entryLog, "utf8");
    expect(log).toContain("STUB_FAIL_MARKER");
    expect(log).toContain("STUB_OK_MARKER");
  });
});

// ── provisioning library: copilot knowledge + instructions ──────────────────

describe("bootstrap: provisioning (copilot)", () => {
  it("bootstrap.bash defines install_copilot_instructions function", () => {
    expect(src(PROVISION)).toMatch(/^install_copilot_instructions\(\)/m);
  });

  it("bootstrap.bash defines sync_copilot_knowledge function", () => {
    expect(src(PROVISION)).toMatch(/^sync_copilot_knowledge\(\)/m);
  });

  it("bootstrap.bash defines normalize_copilot_knowledge_subpath helper", () => {
    expect(src(PROVISION)).toMatch(/^normalize_copilot_knowledge_subpath\(\)/m);
  });

  it("normalize_copilot_knowledge_subpath defaults empty to repo root", () => {
    const r = sh(`source '${PROVISION}'; normalize_copilot_knowledge_subpath ''`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(".");
  });

  it("normalize_copilot_knowledge_subpath trims leading ./ and trailing /", () => {
    const r = sh(`source '${PROVISION}'; normalize_copilot_knowledge_subpath './copilot-knowledge/'`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("copilot-knowledge");
  });

  it("install_copilot_instructions copies to ~/.copilot/copilot-instructions.md", () => {
    const s = src(PROVISION);
    expect(s).toContain("copilot-instructions.md");
    expect(s).toContain(".copilot/copilot-instructions.md");
  });

  it("[provisioning step] sync_copilot_knowledge is included in default task list", () => {
    const r = spawnSync("node", [SETUP_FIRST_RUN, "--list"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/knowledge-sync/);
    expect(runnerTasks("run_bootstrap_tasks", "default_tasks")).toContain("run_setup_first_run");
  });

  it("sync_copilot_knowledge uses the subpath helper and the provider hook for the auth header", () => {
    const s = src(PROVISION);
    expect(s).toContain('subpath=$(normalize_copilot_knowledge_subpath "$subpath")');
    expect(s).toContain('header=$(provider_bootstrap_call git_auth_header "$token")');
  });

  it("bootstrap never exports GH_TOKEN (keychain-only auth contract)", () => {
    expect(src(BOOTSTRAP_BASH)).not.toContain("export GH_TOKEN");
  });

  it("sync_copilot_knowledge stores pre-sync backups under runtime path", () => {
    const s = src(PROVISION);
    expect(s).toContain("copilot-knowledge-backups");
    expect(s).toContain("copilot-engineering-backups");
  });

  it("sync_copilot_side_repo is the shared parametric sync used by both imports", () => {
    const s = src(PROVISION);
    expect(s).toMatch(/^sync_copilot_side_repo\(\)/m);
    // The shared sync is invoked by both imports: a 3-line window after each
    // call carries the knowledge and engineering link paths (the bats grep -A3).
    expect(sh(`grep -A3 -F 'sync_copilot_side_repo' '${PROVISION}' | grep 'copilot/knowledge'`).status).toBe(0);
    expect(sh(`grep -A3 -F 'sync_copilot_side_repo' '${PROVISION}' | grep 'copilot/engineering'`).status).toBe(0);
  });

  it("[provisioning step] sync_copilot_engineering is defined and registered in both task runners", () => {
    const r = spawnSync("node", [SETUP_FIRST_RUN, "--list"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/engineering-sync/);
    expect(runnerTasks("run_update_tasks", "update_tasks")).toContain("run_setup_first_run");
  });

  it("engineering sync skips gracefully when engineering_repo unconfigured", () => {
    expect(src(PROVISION)).toContain("No [copilot] engineering_repo configured; skipping");
  });

  it("container start pulls engineering standards non-blocking", () => {
    expect(src(COPILOT_KNOWLEDGE)).toContain("pull_copilot_engineering_on_container_start()");
    expect(src(STARTUP_SH)).toContain("pull_copilot_engineering_on_container_start");
  });

  it("write_devenvrc includes startup knowledge pull hook", () => {
    expect(src(COPILOT_KNOWLEDGE)).toMatch(/^pull_copilot_knowledge_on_container_start\(\)/m);
  });

  it("startup knowledge pull runs only when copilot knowledge is a git repo", () => {
    expect(src(COPILOT_KNOWLEDGE)).toContain('[ -d "$repo_dir/.git" ] || return 0');
  });

  it("startup knowledge pull is non-blocking background pull", () => {
    const s = src(COPILOT_KNOWLEDGE);
    expect(s).toContain("pull_copilot_knowledge_on_container_start");
    expect(s).toContain("pull --ff-only origin");
    expect(s).toContain("nohup env REPO_DIR=");
  });

  it("startup.sh sources copilot knowledge library and calls pull function", () => {
    const s = src(STARTUP_SH);
    expect(s).toContain('source "$toolbox_root/tools/lib/copilot-knowledge.bash"');
    expect(s).toContain('pull_copilot_knowledge_on_container_start "$toolbox_root"');
  });
});

// ── devenv-update flow (post-update.bash) ───────────────────────────────────

describe("bootstrap: devenv-update flow", () => {
  it("devenv-update parses Devenv-Action trailers from pulled commit range", () => {
    expect(src(POST_UPDATE)).toMatch(/git log "\$\{old_ref\}\.\.\$\{new_ref\}" --format=.*Devenv-Action/);
  });

  it("devenv-update always prints a post-update action recommendation", () => {
    expect(src(POST_UPDATE)).toContain("Update complete.");
  });

  it("devenv-update offers to run bootstrap when bootstrap action is recommended", () => {
    expect(src(POST_UPDATE)).toContain("Do you want to run bootstrap now? (y/n):");
  });

  it("devenv-update includes explicit bootstrap follow-up paths", () => {
    const s = src(POST_UPDATE);
    expect(s).toContain("Bootstrap completed successfully.");
    expect(s).toContain("Recommendation: restart the dev container to apply bootstrap changes.");
    expect(s).toContain("Skipping bootstrap. Run ");
    expect(s).toContain(" when ready.");
  });

  it("devenv-update restart action prompts for full container restart", () => {
    expect(src(POST_UPDATE)).toContain("Do you want to restart the dev container now? (y/n):");
  });

  it("devenv-update uses docker restart hostname for container restart", () => {
    expect(src(POST_UPDATE)).toContain('docker restart "$(hostname)"');
  });

  it("devenv-update recreate action offers recreate restart skip options", () => {
    const s = src(POST_UPDATE);
    expect(s).toContain("Choose an option:");
    expect(s).toContain("1) Recreate container now (recommended)");
    expect(s).toContain("2) Restart container now");
    expect(s).toContain("3) Skip");
  });

  it("devenv-update uses safe full convergence bootstrap profile", () => {
    const s = src(BOOTSTRAP_BASH);
    expect(s).toMatch(/^run_update_tasks\(\)/m);
    expect(s).toContain("run_update_tasks");
  });
});

// ── setup.ts step ordering ──────────────────────────────────────────────────

describe("bootstrap: setup ordering", () => {
  it("[provisioning step] load_setup_credentials runs before sync_copilot_knowledge", () => {
    const r = spawnSync("node", [SETUP_FIRST_RUN, "--list"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n");
    const credLine = lines.findIndex((l) => l.includes("credentials"));
    const syncLine = lines.findIndex((l) => l.includes("knowledge-sync"));
    expect(credLine).toBeGreaterThanOrEqual(0);
    expect(syncLine).toBeGreaterThan(credLine);
  });
});

// ── symlink install behaviors (executed against fixtures) ───────────────────

describe("bootstrap: symlink installs", () => {
  it("install_copilot_instructions symlinks file when source exists", () => {
    const srcDir = tmpPath("copilot");
    const homeDir = tmpPath("home", ".copilot");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "copilot-instructions.md"), "# test instructions\n");
    const r = sh(`
      toolbox_root='${TMP}'
      HOME='${tmpPath("home")}'
      src="$toolbox_root/copilot/copilot-instructions.md"
      dest="$HOME/.copilot/copilot-instructions.md"
      if [ -f "$src" ]; then
        mkdir -p "$HOME/.copilot"; rm -f "$dest"; ln -s "$src" "$dest"; echo "symlinked"
      else
        echo "skipped"
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("symlinked");
    expect(existsSync(join(homeDir, "copilot-instructions.md"))).toBe(true);
    expect(sh(`[ -L '${join(homeDir, "copilot-instructions.md")}' ] && echo link`).stdout.trim()).toBe("link");
  });

  it("install_copilot_instructions skips gracefully when source missing", () => {
    const r = sh(`
      toolbox_root='${tmpPath("no-such-dir")}'
      HOME='${tmpPath("home2")}'
      src="$toolbox_root/copilot/copilot-instructions.md"
      dest="$HOME/.copilot/copilot-instructions.md"
      if [ -f "$src" ]; then
        mkdir -p "$HOME/.copilot"; cp "$src" "$dest"; echo "copied"
      else
        echo "skipped"
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped");
  });

  it("install_copilot_instructions creates skills symlink to copilot/skills", () => {
    const toolbox = tmpPath("toolbox_skills");
    const homeDir = tmpPath("home_skills");
    mkdirSync(join(toolbox, "copilot", "skills", "spike"), { recursive: true });
    mkdirSync(join(homeDir, ".copilot"), { recursive: true });
    const r = sh(`
      toolbox_root='${toolbox}'
      HOME='${homeDir}'
      skills_src="$toolbox_root/copilot/skills"
      skills_link="$HOME/.copilot/skills"
      if [ -d "$skills_src" ]; then
        mkdir -p "$HOME/.copilot"; rm -rf "$skills_link"; ln -s "$skills_src" "$skills_link"; echo "symlinked"
      else
        echo "skipped"
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("symlinked");
    expect(sh(`readlink '${join(homeDir, ".copilot", "skills")}'`).stdout.trim()).toBe(join(toolbox, "copilot", "skills"));
  });

  it("install_copilot_instructions skills symlink is idempotent", () => {
    const toolbox = tmpPath("toolbox_skills2");
    const homeDir = tmpPath("home_skills2");
    mkdirSync(join(toolbox, "copilot", "skills"), { recursive: true });
    mkdirSync(join(homeDir, ".copilot"), { recursive: true });
    symlinkSync("/tmp/stale", join(homeDir, ".copilot", "skills"));
    const r = sh(`
      toolbox_root='${toolbox}'
      HOME='${homeDir}'
      skills_src="$toolbox_root/copilot/skills"
      skills_link="$HOME/.copilot/skills"
      if [ -d "$skills_src" ]; then
        mkdir -p "$HOME/.copilot"; rm -rf "$skills_link"; ln -s "$skills_src" "$skills_link"; echo "symlinked"
      fi
    `);
    expect(r.status).toBe(0);
    expect(sh(`readlink '${join(homeDir, ".copilot", "skills")}'`).stdout.trim()).toBe(join(toolbox, "copilot", "skills"));
  });

  it("install_copilot_instructions skips skills symlink when copilot/skills missing", () => {
    const toolbox = tmpPath("toolbox_noskills");
    const homeDir = tmpPath("home_noskills");
    mkdirSync(join(toolbox, "copilot"), { recursive: true });
    mkdirSync(join(homeDir, ".copilot"), { recursive: true });
    const r = sh(`
      toolbox_root='${toolbox}'
      HOME='${homeDir}'
      skills_src="$toolbox_root/copilot/skills"
      skills_link="$HOME/.copilot/skills"
      if [ -d "$skills_src" ]; then
        mkdir -p "$HOME/.copilot"; rm -rf "$skills_link"; ln -s "$skills_src" "$skills_link"; echo "symlinked"
      else
        echo "skipped"
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped");
    expect(existsSync(join(homeDir, ".copilot", "skills"))).toBe(false);
  });
});

// ── claude code integration (executed via the real installer functions) ─────

describe("bootstrap: claude integration", () => {
  it("bootstrap.bash defines install_claude_code_integration function", () => {
    expect(src(PROVISION)).toMatch(/^install_claude_code_integration\(\)/m);
  });

  it("install_claude_code_integration copies to ~/.claude/CLAUDE.md", () => {
    const s = src(PROVISION);
    expect(s).toContain("CLAUDE.md");
    expect(s).toContain(".claude/CLAUDE.md");
  });

  it("[provisioning step] install_claude_code_integration is included in both default and update task lists", () => {
    const r = spawnSync("node", [SETUP_FIRST_RUN, "--list"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/claude-integration/);
    expect(runnerTasks("run_bootstrap_tasks", "default_tasks")).toContain("run_setup_first_run");
    expect(runnerTasks("run_update_tasks", "update_tasks")).toContain("run_setup_first_run");
  });

  it("install_claude_code_integration symlinks CLAUDE.md when source exists", () => {
    const srcDir = tmpPath("claude_copilot");
    const destDir = tmpPath("claude_home", ".claude");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "copilot-instructions.md"), "# test instructions\n");
    const r = sh(`
      toolbox_root='${TMP}'
      HOME='${tmpPath("claude_home")}'
      src="$toolbox_root/claude_copilot/copilot-instructions.md"
      dest="$HOME/.claude/CLAUDE.md"
      if [ -f "$src" ]; then
        mkdir -p "$HOME/.claude"; rm -f "$dest"; ln -s "$src" "$dest"; echo "symlinked"
      else
        echo "skipped"
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("symlinked");
    expect(sh(`[ -L '${join(destDir, "CLAUDE.md")}' ] && echo link`).stdout.trim()).toBe("link");
  });

  it("install_claude_code_integration skips gracefully when source missing", () => {
    const r = sh(`
      toolbox_root='${tmpPath("no-such-dir")}'
      HOME='${tmpPath("claude_home2")}'
      src="$toolbox_root/copilot/copilot-instructions.md"
      dest="$HOME/.claude/CLAUDE.md"
      if [ -f "$src" ]; then
        mkdir -p "$HOME/.claude"; ln -s "$src" "$dest"; echo "symlinked"
      else
        echo "skipped"
      fi
    `);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped");
  });

  it("Claude integration creates individual skill and shared-reference links", () => {
    const { toolbox, homeDir } = setupClaudeFixture();
    const r = runClaudeInstaller(toolbox, homeDir);
    expect(r.status).toBe(0);
    const skills = join(homeDir, ".claude", "skills");
    expect(existsSync(skills)).toBe(true);
    expect(sh(`[ -L '${skills}' ] && echo sym || echo dir`).stdout.trim()).toBe("dir");
    for (const n of ["devenv-fixture", "common", "_tools-reference.md"]) {
      expect(sh(`[ -L '${join(skills, n)}' ] && echo sym || echo no`).stdout.trim()).toBe("sym");
    }
    expect(sh(`readlink '${join(skills, "devenv-fixture")}'`).stdout.trim()).toBe(join(toolbox, "copilot", "skills", "devenv-fixture"));
    expect(readFileSync(join(skills, "devenv-fixture", "SKILL.md"), "utf8")).toContain("# Fixture");
    expect(sh(`readlink '${join(homeDir, ".claude", "CLAUDE.md")}'`).stdout.trim()).toBe(join(toolbox, "copilot", "copilot-instructions.md"));
  });

  it("Claude integration preserves synced and personal skills", () => {
    const { toolbox, homeDir } = setupClaudeFixture();
    const skills = join(homeDir, ".claude", "skills");
    mkdirSync(join(skills, "synced"), { recursive: true });
    mkdirSync(join(skills, "personal"), { recursive: true });
    writeFileSync(join(skills, "synced", "marker"), "keep synced\n");
    writeFileSync(join(skills, "personal", "SKILL.md"), "# Personal\n");
    const r = runClaudeInstaller(toolbox, homeDir);
    expect(r.status).toBe(0);
    expect(readFileSync(join(skills, "synced", "marker"), "utf8").trim()).toBe("keep synced");
    expect(readFileSync(join(skills, "personal", "SKILL.md"), "utf8").trim()).toBe("# Personal");
    expect(sh(`[ -L '${join(skills, "devenv-fixture")}' ] && echo sym`).stdout.trim()).toBe("sym");
  });

  it("Claude integration is repeatable and preserves personal name collisions", () => {
    const { toolbox, homeDir } = setupClaudeFixture();
    const collision = join(homeDir, ".claude", "skills", "devenv-fixture");
    mkdirSync(collision, { recursive: true });
    writeFileSync(join(collision, "SKILL.md"), "# Personal collision\n");
    expect(runClaudeInstaller(toolbox, homeDir).status).toBe(0);
    const r2 = runClaudeInstaller(toolbox, homeDir);
    expect(r2.status).toBe(0);
    expect(sh(`[ -L '${collision}' ] && echo sym || echo dir`).stdout.trim()).toBe("dir");
    expect(readFileSync(join(collision, "SKILL.md"), "utf8").trim()).toBe("# Personal collision");
    expect(sh(`readlink '${join(homeDir, ".claude", "skills", "common")}'`).stdout.trim()).toBe(join(toolbox, "copilot", "skills", "common"));
    expect(r2.out).toMatch(/WARNING:.*devenv-fixture/s);
  });

  it("Claude integration skips missing source skills without touching personal skills", () => {
    const { toolbox, homeDir } = setupClaudeFixture();
    rmSync(join(toolbox, "copilot", "skills"), { recursive: true, force: true });
    const synced = join(homeDir, ".claude", "skills", "synced");
    mkdirSync(synced, { recursive: true });
    writeFileSync(join(synced, "marker"), "keep synced\n");
    const r = runClaudeInstaller(toolbox, homeDir);
    expect(r.status).toBe(0);
    expect(readFileSync(join(synced, "marker"), "utf8").trim()).toBe("keep synced");
    expect(r.out).toContain("WARNING: copilot/skills not found");
  });
});

// ── idempotency guards ──────────────────────────────────────────────────────

describe("bootstrap: idempotency guards", () => {
  it("install_dotnet uses ln -sf to allow re-running safely", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/ln -sf.*dotnet/);
  });

  it("install_dotnet skips download when dotnet already installed", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("command -v dotnet");
  });

  it("install_dotnet installs dotnet-format only when not already present", () => {
    const s = src(BOOTSTRAP_BASH);
    expect(s).toMatch(/dotnet-format.*tool install|tool install.*dotnet-format/);
    // The install is guarded by a list check nearby, not unconditional.
    expect(s).toMatch(/dotnet-format[\s\S]{0,300}(tool list|grep)|(tool list|grep)[\s\S]{0,300}dotnet-format/);
  });

  it("configure_dotnet_tools guards reportgenerator install with list check", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/tool list.*reportgenerator|reportgenerator.*tool list/);
  });

  it("configure_dotnet_tools guards dotnet-outdated install with list check", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/tool list.*dotnet-outdated|dotnet-outdated.*tool list/);
  });

  it("ensure_directories_and_settings guards sysctl.conf append to prevent duplicates", () => {
    expect(src(PROVISION)).toMatch(/grep.*sysctl\.conf|sysctl\.conf.*grep/);
  });

  it("init_bootstrap_run_time uses rm -f to avoid failure when file missing", () => {
    expect(src(BOOTSTRAP_BASH)).toMatch(/rm -f.*repo_bootstrap_run_file|rm -f.*bootstrap_run/);
  });

  it("install_or_configure_nvm checks NVM directory not command -v nvm", () => {
    const s = src(BOOTSTRAP_BASH);
    expect(s).toMatch(/! -f.*nvm\.sh|-f.*NVM_DIR.*nvm\.sh/);
  });

  it("install_or_configure_nvm does not use command -v nvm as its primary check", () => {
    // Strip comments, then require no functional `command -v nvm` remains.
    const code = src(BOOTSTRAP_BASH)
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/^.*command -v nvm.*$/m);
  });

  it("generate_env_vars_file writes env-vars.sh with owner-only permissions", () => {
    const toolbox = tmpPath("envvars-toolbox");
    mkdirSync(join(toolbox, ".setup"), { recursive: true });
    const generator = extractFn(PROVISION, "generate_env_vars_file");
    const r = runSnippet(`${generator}\ngenerate_env_vars_file\n`, {
      toolbox_root: toolbox,
      setup_dir: join(toolbox, ".setup"),
    });
    expect(r.status).toBe(0);
    const envVars = join(toolbox, ".runtime", "env-vars.sh");
    expect(existsSync(envVars)).toBe(true);
    expect(sh(`stat -c '%a' '${envVars}'`).stdout.trim()).toBe("600");
  });
});

// ── provider feed configuration (executed against real provider hooks) ──────

describe("bootstrap: provider feed configuration", () => {
  it("require_provider_token: a seed the provider accepts is imported and deleted", () => {
    const r = runSeedFlow({ validateRc: 0 });
    expect(r.importLog).toBe("seed-token-abc");
    expect(existsSync(join(r.setupDir, "provider_token.txt"))).toBe(false);
    expect(r.out).toContain("RC=0");
  });

  it("require_provider_token: a seed the provider rejects is neither imported nor deleted, and bootstrap fails without a terminal", () => {
    const r = runSeedFlow({ validateRc: 1 });
    expect(r.importLog).toBe("");
    expect(existsSync(join(r.setupDir, "provider_token.txt"))).toBe(true);
    expect(r.out).toContain("RC=1");
    expect(r.out).toContain("rejected");
  });

  it("require_provider_token: an unverifiable seed (provider unreachable) is imported with a warning", () => {
    const r = runSeedFlow({ validateRc: 2 });
    expect(r.importLog).toBe("seed-token-abc");
    expect(existsSync(join(r.setupDir, "provider_token.txt"))).toBe(false);
    expect(r.out).toContain("could not verify");
    expect(r.out).toContain("RC=0");
  });

  it("require_provider_token: a provider with no validate hook imports the seed as before", () => {
    const r = runSeedFlow();
    expect(r.importLog).toBe("seed-token-abc");
    expect(existsSync(join(r.setupDir, "provider_token.txt"))).toBe(false);
    expect(r.out).toContain("RC=0");
  });

  it("require_provider_token: a seed that cannot be imported is kept and bootstrap fails without a terminal", () => {
    const r = runSeedFlow({ validateRc: 0, importRc: 1 });
    expect(existsSync(join(r.setupDir, "provider_token.txt"))).toBe(true);
    expect(r.out).toContain("RC=1");
  });

  it("configure_nuget_sources registers no GitHub feed and sends no token under azure", () => {
    const r = runFeedConfig("azure", "configure_nuget_sources");
    expect(r.status).toBe(0);
    expect(r.dotnetLog).not.toContain("nuget.pkg.github.com");
    expect(r.dotnetLog).not.toContain("feed-token-123");
    expect(r.dotnetLog).toContain("local-nuget-dev");
  });

  it("configure_nuget_sources registers the GitHub feed with the provider credential under github", () => {
    const r = runFeedConfig("github", "configure_nuget_sources");
    expect(r.status).toBe(0);
    expect(r.dotnetLog).toContain("nuget.pkg.github.com/the-org");
    expect(r.dotnetLog).toContain("-u the-user");
  });

  it("configure_nuget_sources refreshes the credentials of a source that already exists (token rotation)", () => {
    const r = runFeedConfig("github", "configure_nuget_sources", {
      DOTNET_LIST: "  1.  github [Enabled]\n      https://nuget.pkg.github.com/the-org/index.json",
    });
    expect(r.status).toBe(0);
    expect(r.dotnetLog).toContain("nuget update source github");
    expect(r.dotnetLog).toContain("feed-token-123");
    expect(r.dotnetLog).not.toContain("nuget add source github");
  });

  it("configure_user_npmrc leaves ~/.npmrc with owner-only permissions", () => {
    const r = runFeedConfig("azure", "configure_user_npmrc", {}, (home) => {
      writeFileSync(join(home, ".npmrc"), "//npm.pkg.github.com/:_authToken=old-token\n");
      chmodSync(join(home, ".npmrc"), 0o644);
    });
    expect(r.status).toBe(0);
    const npmrc = join(r.homeDir, ".npmrc");
    expect(existsSync(npmrc), "npmrc must survive the azure run").toBe(true);
    expect(readFileSync(npmrc, "utf8")).toContain("old-token");
    expect(sh(`stat -c '%a' '${npmrc}'`).stdout.trim()).toBe("600");
  });

  it("configure_user_npmrc under azure never writes the provider token into the npmrc", () => {
    const r = runFeedConfig("azure", "configure_user_npmrc");
    expect(r.status).toBe(0);
    if (existsSync(join(r.homeDir, ".npmrc"))) {
      expect(readFileSync(join(r.homeDir, ".npmrc"), "utf8")).not.toContain("feed-token-123");
    }
  });

  it("configure_user_npmrc under github writes the registry token and keeps the file owner-only", () => {
    const r = runFeedConfig("github", "configure_user_npmrc", {}, (home) => {
      writeFileSync(join(home, ".npmrc"), "registry=https://registry.example.test/\n");
      chmodSync(join(home, ".npmrc"), 0o644);
    });
    expect(r.status).toBe(0);
    const npmrc = join(r.homeDir, ".npmrc");
    expect(existsSync(npmrc)).toBe(true);
    const content = readFileSync(npmrc, "utf8");
    expect(content).toMatch(/^\/\/npm\.pkg\.github\.com\/:_authToken=feed-token-123$/m);
    expect(content).toMatch(/^registry=https:\/\/registry\.example\.test\/$/m);
    expect(sh(`stat -c '%a' '${npmrc}'`).stdout.trim()).toBe("600");
  });
});

// ── nvm / node activation ───────────────────────────────────────────────────

describe("bootstrap: nvm activation", () => {
  const nvmInstalled = existsSync("/usr/local/share/nvm/nvm.sh");

  it("install_or_configure_nvm resolves NODE_VERSION when sourced before DEVENV_ROOT is set", () => {
    if (!nvmInstalled) return; // environment-conditional skip (as in bats)
    const script = [
      `source '${BOOTSTRAP_BASH}'`,
      '[ -z "${NODE_VERSION:-}" ] || { echo "precondition: NODE_VERSION already set"; exit 1; }',
      "install_or_configure_nvm >/dev/null",
      'echo "NODE_VERSION=${NODE_VERSION:-}"',
      "",
    ].join("\n");
    const f = tmpPath("nvm-resolve.sh");
    writeFileSync(f, script);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env["DEVENV_ROOT"];
    delete env["NODE_VERSION"];
    delete env["PNPM_VERSION"];
    const r = spawnSync("bash", [f], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toMatch(/NODE_VERSION=\d+\.\d+\.\d+/);
  });

  it("install_or_configure_nvm activates the declared node when nvm is already installed", () => {
    if (!nvmInstalled) return;
    const tv = sh(`env -u NODE_VERSION bash -c "source '${TOOL_VERSIONS}'; echo \\"\\$NODE_VERSION\\""`);
    const declared = tv.stdout.trim();
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    if (!existsSync(`/usr/local/share/nvm/versions/node/v${declared}`)) return;
    // A decoy node shadows the real one; the task must converge node onto the
    // declared version despite it.
    const decoy = tmpPath("decoy-bin");
    mkdirSync(decoy, { recursive: true });
    writeFileSync(join(decoy, "node"), '#!/usr/bin/env bash\necho "v99.99.99-decoy"\n');
    chmodSync(join(decoy, "node"), 0o755);
    const r = sh(`PATH='${decoy}:/usr/bin:/bin' bash -c '. "$0/.devcontainer/bootstrap.bash"; install_or_configure_nvm >/dev/null 2>&1; node -v' '${ROOT}'`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n").pop()).toBe(`v${declared}`);
  });

  it("install_or_configure_nvm sets NVM_SYMLINK_CURRENT=true to converge the current symlink", () => {
    expect(src(BOOTSTRAP_BASH)).toContain("NVM_SYMLINK_CURRENT=true");
  });

  it("ensure_tool_versions sets NVM_SYMLINK_CURRENT=true in the node repair path", () => {
    expect(src(TOOL_VERSIONS)).toContain("NVM_SYMLINK_CURRENT=true");
  });
});

// ── install_yq: pinned download + sha256 verification ───────────────────────

describe("bootstrap: install_yq and download verification", () => {
  it("install_yq installs the pinned version via a private mktemp path", () => {
    const stubs = tmpPath("yq-stubs");
    const calls = tmpPath("yq-calls.log");
    mkdirSync(stubs, { recursive: true });
    writeFileSync(calls, "");
    writeFileSync(join(stubs, "curl"), '#!/bin/bash\necho "curl-called $*" >> "$CALLS"\n');
    writeFileSync(
      join(stubs, "wget"),
      '#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = "-O" ] && { echo "wget-out=$2" >> "$CALLS"; echo stub > "$2"; }; last="$1"; shift; done\necho "wget-url=$last" >> "$CALLS"\n',
    );
    writeFileSync(join(stubs, "sudo"), '#!/bin/bash\necho "sudo $*" >> "$CALLS"\n');
    for (const n of ["curl", "wget", "sudo"]) chmodSync(join(stubs, n), 0o755);
    const tv = sh(`env -u YQ_VERSION bash -c "source '${TOOL_VERSIONS}'; echo \\\\$YQ_VERSION"`);
    const pinnedVersion = tv.stdout.trim();
    expect(pinnedVersion).not.toBe("");
    const stubSha = sh(`printf 'stub\\n' | sha256sum`).stdout.split(" ")[0];
    const f = tmpPath("yq-install.sh");
    writeFileSync(f, `source '${BOOTSTRAP_BASH}'\ninstall_yq\n`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env["PATH"] = `${stubs}:/usr/bin:/bin`;
    env["DEVENV_ROOT"] = "";
    env["YQ_VERSION"] = pinnedVersion!;
    env["CALLS"] = calls;
    env["YQ_SHA256_AMD64"] = stubSha!;
    env["YQ_SHA256_ARM64"] = stubSha!;
    const r = spawnSync("bash", [f], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    const log = readFileSync(calls, "utf8");
    expect(log).not.toMatch(/^curl-called/m);
    expect(log).toMatch(new RegExp(`^wget-url=https://github\\.com/mikefarah/yq/releases/download/${pinnedVersion.replace(/\./g, "\\.")}/yq_linux_`, "m"));
    const downloaded = (log.match(/^wget-out=(.*)$/m) ?? [])[1] ?? "";
    expect(downloaded).not.toBe("");
    expect(downloaded).not.toBe("/tmp/yq");
    expect(log).toContain(`sudo mv ${downloaded} /usr/local/bin/yq`);
  });

  it("tool-versions.bash pins sha256 digests for the deterministic downloads", () => {
    const r = sh(`env -u YQ_SHA256_AMD64 -u YQ_SHA256_ARM64 -u NVM_INSTALL_SHA256 bash -c "source '${TOOL_VERSIONS}'; echo '$YQ_SHA256_AMD64 $YQ_SHA256_ARM64 $NVM_INSTALL_SHA256'"`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^[0-9a-f]{64} [0-9a-f]{64} [0-9a-f]{64}$/);
  });

  it("tool-versions.bash documents the mutable downloads left unverified", () => {
    const s = src(TOOL_VERSIONS);
    expect(s.toLowerCase()).toContain("accepted exceptions");
    for (const site of ["tailscale", "get.docker.com", "dotnet-install", "getvsdbg", "minikube"]) {
      expect(s).toContain(site);
    }
  });

  it("tool-versions.bash is the single home for runtime-fetched tool versions", () => {
    const script = `source '${TOOL_VERSIONS}'\necho "yq=$YQ_VERSION nvm=$NVM_VERSION turbo=$TURBO_VERSION dotnet=$DOTNET_CHANNELS k8s=$K8S_APT_TRACK"\n`;
    const f = tmpPath("tv-single.sh");
    writeFileSync(f, script);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const k of ["YQ_VERSION", "NVM_VERSION", "TURBO_VERSION", "DOTNET_CHANNELS", "K8S_APT_TRACK"]) delete env[k];
    const r = spawnSync("bash", [f], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toMatch(/yq=v\d+\.\d+\.\d+ nvm=v\d+\.\d+\.\d+ turbo=\d+\.\d+\.\d+ dotnet=[\d.]+( [\d.]+)* k8s=v\d+\.\d+$/);
  });

  it("install_node_packages installs turbo at the version declared in tool-versions.bash", () => {
    const calls = tmpPath("npm-calls.log");
    writeFileSync(calls, "");
    const r = sh(
      `env -u DEVENV_ROOT CALLS='${calls}' PNPM_VERSION=1.2.3 NODE_VERSION=4.5.6 TURBO_VERSION=7.7.7 bash -c "source '${BOOTSTRAP_BASH}'; call_npm() { echo \\"npm \\$*\\" >> \\"\\$CALLS\\"; }; reclaim_global_pnpm_ownership() { :; }; install_node_packages"`,
    );
    expect(r.status).toBe(0);
    expect(readFileSync(calls, "utf8")).toContain("npm install -g turbo@7.7.7");
  });

  it("bootstrap.bash carries no hard-coded runtime tool versions", () => {
    const code = src(BOOTSTRAP_BASH)
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toContain("v4.35.1");
    expect(code).not.toContain("releases/latest");
    expect(code).not.toContain("nvm/v0.39.5");
    expect(code).not.toContain("turbo@2.0.6");
    expect(code).not.toContain("dotnet-install.sh -c 8.0");
    expect(code).not.toContain("stable:/v1.31");
    expect(code).toContain("nvm-sh/nvm/${NVM_VERSION}/install.sh");
    expect(code).toContain('download_verified "https://raw.githubusercontent.com/nvm-sh/nvm/');
    expect(code).not.toContain("install.sh | bash");
    expect(code).toContain("stable:/${K8S_APT_TRACK}/deb");
    expect(/\$\{DOTNET_CHANNELS\}|\$DOTNET_CHANNELS/.test(code)).toBe(true);
  });

  it("download_verified keeps a file whose sha256 matches the pin", () => {
    const stubs = tmpPath("dv-stubs");
    const dest = tmpPath("dv-file");
    mkdirSync(stubs, { recursive: true });
    writeFileSync(join(stubs, "wget"), '#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = "-O" ] && printf "payload\\n" > "$2"; shift; done\n');
    chmodSync(join(stubs, "wget"), 0o755);
    const good = sh(`printf 'payload\\n' | sha256sum`).stdout.split(" ")[0];
    const f = tmpPath("dv-keep.sh");
    writeFileSync(f, `source '${BOOTSTRAP_BASH}'\ndownload_verified https://example.invalid/f '${dest}' '${good}'\n`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env["PATH"] = `${stubs}:${process.env.PATH ?? ""}`;
    const r = spawnSync("bash", [f], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(readFileSync(dest, "utf8").trim()).toBe("payload");
  });

  it("download_verified refuses and removes a file whose sha256 does not match", () => {
    const stubs = tmpPath("dv-stubs2");
    const dest = tmpPath("dv-file2");
    mkdirSync(stubs, { recursive: true });
    writeFileSync(join(stubs, "wget"), '#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = "-O" ] && printf "tampered\\n" > "$2"; shift; done\n');
    chmodSync(join(stubs, "wget"), 0o755);
    const pin = sh(`printf 'payload\\n' | sha256sum`).stdout.split(" ")[0];
    const f = tmpPath("dv-refuse.sh");
    writeFileSync(f, `source '${BOOTSTRAP_BASH}'\ndownload_verified https://example.invalid/f '${dest}' '${pin}'\n`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env["PATH"] = `${stubs}:${process.env.PATH ?? ""}`;
    const r = spawnSync("bash", [f], { encoding: "utf8", env });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("sha256 mismatch");
    expect(existsSync(dest)).toBe(false);
  });

  it("download_verified refuses to download anything without a pin", () => {
    const dest = tmpPath("dv-file3");
    const r = sh(`bash -c "source '${BOOTSTRAP_BASH}'; download_verified https://example.invalid/f '${dest}' ''"`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no sha256 pin");
    expect(existsSync(dest)).toBe(false);
  });

  it("install_yq does not install a binary that fails sha256 verification", () => {
    const stubs = tmpPath("yq-stubs2");
    const calls = tmpPath("yq-calls2.log");
    mkdirSync(stubs, { recursive: true });
    writeFileSync(calls, "");
    writeFileSync(join(stubs, "wget"), '#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = "-O" ] && { echo "wget-out=$2" >> "$CALLS"; echo tampered > "$2"; }; shift; done\n');
    writeFileSync(join(stubs, "sudo"), '#!/bin/bash\necho "sudo $*" >> "$CALLS"\n');
    chmodSync(join(stubs, "wget"), 0o755);
    chmodSync(join(stubs, "sudo"), 0o755);
    const pin = sh(`printf 'stub\\n' | sha256sum`).stdout.split(" ")[0];
    const f = tmpPath("yq-refuse.sh");
    writeFileSync(f, `source '${BOOTSTRAP_BASH}'\ninstall_yq\n`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env["PATH"] = `${stubs}:/usr/bin:/bin`;
    env["DEVENV_ROOT"] = "";
    env["YQ_VERSION"] = "v1.2.3";
    env["CALLS"] = calls;
    env["YQ_SHA256_AMD64"] = pin!;
    env["YQ_SHA256_ARM64"] = pin!;
    const r = spawnSync("bash", [f], { encoding: "utf8", env });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("sha256 mismatch");
    const log = readFileSync(calls, "utf8");
    expect(log).not.toMatch(/^sudo/m);
    const downloaded = (log.match(/^wget-out=(.*)$/m) ?? [])[1] ?? "";
    expect(downloaded).not.toBe("");
    expect(existsSync(downloaded)).toBe(false);
  });
});

// ── bootstrap lock ──────────────────────────────────────────────────────────

describe("bootstrap: lock", () => {
  it("bootstrap.sh refuses to start while another bootstrap holds the lock", () => {
    const fx = setupBootstrapEntryFixture();
    const lockHome = tmpPath("lock-home");
    mkdirSync(lockHome, { recursive: true });
    const lockFile = join(lockHome, ".bootstrap.lock");
    // The holder takes the lock and then writes the ready marker INTO the
    // lockfile — the test waits on the marker, so there is no take-the-lock
    // race, only a bounded wait for a definite signal.
    const holder = spawn(
      "bash",
      ["-c", `exec 9>'${lockFile}'; flock -n 9 && { echo held >&9; sleep 30; }`],
      { stdio: ["ignore", "ignore", "pipe"], detached: true },
    );
    let held = false;
    for (let i = 0; i < 50; i++) {
      if (existsSync(lockFile) && readFileSync(lockFile, "utf8").includes("held")) {
        held = true;
        break;
      }
      spawnSync("sleep", ["0.1"]);
    }
    if (!held) {
      try {
        process.kill(-(holder.pid ?? 0), "SIGKILL");
      } catch {
        holder.kill("SIGKILL");
      }
      throw new Error(`holder never took the lock (pid ${holder.pid}, alive=${holder.exitCode === null})`);
    }
    let rStatus = 0;
    let rOut = "";
    try {
      const r = runBootstrapEntry(fx.entryToolbox, "stub_ok_task", { HOME: lockHome });
      rStatus = r.status;
      rOut = r.out;
    } finally {
      try {
        process.kill(-(holder.pid ?? 0), "SIGKILL");
      } catch {
        holder.kill("SIGKILL");
      }
    }
    expect(rStatus).not.toBe(0);
    expect(rOut).toContain("already running");
    expect(rOut).not.toContain("STUB_OK_MARKER");
    expect(existsSync(fx.entryLog) ? readFileSync(fx.entryLog, "utf8") : "").toBe("");
  });

  it("bootstrap.sh runs when the lock is free, and when its parent already holds it", () => {
    const fx = setupBootstrapEntryFixture();
    const lockHome = tmpPath("lock-home2");
    mkdirSync(lockHome, { recursive: true });
    const r = runBootstrapEntry(fx.entryToolbox, "stub_ok_task", { HOME: lockHome });
    expect(r.status).toBe(0);
    expect(r.out).toContain("STUB_OK_MARKER");
    const r2 = runBootstrapEntry(fx.entryToolbox, "stub_ok_task", {
      HOME: lockHome,
      DEVENV_BOOTSTRAP_LOCK_HELD: "1",
    });
    expect(r2.status).toBe(0);
    expect(r2.out).toContain("STUB_OK_MARKER");
  });

  it("container-start.sh marks the bootstrap lock as held for the child bootstrap", () => {
    expect(src(CONTAINER_START)).toMatch(/export DEVENV_BOOTSTRAP_LOCK_HELD=1/);
  });
});

// ── task runners: executed for real with every task stubbed ─────────────────

describe("bootstrap: task runners", () => {
  it("runner task lists were extracted (guards the extraction itself)", () => {
    expect(runnerTasks("run_bootstrap_tasks", "default_tasks").length).toBeGreaterThanOrEqual(12);
    expect(runnerTasks("run_update_tasks", "update_tasks").length).toBeGreaterThanOrEqual(11);
  });

  it("every runner task is a function defined by bootstrap.bash", () => {
    const all = [...runnerTasks("run_bootstrap_tasks", "default_tasks"), ...runnerTasks("run_update_tasks", "update_tasks")].join(" ");
    const script = `source '${BOOTSTRAP_BASH}'\nfor t in ${all}; do\n  declare -F "$t" >/dev/null || echo "undefined: $t"\ndone\n`;
    const r = runSnippet(script);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  it("the update runner is the bootstrap runner minus exactly the documented destructive set", () => {
    const full = runnerTasks("run_bootstrap_tasks", "default_tasks").slice().sort();
    const upd = runnerTasks("run_update_tasks", "update_tasks").slice().sort();
    const extra = upd.filter((t) => !full.includes(t));
    expect(extra).toEqual([]);
    const missing = full.filter((t) => !upd.includes(t));
    expect(missing.slice().sort()).toEqual([...DESTRUCTIVE_TASKS].sort());
  });

  it("the update runner keeps the bootstrap runner's relative task order", () => {
    const full = runnerTasks("run_bootstrap_tasks", "default_tasks");
    const expected = full.filter((t) => !DESTRUCTIVE_TASKS.includes(t));
    expect(runnerTasks("run_update_tasks", "update_tasks")).toEqual(expected);
  });

  it("run_bootstrap_tasks executes every task once, in order", () => {
    const r = stubRunner("run_bootstrap_tasks");
    expect(r.status).toBe(0);
    expect(r.calls).toBe(runnerTasks("run_bootstrap_tasks", "default_tasks").join("\n"));
  });

  it("run_update_tasks executes its tasks in order and never a destructive one", () => {
    const r = stubRunner("run_update_tasks");
    expect(r.status).toBe(0);
    expect(r.calls).toBe(runnerTasks("run_update_tasks", "update_tasks").join("\n"));
    for (const t of DESTRUCTIVE_TASKS) {
      expect(r.calls.split("\n")).not.toContain(t);
    }
  });

  it("a failing task stops run_bootstrap_tasks: exit 1, later tasks never run", () => {
    const r = stubRunner("run_bootstrap_tasks", "install_dotnet");
    expect(r.status).toBe(1);
    expect(r.out).toContain("Task failed: install_dotnet");
    expect(r.calls.split("\n")).toContain("install_dotnet");
    expect(r.calls.split("\n")).not.toContain("load_setup_credentials");
  });

  it("a failing task stops run_update_tasks: exit 1, later tasks never run", () => {
    const r = stubRunner("run_update_tasks", "install_dotnet");
    expect(r.status).toBe(1);
    expect(r.out).toContain("Task failed: install_dotnet");
    expect(r.calls.split("\n")).not.toContain("load_setup_credentials");
  });

  it("run_bootstrap_tasks with explicit names runs only those, in the order given", () => {
    const r = stubRunner("run_bootstrap_tasks install_dotnet detect_architecture");
    expect(r.status).toBe(0);
    expect(r.calls).toBe("install_dotnet\ndetect_architecture");
  });

  it("run_bootstrap_tasks rejects an unknown task name with exit 1", () => {
    const r = stubRunner("run_bootstrap_tasks no_such_task");
    expect(r.status).toBe(1);
    expect(r.out).toContain("Unknown task: no_such_task");
  });
});

// ── docs + helpers + robustness ─────────────────────────────────────────────

describe("bootstrap: docs, helpers, robustness", () => {
  it("Bootstrap-Customization.md lists exactly the hook files run_custom_bootstrap_if_present runs", () => {
    const fnBody = extractFn(PROVISION, "run_custom_bootstrap_if_present");
    const hooks = [...new Set((fnBody.match(/[a-z]+-custom-bootstrap\.sh/g) ?? []).sort())];
    expect(hooks.length).toBe(2);
    const doc = src(CUSTOMIZATION_DOC);
    for (const h of hooks) {
      expect(doc).toContain(`.devcontainer/${h}`);
    }
  });

  it("Bootstrap-Customization.md does not list a custom-bootstrap.sh hook that is never run", () => {
    expect(src(CUSTOMIZATION_DOC)).not.toMatch(/\.devcontainer\/custom-bootstrap\.sh/);
  });

  it("key-update-provider reads the provider name with spaces around =, or with CRLF", () => {
    const funcs = extractFn(PROVISION, "_key_update_run") + "\n" + extractFn(PROVISION, "key-update-provider");
    const variants = ["[provider]\nname=azure\n", "[provider]\nname = azure\n", "[provider]\r\nname=azure\r\n"];
    for (const variant of variants) {
      const root = tmpPath(`ku-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(root, "tools", "lib", "providers", "azure"), { recursive: true });
      spawnSync("cp", [CONFIG_READER, join(root, "tools", "lib", "config-reader.bash")]);
      writeFileSync(join(root, "tools", "lib", "providers", "azure", "key-update.sh"), '#!/bin/bash\necho "rotated:azure"\n');
      writeFileSync(join(root, "devenv.config"), variant);
      const r = runSnippet(`unset DEVENV_KEY_UPDATE_PROVIDER\n${funcs}\nkey-update-provider\n`, { DEVENV_ROOT: root });
      expect(r.status, `variant failed: ${r.out}`).toBe(0);
      expect(r.out, `variant failed: ${r.out}`).toContain("rotated:azure");
    }
  });

  it("record_bootstrap_run_time writes both markers, and they agree", () => {
    const d = tmpPath("markers");
    mkdirSync(join(d, "runtime"), { recursive: true });
    const fn = extractFn(BOOTSTRAP_BASH, "record_bootstrap_run_time");
    const r = runSnippet(
      `${fn}\nrecord_bootstrap_run_time >/dev/null\n` + `[ -s "$container_bootstrap_run_file" ] && cmp -s "$container_bootstrap_run_file" "$repo_bootstrap_run_file"\n`,
      {
        container_bootstrap_run_file: join(d, "container"),
        repo_bootstrap_run_file: join(d, "runtime", "repo"),
      },
    );
    expect(r.status).toBe(0);
  });

  it("link_replacing_symlink_only creates a link, repoints a stale one, and is idempotent", () => {
    const d = tmpPath("lk");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "src"), "a\n");
    const fn = extractFn(PROVISION, "link_replacing_symlink_only");
    const srcP = join(d, "src");
    const destP = join(d, "dest");
    const r = runSnippet(
      `${fn}\n` +
        `link_replacing_symlink_only '${srcP}' '${destP}' && [ "$(readlink '${destP}')" = '${srcP}' ] || exit 11\n` +
        `ln -sfn /nonexistent '${destP}'\n` +
        `link_replacing_symlink_only '${srcP}' '${destP}' && [ "$(readlink '${destP}')" = '${srcP}' ] || exit 12\n` +
        `link_replacing_symlink_only '${srcP}' '${destP}'\n`,
    );
    expect(r.status).toBe(0);
  });

  it("link_replacing_symlink_only never deletes a real file or directory", () => {
    const d = tmpPath("lk2");
    mkdirSync(join(d, "realdir"), { recursive: true });
    writeFileSync(join(d, "realdir", "f"), "keep\n");
    writeFileSync(join(d, "realfile"), "keepfile\n");
    writeFileSync(join(d, "src"), "a\n");
    const fn = extractFn(PROVISION, "link_replacing_symlink_only");
    const r = runSnippet(
      `${fn}\n` +
        `link_replacing_symlink_only '${join(d, "src")}' '${join(d, "realdir")}'\n` +
        `link_replacing_symlink_only '${join(d, "src")}' '${join(d, "realfile")}'\n`,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("not a symlink");
    expect(sh(`[ -L '${join(d, "realdir")}' ] && echo sym || echo dir`).stdout.trim()).toBe("dir");
    expect(readFileSync(join(d, "realdir", "f"), "utf8").trim()).toBe("keep");
    expect(sh(`[ -L '${join(d, "realfile")}' ] && echo sym || echo file`).stdout.trim()).toBe("file");
    expect(readFileSync(join(d, "realfile"), "utf8").trim()).toBe("keepfile");
  });

  it("install_copilot_instructions leaves a real ~/.copilot/skills directory in place", () => {
    const toolbox = tmpPath("tb");
    const homeDir = tmpPath("hm");
    mkdirSync(join(toolbox, "copilot", "skills"), { recursive: true });
    mkdirSync(join(homeDir, ".copilot", "skills"), { recursive: true });
    writeFileSync(join(homeDir, ".copilot", "skills", "my-skill"), "mine\n");
    writeFileSync(join(toolbox, "copilot", "copilot-instructions.md"), "i\n");
    const funcs = extractFn(PROVISION, "link_replacing_symlink_only") + "\n" + extractFn(PROVISION, "install_copilot_instructions");
    const r = runSnippet(`${funcs}\ninstall_copilot_instructions\n`, {
      HOME: homeDir,
      toolbox_root: toolbox,
    });
    expect(r.status).toBe(0);
    expect(readFileSync(join(homeDir, ".copilot", "skills", "my-skill"), "utf8").trim()).toBe("mine");
    expect(sh(`[ -L '${join(homeDir, ".copilot", "copilot-instructions.md")}' ] && echo sym`).stdout.trim()).toBe("sym");
  });

  it("the generated devenvrc puts tools before repo scripts and does not grow PATH when sourced twice", () => {
    const toolbox = tmpPath("tbpath");
    const homeDir = tmpPath("hmpath");
    mkdirSync(join(toolbox, "tools"), { recursive: true });
    mkdirSync(join(toolbox, "repos", "r1", "scripts"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    // The bats helper extracts write_devenvrc through its closing heredoc tag;
    // mirror that by extracting the function and appending the terminator.
    const fnSrc = sh(`sed -n '/^write_devenvrc()/,/^DEVENVRC_EOF$/p' '${PROVISION}'`).stdout;
    const rcFile = join(homeDir, ".devenvrc");
    const r = runSnippet(
      `${fnSrc}}\n` +
        `write_devenvrc >/dev/null\n` +
        `export DEVENV_ROOT='${toolbox}'\n` +
        `. '${rcFile}' 2>/dev/null\nfirst="$PATH"\n` +
        `. '${rcFile}' 2>/dev/null\n` +
        `[ "$PATH" = "$first" ] || { echo 'PATH grew'; exit 11; }\n` +
        `case "$PATH" in *'${toolbox}/tools:'*'${toolbox}/repos/r1/scripts'*) ;; *) echo "order: $PATH"; exit 12 ;; esac\n`,
      { HOME: homeDir, toolbox_root: toolbox },
    );
    expect(r.status).toBe(0);
  });

  it("git-completion is vendored in the repo and sourced from there, not downloaded at bootstrap", () => {
    expect(sh(`[ -s '${join(ROOT, ".devcontainer", "git-completion.bash")}' ] && echo ok`).stdout.trim()).toBe("ok");
    const prov = src(PROVISION);
    const boot = src(BOOTSTRAP_BASH);
    expect(/git-completion\.bash.*raw\.githubusercontent|raw\.githubusercontent.*git-completion/.test(boot + prov)).toBe(false);
    expect(prov).toContain(".devcontainer/git-completion.bash");
    expect(/\.git-completion\.bash/.test(boot + prov)).toBe(false);
  });

  it("the OS package round does not upgrade every installed package", () => {
    expect(/apt upgrade|apt-get upgrade/.test(src(BOOTSTRAP_BASH))).toBe(false);
  });

  it("bootstrap.bash code names no provider: provider-specific work comes from the bootstrap hooks", () => {
    const code = src(BOOTSTRAP_BASH)
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/^[^#]*(azure|ghp_|x-access-token)/m);
    expect(code).not.toMatch(/^[^#]*[[:space:]]gh[[:space:]\]/m);
    expect(code).not.toMatch(/^[^#]*PROVIDER_NAME:-github/m);
  });

  it("each provider declares its OS packages through a hook: gh for github, none for azure", () => {
    const gh = sh(`bash -c "source '${join(ROOT, "tools", "lib", "providers", "github", "bootstrap.bash")}' 2>/dev/null; provider_bootstrap_apt_packages"`);
    expect(gh.stdout.trim()).toBe("gh");
    const az = sh(`bash -c "source '${join(ROOT, "tools", "lib", "providers", "azure", "bootstrap.bash")}' 2>/dev/null; provider_bootstrap_apt_packages"`);
    expect(az.stdout.trim()).toBe("");
  });

  it("require_setup_files: all required seed files present passes", () => {
    const r = requireSetupFilesRun(makeSetupDir("ok"));
    expect(r.status).toBe(0);
  });

  it("require_setup_files: optional timezone and digitalocean files are not required", () => {
    const dir = makeSetupDir("optional");
    expect(existsSync(join(dir, "timezone.txt"))).toBe(false);
    expect(existsSync(join(dir, "digitalocean_token.txt"))).toBe(false);
    expect(requireSetupFilesRun(dir).status).toBe(0);
  });

  it("require_setup_files: missing .setup directory fails and tells the user to run setup", () => {
    const r = requireSetupFilesRun(tmpPath("no-such-setup"));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("setup");
    expect(r.out).toContain("host");
  });

  it("require_setup_files: each missing required file fails and is named", () => {
    for (const f of ["name.txt", "email.txt", "provider_org.txt", "provider_user.txt"]) {
      const dir = makeSetupDir(`miss-${f}`);
      rmSync(join(dir, f));
      const r = requireSetupFilesRun(dir);
      expect(r.status, `expected failure for missing ${f}`).not.toBe(0);
      expect(r.out).toContain(f);
    }
  });

  it("require_setup_files: several missing files are all named in one message", () => {
    const dir = makeSetupDir("multi");
    rmSync(join(dir, "name.txt"));
    rmSync(join(dir, "provider_org.txt"));
    const r = requireSetupFilesRun(dir);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("name.txt");
    expect(r.out).toContain("provider_org.txt");
  });

  it("bootstrap task lists run require_setup_files right after initialize_paths", () => {
    const s = src(BOOTSTRAP_BASH);
    for (const fn of ["run_bootstrap_tasks", "run_update_tasks"]) {
      const m = s.match(new RegExp(`^${fn}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
      expect(m, `${fn} not found`).not.toBeNull();
      const body = m![0];
      const lines = body.split("\n");
      const initIdx = lines.findIndex((l) => l.trim() === "initialize_paths");
      expect(initIdx, `${fn}: initialize_paths not in body`).toBeGreaterThanOrEqual(0);
      expect(lines[initIdx + 1]?.trim()).toBe("require_setup_files");
    }
  });
});
