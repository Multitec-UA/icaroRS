// Fixture: a deliberately planted leak of each kind the scanner should catch.
export function Leaky({ active, t }: { active: boolean; t: (key: string) => string }) {
  return (
    <div>
      {/* Plain JSX text leak. */}
      <p>Planted text leak</p>
      {/* Attribute leak, bare string form. */}
      <input placeholder="Planted placeholder leak" />
      {/* Attribute leak reachable only through a ternary — the "b" branch
          here is untranslated even though the "a" branch correctly calls
          t(); the scanner must still catch "b". */}
      <span aria-label={active ? t("leaky.a") : "Planted ternary leak"} />
    </div>
  );
}
