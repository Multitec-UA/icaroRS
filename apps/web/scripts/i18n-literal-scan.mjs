/**
 * Untranslated-JSX-literal scanner (issue #54).
 *
 * npm run i18n:check only ever validated catalog PARITY (en.json vs es.json)
 * — it has no way to see a JSX literal that never called t() in the first
 * place, so a hardcoded English string in a component is invisible to it.
 * This module closes that gap: it parses every non-test .ts/.tsx file under
 * components/ and app/ with the TypeScript compiler API (already a
 * devDependency — no new dependency needed) and flags:
 *
 *   1. Non-trivial JSX text content (a JsxText child with at least one
 *      letter) that isn't inside a t()/plural() call.
 *   2. String-literal `aria-label`, `placeholder`, `alt`, or `title`
 *      attribute values containing at least one letter — including a
 *      literal reachable through a `{cond ? "a" : "b"}` ternary, not just a
 *      bare `attr="…"` — see literalStringsIn() below.
 *   3. Copy fields of an exported Next.js `metadata` / `generateMetadata`
 *      (issue #103). These are user-facing strings — browser tab, bookmarks,
 *      history, link previews, search results — but they live in a plain
 *      object literal at module scope, NOT in JSX, so rules 1 and 2 are
 *      structurally incapable of seeing them. That blind spot is how
 *      app/layout.tsx kept a hardcoded English title while this check
 *      reported the app clean.
 *
 * A finding is a real leak unless it's explicitly exempted in
 * i18n-literal-allowlist.mjs (file + exact text), so an allowlist edit is
 * always a visible, reviewable decision rather than a silent carve-out.
 *
 * False-negative by design: this is a heuristic syntactic scan, not a
 * translation-completeness proof. It catches literal string content; it
 * does not (and cannot, without a full type/data-flow analysis) catch every
 * conceivable way English could leak into the UI. It closes the exact class
 * of leak issue #54 found — hand-typed copy that never reached t() — which
 * is what CI actually needs to gate on.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ALLOWLIST } from "./i18n-literal-allowlist.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");

const SCAN_DIRS = ["components", "app"];
const CHECKED_ATTRIBUTES = new Set(["aria-label", "placeholder", "alt", "title"]);
const HAS_LETTER = /\p{L}/u;

/**
 * Property names inside an exported `metadata` / `generateMetadata` whose
 * value is human-readable copy rather than configuration. The scan walks the
 * whole metadata subtree, so nesting is covered for free: `openGraph.title`,
 * `twitter.description` and `title.default` all match by name.
 *
 * Deliberately a name allowlist rather than "every string in the object" —
 * `metadataBase`, `robots`, `icons`, `themeColor` and friends are machine
 * values that must NOT be translated.
 */
const METADATA_COPY_FIELDS = new Set([
  "title",
  "description",
  "siteName",
  "applicationName",
  "default",
]);

/** Exported names whose value Next.js treats as route metadata. */
const METADATA_EXPORTS = new Set(["metadata", "generateMetadata"]);

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively yield every `.ts`/`.tsx` file under `dir`, skipping tests.
 *
 * `.ts` is included for the metadata rule only: JSX cannot appear in a `.ts`
 * file, so rules 1 and 2 simply never fire there, but a `page.ts` exporting
 * `metadata` is valid Next.js and would otherwise be a hole in rule 3.
 */
function* walkSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSourceFiles(full);
    } else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

/**
 * Extracts every plain string-literal value reachable from a JSX attribute
 * initializer, including through a `{cond ? "a" : "b"}` ternary — a common
 * enough pattern (e.g. `aria-label={active ? "Español" : "English"}`) that
 * skipping it would miss real leaks. Deliberately does NOT walk into a
 * CallExpression (so `{cond ? t("a") : t("b")}` and `{cond ? t("a") : "b"}`
 * only report the still-untranslated "b" branch, not a false positive on the
 * already-correct t() branch), a TemplateExpression, or an Identifier — this
 * is a targeted heuristic, not a full data-flow analysis.
 */
function literalStringsIn(node) {
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isJsxExpression(node) && node.expression) return literalStringsIn(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...literalStringsIn(node.whenTrue), ...literalStringsIn(node.whenFalse)];
  }
  if (ts.isParenthesizedExpression(node)) return literalStringsIn(node.expression);
  return [];
}

/** The static name of a property assignment, or null if it's computed. */
function propertyNameOf(node) {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

/**
 * Returns the nodes to search for hardcoded metadata copy: the initializer of
 * an exported `metadata` (or `generateMetadata`) variable, and the body of an
 * exported `generateMetadata` function. Anything else — a metadata object
 * built in a helper, or assembled from identifiers — is out of reach here,
 * the same deliberate heuristic boundary literalStringsIn() documents.
 */
function metadataRootsIn(sourceFile) {
  const roots = [];
  for (const statement of sourceFile.statements) {
    const isExported = statement.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && METADATA_EXPORTS.has(decl.name.text) && decl.initializer) {
          roots.push(decl.initializer);
        }
      }
    } else if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      METADATA_EXPORTS.has(statement.name.text) &&
      statement.body
    ) {
      roots.push(statement.body);
    }
  }
  return roots;
}

