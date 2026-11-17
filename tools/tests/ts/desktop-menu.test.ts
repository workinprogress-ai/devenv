// desktop-menu domain helpers: user text is escaped into Fluxbox syntax and
// failures surface as thrown errors (never a process exit inside the library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addFolder, addShortcut, escapeMenuText } from "../../lib/domain/desktop-menu.ts";

let dir = "";
let menu = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "desktop-menu-"));
  menu = join(dir, "menu");
  writeFileSync(menu, "[begin] (Menu)\n[end]\n");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("desktop-menu", () => {
  it("escapes syntax delimiters in user text", () => {
    expect(escapeMenuText("a(b){c}\\d")).toBe("a\\(b\\)\\{c\\}\\\\d");
  });

  it("rejects line breaks that would inject a menu line", () => {
    expect(() => escapeMenuText("x\n[exec] (evil) { rm }")).toThrow(/line breaks/);
  });

  it("writes escaped labels and commands into the menu", () => {
    addShortcut(menu, "Run (x)", "echo {hi}");
    expect(readFileSync(menu, "utf8")).toContain("[exec] (Run \\(x\\)) { echo \\{hi\\} } <>");
  });

  it("is idempotent for an escaped label", () => {
    addShortcut(menu, "Run (x)", "true");
    addShortcut(menu, "Run (x)", "true");
    expect(readFileSync(menu, "utf8").match(/\[exec\]/g)).toHaveLength(1);
  });

  it("throws instead of exiting when the menu file is missing", () => {
    const exit = vi.spyOn(process, "exit");
    expect(() => addFolder(join(dir, "nope"), "F")).toThrow(/Menu file not found/);
    expect(exit).not.toHaveBeenCalled();
  });

  it("throws when the parent folder does not exist", () => {
    expect(() => addFolder(menu, "Child", "Missing")).toThrow(/Parent folder 'Missing' does not exist/);
  });

  it("nests a folder inside an existing parent", () => {
    addFolder(menu, "Parent");
    addFolder(menu, "Child", "Parent");
    const text = readFileSync(menu, "utf8");
    expect(text.indexOf("(Child)")).toBeGreaterThan(text.indexOf("(Parent)"));
  });
});
