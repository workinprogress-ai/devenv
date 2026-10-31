// Flat config; one config for all TS under tools/. Types are not style:
// this rides the same CI job as `tsc --noEmit`.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/", "tmp/", "playground/", "write_file/", ".local-artifacts/",
      // Machine-managed repo cache (refreshed by repo-cache-update) can hold
      // third-party TS snapshots — never lint them.
      "tools/cache/"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Named constants only — the suite-wide exit-code contract.
      "no-constant-condition": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      // Strip-only execution: Node's native type stripping rejects
      // parameter properties, enums, and namespaces — keep sources inside
      // the strip-only subset so every module is natively runnable.
      // (typescript-eslint v8 dropped no-parameter-properties; the generic
      // selector ban below covers the same syntax.)
      "no-restricted-syntax": [
        "error",
        {
          "selector": "TSParameterProperty",
          "message": "Parameter properties are not supported by Node's strip-only TypeScript execution — declare the field explicitly.",
        },
        {
          "selector": "TSEnumDeclaration",
          "message": "Enums are not supported by Node's strip-only TypeScript execution — use a const object with a union type.",
        },
        {
          "selector": "TSNamespaceDeclaration",
          "message": "Namespaces are not supported by Node's strip-only TypeScript execution — use modules.",
        },
      ],
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
