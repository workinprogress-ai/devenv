// Unit tests for domain/cs/csproj.ts — csproj and Directory.Packages.props
// read as XML: every spelling of a package reference, target-framework lists,
// comment handling, central package management, and the in-place rewrites.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addLangVersionAfterTargetFramework,
  centralPackageVersions,
  csprojPackageReferences,
  hasLangVersion,
  packageIdFromNupkgName,
  packageReferencesOf,
  parseXml,
  removeLangVersionLines,
  rewriteTargetFrameworks,
  setLangVersion,
  targetFrameworksOf,
} from "../../lib/domain/cs/csproj.ts";

describe("parseXml", () => {
  it("builds a tree and decodes attribute entities", () => {
    const root = parseXml('<?xml version="1.0"?><A x="a&amp;b"><B/><C>t</C></A>');
    const a = root.children[0];
    expect(a?.name).toBe("A");
    expect(a?.attrs["x"]).toBe("a&b");
    expect(a?.children.map((c) => c.name)).toEqual(["B", "C"]);
    expect(a?.children[1]?.text).toBe("t");
  });

  it("keeps CDATA content as text and drops comments", () => {
    const root = parseXml("<A><!-- <B/> --><V><![CDATA[1.0<x]]></V></A>");
    const a = root.children[0];
    expect(a?.children.map((c) => c.name)).toEqual(["V"]);
    expect(a?.children[0]?.text).toContain("1.0");
  });

  it("does not throw on unbalanced input", () => {
    expect(() => parseXml("<A><B></A></C><D")).not.toThrow();
  });
});

describe("packageReferencesOf", () => {
  it("reads Include/Version in either attribute order", () => {
    const refs = packageReferencesOf(
      '<Project><ItemGroup><PackageReference Include="A" Version="1.0.0" /><PackageReference Version="2.0.0" Include="B"/></ItemGroup></Project>',
    );
    expect(refs).toEqual([
      { name: "A", version: "1.0.0" },
      { name: "B", version: "2.0.0" },
    ]);
  });

  it("reads a Version child element and the Update spelling", () => {
    const refs = packageReferencesOf(
      `<Project><ItemGroup>
        <PackageReference Include="A"><Version>3.1.0</Version></PackageReference>
        <PackageReference Update="B" Version="4.0.0" />
      </ItemGroup></Project>`,
    );
    expect(refs).toEqual([
      { name: "A", version: "3.1.0" },
      { name: "B", version: "4.0.0" },
    ]);
  });

  it("ignores commented-out references and Remove items", () => {
    const refs = packageReferencesOf(
      '<Project><ItemGroup><!-- <PackageReference Include="Old" Version="1.0.0" /> --><PackageReference Remove="X" /></ItemGroup></Project>',
    );
    expect(refs).toEqual([]);
  });

  it("takes versions from the central map when the project states none", () => {
    const refs = packageReferencesOf(
      '<Project><ItemGroup><PackageReference Include="A" /><PackageReference Include="B" VersionOverride="9.9.9" /></ItemGroup></Project>',
      new Map([["A", "1.2.3"], ["B", "1.0.0"]]),
    );
    expect(refs).toEqual([
      { name: "A", version: "1.2.3" },
      { name: "B", version: "9.9.9" },
    ]);
  });

  it("reports an empty version when none is reachable", () => {
    expect(packageReferencesOf('<Project><PackageReference Include="A" /></Project>')).toEqual([{ name: "A", version: "" }]);
  });
});

describe("central package management on disk", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csproj-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("centralPackageVersions reads attribute and element versions", () => {
    const map = centralPackageVersions(
      '<Project><ItemGroup><PackageVersion Include="A" Version="1.0.0" /><PackageVersion Include="B"><Version>2.0.0</Version></PackageVersion></ItemGroup></Project>',
    );
    expect(map.get("A")).toBe("1.0.0");
    expect(map.get("B")).toBe("2.0.0");
  });

  it("resolves versions from the nearest props file inside the repo root", () => {
    mkdirSync(join(dir, "src", "Lib"), { recursive: true });
    writeFileSync(join(dir, "Directory.Packages.props"), '<Project><ItemGroup><PackageVersion Include="A" Version="7.0.0" /></ItemGroup></Project>');
    const csproj = join(dir, "src", "Lib", "Lib.csproj");
    writeFileSync(csproj, '<Project><ItemGroup><PackageReference Include="A" /></ItemGroup></Project>');
    expect(csprojPackageReferences(csproj, dir)).toEqual([{ name: "A", version: "7.0.0" }]);
  });

  it("never consults a props file above the repo root", () => {
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(dir, "Directory.Packages.props"), '<Project><ItemGroup><PackageVersion Include="A" Version="7.0.0" /></ItemGroup></Project>');
    const csproj = join(repo, "Lib.csproj");
    writeFileSync(csproj, '<Project><ItemGroup><PackageReference Include="A" /></ItemGroup></Project>');
    expect(csprojPackageReferences(csproj, repo)).toEqual([{ name: "A", version: "" }]);
  });
});

