// Fixture: a *.test.tsx file with a planted leak that must be skipped — test
// fixtures are correctly untranslated (see the real check-i18n.mjs's
// exclusion for test files, and issue #54's note that title= literals inside
// .test.tsx fixtures are intentional and must not be "fixed").
export function Ignored() {
  return <p>This leak must never be reported — it lives in a test file</p>;
}
