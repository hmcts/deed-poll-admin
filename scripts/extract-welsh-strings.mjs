#!/usr/bin/env node

/**
 * Extracts every English string a translator needs, as a CSV.
 *
 * The service carries `en` and `cy` on every page with matching keys, but `cy` holds English pending
 * translation. This produces the list to send out, and is re-runnable so it stays right as content
 * changes rather than being a snapshot that silently goes stale.
 *
 *   node scripts/extract-welsh-strings.mjs            # writes .business_context/welsh-translation-request.csv
 *   node scripts/extract-welsh-strings.mjs --check    # exits 1 if any cy value is still identical to en
 *
 * **The source is parsed, not imported.** These are page modules: importing one pulls in the domain and
 * therefore Prisma, so reading the AST keeps this a text operation with no database and no build step.
 *
 * **Scope is the deed-poll pages plus the shared locale files.** `pages/onboarding/**` is template demo
 * content that nothing in this service links to, and `pages/(footer)/**` arrived already translated —
 * paying to translate either would be waste. That boundary is a judgement call, so it is stated here
 * rather than buried in a glob.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".business_context", "welsh-translation-request.csv");

const INCLUDE = [path.join(ROOT, "apps/web/src/pages/deed-polls"), path.join(ROOT, "apps/web/src/locales")];

const checkOnly = process.argv.includes("--check");

const rows = [];
const needsHuman = [];
/** Keyed by the unit a translator sees. `locales/{en,cy}.ts` are one unit split across two files. */
const groups = new Map();

for (const dir of INCLUDE) {
  for (const file of walk(dir)) collect(file);
}

for (const [group, { en, cy, cyMirrorsEn }] of groups) {
  for (const [key, value] of Object.entries(en ?? {})) {
    // `const cy = { ...en }` is the shape most pages use: every key not explicitly overridden holds the
    // English string by construction. Reporting those as "no cy key" would hide the entire problem this
    // script exists to measure.
    const current = cy?.[key] ?? (cyMirrorsEn ? value : undefined);
    rows.push({ file: group, key, en: value, cy: current });
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key));

const untranslated = rows.filter((r) => r.cy !== undefined && r.cy === r.en);

if (checkOnly) {
  console.log(`${rows.length} strings, ${untranslated.length} still identical in cy`);
  if (untranslated.length > 0) process.exitCode = 1;
} else {
  const csv = [
    "file,key,english,current_welsh,needs_translation",
    ...rows.map((r) =>
      [r.file, r.key, csvCell(r.en), csvCell(r.cy ?? ""), r.cy === undefined ? "no cy key" : r.cy === r.en ? "YES" : "already translated"].join(",")
    )
  ].join("\n");
  writeFileSync(OUT, `${csv}\n`);
  console.log(`Wrote ${rows.length} strings to ${path.relative(ROOT, OUT)}`);
  console.log(`  ${untranslated.length} still need translating`);
  if (needsHuman.length > 0) {
    console.log(`\n${needsHuman.length} interpolated string(s) a translator must be briefed on, not just given:`);
    for (const n of needsHuman) console.log(`  ${n}`);
  }
}

function collect(file) {
  const relative = path.relative(ROOT, file);
  const isLocaleFile = relative.includes("src/locales/");
  // The two locale files are one translation unit, so they share a group and merge into one row set.
  const group = isLocaleFile ? path.dirname(relative) : relative;
  const entry = groups.get(group) ?? { en: undefined, cy: undefined, cyMirrorsEn: false };

  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);

  ts.forEachChild(source, (node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined;
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue;

      // `locales/en.ts` and `locales/cy.ts` both export `content`, so the locale comes from the filename.
      const which = name === "content" ? (path.basename(relative, ".ts") === "cy" ? "cy" : "en") : name;
      if (which !== "en" && which !== "cy") continue;

      if (which === "cy" && spreadsEn(decl.initializer)) entry.cyMirrorsEn = true;
      entry[which] = { ...(entry[which] ?? {}), ...flatten(decl.initializer, "", relative) };
    }
  });

  groups.set(group, entry);
}

/** True for `const cy = { ...en }`, with or without explicit overrides alongside the spread. */
function spreadsEn(objectLiteral) {
  return objectLiteral.properties.some((prop) => ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression) && prop.expression.text === "en");
}

function flatten(objectLiteral, prefix, relative) {
  const out = {};
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (!key) continue;
    const full = prefix ? `${prefix}.${key}` : key;

    if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
      out[full] = prop.initializer.text;
    } else if (ts.isObjectLiteralExpression(prop.initializer)) {
      Object.assign(out, flatten(prop.initializer, full, relative));
    } else if (ts.isTemplateExpression(prop.initializer)) {
      // Carries a runtime value, so a translator needs the shape and what substitutes in, not the text.
      out[full] = prop.initializer.getText();
      needsHuman.push(`${relative} → ${full}`);
    }
  }
  return out;
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(full);
  }
  return found;
}
