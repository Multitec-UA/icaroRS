// Fixture: every user-facing string goes through t() — the scanner must not
// flag anything in this file.
export function Clean({ t }: { t: (key: string) => string }) {
  return (
    <div>
      <span aria-label={t("clean.label")}>{t("clean.text")}</span>
      <input placeholder={t("clean.placeholder")} />
    </div>
  );
}
