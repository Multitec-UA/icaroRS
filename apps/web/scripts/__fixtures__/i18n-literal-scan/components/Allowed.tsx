// Fixture: a literal that matches a fixture-local allowlist entry exactly
// (file + text) — the scanner must not flag it, and must count the entry as
// used rather than stale.
export function Allowed() {
  return <p>Deliberately allowed literal</p>;
}
