// A path to go back to after an action, from a form or query string. Only a path on this site:
// no other host, no backslash, no whitespace or control characters (a browser drops a tab or a
// newline, which would turn "/\t/evil.example" into "//evil.example").
export function safePath(next: string, fallback: string): string {
  return /^\/(?![/\\])[^\s\\\x00-\x1f\x7f]*$/.test(next) ? next : fallback;
}