describe("targetFrameworksOf / hasLangVersion", () => {
  it("lists a single framework and every entry of a list, once each", () => {
    expect(targetFrameworksOf("<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>")).toEqual(["net8.0"]);
    expect(
      targetFrameworksOf(
        "<Project><PropertyGroup><TargetFrameworks>netstandard2.0; net8.0;net8.0</TargetFrameworks></PropertyGroup></Project>",
      ),
    ).toEqual(["netstandard2.0", "net8.0"]);
  });

  it("ignores commented-out frameworks", () => {
    expect(targetFrameworksOf("<Project><!-- <TargetFramework>net6.0</TargetFramework> --></Project>")).toEqual([]);
  });

  it("detects LangVersion with or without attributes, not in comments", () => {
    expect(hasLangVersion('<Project><LangVersion Condition="x">12.0</LangVersion></Project>')).toBe(true);
    expect(hasLangVersion("<Project><!-- <LangVersion>12.0</LangVersion> --></Project>")).toBe(false);
  });
});

describe("rewrites", () => {
  const toNet10 = (t: string): string => (/^net\d+\.\d+(-.+)?$/.test(t) ? t.replace(/^net\d+\.\d+/, "net10.0") : t);

  it("keeps the element name and non-matching entries of a multi-target list", () => {
    const out = rewriteTargetFrameworks(
      "<PropertyGroup><TargetFrameworks>netstandard2.0;net8.0;net9.0</TargetFrameworks></PropertyGroup>",
      toNet10,
    );
    expect(out).toBe("<PropertyGroup><TargetFrameworks>netstandard2.0;net10.0</TargetFrameworks></PropertyGroup>");
  });

  it("keeps a single-framework element and a platform suffix", () => {
    expect(rewriteTargetFrameworks("<TargetFramework>net8.0-windows</TargetFramework>", toNet10)).toBe(
      "<TargetFramework>net10.0-windows</TargetFramework>",
    );
  });

  it("leaves commented-out frameworks alone", () => {
    const text = "<!-- <TargetFramework>net8.0</TargetFramework> -->";
    expect(rewriteTargetFrameworks(text, toNet10)).toBe(text);
  });

  it("sets, removes and adds LangVersion", () => {
    expect(setLangVersion("<LangVersion>12.0</LangVersion>", "14.0")).toBe("<LangVersion>14.0</LangVersion>");
    expect(removeLangVersionLines("a\n  <LangVersion>12.0</LangVersion>\nb")).toBe("a\nb");
    expect(addLangVersionAfterTargetFramework("  <TargetFramework>net8.0</TargetFramework>\n", "14.0")).toBe(
      "  <TargetFramework>net8.0</TargetFramework>\n  <LangVersion>14.0</LangVersion>\n",
    );
  });
});

describe("packageIdFromNupkgName", () => {
  it.each([
    ["Lib.Common.1.2.3.nupkg", "Lib.Common"],
    ["Lib.Common.1.2.3-beta.4.nupkg", "Lib.Common"],
    ["Lib.Common.1.2.3.4.snupkg", "Lib.Common"],
    ["Lib.Common.1.2.nupkg", "Lib.Common"],
    ["Lib.2.Common.1.0.0+build5.nupkg", "Lib.2.Common"],
  ])("%s -> %s", (file, id) => {
    expect(packageIdFromNupkgName(file)).toBe(id);
  });

  it("returns null when no version is present", () => {
    expect(packageIdFromNupkgName("Lib.Common.nupkg")).toBeNull();
  });
});
