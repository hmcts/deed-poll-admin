#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOGUE_PATH = join(__dirname, "../templates/tech-spec-references/welsh-translations.json");

const catalogue = JSON.parse(readFileSync(CATALOGUE_PATH, "utf8"));

const MARKER_REGEX = /\[TRANSLATE:\s*"([^"]+)"\]/g;

function translateMarkers(content) {
  return content.replace(MARKER_REGEX, (_match, englishText) => {
    const welsh = catalogue[englishText];
    if (welsh !== undefined) {
      return welsh;
    }
    return `[WELSH TRANSLATION REQUIRED: "${englishText}"]`;
  });
}

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const output = translateMarkers(input);
  process.stdout.write(output);
});
