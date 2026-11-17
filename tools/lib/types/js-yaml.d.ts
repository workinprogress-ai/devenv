// js-yaml ships no types; only the safe-schema load used by the issues-config
// and batch-manifest readers is declared.
declare module "js-yaml" {
  export interface LoadOptions {
    schema?: unknown;
    filename?: string;
  }
  export const JSON_SCHEMA: unknown;
  export function load(input: string, options?: LoadOptions): unknown;
}
