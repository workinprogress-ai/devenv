// domain/cs/csproj.ts — read .csproj / Directory.Packages.props as XML
// (no external parser): package references in every spelling MSBuild accepts
// (Include or Update, Version attribute or child element, central package
// management) and the target-framework list. Attribute order and layout never
// matter, and commented-out markup is ignored.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Parse XML text into an element tree rooted at a synthetic document node.
 * Comments and processing instructions are dropped, CDATA sections become
 * ordinary text; unbalanced input yields whatever was well-formed up to the
 * break rather than throwing. */
export function parseXml(xml: string): XmlElement {
  const clean = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, body: string) => escapeText(body))
    .replace(/<\?[\s\S]*?\?>/g, "");
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let last = 0;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(clean); m !== null; m = TAG_RE.exec(clean)) {
    const top = stack[stack.length - 1] as XmlElement;
    top.text += clean.slice(last, m.index);
    last = TAG_RE.lastIndex;
    const [, closing, name, attrText, selfClosing] = m as unknown as [string, string, string, string, string];
    if (closing === "/") {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    for (let a = ATTR_RE.exec(attrText); a !== null; a = ATTR_RE.exec(attrText)) {
      attrs[a[1] as string] = decodeEntities(a[2] ?? a[3] ?? "");
    }
    const el: XmlElement = { name, attrs, children: [], text: "" };
    top.children.push(el);
    if (selfClosing !== "/") stack.push(el);
  }
  return root;
}

function descendants(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

function childText(el: XmlElement, name: string): string {
  const c = el.children.find((x) => x.name === name);
  return c === undefined ? "" : decodeEntities(c.text).trim();
}

export interface PackageRef {
  name: string;
  /** Empty when no version is declared anywhere reachable. */
  version: string;
}

/** `PackageVersion` entries of a Directory.Packages.props (central package
 * management), name -> version. */
export function centralPackageVersions(propsText: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of descendants(parseXml(propsText), "PackageVersion")) {
    const name = el.attrs["Include"] ?? el.attrs["Update"];
    const version = el.attrs["Version"] ?? childText(el, "Version");
    if (name !== undefined && version !== "") map.set(name, version);
  }
  return map;
}

/** The nearest Directory.Packages.props at or above `dir`, never looking
 * above `stopAt`. */
function nearestCentralProps(dir: string, stopAt: string): string | null {
  let cur = resolve(dir);
  const top = resolve(stopAt);
  for (;;) {
    const candidate = join(cur, "Directory.Packages.props");
    if (existsSync(candidate)) return candidate;
    if (cur === top || cur === dirname(cur) || cur === parse(cur).root) return null;
    cur = dirname(cur);
  }
}

/** Package references of a csproj text. `central` supplies versions the
 * project does not state itself (central package management). */
export function packageReferencesOf(csprojText: string, central: Map<string, string> = new Map()): PackageRef[] {
  const out: PackageRef[] = [];
  for (const el of descendants(parseXml(csprojText), "PackageReference")) {
    const name = el.attrs["Include"] ?? el.attrs["Update"];
    if (name === undefined || name === "") continue;
    const version = el.attrs["Version"] ?? el.attrs["VersionOverride"] ?? (childText(el, "Version") || childText(el, "VersionOverride"));
    out.push({ name, version: version !== "" ? version : (central.get(name) ?? "") });
  }
  return out;
}

/** Package references of a csproj file, resolving central versions from the
 * nearest Directory.Packages.props between the project and `repoRoot`
 * (a props file above the repository is never consulted). */
export function csprojPackageReferences(csprojPath: string, repoRoot: string): PackageRef[] {
  const text = readFileSync(csprojPath, "utf8");
  const propsPath = nearestCentralProps(dirname(csprojPath), repoRoot);
  const central = propsPath === null ? new Map<string, string>() : centralPackageVersions(readFileSync(propsPath, "utf8"));
  return packageReferencesOf(text, central);
}

/** Target frameworks declared by a csproj text (TargetFramework and every
 * entry of TargetFrameworks, in declaration order, unique). */
export function targetFrameworksOf(csprojText: string): string[] {
  const root = parseXml(csprojText);
  const seen: string[] = [];
  for (const name of ["TargetFramework", "TargetFrameworks"]) {
    for (const el of descendants(root, name)) {
      for (const t of decodeEntities(el.text).split(";")) {
        const v = t.trim();
        if (v !== "" && !seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

function commentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function insideAny(ranges: Array<[number, number]>, at: number): boolean {
  return ranges.some(([from, to]) => at >= from && at < to);
}

/** Rewrite the text content of every `<TargetFramework>` and
 * `<TargetFrameworks>` element (commented-out ones untouched). Each entry is
 * passed to `mapEntry`; the element keeps its name, attributes and entry
 * order, entries that map to the same value collapse into one. */
export function rewriteTargetFrameworks(csprojText: string, mapEntry: (tfm: string) => string): string {
  const comments = commentRanges(csprojText);
  return csprojText.replace(
    /(<(TargetFrameworks?)(?:\s[^>]*)?>)([^<]*)(<\/\2\s*>)/g,
    (whole: string, open: string, _name: string, body: string, close: string, offset: number) => {
      if (insideAny(comments, offset)) return whole;
      const next: string[] = [];
      for (const raw of body.split(";")) {
        const entry = raw.trim();
        if (entry === "") continue;
        const mapped = mapEntry(entry);
        if (!next.includes(mapped)) next.push(mapped);
      }
      return `${open}${next.join(";")}${close}`;
    },
  );
}

/** Set the text of every `<LangVersion>` element (commented-out ones
 * untouched). */
export function setLangVersion(csprojText: string, version: string): string {
  const comments = commentRanges(csprojText);
  return csprojText.replace(
    /(<LangVersion(?:\s[^>]*)?>)[^<]*(<\/LangVersion\s*>)/g,
    (whole: string, open: string, close: string, offset: number) =>
      insideAny(comments, offset) ? whole : `${open}${version}${close}`,
  );
}

/** Remove every `<LangVersion>` element that sits alone on its line. */
export function removeLangVersionLines(csprojText: string): string {
  return csprojText
    .split("\n")
    .filter((l) => !/^[ \t]*<LangVersion(?:\s[^>]*)?>[^<]*<\/LangVersion\s*>[ \t]*\r?$/.test(l))
    .join("\n");
}

/** Insert a `<LangVersion>` line (same indentation) after the first
 * `<TargetFramework>`/`<TargetFrameworks>` line. Unchanged when the project
 * has no such line. */
export function addLangVersionAfterTargetFramework(csprojText: string, version: string): string {
  return csprojText.replace(
    /^([ \t]*)(<TargetFrameworks?(?:\s[^>]*)?>[^<]*<\/TargetFrameworks?\s*>)/m,
    `$1$2\n$1<LangVersion>${version}</LangVersion>`,
  );
}

/** Whether a csproj text declares a LangVersion element. */
export function hasLangVersion(csprojText: string): boolean {
  return descendants(parseXml(csprojText), "LangVersion").length > 0;
}

/** Package id of a nupkg/snupkg file name: the name minus the trailing
 * version (two to four numeric parts, optional prerelease and build metadata)
 * and extension. Null when the name carries no version. */
export function packageIdFromNupkgName(fileName: string): string | null {
  const m = /^(.+?)\.\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\.s?nupkg$/.exec(fileName);
  return m === null ? null : (m[1] as string);
}