// ---------------------------------------------------------------------------
// AST scan
// ---------------------------------------------------------------------------

/**
 * @param {string} absPath
 * @returns {{ line: number, text: string, kind: string }[]}
 */
function scanFile(absPath) {
  const source = readFileSync(absPath, "utf8");
  const sourceFile = ts.createSourceFile(
    absPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    // A `.ts` file must be parsed as TS, not TSX: in TSX, `<Foo>bar` is a JSX
    // element rather than a type assertion, so the wrong kind misparses it.
    absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const trimmed = node.text.trim().replace(/\s+/g, " ");
      if (trimmed.length > 0 && HAS_LETTER.test(trimmed)) {
        findings.push({ line: lineOf(node), text: trimmed, kind: "JSX text" });
      }
    } else if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile);
      if (CHECKED_ATTRIBUTES.has(attrName) && node.initializer) {
        for (const value of literalStringsIn(node.initializer)) {
          if (HAS_LETTER.test(value)) {
            findings.push({ line: lineOf(node), text: value, kind: `attribute "${attrName}"` });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Rule 3 — metadata copy. Walked separately from `visit` because it is
  // scoped to the exported metadata subtree: the same `title: "…"` property
  // anywhere else in the file is ordinary configuration, not UI copy.
  function visitMetadata(node) {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameOf(node);
      if (name && METADATA_COPY_FIELDS.has(name)) {
        for (const value of literalStringsIn(node.initializer)) {
          if (HAS_LETTER.test(value)) {
            findings.push({ line: lineOf(node), text: value, kind: `metadata "${name}"` });
          }
        }
      }
    }
    ts.forEachChild(node, visitMetadata);
  }

  for (const root of metadataRootsIn(sourceFile)) visitMetadata(root);

  return findings;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Scans components/ and app/ for untranslated literals.
 *
 * `root` and `scanDirs`/`allowlist` are overridable purely so the test suite
 * (i18n-literal-scan.test.mjs) can point this at an isolated fixture
 * directory with a deliberately planted literal, instead of coupling every
 * test run to this repo's real, ever-changing component tree. Production
 * usage (check-i18n.mjs) always calls this with no arguments.
 *
 * @param {{ root?: string, scanDirs?: string[], allowlist?: typeof ALLOWLIST }} [options]
 * @returns {{
 *   violations: { file: string, line: number, text: string, kind: string }[],
 *   unusedAllowlistEntries: typeof ALLOWLIST,
 * }}
 */
export function scanForUntranslatedLiterals(options = {}) {
  const root = options.root ?? webRoot;
  const scanDirs = options.scanDirs ?? SCAN_DIRS;
  const allowlist = options.allowlist ?? ALLOWLIST;

  const violations = [];
  const usedAllowlistEntries = new Set();

  for (const dirName of scanDirs) {
    const dir = join(root, dirName);
    for (const absPath of walkSourceFiles(dir)) {
      // Normalize to POSIX separators so allowlist entries and reported
      // paths are stable across platforms (Windows contributors included).
      const relPath = relative(root, absPath).split(/[\\/]/).join("/");

      for (const finding of scanFile(absPath)) {
        const allowlistIndex = allowlist.findIndex(
          (entry) => entry.file === relPath && entry.text === finding.text,
        );
        if (allowlistIndex !== -1) {
          usedAllowlistEntries.add(allowlistIndex);
          continue;
        }
        violations.push({ file: relPath, line: finding.line, text: finding.text, kind: finding.kind });
      }
    }
  }

  // An allowlist entry the scanner's AST rules didn't trigger on this run is
  // not necessarily stale — e.g. the OpenStreetMap attribution lives in a
  // custom `attribution` prop, not one of CHECKED_ATTRIBUTES, so it's
  // exempted by scope rather than by a scan match. Only flag an entry whose
  // exact text isn't present ANYWHERE in its file anymore — that's the
  // signal the underlying literal actually moved, changed, or was deleted,
  // and the allowlist entry has rotted into stale documentation.
  const staleAllowlistEntries = allowlist.filter((entry, i) => {
    if (usedAllowlistEntries.has(i)) return false;
    const absPath = join(root, ...entry.file.split("/"));
    let source;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      return true; // file itself no longer exists — definitely stale
    }
    return !source.includes(entry.text);
  });

  return { violations, unusedAllowlistEntries: staleAllowlistEntries };
}
