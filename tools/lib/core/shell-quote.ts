// Quote a value for assignment in a sourced bash file: a plain token stays
// readable and unquoted; anything else is single-quoted with embedded
// single quotes escaped, so nothing in the value is ever expanded or executed.
// A value with line breaks uses the ANSI-C form so every assignment stays on
// one physical line (line-based replacement relies on that).
export function bashQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (/[\r\n]/.test(value)) {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
    return `$'${escaped}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
